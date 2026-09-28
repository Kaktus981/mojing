import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { NovelGenerationEstimate } from '../../contracts/src'
import { emptyWorldDetails, WorldBibleSchema, WorldEntrySchema } from '../../contracts/src'
import type { ProviderService } from './ai/provider'
import { NovelDatabaseService } from './novelDatabase'
import { NovelGenerationService, outputBudgetFor, styleProfileInstruction, WorldFoundationDraftSchema } from './novelGeneration'
import { makeNovel } from './novelTestFactory'
import { establishPlanningDigestBaseline } from './novelPlanning'
import { providerConfigDigest } from './ai/provider'

const estimate: NovelGenerationEstimate = {
  estimatedInputTokens: 1_250,
  estimatedOutputTokens: 4_000,
  contextWindow: 60_000,
  warnings: ['大纲仍为草稿。'],
  entries: [
    { id: 'world-core', category: '世界观', title: '核心规则', included: true, reason: '用户已经定稿。', authority: '最高', estimatedTokens: 800, priority: 100, trimmed: false },
    { id: 'old-chapter', category: '远期召回', title: '旧章节', included: false, reason: '上下文容量不足，按优先级排除。', authority: '参考', estimatedTokens: 450, priority: 50, trimmed: false }
  ]
}

describe('小说 AI 生成历史', () => {
  const temporaryDirectories: string[] = []
  afterEach(() => temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

  it('持久记录上下文、进度事件和待确认结果', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    database.createGenerationJob('job-1', project.id, 'chapter', estimate)
    expect(database.startGenerationJob('job-1')).toBe(true)
    expect(database.appendGenerationJobProgress('job-1', 42, '正在创作正文…')).toBe(true)
    expect(database.completeGenerationJob('job-1', { proposalId: 'proposal-1' })).toBe(true)

    const job = database.getGenerationJob('job-1')!
    expect(job).toMatchObject({ status: '待确认', progress: 100, proposalId: 'proposal-1', estimatedInputTokens: 1_250, estimatedOutputTokens: 4_000, contextWindow: 60_000 })
    expect(job.contextEntries.map((entry) => [entry.included, entry.reason])).toEqual([
      [true, '用户已经定稿。'],
      [false, '上下文容量不足，按优先级排除。']
    ])
    expect(job.events.map((event) => event.progress)).toEqual([0, 2, 42, 100])
    expect(database.listGenerationJobs(project.id)).toHaveLength(1)
    database.markGenerationProposalHandled('proposal-1')
    expect(database.getGenerationJob('job-1')).toMatchObject({ status: '完成', message: '生成候选已处理。' })
    database.close()
  })

  it('世界观任务显示受控输出预算，并使用精简基础草案 Schema', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const generation = new NovelGenerationService(database, {} as ProviderService)
    expect(generation.estimate(project.id, { kind: 'world-foundation', baseRevision: project.revision, qualityProfile: 'standard', acknowledgedDraftPlanning: false }).estimatedOutputTokens).toBe(4_500)
    expect(outputBudgetFor('world-section')).toBe(2_500)
    const completeSize = JSON.stringify(zodResponseFormat(WorldBibleSchema, 'complete_world').json_schema.schema).length
    const foundationSize = JSON.stringify(zodResponseFormat(WorldFoundationDraftSchema, 'world_foundation').json_schema.schema).length
    expect(foundationSize).toBeLessThan(completeSize / 2)
    database.close()
  })

  it('局部世界观生成把目标类型写入结构约束，能力与资源不会退化成角色词条', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const cultivation = WorldEntrySchema.parse({
      id: 'cultivation-clock-gap', type: '修行体系', name: '校隙法', aliases: [], tags: ['时间校准'],
      summary: '通过校准钟表误差辨认时间异常。', notes: '', locked: false, aiVisibility: '按需召回', relations: [], customFields: {},
      details: emptyWorldDetails('修行体系')
    })
    const role = WorldEntrySchema.parse({
      id: 'character-apprentice', type: '角色', name: '修表学徒', aliases: [], tags: [], summary: '', notes: '', locked: false,
      aiVisibility: '按需召回', relations: [], customFields: {}, details: emptyWorldDetails('角色')
    })
    const generate = vi.fn().mockImplementation(async (request: { schema: { safeParse(value: unknown): { success: boolean } }; schemaName: string }) => {
      expect(request.schemaName).toBe('mojing_world_entry_cultivation')
      expect(request.schema.safeParse(cultivation).success).toBe(true)
      expect(request.schema.safeParse(role).success).toBe(false)
      return cultivation
    })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)

    const result = await generation.run(project.id, { kind: 'world-section', worldEntryType: '修行体系', baseRevision: project.revision })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(database.getRevision(result.proposalId!)).toMatchObject({
      kind: 'world-section', target: 'worldBible', candidate: { type: '修行体系', name: '校隙法' }
    })
    database.close()
  })

  it('世界观审校支持单个词条候选，并将证据路径绑定在词条根节点', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const entry = WorldEntrySchema.parse({
      id: 'cultivation-entry', type: '修行体系', name: '校隙法', aliases: [], tags: [],
      summary: '异骨资源枯竭。', notes: '', locked: false, aiVisibility: '按需召回', relations: [], customFields: {}, details: emptyWorldDetails('修行体系')
    })
    const proposal = database.saveRevision({ id: 'entry-audit-proposal', projectId: project.id, kind: 'world-section', target: 'worldBible', targetId: entry.id, baseRevision: project.revision, summary: '修行体系词条', candidate: entry, status: '待处理', createdAt: new Date().toISOString() })
    const generate = vi.fn().mockResolvedValue({ findings: [{ type: '术语误用', severity: '高', confidence: .99, evidence: { fieldPath: '/summary', excerpt: '异骨资源枯竭。' }, constraintIds: [], explanation: '先天结构不能直接当作资源。', suggestedReplacement: '具异骨者数量减少。' }] })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)
    const result = await generation.run(project.id, { kind: 'world-audit', proposalId: proposal.id, baseRevision: project.revision })
    expect(result.proposalId).toBe(proposal.id)
    const audited = database.getRevision(proposal.id)
    expect(audited.qualityFindings?.[0]).toMatchObject({ evidence: { fieldPath: '/summary', excerpt: '异骨资源枯竭。' } })
    expect(generate.mock.calls[0]?.[0].user).toContain('当前审校范围仅为“校隙法”修行体系词条')
    database.close()
  })

  it('故事方向可以由 AI 生成待确认候选，并保留作者决定的问题', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    project.directionQuestions = ['故事最不能失去什么？', '希望读者先感到什么？']
    project.directionQuestionAnswers = ['不能失去会改变记忆的潮声。', '先对主角产生共情。']
    database.createProject(project)
    const card = (title: string) => ({ title, genreDirection: '原创悬疑长篇', logline: `${title}的一句话故事`, protagonistIdentity: '处于弱势的调查者', protagonistSituation: '发现异常但缺乏证据', protagonistGoal: '查明真相', mainObstacle: '信息被有意分割', specialPremise: '真相只对部分角色可见', cost: '每次调查都会损失信任', failureConsequence: '幕后者完成布局', centralMystery: '谁在隐藏真相', readingExperience: '证据重组与人物成长', openingSituation: '从一次选择开始', unresolvedQuestions: ['主角最不能失去什么？'] })
    const generate = vi.fn().mockResolvedValue({ cards: [card('方向甲'), card('方向乙'), card('方向丙')], questions: ['第一卷结尾需要确认哪项改变？'] })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)
    const result = await generation.run(project.id, { kind: 'story-direction', baseRevision: project.revision, qualityProfile: 'standard' })
    expect(result.proposalId).toBeTruthy()
    const proposal = database.getRevision(result.proposalId!)
    expect(proposal).toMatchObject({ kind: 'story-direction', target: 'directionCards', targetId: 'direction-cards', status: '待处理' })
    expect((proposal.candidate as { cards: Array<{ status: string }>; questions: string[] }).cards).toHaveLength(3)
    expect((proposal.candidate as { cards: Array<{ status: string; failureConsequence: string }>; questions: string[] }).cards.every((item) => item.status === '候选')).toBe(true)
    expect((proposal.candidate as { cards: Array<{ failureConsequence: string }>; questions: string[] }).cards[0]?.failureConsequence).toBe('幕后者完成布局')
    expect((proposal.candidate as { cards: Array<{ status: string }>; questions: string[] }).questions).toEqual(['第一卷结尾需要确认哪项改变？'])
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'mojing_story_direction', maxOutputTokens: 2_500 })
    expect(generate.mock.calls[0]?.[0].user).toContain('作者对重新提问的回答')
    expect(generate.mock.calls[0]?.[0].user).toContain('不能失去会改变记忆的潮声。')
    expect(generate.mock.calls[0]?.[0].user).toContain('先对主角产生共情。')
    expect(database.getProject(project.id).directionCards ?? []).toHaveLength(0)
    database.close()
  })

  it('重新生成方向卡时强制保留作者已确定的完整字段', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    const now = new Date().toISOString()
    project.directionCards = [{
      id: 'adopted-direction', version: 1, title: '作者方向', premise: '调查者追查被删除的身份。', protagonistHook: '旧城调查者', coreConflict: '证据被分割', emotionalPromise: '悬念推进', openingSituation: '证件上的名字发生变化',
      genreDirection: '作者锁定的玄幻悬疑', logline: '调查者追查被删除的身份。', protagonistIdentity: '旧城调查者', protagonistSituation: '受到监视', protagonistGoal: '找回身份记录', mainObstacle: '证据被分割', specialPremise: '记忆改变道路', cost: '失去信任', failureConsequence: '身份被替换', centralMystery: '谁删除了名字', readingExperience: '证据重组',
      fieldStatuses: { genreDirection: '作者已确定', protagonistGoal: '作者已确定', cost: '暂时采用' }, unresolvedQuestions: [], status: '已采用', createdAt: now, updatedAt: now
    }]
    project.activeDirectionCardId = 'adopted-direction'
    database.createProject(project)
    const generatedCard = { title: '模型新方向', genreDirection: '模型错误改写的题材', logline: '另一版故事', protagonistIdentity: '陌生人', protagonistSituation: '处于困境', protagonistGoal: '模型错误改写的目标', mainObstacle: '新阻力', specialPremise: '新设定', cost: '新代价', failureConsequence: '新后果', centralMystery: '新悬念', readingExperience: '新体验', openingSituation: '新开篇', unresolvedQuestions: [] }
    const generate = vi.fn().mockResolvedValue({ cards: [generatedCard, { ...generatedCard, title: '模型新方向二' }, { ...generatedCard, title: '模型新方向三' }], questions: [] })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)
    const result = await generation.run(project.id, { kind: 'story-direction', baseRevision: project.revision, qualityProfile: 'standard' })
    const cards = (database.getRevision(result.proposalId!).candidate as { cards: Array<{ genreDirection: string; protagonistGoal: string; cost: string; fieldStatuses: Record<string, string> }> }).cards
    expect(cards.every((card) => card.genreDirection === '作者锁定的玄幻悬疑' && card.protagonistGoal === '找回身份记录')).toBe(true)
    expect(cards.every((card) => card.cost === '新代价')).toBe(true)
    expect(cards[0]?.fieldStatuses).toMatchObject({ genreDirection: '作者已确定', protagonistGoal: '作者已确定', cost: '暂时采用' })
    expect(generate.mock.calls[0]?.[0].user).toContain('作者锁定的玄幻悬疑')
    database.close()
  })

  it('术语提取和世界观审校拥有独立且受控的 Token 预算', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const generation = new NovelGenerationService(database, {} as ProviderService)
    for (const kind of ['world-constraint-extraction', 'world-audit', 'world-repair-suggestion'] as const) {
      const request = { kind, baseRevision: project.revision, qualityProfile: 'standard' as const, acknowledgedDraftPlanning: false }
      const estimated = generation.estimate(project.id, request)
      expect(estimated.estimatedOutputTokens).toBe(outputBudgetFor(kind))
      expect(estimated.estimatedOutputTokens).toBeGreaterThan(0)
      expect(estimated.estimatedOutputTokens).toBeLessThanOrEqual(outputBudgetFor('world-foundation'))
    }
    database.close()
  })

  it('生成前估算会显示当前模型的长输出实测能力，并在预算偏高时提醒分段', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    const provider = database.saveProvider({ id: 'estimate-capability', name: '预算测试模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-test', contextWindow: 32_000, maxOutputTokens: 16_000, outputTokenParameter: 'auto', supportsStreaming: true, supportsJsonSchema: false, hasApiKey: false })
    database.createProject(project)
    database.insertProviderOutputTest({ providerId: provider.id, providerName: provider.name, model: provider.model, baseUrl: provider.baseUrl, contextWindow: provider.contextWindow, outputTokenParameter: provider.outputTokenParameter ?? 'auto', supportsStreaming: provider.supportsStreaming, supportsJsonSchema: provider.supportsJsonSchema, testMode: '流式', targetOutputTokens: 9_000, outputTokens: 2_900, finishReason: 'stop', ok: true, message: '测试通过', latencyMs: 100, configDigest: providerConfigDigest(provider), testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
    const generation = new NovelGenerationService(database, {} as ProviderService)
    const estimated = generation.estimate(project.id, { kind: 'world-foundation', baseRevision: project.revision, providerId: provider.id, qualityProfile: 'standard', acknowledgedDraftPlanning: false })
    expect(estimated.outputCapability).toMatchObject({ status: '已验证', sampleCount: 1, maxOutputTokens: 2_900 })
    expect(estimated.warnings.some((warning) => warning.includes('低于本次任务预算'))).toBe(true)
    database.close()
  })

  it('取消后不会被迟到的完成结果覆盖', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    database.createGenerationJob('job-cancel', project.id, 'chapter', estimate)
    database.startGenerationJob('job-cancel')
    expect(database.cancelGenerationJob('job-cancel')).toBe(true)
    expect(database.completeGenerationJob('job-cancel', { proposalId: 'too-late' })).toBe(false)
    expect(database.getGenerationJob('job-cancel')).toMatchObject({ status: '取消', proposalId: undefined })
    database.close()
  })

  it('保存原始请求并将可重试失败任务列为可恢复任务', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const request = { kind: 'chapter' as const, chapterId: project.chapters[0]!.id, baseRevision: project.revision, qualityProfile: 'standard' as const, acknowledgedDraftPlanning: true }
    database.createGenerationJob('job-resumable', project.id, request.kind, estimate, request)
    database.startGenerationJob('job-resumable')
    database.failGenerationJob('job-resumable', { code: 'TIMEOUT', message: '模型响应超时', retryable: true })
    expect(database.getGenerationJob('job-resumable')).toMatchObject({ resumable: true, request, resumeCount: 0 })
    expect(database.listRecoverableGenerationJobs(project.id).map((job) => job.id)).toEqual(['job-resumable'])
    database.close()
  })

  it('重开数据库后保留历史，并把中断中的任务标记为可重试失败', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mojing-generation-history-')); temporaryDirectories.push(directory)
    const path = join(directory, 'mojing.db'), project = makeNovel(1)
    const first = new NovelDatabaseService(path)
    first.createProject(project)
    first.createGenerationJob('job-interrupted', project.id, 'memory-rebuild', estimate)
    first.startGenerationJob('job-interrupted')
    first.appendGenerationJobProgress('job-interrupted', 30, '正在分析章节记忆…')
    first.close()

    const reopened = new NovelDatabaseService(path), job = reopened.getGenerationJob('job-interrupted')!
    expect(job.status).toBe('失败')
    expect(job.error).toEqual({ code: 'JOB_INTERRUPTED', message: '软件关闭后任务已中断，请重新生成。', retryable: true })
    expect(job.events.at(-1)?.message).toBe('正在分析章节记忆…')
    expect(reopened.listGenerationJobs(project.id)).toHaveLength(1)
    reopened.close()
  })

  it('文风画像指令保持无画像空串和已绑定画像的原样内容', () => {
    const project = makeNovel(1)
    expect(styleProfileInstruction(project)).toBe('')
    project.settings.styleProfileSnapshot = {
      profileId: 'style-1', name: '测试画像', description: '短句推进。',
      traits: { sentenceRhythm: '短句', narrativeDistance: '', dialogueStyle: '', descriptionStyle: '', pacing: '', diction: '', paragraphPattern: '', rhetoric: '' },
      guidelines: ['先写动作'], avoidPatterns: ['堆叠形容词'], sourceKind: '用户创建', capturedAt: '2026-09-27T00:00:00.000Z'
    }
    expect(styleProfileInstruction(project)).toBe('\n本项目启用一份作者确认的抽象文风画像。不得根据画像名称猜测或模仿任何具体作者，只能借鉴以下一般写作技法，不得复刻来源作品的句子、专有内容或独特表达：{"文风说明":"短句推进。","写作特征":{"sentenceRhythm":"短句","narrativeDistance":"","dialogueStyle":"","descriptionStyle":"","pacing":"","diction":"","paragraphPattern":"","rhetoric":""},"建议遵守":["先写动作"],"需要避免":["堆叠形容词"]}若画像的修辞倾向与本项目“修辞强度”冲突，必须以修辞强度为上限。')
  })

  it('正文、改稿与剧情分支都把独立修辞档位发给模型', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    project.settings.rhetoricIntensity = 0
    const card = project.outline!.volumes[0]!.chapters[0]!
    card.beats = [{
      id: 'beat-rhetoric', order: 1, title: '检查古钟', purpose: '确认古钟异常', conflict: '守卫正在靠近', outcome: '林砚藏起古钟',
      location: '旧城', timeframe: '夜晚', characterIds: ['char-1'], reveal: '', threadActions: []
    }]
    card.beatStatus = '已确认'
    const now = new Date().toISOString()
    project.branches.push({ id: 'branch-rhetoric', name: '交出古钟', description: '探索林砚主动交出古钟的后果。', baseChapterId: project.chapters[0]!.id, chapters: [], status: '构思中', createdAt: now, updatedAt: now })
    database.createProject(project)
    const generate = vi.fn().mockImplementation(async (request: { schemaName: string }) => {
      if (request.schemaName === 'mojing_scene_prose') return { paragraphs: ['林砚听见脚步，立即把古钟藏进木箱。'] }
      return { title: '古钟初鸣', paragraphs: ['林砚把古钟收好，转身离开。'] }
    })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)
    await generation.run(project.id, { kind: 'chapter', chapterId: project.chapters[0]!.id, baseRevision: project.revision })
    await generation.run(project.id, { kind: 'chapter-revision', chapterId: project.chapters[0]!.id, baseRevision: project.revision })
    await generation.run(project.id, { kind: 'branch', branchId: 'branch-rhetoric', baseRevision: project.revision })

    for (const schemaName of ['mojing_scene_prose', 'mojing_chapter_revision', 'mojing_branch_chapter']) {
      const prompt = generate.mock.calls.map(([request]) => request as { schemaName: string; system: string; user: string }).find((request) => request.schemaName === schemaName)
      expect(prompt?.system).toContain('修辞强度')
      expect(prompt?.system).toContain('极少')
      expect(prompt?.system).toContain('普通段落原则上不主动添加显性比喻')
      expect(prompt?.user).toContain('修辞要求：极少')
    }
    database.close()
  })

  it('卷级规划摘要变化后服务端阻止静默生成，作者确认后才继续', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    const card = project.outline!.volumes[0]!.chapters[0]!
    card.beats = [{
      id: 'beat-stale', order: 1, title: '检查古钟', purpose: '确认古钟异常', conflict: '守卫逼近', outcome: '林砚藏起古钟',
      location: '旧城', timeframe: '夜晚', characterIds: ['char-1'], reveal: '', threadActions: []
    }]
    card.beatStatus = '已确认'
    establishPlanningDigestBaseline(project)
    project.outline!.volumes[0]!.goal = '卷目标已经改变'
    database.createProject(project)
    const generate = vi.fn().mockResolvedValue({ paragraphs: ['林砚在旧城听见脚步，立即藏起古钟。'] })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)

    await expect(generation.run(project.id, { kind: 'chapter', chapterId: project.chapters[0]!.id, baseRevision: project.revision }))
      .rejects.toMatchObject({ code: 'STALE_PLANNING_WARNING' })
    expect(generate).not.toHaveBeenCalled()

    const result = await generation.run(project.id, { kind: 'chapter', chapterId: project.chapters[0]!.id, baseRevision: project.revision, acknowledgedStalePlan: true })
    expect(result.proposalId).toBeTruthy()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(database.getRevision(result.proposalId!)).toMatchObject({ kind: 'chapter', target: 'chapter', status: '待处理' })
    database.close()
  })
})
