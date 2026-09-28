import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MemorySecretStore } from '../../../packages/core/src/secrets'
import { createMojingServer } from './mojingServer'
import { defaultSettings } from '../../../packages/core/src/novelImportExport'
import { importNovelBuffer } from '../../../packages/core/src/novelImportExport'
import { makeNovel } from '../../../packages/core/src/novelTestFactory'
import { AssistantGuideService, type AssistantGuideStructuredRunner } from '../../../packages/core/src/assistantGuideService'
import { assistantGuideAdapters } from '../../../packages/core/src/assistantGuideAdapters'
import { assistantGuideScopeKey, type AssistantGuideTurn } from '../../../packages/contracts/src'
import type { StructuredGenerationRequest } from '../../../packages/core/src/ai/provider'

function readyGuideTurn(): AssistantGuideTurn {
  return {
    analysisSummary: '已聚焦局部审稿。',
    strengths: [{ title: '已有章节上下文', evidenceRefs: ['context.target'] }],
    gaps: [],
    focus: '生成局部审稿候选',
    question: null,
    readyToComplete: true
  }
}

function questionGuideTurn(questionId = 'question-1'): AssistantGuideTurn {
  return {
    analysisSummary: '故事核心已有种子，需要确认主角选择。',
    strengths: [{ title: '目标范围明确', evidenceRefs: ['context.domain'] }],
    gaps: [{ key: 'desire', title: '主角欲望待定', impact: '影响后续大纲生成。', evidenceRefs: ['context.target'] }],
    focus: '确认主角最想守住的东西',
    question: {
      id: questionId,
      text: '主角最想守住什么？',
      whyNow: '它会决定故事核心冲突。',
      options: [
        { id: 'memory', label: '守住记忆', reason: '呼应力量代价。' },
        { id: 'truth', label: '揭开真相', reason: '推动调查主线。' },
        { id: 'city', label: '保护旧城', reason: '建立外部目标。' }
      ],
      allowCustom: true,
      allowSkip: true
    },
    readyToComplete: false
  }
}

function outlineCandidate() {
  return {
    core: '林砚调查古钟，并发现记忆是力量的代价。',
    skeleton: { 开端: '发现古钟', 发展: '追查来源', 转折: '记忆被夺走', 高潮: '公开真相', 结局: '守住重要的人' },
    volumes: [{ volumeNumber: 1, title: '旧城钟声', goal: '查清古钟来源' }],
    storylines: [{ title: '古钟星纹', why: '连接主线悬念' }],
    pending: ['反派动机待确认']
  }
}

async function startModelServer(responses: unknown[]): Promise<{ baseUrl: string; requests: unknown[]; close(): Promise<void> }> {
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      const next = responses.shift()
      response.setHeader('content-type', 'application/json')
      if (next instanceof Error) {
        response.statusCode = 503
        response.end(JSON.stringify({ error: { message: next.message } }))
        return
      }
      response.end(JSON.stringify({
        id: 'chatcmpl-guide-api-test',
        object: 'chat.completion',
        created: 0,
        model: 'guide-test',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(next) } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function createGuideApi(responses: unknown[]) {
  const model = await startModelServer(responses)
  const server = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' })
  const project = { ...makeNovel(1), id: 'guide-api-project' }
  server.database.createProject(project)
  server.database.saveProvider({
    id: 'guide-provider',
    name: '引导 API 测试模型',
    baseUrl: model.baseUrl,
    model: 'guide-test',
    contextWindow: 32_000,
    supportsStreaming: false,
    supportsJsonSchema: true,
    hasApiKey: true
  })
  return { ...server, model, project, headers: { authorization: 'Bearer test' } }
}

class FakeGuideRunner implements AssistantGuideStructuredRunner {
  readonly calls: Array<StructuredGenerationRequest<unknown>> = []

  constructor(private readonly responses: unknown[]) {}

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    this.calls.push(request as StructuredGenerationRequest<unknown>)
    return this.responses.shift() as T
  }
}

describe('墨境本机 API', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

  it('使用独立小说接口创建、保存和列出项目', async () => {
    const { app } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const headers = { authorization: 'Bearer test' }
    const created = await app.inject({ method: 'POST', url: '/api/novels', headers, payload: { title: '墨境测试', seed: '原创故事种子', settings: defaultSettings('玄幻修仙') } })
    expect(created.statusCode).toBe(201)
    const project = created.json()
    // 跟随 NovelProjectSchema 的 transform 目标版本（旧版本读取时统一升级，见 packages/contracts/src/novel.ts）。
    expect(project.schemaVersion).toBe(7)
    expect(project.settings.genreTemplate).toBe('玄幻修仙')
    const listed = await app.inject({ method: 'GET', url: '/api/novels', headers })
    expect(listed.json()[0].title).toBe('墨境测试')
    expect((await app.inject({ method: 'GET', url: '/api/image-providers', headers })).statusCode).toBe(404)
    const preflight = await app.inject({ method: 'OPTIONS', url: `/api/novels/${project.id}`, headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } })
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT')
  })

  it('本地编排预演返回带人工门禁的步骤计划，不调用模型也不改项目', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    const headers = { authorization: 'Bearer test' }
    const before = database.getProject(project.id)
    const response = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/agent-plans/preview`, headers, payload: { intent: '章节创作', chapterId: project.chapters[0]!.id, maxParallel: 2 } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ projectId: project.id, localOnly: true, policy: { autoApply: false, requireHumanGate: true } })
    expect(response.json().steps.map((step: { kind: string }) => step.kind)).toEqual(['scene-beats', 'chapter', 'memory-extraction', 'continuity-audit'])
    expect(database.getProject(project.id).revision).toBe(before.revision)
  })

  it('创作对话记录按项目和阶段查询，删除时不影响正式作品', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    const conversation = database.createCreativeConversation({ projectId: project.id, stage: 'outline', title: '大纲转折讨论' })
    database.appendCreativeMessage({ conversationId: conversation.id, role: 'user', content: '中点转折是否足够有力？', mode: '问题分析', references: [], actions: [], projectRevision: project.revision })
    const headers = { authorization: 'Bearer test' }

    const listed = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-conversations?stage=outline`, headers })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()).toMatchObject([{ title: '大纲转折讨论', messageCount: 1 }])
    const messages = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/creative-conversations/${conversation.id}/messages`, headers })
    expect(messages.json()).toMatchObject([{ role: 'user', content: '中点转折是否足够有力？' }])
    const removed = await app.inject({ method: 'DELETE', url: `/api/novels/${project.id}/creative-conversations/${conversation.id}`, headers })
    expect(removed.statusCode).toBe(204)
    expect(database.getProject(project.id).chapters).toHaveLength(1)
  })

  it('assistant guide API exposes start/current/answer/reanalyze/complete/restart with project-scoped sessions', async () => {
    const guide = await createGuideApi([
      questionGuideTurn('question-1'),
      readyGuideTurn(),
      questionGuideTurn('question-2'),
      {
        turn: readyGuideTurn(),
        resultKind: 'assistant-draft',
        payload: { initialOutline: outlineCandidate() }
      },
      questionGuideTurn('question-restart')
    ])
    apps.push(guide.app)
    const target = { kind: 'story-core' as const, projectId: guide.project.id }
    const scopeKey = assistantGuideScopeKey('outline', target)
    try {
      const started = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/start`,
        headers: guide.headers,
        payload: { domain: 'outline', target }
      })
      expect(started.statusCode).toBe(201)
      expect(started.json()).toMatchObject({ projectId: guide.project.id, domain: 'outline', scopeKey, status: '提问中', turn: { question: { id: 'question-1' } } })
      expect(guide.model.requests).toHaveLength(1)

      const restored = await guide.app.inject({
        method: 'GET',
        url: `/api/novels/${guide.project.id}/assistant-guides/current?domain=outline&scopeKey=${encodeURIComponent(scopeKey)}`,
        headers: guide.headers
      })
      expect(restored.statusCode).toBe(200)
      expect(restored.json().id).toBe(started.json().id)
      expect(guide.model.requests).toHaveLength(1)

      const answered = await guide.app.inject({
        method: 'PUT',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/answer`,
        headers: guide.headers,
        payload: { expectedVersion: started.json().version, questionId: 'question-1', selectedOptionId: 'memory' }
      })
      expect(answered.statusCode).toBe(200)
      expect(answered.json()).toMatchObject({ status: '可生成', confirmedAnswers: [{ selectedOptionLabel: '守住记忆' }] })

      const reanalyzed = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/reanalyze`,
        headers: guide.headers,
        payload: { expectedVersion: answered.json().version }
      })
      expect(reanalyzed.statusCode).toBe(200)
      expect(reanalyzed.json()).toMatchObject({ status: '提问中', confirmedAnswers: [{ selectedOptionLabel: '守住记忆' }], turn: { question: { id: 'question-2' } } })

      const ready = guide.database.saveAssistantGuideSession({ ...reanalyzed.json(), status: '可生成', turn: readyGuideTurn(), version: reanalyzed.json().version + 1, updatedAt: new Date().toISOString() }, reanalyzed.json().version)
      const completed = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/complete`,
        headers: guide.headers,
        payload: { expectedVersion: ready.version }
      })
      expect(completed.statusCode).toBe(200)
      expect(completed.json()).toMatchObject({ status: '已生成', resultRef: { kind: 'assistant-draft' } })
      expect(guide.database.listAssistantCandidateRecords(guide.project.id)).toHaveLength(1)

      const restarted = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/restart`,
        headers: guide.headers,
        payload: { expectedVersion: completed.json().version }
      })
      expect(restarted.statusCode).toBe(200)
      expect(restarted.json()).toMatchObject({ status: '提问中', turn: { question: { id: 'question-restart' } } })
      expect(restarted.json().id).not.toBe(started.json().id)
      expect(guide.database.listAssistantCandidateRecords(guide.project.id)).toHaveLength(1)
    } finally {
      guide.database.close()
      await guide.model.close()
    }
  })

  it('assistant guide API maps stale, cross-project, invalid-target and model failures without mutating answered state', async () => {
    const guide = await createGuideApi([questionGuideTurn('question-1'), new Error('upstream unavailable')])
    const other = { ...makeNovel(1), id: 'other-guide-project' }
    guide.database.createProject(other)
    apps.push(guide.app)
    const target = { kind: 'story-core' as const, projectId: guide.project.id }
    try {
      const started = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/start`,
        headers: guide.headers,
        payload: { domain: 'outline', target }
      })
      expect(started.statusCode).toBe(201)
      const stale = await guide.app.inject({
        method: 'PUT',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/answer`,
        headers: guide.headers,
        payload: { expectedVersion: 1, questionId: 'question-1', selectedOptionId: 'memory' }
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json()).toMatchObject({ error: { code: 'ASSISTANT_GUIDE_VERSION_CONFLICT', retryable: false } })

      const crossed = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${other.id}/assistant-guides/${started.json().id}/reanalyze`,
        headers: guide.headers,
        payload: { expectedVersion: started.json().version }
      })
      expect(crossed.statusCode).toBe(404)
      expect(crossed.json()).toMatchObject({ error: { code: 'ASSISTANT_GUIDE_NOT_FOUND', retryable: false } })

      const invalid = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/start`,
        headers: guide.headers,
        payload: { domain: 'outline', target: { kind: 'world', projectId: guide.project.id } }
      })
      expect(invalid.statusCode).toBe(422)
      expect(invalid.json()).toMatchObject({ error: { code: 'ASSISTANT_GUIDE_TARGET_INVALID', retryable: false } })

      const before = guide.database.getAssistantGuideSession(guide.project.id, started.json().id)
      const failed = await guide.app.inject({
        method: 'PUT',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/answer`,
        headers: guide.headers,
        payload: { expectedVersion: started.json().version, questionId: 'question-1', selectedOptionId: 'memory' }
      })
      expect(failed.statusCode).toBe(503)
      expect(failed.json().error.retryable).toBe(true)
      expect(guide.database.getAssistantGuideSession(guide.project.id, started.json().id)).toEqual(before)
    } finally {
      guide.database.close()
      await guide.model.close()
    }
  })

  it('assistant guide API maps correctable question/state errors to 422 without model calls or session mutation', async () => {
    const guide = await createGuideApi([questionGuideTurn('question-1')])
    apps.push(guide.app)
    const target = { kind: 'story-core' as const, projectId: guide.project.id }
    try {
      const started = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/start`,
        headers: guide.headers,
        payload: { domain: 'outline', target }
      })
      expect(started.statusCode).toBe(201)
      expect(guide.model.requests).toHaveLength(1)
      const before = guide.database.getAssistantGuideSession(guide.project.id, started.json().id)

      const mismatch = await guide.app.inject({
        method: 'PUT',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/answer`,
        headers: guide.headers,
        payload: { expectedVersion: started.json().version, questionId: 'another-question', selectedOptionId: 'memory' }
      })
      expect(mismatch.statusCode).toBe(422)
      expect(mismatch.json()).toMatchObject({ error: { code: 'ASSISTANT_GUIDE_QUESTION_MISMATCH', retryable: false } })
      expect(guide.model.requests).toHaveLength(1)
      expect(guide.database.getAssistantGuideSession(guide.project.id, started.json().id)).toEqual(before)

      const invalidOption = await guide.app.inject({
        method: 'PUT',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/answer`,
        headers: guide.headers,
        payload: { expectedVersion: started.json().version, questionId: 'question-1', selectedOptionId: 'missing-option' }
      })
      expect(invalidOption.statusCode).toBe(422)
      expect(invalidOption.json()).toMatchObject({ error: { code: 'ASSISTANT_GUIDE_OPTION_INVALID', retryable: false } })
      expect(guide.model.requests).toHaveLength(1)
      expect(guide.database.getAssistantGuideSession(guide.project.id, started.json().id)).toEqual(before)

      const notReady = await guide.app.inject({
        method: 'POST',
        url: `/api/novels/${guide.project.id}/assistant-guides/${started.json().id}/complete`,
        headers: guide.headers,
        payload: { expectedVersion: started.json().version }
      })
      expect(notReady.statusCode).toBe(422)
      expect(notReady.json()).toMatchObject({ error: { code: 'ASSISTANT_GUIDE_NOT_READY', retryable: false } })
      expect(guide.model.requests).toHaveLength(1)
      expect(guide.database.getAssistantGuideSession(guide.project.id, started.json().id)).toEqual(before)
    } finally {
      guide.database.close()
      await guide.model.close()
    }
  })

  it('旧漫剧 JSON 会被明确拒绝', async () => {
    await expect(importNovelBuffer('old.json', Buffer.from(JSON.stringify({ schemaVersion: 1, episodes: [] })))).rejects.toThrow('旧漫剧项目不兼容')
  })

  it('损坏 DOCX 返回面向用户的导入错误', async () => {
    await expect(importNovelBuffer('broken.docx', Buffer.from('not-a-docx'))).rejects.toThrow('这份 DOCX 无法读取，文件可能已损坏。')
  })

  it('采用剧情分支时先建立正文差异候选，不直接覆盖正式章节', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1), source = project.chapters[0]!, alternative = { ...structuredClone(source), id: 'branch-chapter', title: '备选第一章' }
    project.branches.push({ id: 'branch-1', name: '另一条路', description: '测试分支', baseChapterId: source.id, chapters: [alternative], status: '可比较', createdAt: project.createdAt, updatedAt: project.updatedAt })
    database.createProject(project)
    const headers = { authorization: 'Bearer test' }
    const proposed = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/branches/branch-1/adopt`, headers, payload: { currentRevision: 0 } })
    expect(proposed.statusCode).toBe(201)
    expect(database.getProject(project.id).chapters[0]?.title).not.toBe('备选第一章')
    const applied = await app.inject({ method: 'POST', url: `/api/revisions/${proposed.json().id}/apply`, headers, payload: { currentRevision: 0 } })
    expect(applied.json().chapters[0].title).toBe('备选第一章')
  })

  it('可以修改待处理世界观候选，保存时不覆盖正式世界观', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    const candidate = structuredClone(project.worldBible)!
    candidate.summary = 'AI 最初候选'
    database.saveRevision({ id: 'world-edit', projectId: project.id, kind: 'world-foundation', target: 'worldBible', baseRevision: project.revision, summary: '世界观候选', candidate, status: '待处理', createdAt: project.createdAt })
    const headers = { authorization: 'Bearer test' }
    const edited = { ...candidate, summary: '用户修改后的世界观候选', themes: ['记忆', '选择'], timeline: [{ id: 'world-event', dateLabel: '新历元年', order: 1, title: '世界事件', description: '完整保留关联资料', entryIds: [candidate.entries[0]!.id], locked: false }] }

    const response = await app.inject({ method: 'PUT', url: '/api/revisions/world-edit', headers, payload: { candidate: edited } })
    expect(response.statusCode).toBe(200)
    expect(response.json().candidate.summary).toBe('用户修改后的世界观候选')
    expect(database.getProject(project.id).worldBible?.summary).toBe('群国争夺星辉资源。')

    const applied = await app.inject({ method: 'POST', url: '/api/revisions/world-edit/apply', headers, payload: { currentRevision: 0 } })
    expect(applied.json().worldBible).toEqual(edited)
    expect(database.listVersions(project.id)[0]).toMatchObject({ reason: '应用候选前：世界观候选', source: 'AI 候选应用' })
  })

  it('高风险世界观冲突阻止普通应用，但允许作者明确强制应用', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1), candidate = structuredClone(project.worldBible)!
    candidate.historySummary = '旧骨资源枯竭。'
    database.createProject(project)
    database.saveRevision({
      id: 'unsafe-world', projectId: project.id, kind: 'world-foundation', target: 'worldBible', baseRevision: project.revision,
      summary: '含高风险冲突的世界观候选', candidate, status: '待处理', createdAt: project.createdAt,
      qualityFindings: [{
        id: 'finding-unsafe', type: '设定冲突', severity: '高', confidence: 1,
        evidence: { fieldPath: '/historySummary', excerpt: '旧骨资源枯竭' }, constraintIds: ['constraint-yigu'], explanation: '异骨不是自然资源。',
        suggestedReplacement: '可合法流通的遗骨日益稀缺。', baseFieldDigest: 'candidate-digest', status: '待处理', source: '本地规则', createdAt: project.createdAt
      }]
    })
    const headers = { authorization: 'Bearer test' }

    const blocked = await app.inject({ method: 'POST', url: '/api/revisions/unsafe-world/apply', headers, payload: { currentRevision: 0 } })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: { code: 'WORLD_QUALITY_CONFLICT' } })
    expect(database.getProject(project.id).worldBible?.historySummary).not.toBe('旧骨资源枯竭。')

    const forced = await app.inject({ method: 'POST', url: '/api/revisions/unsafe-world/apply', headers, payload: { currentRevision: 0, allowQualityConflict: true } })
    expect(forced.statusCode).toBe(200)
    expect(forced.json().worldBible.historySummary).toBe('旧骨资源枯竭。')
  })

  it('引导生成的局部审稿候选可被既有 update/apply 路由消费', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    database.saveProvider({
      id: 'guide-provider',
      name: '引导测试模型',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'guide-test',
      contextWindow: 8_000,
      supportsStreaming: false,
      supportsJsonSchema: true,
      hasApiKey: true
    })
    const runner = new FakeGuideRunner([
      readyGuideTurn(),
      {
        turn: readyGuideTurn(),
        resultKind: 'revision-proposal',
        payload: { summary: '局部审稿候选', finding: { title: '动机跳跃', detail: '当前章缺少承接。', severity: '中' } }
      }
    ])
    const service = new AssistantGuideService(database, runner, assistantGuideAdapters(database))
    const started = await service.start(project.id, { domain: 'delivery', target: { kind: 'chapter', projectId: project.id, objectId: project.chapters[0]!.id } })
    const completed = await service.complete(project.id, started.id, { expectedVersion: started.version })
    const proposalId = completed.resultRef?.kind === 'revision-proposal' ? completed.resultRef.proposalId : ''
    const proposal = database.getRevision(proposalId)
    expect(proposal).toMatchObject({ target: 'branch', targetId: 'reviews' })
    const headers = { authorization: 'Bearer test' }

    const editedCandidate = {
      reviews: [{
        id: 'review-edited',
        chapterId: project.chapters[0]!.id,
        category: '连续性',
        severity: '中',
        title: '动机跳跃（已编辑）',
        description: '用户编辑后的问题描述。',
        evidence: [],
        recommendation: '补一段承接。',
        status: '待处理',
        createdAt: project.createdAt
      }]
    }
    const updated = await app.inject({ method: 'PUT', url: `/api/revisions/${proposalId}`, headers, payload: { candidate: editedCandidate } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().candidate.reviews[0].title).toBe('动机跳跃（已编辑）')

    const applied = await app.inject({ method: 'POST', url: `/api/revisions/${proposalId}/apply`, headers, payload: { currentRevision: project.revision } })
    expect(applied.statusCode).toBe(200)
    expect(applied.json().reviews).toEqual(editedCandidate.reviews)
    expect(applied.json().chapters[0].blocks).toEqual(project.chapters[0]!.blocks)
  })

  it('只删除指定版本，且不会改变当前项目或其他历史版本', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    const headers = { authorization: 'Bearer test' }
    const first = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/checkpoints`, headers, payload: { reason: '准备删除的版本' } })
    const second = await app.inject({ method: 'POST', url: `/api/novels/${project.id}/checkpoints`, headers, payload: { reason: '需要保留的版本' } })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    const firstId = first.json<{ id: string }>().id
    const secondId = second.json<{ id: string }>().id
    const currentBeforeDelete = database.getProject(project.id)

    const removed = await app.inject({ method: 'DELETE', url: `/api/novels/${project.id}/versions/${firstId}`, headers })
    expect(removed.statusCode).toBe(204)
    expect(database.getProject(project.id)).toEqual(currentBeforeDelete)

    const remaining = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/versions`, headers })
    expect(remaining.statusCode).toBe(200)
    expect(remaining.json<Array<{ id: string }>>().map((version) => version.id)).toEqual([secondId])
    const kept = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/versions/${secondId}`, headers })
    expect(kept.statusCode).toBe(200)
    expect(kept.json().id).toBe(project.id)

    const deleted = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/versions/${firstId}`, headers })
    expect(deleted.statusCode).not.toBe(200)
    expect(deleted.json()).toMatchObject({ error: { message: '找不到指定版本。' } })
  })

  it('按项目查询持久化生成历史，并可读取单个任务与兼容的 SSE 终态', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    database.createGenerationJob('history-job', project.id, 'chapter', {
      estimatedInputTokens: 900, estimatedOutputTokens: 4_000, contextWindow: 60_000, warnings: [],
      entries: [{ id: 'outline', category: '大纲', title: '当前章纲', included: true, reason: '当前章节必须使用。', authority: '最高', estimatedTokens: 900, priority: 100, trimmed: false }]
    })
    database.startGenerationJob('history-job')
    database.completeGenerationJob('history-job', { proposalId: 'proposal-history' })
    const headers = { authorization: 'Bearer test' }

    const listed = await app.inject({ method: 'GET', url: `/api/novels/${project.id}/generation-jobs`, headers })
    expect(listed.statusCode).toBe(200)
    expect(listed.json()[0]).toMatchObject({ id: 'history-job', status: '待确认', proposalId: 'proposal-history', estimatedInputTokens: 900 })
    const detail = await app.inject({ method: 'GET', url: '/api/jobs/history-job', headers })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().events).toHaveLength(3)
    const stream = await app.inject({ method: 'GET', url: '/api/jobs/history-job/events', headers })
    expect(stream.statusCode).toBe(200)
    expect(stream.body).toContain('"type":"completed"')
    expect(stream.body).toContain('"proposalId":"proposal-history"')
  })

  it('已删除或从未存在的项目返回 404，不与后端故障混为 500', async () => {
    const { app, database } = await createMojingServer({ databasePath: ':memory:', secretStore: new MemorySecretStore(), sessionToken: 'test', allowedOrigin: 'http://localhost:5173' }); apps.push(app)
    const project = makeNovel(1); database.createProject(project)
    const headers = { authorization: 'Bearer test' }

    expect((await app.inject({ method: 'GET', url: `/api/novels/${project.id}`, headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/api/novels/${project.id}`, headers })).statusCode).toBe(204)

    const gone = await app.inject({ method: 'GET', url: `/api/novels/${project.id}`, headers })
    expect(gone.statusCode).toBe(404)
    expect(gone.json()).toMatchObject({ error: { code: 'NOVEL_NOT_FOUND', retryable: false } })

    // 与「曾经存在但已删除」区分开的另一条路径：编号从未出现在库中。
    const never = await app.inject({ method: 'GET', url: '/api/novels/never-existed', headers })
    expect(never.statusCode).toBe(404)
    expect(never.json()).toMatchObject({ error: { code: 'NOVEL_NOT_FOUND' } })

    // 写路径不能把「项目不存在」报成后端故障，否则前端只能显示模糊失败。
    expect((await app.inject({ method: 'PUT', url: `/api/novels/${project.id}`, headers, payload: { document: { ...project, revision: 0 }, baseRevision: 0 } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PUT', url: `/api/novels/${project.id}/archive`, headers, payload: { archived: true } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/novels/${project.id}/checkpoints`, headers, payload: { reason: '项目已删除' } })).statusCode).toBe(404)
  })
})
