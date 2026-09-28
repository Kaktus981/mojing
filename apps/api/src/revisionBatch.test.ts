import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { makeNovel } from '../../../packages/core/src/novelTestFactory'
import { createMojingServer } from './mojingServer'

describe('修改候选批量处理与方向卡接入', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('一批不同目标候选全部提交；任一候选无效时整批不改变项目', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = server.database.createProject(makeNovel(2))
    const headers = { authorization: 'Bearer test' }
    const now = new Date().toISOString()
    const revised = structuredClone(project.chapters[0]!)
    revised.blocks[0]!.text = '第一章由作者确认的新内容。'
    const second = structuredClone(project.chapters[1]!)
    second.blocks[0]!.text = '第二章由作者确认的新内容。'
    for (const [id, chapter] of [['first', revised], ['second', second]] as const) {
      server.database.saveRevision({ id, projectId: project.id, kind: 'chapter', target: 'chapter', targetId: chapter.id, baseRevision: project.revision, summary: id, candidate: chapter, status: '待处理', createdAt: now })
    }
    const url = `/api/novels/${project.id}/revisions/batch`
    const success = await server.app.inject({ method: 'POST', url, headers, payload: { currentRevision: project.revision, decisions: [{ proposalId: 'first', action: '应用' }, { proposalId: 'second', action: '应用' }] } })
    expect(success.statusCode).toBe(200)
    expect(success.json()).toMatchObject({ status: '全部成功', processedIds: ['first', 'second'], committedRevision: project.revision + 2 })
    expect(server.database.getProject(project.id).chapters.map((chapter) => chapter.blocks[0]?.text)).toEqual(['第一章由作者确认的新内容。', '第二章由作者确认的新内容。'])
    expect(server.database.getRevision('first').status).toBe('已应用')
    expect(server.database.getRevision('second').status).toBe('已应用')
    const history = await server.app.inject({ method: 'GET', url: `/api/novels/${project.id}/revision-proposals`, headers })
    expect(history.json().filter((item: { status: string }) => item.status === '已应用')).toHaveLength(2)

    const latest = server.database.getProject(project.id)
    server.database.saveRevision({ id: 'valid', projectId: project.id, kind: 'chapter', target: 'chapter', targetId: revised.id, baseRevision: latest.revision, summary: 'valid', candidate: revised, status: '待处理', createdAt: now })
    server.database.saveRevision({ id: 'broken', projectId: project.id, kind: 'chapter', target: 'chapter', targetId: 'missing', baseRevision: latest.revision, summary: 'broken', candidate: {}, status: '待处理', createdAt: now })
    const failed = await server.app.inject({ method: 'POST', url, headers, payload: { currentRevision: latest.revision, decisions: [{ proposalId: 'valid', action: '应用' }, { proposalId: 'broken', action: '应用' }] } })
    expect(failed.statusCode).toBeGreaterThanOrEqual(400)
    expect(server.database.getProject(project.id).revision).toBe(latest.revision)
    expect(server.database.getRevision('valid').status).toBe('待处理')
    expect(server.database.getRevision('broken').status).toBe('待处理')
  })

  it('同批先应用章节再应用创作规格时，两条候选仍按共同的起始版本确认', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = server.database.createProject(makeNovel(1))
    const chapter = structuredClone(project.chapters[0]!)
    chapter.blocks[0]!.text = '作者确认的新章节。'
    const now = new Date().toISOString()
    server.database.saveRevision({ id: 'chapter-first', projectId: project.id, kind: 'chapter', target: 'chapter', targetId: chapter.id, baseRevision: project.revision, summary: '章节', candidate: chapter, status: '待处理', createdAt: now })
    server.database.saveRevision({ id: 'settings-second', projectId: project.id, kind: 'writing-specs', target: 'settings', targetId: 'writing-specs', baseRevision: project.revision, summary: '创作规格', candidate: {
      genreTemplate: '悬疑', targetWords: 180_000, plannedVolumes: 3, plannedChapters: 60,
      pointOfView: '第三人称限知', tense: '过去时', audience: '悬疑读者', style: '冷静克制',
      contentLimits: '', rhetoricIntensity: 1
    }, status: '待处理', createdAt: now })

    const result = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/revisions/batch`, headers: { authorization: 'Bearer test' }, payload: {
      currentRevision: project.revision, decisions: [{ proposalId: 'chapter-first', action: '应用' }, { proposalId: 'settings-second', action: '应用' }]
    } })

    expect(result.statusCode).toBe(200)
    expect(result.json()).toMatchObject({ status: '全部成功', committedRevision: project.revision + 2 })
    const saved = server.database.getProject(project.id)
    expect(saved.chapters[0]!.blocks[0]!.text).toBe('作者确认的新章节。')
    expect(saved.settings.targetWords).toBe(180_000)
    expect(server.database.getRevision('chapter-first').status).toBe('已应用')
    expect(server.database.getRevision('settings-second').status).toBe('已应用')
  })

  it('方向卡候选经确认后入库，保留已有问题的回答', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = server.database.createProject({ ...makeNovel(1), directionQuestions: ['主角要付出什么？'], directionQuestionAnswers: ['失去信任'] })
    const now = new Date().toISOString()
    const card = { id: 'direction-1', version: 1, title: '寻找古钟', premise: '少年追查钟声。', protagonistHook: '旧城少年', coreConflict: '真相被隐藏', emotionalPromise: '悬念', openingSituation: '古钟出现', status: '候选' as const, unresolvedQuestions: [], createdAt: now, updatedAt: now }
    server.database.saveRevision({ id: 'directions', projectId: project.id, kind: 'story-direction', target: 'directionCards', targetId: 'direction-cards', baseRevision: project.revision, summary: '新方向', candidate: { cards: [card], questions: ['主角要付出什么？', '谁隐藏真相？'] }, status: '待处理', createdAt: now })
    const result = await server.app.inject({ method: 'POST', url: '/api/revisions/directions/apply', headers: { authorization: 'Bearer test' }, payload: { currentRevision: project.revision } })
    expect(result.statusCode).toBe(200)
    expect(result.json().directionCards).toMatchObject([{ id: 'direction-1', title: '寻找古钟' }])
    expect(result.json().directionQuestionAnswers).toEqual(['失去信任', ''])
  })

  it('故事种子变化后方向卡候选需要明确确认冲突', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const project = server.database.createProject(makeNovel(1))
    const now = new Date().toISOString()
    server.database.saveRevision({ id: 'stale-direction', projectId: project.id, kind: 'story-direction', target: 'directionCards', targetId: 'direction-cards', baseRevision: project.revision, summary: '旧种子的方向', candidate: { cards: [{ id: 'card-1', version: 1, title: '方向', premise: '', protagonistHook: '', coreConflict: '', emotionalPromise: '', openingSituation: '', status: '候选', unresolvedQuestions: [], createdAt: now, updatedAt: now }], questions: [] }, status: '待处理', createdAt: now })
    const latest = server.database.saveProject({ ...project, seed: '种子已改变' }, project.revision, '作者修改种子')
    const headers = { authorization: 'Bearer test' }
    const url = '/api/revisions/stale-direction/apply'
    const blocked = await server.app.inject({ method: 'POST', url, headers, payload: { currentRevision: latest.revision } })
    expect(blocked.statusCode).toBe(409)
    expect(server.database.getProject(project.id).directionCards ?? []).toHaveLength(0)
    const confirmed = await server.app.inject({ method: 'POST', url, headers, payload: { currentRevision: latest.revision, allowConflict: true } })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().directionCards).toHaveLength(1)
  })

  it('创作规格建议经确认才应用，且不覆盖文风绑定等非建议字段', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const source = makeNovel(1)
    source.settings.chapterAutoAnalyze = true
    const project = server.database.createProject(source)
    server.database.saveRevision({ id: 'specs', projectId: project.id, kind: 'writing-specs', target: 'settings', targetId: 'writing-specs', baseRevision: project.revision, summary: '规格建议', candidate: {
      genreTemplate: '悬疑', targetWords: 180_000, plannedVolumes: 3, plannedChapters: 60,
      pointOfView: '第三人称限知', tense: '过去时', audience: '悬疑读者', style: '冷静克制',
      contentLimits: '保留作者限制', rhetoricIntensity: 1
    }, status: '待处理', createdAt: new Date().toISOString() })
    expect(server.database.getProject(project.id).settings.genreTemplate).toBe(project.settings.genreTemplate)
    const applied = await server.app.inject({ method: 'POST', url: '/api/revisions/specs/apply', headers: { authorization: 'Bearer test' }, payload: { currentRevision: project.revision } })
    expect(applied.statusCode).toBe(200)
    expect(applied.json().settings).toMatchObject({ genreTemplate: '悬疑', chapterAutoAnalyze: true, contentLimits: '保留作者限制' })
  })

  it('归档分支不能绕过界面直接生成采用候选', async () => {
    const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
    apps.push(server.app)
    const source = makeNovel(1)
    const chapter = source.chapters[0]!
    const now = new Date().toISOString()
    const project = server.database.createProject({ ...source, branches: [{ id: 'archived-branch', name: '旧分支', description: '', baseChapterId: chapter.id, chapters: [chapter], status: '已归档', sourceDigest: chapter.sourceDigest, baseRevision: source.revision, createdAt: now, updatedAt: now }] })
    const result = await server.app.inject({ method: 'POST', url: `/api/novels/${project.id}/branches/archived-branch/adopt`, headers: { authorization: 'Bearer test' }, payload: { currentRevision: project.revision } })
    expect(result.statusCode).toBeGreaterThanOrEqual(400)
    expect(server.database.listRevisions(project.id)).toHaveLength(0)
  })
})
