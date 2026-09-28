import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { createMojingServer } from './mojingServer'
import { makeNovel } from '../../../packages/core/src/novelTestFactory'

describe('创作席位可恢复工序 API', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  async function setup() {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = makeNovel(1)
    server.database.createProject(project)
    return { ...server, project, headers: { authorization: 'Bearer test' } }
  }

  it('保存并启动运行时只持久化计划，不自动调用模型', async () => {
    const { app, project, headers } = await setup()
    const created = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/orchestration-runs`, headers, payload: { intent: '章节创作', chapterId: project.chapters[0]!.id, maxParallel: 2 } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ status: '草稿', policy: { autoApply: false } })
    const runId = created.json().id
    const started = await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/start`, headers })
    expect(started.statusCode).toBe(200)
    expect(started.json().status).toBe('等待执行')
    expect((await app.inject({ method: 'GET', url: `/api/novels/${project.id}/orchestration-runs`, headers })).json()).toHaveLength(1)
  })

  it('提供中文席位与能力目录，并拒绝把用户能力变成可执行脚本', async () => {
    const { app, project, headers } = await setup()
    const catalog = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-seats`, headers })
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json().seats).toEqual(expect.arrayContaining([expect.objectContaining({ name: '设定校准席', locked: true })]))
    expect(catalog.json().capabilities.every((item: { name: string }) => !item.name.includes('Agent'))).toBe(true)

    const rejected = await app.inject({
      method: 'POST', url: `/api/novels/${project.id}/creative-capabilities`, headers,
      payload: { name: '危险配置', description: '不应保存', taskScopes: ['中文审校'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [], command: 'powershell.exe' }
    })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })

    const seat = catalog.json().seats[0], capability = catalog.json().capabilities[0]
    const configured = await app.inject({ method: 'PUT', url: `/api/novels/${project.id}/creative-seats/${seat.id}`, headers, payload: { enabled: false, providerId: null, capabilityIds: seat.capabilityIds } })
    expect(configured.statusCode).toBe(200)
    expect(configured.json().seats.find((item: { id: string }) => item.id === seat.id).enabled).toBe(false)
    const disabled = await app.inject({ method: 'PUT', url: `/api/novels/${project.id}/creative-capabilities/${capability.id}/enabled`, headers, payload: { enabled: false } })
    expect(disabled.json()).toMatchObject({ id: capability.id, enabled: false })

    const added = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/creative-capabilities`, headers, payload: { name: '克制修辞检查', description: '只检查过度修辞并提供说明。', taskScopes: ['中文审校'], contextScopes: [], permission: '只读分析', constraints: ['不修改正式正文'], taskPreferences: [] } })
    expect(added.statusCode).toBe(201)
    expect(added.json()).toMatchObject({ source: '用户配置', name: '克制修辞检查' })
    expect((await app.inject({ method: 'DELETE', url: `/api/novels/${project.id}/creative-capabilities/${added.json().id}`, headers })).statusCode).toBe(204)
  })

  it('依赖未完成时拒绝执行后续步骤，并支持暂停、继续和取消', async () => {
    const { app, project, headers } = await setup()
    const created = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/orchestration-runs`, headers, payload: { intent: '章节创作', chapterId: project.chapters[0]!.id, maxParallel: 2 } })
    const runId = created.json().id
    await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/start`, headers })
    const run = (await app.inject({ method: 'GET', url: `/api/orchestration-runs/${runId}`, headers })).json()
    const chapterStep = run.steps.find((step: { kind: string }) => step.kind === 'chapter')
    const blocked = await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/steps/${chapterStep.id}/execute`, headers })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: { code: 'ORCHESTRATION_STEP_NOT_READY' } })
    expect((await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/pause`, headers })).json().status).toBe('暂停')
    expect((await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/resume`, headers })).json().status).toBe('等待执行')
    expect((await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/cancel`, headers })).json().status).toBe('取消')
  })

  it('依据既有生成任务调和待确认状态，作者处理候选后才解锁依赖步骤', async () => {
    const { app, database, project, headers } = await setup()
    const created = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/orchestration-runs`, headers, payload: { intent: '章节创作', chapterId: project.chapters[0]!.id, maxParallel: 1 } })
    const runId = created.json().id, beatStep = created.json().steps[0], proposalId = 'beat-proposal'
    await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/start`, headers })
    database.createGenerationJob('beat-job', project.id, 'scene-beats', { estimatedInputTokens: 10, estimatedOutputTokens: 10, contextWindow: 1_000, warnings: [], entries: [] }, { kind: 'scene-beats', baseRevision: project.revision, chapterId: project.chapters[0]!.id, qualityProfile: 'standard', acknowledgedDraftPlanning: true })
    database.startGenerationJob('beat-job')
    database.completeGenerationJob('beat-job', { proposalId })
    database.updateCreativeOrchestrationStep(runId, beatStep.id, { status: '运行中', jobId: 'beat-job', attempt: 1 })

    const pending = (await app.inject({ method: 'GET', url: `/api/orchestration-runs/${runId}`, headers })).json()
    expect(pending).toMatchObject({ status: '待作者确认' })
    expect(pending.steps[0]).toMatchObject({ status: '待作者确认', proposalId })
    expect(pending.steps[1].status).toBe('等待前置')

    database.markGenerationProposalHandled(proposalId)
    const unlocked = (await app.inject({ method: 'GET', url: `/api/orchestration-runs/${runId}`, headers })).json()
    expect(unlocked.steps[0].status).toBe('完成')
    expect(unlocked.steps[1].status).toBe('可执行')
    expect(unlocked.status).toBe('等待执行')
  })

  it('失败步骤可以重置为可执行状态，重试不会改写正文', async () => {
    const { app, database, project, headers } = await setup()
    const created = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/orchestration-runs`, headers, payload: { intent: '长篇复核', maxParallel: 1 } })
    const runId = created.json().id
    const step = created.json().steps[0]
    database.updateCreativeOrchestrationStep(runId, step.id, { status: '失败', error: { code: 'TEST', message: '模拟失败', retryable: true }, endedAt: new Date().toISOString() })
    database.updateCreativeOrchestrationRun(runId, { status: '失败' })
    const retried = await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/steps/${step.id}/retry`, headers })
    expect(retried.statusCode).toBe(200)
    expect(retried.json().steps[0]).toMatchObject({ status: '可执行', attempt: 0 })
    expect(database.getProject(project.id).chapters[0]!.blocks[0]!.text).toContain('林砚')
  })

  it('执行入口遵守运行的并行上限', async () => {
    const { app, database, project, headers } = await setup()
    const created = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/orchestration-runs`, headers, payload: { intent: '长篇复核', maxParallel: 1 } })
    const runId = created.json().id
    await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/start`, headers })
    database.updateCreativeOrchestrationStep(runId, created.json().steps[0].id, { status: '运行中' })
    database.updateCreativeOrchestrationRun(runId, { status: '运行中' })
    const limited = await app.inject({ method: 'POST', url: `/api/orchestration-runs/${runId}/steps/${created.json().steps[1].id}/execute`, headers })
    expect(limited.statusCode).toBe(409)
    expect(limited.json()).toMatchObject({ error: { code: 'ORCHESTRATION_PARALLEL_LIMIT' } })
  })

})
