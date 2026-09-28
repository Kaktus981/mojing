import { describe, expect, it } from 'vitest'
import type { AssistantGuideTurn, InitialOutlineCandidate, NovelPlotThread, NovelProject, WorldEntry } from '../../contracts/src'
import { NovelProjectSchema } from '../../contracts/src'
import type { StructuredGenerationRequest } from './ai/provider'
import { AssistantGuideService, type AssistantGuideStructuredRunner } from './assistantGuideService'
import { assistantGuideContextDigest } from './assistantGuide'
import { assistantGuideAdapter, assistantGuideAdapters } from './assistantGuideAdapters'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import { adoptSettingProposal } from './settingProposals'

function readyTurn(evidenceRef = 'context.target'): AssistantGuideTurn {
  return {
    analysisSummary: '上下文已经足够生成候选。',
    strengths: [{ title: '已有可用依据', evidenceRefs: [evidenceRef] }],
    gaps: [],
    focus: '生成受控候选',
    question: null,
    readyToComplete: true
  }
}

class FakeRunner implements AssistantGuideStructuredRunner {
  readonly calls: Array<StructuredGenerationRequest<unknown>> = []

  constructor(private readonly responses: unknown[]) {}

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    this.calls.push(request as StructuredGenerationRequest<unknown>)
    const response = this.responses.shift()
    return (typeof response === 'function' ? response(request as StructuredGenerationRequest<unknown>) : response) as T
  }
}

function provider(database: NovelDatabaseService) {
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
}

function setup(chapterCount = 2) {
  const database = new NovelDatabaseService(':memory:')
  const project = structuredClone(makeNovel(chapterCount)) as NovelProject
  project.id = 'guide-project'
  project.chapters = project.chapters.map((chapter, index) => ({ ...chapter, id: `body-${index + 1}` }))
  project.outline!.volumes[0]!.chapters = project.outline!.volumes[0]!.chapters.map((card, index) => ({
    ...card,
    id: `outline-${index + 1}`,
    beats: [{
      id: `beat-${index + 1}`,
      order: 1,
      title: `第${index + 1}章第一步`,
      purpose: '推动古钟线索',
      conflict: '是否公开秘密',
      outcome: '林砚继续隐瞒',
      location: '旧城',
      timeframe: '夜晚',
      characterIds: ['char-1'],
      reveal: '古钟会吞掉记忆',
      threadActions: []
    }]
  }))
  project.memories = [{
    id: 'memory-1',
    chapterId: 'body-1',
    chapterNumber: 1,
    status: '正式',
    sourceDigest: 'memory-digest',
    summary: '林砚隐瞒古钟。',
    keyEvents: ['林砚发现古钟'],
    characterStates: [],
    facts: [],
    objectStates: [],
    timelineEvents: [],
    styleSignals: ['短句、克制'],
    updatedAt: project.updatedAt
  }]
  const parsed = NovelProjectSchema.parse(project)
  database.createProject(parsed)
  provider(database)
  return { database, project: parsed }
}

function makeService(database: NovelDatabaseService, responses: unknown[]) {
  const runner = new FakeRunner(responses)
  return { runner, service: new AssistantGuideService(database, runner, assistantGuideAdapters(database)) }
}

async function completeWith(
  database: NovelDatabaseService,
  project: NovelProject,
  domain: Parameters<typeof assistantGuideAdapter>[0],
  target: Parameters<ReturnType<typeof assistantGuideAdapter>['readContext']>[1],
  resultKind: string,
  payload: unknown
) {
  const { runner, service } = makeService(database, [readyTurn(), { turn: readyTurn(), resultKind, payload }])
  const started = await service.start(project.id, { domain, target })
  const completed = await service.complete(project.id, started.id, { expectedVersion: started.version })
  return { runner, completed }
}

function outlineCandidate(): InitialOutlineCandidate {
  return {
    core: '林砚调查古钟，并发现记忆是力量的代价。',
    skeleton: { 开端: '发现古钟', 发展: '追查来源', 转折: '记忆被夺走', 高潮: '公开真相', 结局: '守住重要的人' },
    volumes: [{ volumeNumber: 1, title: '旧城钟声', goal: '查清古钟来源' }],
    storylines: [{ title: '古钟星纹', why: '连接主线悬念' }],
    pending: ['反派动机待确认']
  }
}

function worldEntry(name: string, locked = false): WorldEntry {
  return {
    id: `entry-${name}`,
    type: '地点',
    name,
    aliases: [],
    tags: [],
    summary: `${name}的说明`,
    notes: '',
    locked,
    aiVisibility: '按需召回',
    relations: [],
    customFields: {},
    details: { fields: {}, lists: {} }
  }
}

function guideWorldEntry(name: string) {
  return {
    type: '地点' as const,
    name,
    aliases: [],
    tags: [],
    summary: `${name}的说明`,
    notes: '',
    relations: [],
    customFields: {},
    details: { fields: {}, lists: {} }
  }
}

function addVisibilityEntries(project: NovelProject) {
  project.worldBible!.entries.push(
    { ...worldEntry('公开港'), id: 'entry-visible', summary: 'VISIBLE_SENTINEL', aiVisibility: '始终可见' },
    { ...worldEntry('禁发密库'), id: 'entry-never', summary: 'NEVER_SEND_SENTINEL', aiVisibility: '永不发送' },
    { ...worldEntry('仅审校档案'), id: 'entry-review-only', summary: 'REVIEW_ONLY_SENTINEL', aiVisibility: '仅审校' }
  )
}

describe('assistant guide concrete adapters', () => {
  it('outline 正常完成只创建助手草稿，不伪造旧 GuideSession，也不改正式大纲', async () => {
    const { database, project } = setup()
    const beforeOutline = JSON.stringify(database.getProject(project.id).outline)

    const { runner, completed } = await completeWith(
      database,
      project,
      'outline',
      { kind: 'story-core', projectId: project.id },
      'assistant-draft',
      { initialOutline: outlineCandidate() }
    )

    expect(completed.resultRef?.kind).toBe('assistant-draft')
    expect(database.listGuideSessions(project.id)).toHaveLength(0)
    expect(JSON.stringify(database.getProject(project.id).outline)).toBe(beforeOutline)
    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(1)
    const completeRequest = JSON.parse(runner.calls[1]!.user)
    expect(JSON.stringify(completeRequest.completionContract.outline)).toContain('initialOutline')
    expect(JSON.stringify(completeRequest.completionContract)).toContain('core')
    expect(JSON.stringify(completeRequest.completionContract)).toContain('skeleton')
    database.close()
  })

  it('contextDigest 只绑定精确上下文，不因无关 project revision 增长而变化', () => {
    const { database, project } = setup()
    const target = { kind: 'story-core' as const, projectId: project.id }
    const adapter = assistantGuideAdapter('outline', database)
    const before = assistantGuideContextDigest(adapter.readContext(database.getProject(project.id), target).context)
    const current = database.getProject(project.id)
    database.saveProject({ ...current, title: '只改项目标题，不改故事核心' }, current.revision, '无关字段修改', '测试')

    const after = assistantGuideContextDigest(adapter.readContext(database.getProject(project.id), target).context)

    expect(after).toBe(before)
    database.close()
  })

  it('outline 精确章纲上下文不包含无关故事线或正文引用，但相关章纲变化会 stale', () => {
    const { database, project } = setup(2)
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'outline-1' }
    const adapter = assistantGuideAdapter('outline', database)
    const beforeContext = adapter.readContext(database.getProject(project.id), target).context
    const before = assistantGuideContextDigest(beforeContext)
    expect(JSON.stringify(beforeContext)).not.toContain('writtenChapterRefs')
    expect(JSON.stringify(beforeContext)).not.toContain('storylines')

    const unrelated = database.getProject(project.id)
    database.saveProject({
      ...unrelated,
      storylines: [{
        id: 'unrelated-line',
        title: '无关支线',
        type: '支线',
        whyNecessary: '测试无关上下文',
        openingState: '',
        finalGoal: '',
        endCondition: '',
        characterIds: [],
        entryIds: [],
        relatedPlotThreadIds: [],
        keyNodes: [],
        chapterPlans: [],
        currentProgress: 0,
        costPaid: '',
        unresolvedQuestions: [],
        nextAction: '',
        status: '未开始',
        evidenceChain: [],
        updatedAt: unrelated.updatedAt
      }]
    }, unrelated.revision, '无关故事线', '测试')
    expect(assistantGuideContextDigest(adapter.readContext(database.getProject(project.id), target).context)).toBe(before)

    const related = database.getProject(project.id)
    const edited = structuredClone(related)
    edited.outline!.volumes[0]!.chapters[0]!.objective = '相关章纲目标改变'
    database.saveProject(edited, related.revision, '相关章纲修改', '测试')
    expect(assistantGuideContextDigest(adapter.readContext(database.getProject(project.id), target).context)).not.toBe(before)
    database.close()
  })

  it('outline 越界修改别的章纲会拒绝，且不留下草稿', async () => {
    const { database, project } = setup()
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'outline-1' }
    const { service } = makeService(database, [
      readyTurn(),
      {
        turn: readyTurn(),
        resultKind: 'assistant-draft',
        payload: { localRevision: { chapters: [{ id: 'outline-2', objective: '越界目标', conflict: '越界冲突' }], summary: '越界' } }
      }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toThrow(/当前选中的这一章/)
    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(0)
    database.close()
  })

  it('outline 不兼容 world target，并且在模型调用前拒绝', async () => {
    const { database, project } = setup()
    const { runner, service } = makeService(database, [readyTurn()])

    await expect(service.start(project.id, { domain: 'outline', target: { kind: 'world', projectId: project.id } }))
      .rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_TARGET_INVALID' })
    expect(runner.calls).toHaveLength(0)
    database.close()
  })

  it('world 正常完成只追加设定提案并增加 revision，不改正式 worldBible', async () => {
    const { database, project } = setup()
    const beforeNames = database.getProject(project.id).worldBible!.entries.map((entry) => entry.name)

    const { completed } = await completeWith(
      database,
      project,
      'world',
      { kind: 'world', projectId: project.id },
      'world-setting-proposal',
      {
        title: '新增设定：潮汐港',
        reason: '正文提到了新的港口。',
        proposedEntries: [guideWorldEntry('潮汐港')],
        evidence: { chapterId: 'body-1', chapterNumber: 1, excerpt: '林砚走进潮汐港', inferred: false }
      }
    )

    const after = database.getProject(project.id)
    expect(completed.resultRef?.kind).toBe('world-setting-proposal')
    expect(after.revision).toBe(project.revision + 1)
    expect(after.worldBible!.entries.map((entry) => entry.name)).toEqual(beforeNames)
    expect(after.worldExpansionProposals).toHaveLength(1)
    database.close()
  })

  it('world completionContract 展开模型可写 payload 字段，并排除服务端所有权字段', async () => {
    const { database, project } = setup()

    const { runner } = await completeWith(
      database,
      project,
      'world',
      { kind: 'world', projectId: project.id },
      'world-setting-proposal',
      {
        title: '新增设定：钟潮',
        reason: '补足世界规则。',
        proposedEntries: [guideWorldEntry('钟潮码头')]
      }
    )

    const completeRequest = JSON.parse(runner.calls[1]!.user)
    const serialized = JSON.stringify(completeRequest.completionContract)
    expect(serialized).toContain('proposedEntries')
    expect(serialized).toContain('summary')
    expect(serialized).toContain('relations')
    expect(serialized).toContain('role')
    expect(serialized).toContain('paths')
    expect(serialized).toContain('denominations')
    expect(serialized).toContain('fields')
    expect(serialized).not.toContain('aiVisibility')
    expect(serialized).not.toContain('locked')
    database.close()
  })

  it('world guide 拒绝模型传入条目所有权和策略字段，避免用锁定 ID 改名覆盖正式设定', async () => {
    const { database, project } = setup()
    const editable = database.getProject(project.id)
    editable.worldBible!.entries.push({ ...worldEntry('锁定塔', true), id: 'entry-locked' })
    database.saveProject(editable, editable.revision, '增加锁定条目', '测试')
    const { service } = makeService(database, [
      readyTurn(),
      {
        turn: readyTurn(),
        resultKind: 'world-setting-proposal',
        payload: {
          title: '篡改锁定条目',
          reason: '模型试图用旧 ID 改名绕过锁定。',
          proposedEntries: [{ ...worldEntry('改名后的塔'), id: 'entry-locked', locked: false, aiVisibility: '始终可见' }]
        }
      }
    ])
    const started = await service.start(project.id, { domain: 'world', target: { kind: 'world', projectId: project.id } })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toThrow()
    expect(database.getProject(project.id).worldExpansionProposals ?? []).toHaveLength(0)
    database.close()
  })

  it('world-entry 范围只绑定被选中的现有条目，提案采用后不会新增无关对象', async () => {
    const { database, project } = setup()
    const editable = database.getProject(project.id)
    editable.worldBible!.entries.push({ ...worldEntry('公开港'), id: 'entry-visible', aiVisibility: '始终可见' })
    database.saveProject(editable, editable.revision, '增加可编辑条目', '测试')
    const current = database.getProject(project.id)

    const { completed } = await completeWith(
      database,
      current,
      'world',
      { kind: 'world-entry', projectId: current.id, objectId: 'entry-visible' },
      'world-setting-proposal',
      {
        title: '补全公开港',
        reason: '补充作者选中条目的细节。',
          proposedEntries: [guideWorldEntry('公开港补全')]
      }
    )

    const proposalId = completed.resultRef?.kind === 'world-setting-proposal' ? completed.resultRef.proposalId : ''
    const proposal = database.getProject(current.id).worldExpansionProposals!.find((item) => item.id === proposalId)!
    expect(proposal.proposedEntries).toMatchObject([{ id: 'entry-visible', locked: false, aiVisibility: '始终可见' }])
    const adopted = adoptSettingProposal({ database, project: database.getProject(current.id), proposalId, allowRisk: true })
    expect(adopted.worldBible!.entries.filter((entry) => entry.id === 'entry-visible')).toHaveLength(1)
    expect(adopted.worldBible!.entries.find((entry) => entry.id === 'entry-visible')?.name).toBe('公开港补全')
    database.close()
  })

  it('world context 遵守 aiVisibility，永不发送/仅审校条目不进入创作上下文', () => {
    const { database, project } = setup()
    const editable = database.getProject(project.id)
    addVisibilityEntries(editable)
    database.saveProject(editable, editable.revision, '增加可见性测试词条', '测试')

    const serialized = JSON.stringify(assistantGuideAdapter('world', database).readContext(database.getProject(project.id), { kind: 'world', projectId: project.id }).context)

    expect(serialized).toContain('VISIBLE_SENTINEL')
    expect(serialized).not.toContain('NEVER_SEND_SENTINEL')
    expect(serialized).not.toContain('REVIEW_ONLY_SENTINEL')
    database.close()
  })

  it('world 明确选中永不发送条目也不能绕过禁发约束', () => {
    const { database, project } = setup()
    const editable = database.getProject(project.id)
    addVisibilityEntries(editable)
    database.saveProject(editable, editable.revision, '增加禁发词条', '测试')

    let error: unknown
    try {
      assistantGuideAdapter('world', database).readContext(database.getProject(project.id), {
        kind: 'world-entry',
        projectId: project.id,
        objectId: 'entry-never'
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'ASSISTANT_GUIDE_TARGET_FORBIDDEN' })
    database.close()
  })

  it('world 不兼容 chapter target，并且在模型调用前拒绝', async () => {
    const { database, project } = setup()
    const { runner, service } = makeService(database, [readyTurn()])

    await expect(service.start(project.id, { domain: 'world', target: { kind: 'chapter', projectId: project.id, objectId: 'body-1' } }))
      .rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_TARGET_INVALID' })
    expect(runner.calls).toHaveLength(0)
    database.close()
  })

  it('allowedEvidenceRefs 只包含实际发送的上下文字段，不默认放行未发送的 project.seed', () => {
    const { database, project } = setup()
    const context = assistantGuideAdapter('world', database).readContext(database.getProject(project.id), { kind: 'world', projectId: project.id })

    expect(context.allowedEvidenceRefs).not.toContain('project.seed')
    expect(context.allowedEvidenceRefs).toContain('context.worldBible')
    database.close()
  })

  it('world 不能覆盖锁定设定条目', async () => {
    const { database, project } = setup()
    const target = { kind: 'world', projectId: project.id } as const
    const { service } = makeService(database, [
      readyTurn(),
      {
        turn: readyTurn(),
        resultKind: 'world-setting-proposal',
        payload: {
          title: '覆盖锁定角色',
          reason: '模型想改主角。',
          proposedEntries: [{ ...guideWorldEntry('林砚'), type: '地点' }]
        }
      }
    ])
    const started = await service.start(project.id, { domain: 'world', target })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toThrow(/已经锁定/)
    expect(database.getProject(project.id).worldExpansionProposals ?? []).toHaveLength(0)
    database.close()
  })

  it('writing 正常完成只创建当前正文章的修改候选，不覆盖正文', async () => {
    const { database, project } = setup()
    const beforeBlocks = database.getProject(project.id).chapters[0]!.blocks.map((block) => block.text)

    const { completed } = await completeWith(
      database,
      project,
      'writing',
      { kind: 'chapter', projectId: project.id, objectId: 'body-1' },
      'revision-proposal',
      { title: '古钟回响', paragraphs: ['林砚把古钟藏进袖中。', '夜色里，星纹轻轻发亮。'], summary: '第1章正文候选' }
    )

    const proposals = database.listRevisions(project.id)
    expect(completed.resultRef).toEqual({ kind: 'revision-proposal', proposalId: proposals[0]!.id })
    expect(proposals[0]).toMatchObject({ target: 'chapter', targetId: 'body-1', kind: 'chapter-revision' })
    expect(database.getProject(project.id).chapters[0]!.blocks.map((block) => block.text)).toEqual(beforeBlocks)
    database.close()
  })

  it('writing/memory/delivery completionContract 都提供真实嵌套 schema，而不是文字说明', async () => {
    const writing = setup()
    const writingRun = await completeWith(
      writing.database,
      writing.project,
      'writing',
      { kind: 'chapter', projectId: writing.project.id, objectId: 'body-1' },
      'revision-proposal',
      { paragraphs: ['林砚听见钟声。'] }
    )
    const writingContract = JSON.parse(writingRun.runner.calls[1]!.user).completionContract
    expect(typeof writingContract.writing).toBe('object')
    expect(JSON.stringify(writingContract)).toContain('paragraphs')
    expect(JSON.stringify(writingContract)).toContain('summary')
    writing.database.close()

    const memory = setup()
    const memoryRun = await completeWith(
      memory.database,
      memory.project,
      'memory',
      { kind: 'chapter', projectId: memory.project.id, objectId: 'body-1' },
      'chapter-analysis',
      {}
    )
    const memoryContract = JSON.parse(memoryRun.runner.calls[1]!.user).completionContract
    expect(typeof memoryContract.memory).toBe('object')
    expect(JSON.stringify(memoryContract)).toContain('additionalProperties')
    memory.database.close()

    const delivery = setup()
    const deliveryRun = await completeWith(
      delivery.database,
      delivery.project,
      'delivery',
      { kind: 'outline', projectId: delivery.project.id },
      'export-precheck',
      { format: 'docx' }
    )
    const deliveryContract = JSON.parse(deliveryRun.runner.calls[1]!.user).completionContract
    const serializedDelivery = JSON.stringify(deliveryContract)
    expect(typeof deliveryContract.delivery).toBe('object')
    expect(serializedDelivery).toContain('finding')
    expect(serializedDelivery).toContain('severity')
    expect(serializedDelivery).toContain('category')
    expect(serializedDelivery).toContain('docx')
    expect(serializedDelivery).toContain('txt')
    delivery.database.close()
  })

  it('writing context 不发送禁发世界词条，但保留正常可用词条', () => {
    const { database, project } = setup()
    const editable = database.getProject(project.id)
    addVisibilityEntries(editable)
    database.saveProject(editable, editable.revision, '增加可见性测试词条', '测试')

    const serialized = JSON.stringify(assistantGuideAdapter('writing', database).readContext(database.getProject(project.id), {
      kind: 'chapter',
      projectId: project.id,
      objectId: 'body-1'
    }).context)

    expect(serialized).toContain('VISIBLE_SENTINEL')
    expect(serialized).not.toContain('NEVER_SEND_SENTINEL')
    expect(serialized).not.toContain('REVIEW_ONLY_SENTINEL')
    database.close()
  })

  it('writing 不能用章纲 ID 冒充正文章 ID', async () => {
    const { database, project } = setup()
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'outline-1' }
    const { service } = makeService(database, [
      readyTurn(),
      { turn: readyTurn(), resultKind: 'revision-proposal', payload: { paragraphs: ['越界正文'] } }
    ])

    await expect(service.start(project.id, { domain: 'writing', target }))
      .rejects.toThrow(/正文章节/)
    expect(database.listRevisions(project.id)).toHaveLength(0)
    database.close()
  })

  it('memory 正常完成只排章节分析任务，不直接写正式记忆', async () => {
    const { database, project } = setup()
    const beforeMemory = JSON.stringify(database.getProject(project.id).memories)

    const { completed } = await completeWith(
      database,
      project,
      'memory',
      { kind: 'chapter', projectId: project.id, objectId: 'body-1' },
      'chapter-analysis',
      {}
    )

    expect(completed.resultRef?.kind).toBe('chapter-analysis')
    expect(database.listChapterAnalyses(project.id, 'body-1')).toHaveLength(1)
    expect(JSON.stringify(database.getProject(project.id).memories)).toBe(beforeMemory)
    database.close()
  })

  it('memory context 的角色知识不发送永不发送或仅审校角色详情', () => {
    const { database, project } = setup()
    const editable = database.getProject(project.id)
    editable.worldBible!.entries.push({
      id: 'char-secret',
      type: '角色',
      name: '禁发角色',
      aliases: [],
      tags: [],
      summary: 'NEVER_SEND_CHARACTER_SENTINEL',
      notes: '',
      locked: false,
      aiVisibility: '永不发送',
      relations: [],
      customFields: {},
      details: {
        role: '秘密角色',
        identity: 'NEVER_SEND_IDENTITY_SENTINEL',
        appearance: '',
        personality: '',
        values: [],
        boundaries: [],
        goal: '',
        weakness: '',
        secret: '',
        speechStyle: '',
        arc: ''
      }
    })
    database.saveProject(editable, editable.revision, '增加禁发角色', '测试')

    const serialized = JSON.stringify(assistantGuideAdapter('memory', database).readContext(database.getProject(project.id), {
      kind: 'chapter',
      projectId: project.id,
      objectId: 'body-1'
    }).context)

    expect(serialized).not.toContain('NEVER_SEND_CHARACTER_SENTINEL')
    expect(serialized).not.toContain('NEVER_SEND_IDENTITY_SENTINEL')
    database.close()
  })

  it('memory 不接受模型指定其它 chapterId', async () => {
    const { database, project } = setup()
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'body-1' }
    const { service } = makeService(database, [
      readyTurn(),
      { turn: readyTurn(), resultKind: 'chapter-analysis', payload: { chapterId: 'body-2' } }
    ])
    const started = await service.start(project.id, { domain: 'memory', target })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toThrow()
    expect(database.listChapterAnalyses(project.id)).toHaveLength(0)
    database.close()
  })

  it('delivery 正常完成只返回本地导出预检引用', async () => {
    const { database, project } = setup()

    const { completed } = await completeWith(
      database,
      project,
      'delivery',
      { kind: 'outline', projectId: project.id },
      'export-precheck',
      { format: 'docx' }
    )

    expect(completed.resultRef).toEqual({ kind: 'export-precheck', projectRevision: project.revision, format: 'docx' })
    expect(database.listRevisions(project.id)).toHaveLength(0)
    database.close()
  })

  /**
   * 交付审稿的正文摘录必须是**稳定字符串**。
   *
   * 回归锁：摘录一度用 `normalizeProse` 生成段落对象（每段一个新 `id`），于是同一份正文
   * 两次读取得到的上下文都不同 → 会话摘要每次都变 → 作者每答一题都被判成
   * 「引用的内容变了」，被迫重新分析。这里同时钉住「是真实原文」与「两次读取一致」。
   */
  it('delivery 正文摘录是真实原文且两次读取完全一致（否则每次作答都会变成「需要重新分析」）', () => {
    const { database, project } = setup()
    const adapter = assistantGuideAdapter('delivery', database)

    const first = adapter.readContext(project, { kind: 'outline', projectId: project.id })
    const second = adapter.readContext(project, { kind: 'outline', projectId: project.id })
    const manuscript = (first.context as { manuscript: Array<{ id: string; excerpt: string; excerptTruncated: boolean }> }).manuscript

    expect(manuscript).toHaveLength(project.chapters.length)
    expect(manuscript[0]!.id).toBe(project.chapters[0]!.id)
    for (const item of manuscript) {
      expect(typeof item.excerpt, '摘录必须是字符串原文，不能是段落对象数组').toBe('string')
      expect(item.excerpt.length, '摘录不能是空的').toBeGreaterThan(0)
      expect(item.excerptTruncated).toBe(false)
    }
    expect(manuscript[0]!.excerpt, '摘录必须是当前章节的真实正文').toContain(project.chapters[0]!.blocks[0]!.text)

    expect(
      assistantGuideContextDigest(first.context),
      '同一份正文两次读取的上下文摘要必须一致，否则每次作答都会被要求重新分析'
    ).toBe(assistantGuideContextDigest(second.context))
    database.close()
  })

  /**
   * 回归锁（补缺）：交付审稿的 `memoryFacts` 此前**一条断言都没有** ——
   * 端到端只断言了「是个数组」，单测里根本没碰过。这里把三件事钉住：
   * 只带最近的一批（受上限约束）、带的是**可读内容**而不是 ID 清单、不泄漏记忆主键。
   */
  it('delivery 上下文把已确认记忆投影成可读内容，只取最近的一批，且不泄漏主键', () => {
    const { database, project } = setup()
    const chapterId = project.chapters[0]!.id
    const blockId = project.chapters[0]!.blocks[0]!.id
    const total = 45
    const memories = Array.from({ length: total }, (_, index) => ({
      id: `memory-${index + 1}`,
      chapterId,
      chapterNumber: 1,
      status: '正式' as const,
      sourceDigest: `digest-${index + 1}`,
      summary: `第${index + 1}条已确认记忆`,
      keyEvents: [`第${index + 1}章的关键事件`],
      characterStates: [],
      facts: [{
        id: `fact-${index + 1}`,
        category: '事件' as const,
        content: `第${index + 1}条剧情事实`,
        certainty: '正式' as const,
        locked: false,
        source: { chapterId, blockId, excerpt: '林砚在旧城发现古钟' }
      }],
      objectStates: [],
      timelineEvents: [],
      styleSignals: [],
      updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
    }))
    const current = database.getProject(project.id)
    database.saveProject({ ...current, memories }, current.revision, '测试注入已确认记忆')

    const context = assistantGuideAdapter('delivery', database)
      .readContext(database.getProject(project.id), { kind: 'outline', projectId: project.id }).context as {
        memoryFacts: Array<{ chapterNumber: number; summary: string; keyEvents: string[]; facts: Array<{ category: string; content: string; certainty: string }> }>
      }

    expect(context.memoryFacts, '受上限约束：只取最近的一批，不是全量倒出去').toHaveLength(40)
    expect(context.memoryFacts[0]!.summary, '取的是**最近**的一批（尾部）').toBe(`第${total - 39}条已确认记忆`)
    const latest = context.memoryFacts[context.memoryFacts.length - 1]!
    expect(latest.summary, '带的是可读内容，不是 ID 清单').toBe(`第${total}条已确认记忆`)
    expect(latest.keyEvents).toEqual([`第${total}章的关键事件`])
    expect(latest.facts, '剧情事实按可读字段投影').toEqual([{
      category: '事件',
      content: `第${total}条剧情事实`,
      certainty: '正式'
    }])
    expect(JSON.stringify(context.memoryFacts), '投影里不得出现记忆 / 事实的主键').not.toContain('memory-')
    expect(JSON.stringify(context.memoryFacts)).not.toContain('fact-')
    database.close()
  })

  it('delivery outline 默认作用域可以生成全稿审稿 reviews 候选，采用前不改正式 reviews', async () => {
    const { database, project } = setup()
    const beforeReviews = database.getProject(project.id).reviews
    const { runner, service } = makeService(database, [
      readyTurn(),
      (request: StructuredGenerationRequest<unknown>) => {
        const body = JSON.parse(request.user) as { allowedResultKinds: string[]; completionContract: { delivery: unknown } }
        const deliveryContract = JSON.stringify(body.completionContract.delivery)
        expect(body.allowedResultKinds).toEqual(['revision-proposal', 'export-precheck'])
        expect(deliveryContract).toContain('revision-proposal')
        expect(deliveryContract).toContain('export-precheck')
        return {
          turn: readyTurn(),
          resultKind: 'revision-proposal',
          payload: { summary: '全稿审稿', finding: { title: '伏笔未回收', detail: '全稿范围发现伏笔回收不足。', severity: '中' } }
        }
      }
    ])
    const started = await service.start(project.id, { domain: 'delivery', target: { kind: 'outline', projectId: project.id } })

    const completed = await service.complete(project.id, started.id, { expectedVersion: started.version })

    expect(completed.resultRef?.kind).toBe('revision-proposal')
    const proposal = database.listRevisions(project.id)[0]!
    expect(proposal).toMatchObject({ target: 'branch', targetId: 'reviews' })
    expect((proposal.candidate as { reviews: Array<{ title: string }> }).reviews[0]!.title).toBe('伏笔未回收')
    expect(database.getProject(project.id).reviews).toEqual(beforeReviews)
    expect(runner.calls).toHaveLength(2)
    database.close()
  })

  it('delivery chapter 作用域的 completionContract 只允许局部审稿，不允许 export-precheck', async () => {
    const { database, project } = setup()
    const { runner, service } = makeService(database, [
      readyTurn(),
      (request: StructuredGenerationRequest<unknown>) => {
        const body = JSON.parse(request.user) as { allowedResultKinds: string[]; completionContract: { delivery: unknown } }
        const deliveryContract = JSON.stringify(body.completionContract.delivery)
        expect(body.allowedResultKinds).toEqual(['revision-proposal'])
        expect(deliveryContract).toContain('revision-proposal')
        expect(deliveryContract).not.toContain('export-precheck')
        return { turn: readyTurn(), resultKind: 'revision-proposal', payload: { summary: '局部审稿', finding: { title: '问题', detail: '详情', severity: '中' } } }
      }
    ])
    const started = await service.start(project.id, { domain: 'delivery', target: { kind: 'chapter', projectId: project.id, objectId: 'body-1' } })

    await service.complete(project.id, started.id, { expectedVersion: started.version })

    expect(runner.calls).toHaveLength(2)
    database.close()
  })

  it('delivery chapter 作用域拒绝 whole-project export-precheck，且不写入结果', async () => {
    const { database, project } = setup()
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'body-1' }
    const { service } = makeService(database, [
      readyTurn(),
      { turn: readyTurn(), resultKind: 'export-precheck', payload: { format: 'docx' } }
    ])
    const started = await service.start(project.id, { domain: 'delivery', target })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_RESULT_KIND_INVALID' })
    expect(database.getAssistantGuideSession(project.id, started.id)?.resultRef).toBeNull()
    database.close()
  })

  it('delivery 审稿候选没有 grounded evidence 时不冒充第一段为证据', async () => {
    const { database, project } = setup()

    await completeWith(
      database,
      project,
      'delivery',
      { kind: 'chapter', projectId: project.id, objectId: 'body-1' },
      'revision-proposal',
      { summary: '局部审稿', finding: { title: '问题', detail: '详情', severity: '中' } }
    )

    const proposal = database.listRevisions(project.id)[0]!
    expect(proposal.targetId).toBe('reviews')
    expect((proposal.candidate as { reviews: Array<{ evidence: unknown[] }> }).reviews[0]!.evidence).toEqual([])
    database.close()
  })

  it('delivery 审稿候选提供 evidence 时必须匹配真实 block 与 excerpt', async () => {
    const { database, project } = setup()
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'body-1' }
    const { service } = makeService(database, [
      readyTurn(),
      {
        turn: readyTurn(),
        resultKind: 'revision-proposal',
        payload: {
          summary: '局部审稿',
          finding: { title: '问题', detail: '详情', severity: '中', evidence: { blockId: project.chapters[0]!.blocks[0]!.id, excerpt: '正文里不存在的句子' } }
        }
      }
    ])
    const started = await service.start(project.id, { domain: 'delivery', target })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_EVIDENCE_INVALID' })
    expect(database.listRevisions(project.id)).toHaveLength(0)
    database.close()
  })

  it('delivery/export-precheck 不能被模型改成“可导出”权限结论', async () => {
    const { database, project } = setup()
    const target = { kind: 'outline' as const, projectId: project.id }
    const { service } = makeService(database, [
      readyTurn(),
      { turn: readyTurn(), resultKind: 'export-precheck', payload: { format: 'docx', allowed: true, state: '可导出' } }
    ])
    const started = await service.start(project.id, { domain: 'delivery', target })

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toThrow()
    expect(database.getAssistantGuideSession(project.id, started.id)?.resultRef).toBeNull()
    database.close()
  })

  it('delivery 越界审稿结果不能指向不存在的章节', async () => {
    const { database, project } = setup()
    const target = { kind: 'chapter' as const, projectId: project.id, objectId: 'missing-body' }
    const { service } = makeService(database, [
      readyTurn(),
      { turn: readyTurn(), resultKind: 'revision-proposal', payload: { summary: '越界审稿', finding: { title: '问题', detail: '详情', severity: '中' } } }
    ])

    await expect(service.start(project.id, { domain: 'delivery', target }))
      .rejects.toThrow(/章节/)
    expect(database.listRevisions(project.id)).toHaveLength(0)
    database.close()
  })
})

/**
 * G-2：交付引导的**有界伏笔台账投影**。
 *
 * 背景：交付引导此前已经允许生成审稿候选，但 `DeliveryGuideAdapter.readContext` 只带正文摘录、
 * 总纲、世界事实与已确认记忆 —— **伏笔台账一个字都没有**。而「伏笔闭环」恰恰是交付审稿的主线
 * （`creativeChat.ts` 的自由创作路径早已投影「伏笔准备度与认知差」），于是引导路径出现
 * 「装配了伏笔能力却没有材料」的缺口。这里钉住补齐后的**范围判定、上限、字段白名单、
 * 可见性过滤与证据引用一致性**。
 *
 * 判别性口径：以下用例读的是 `readContext` 的**返回值**（也就是服务端真正塞进出站请求体的那份
 * `context`，见 `assistantGuideService.ts:332` `context: prepared.adapterContext.context`），
 * 不是卡片、不是 `taskScopes`、也不是任何纯函数推算。
 */
describe('交付引导的伏笔台账投影', () => {
  type LedgerThread = {
    title: string
    status: string
    targetPayoffChapter?: number
    characters: string[]
    readiness: { level: string; score: number; gaps: string[] }
    cognitionGap: string
    evidence: Array<{ phase: string; chapterNumber?: number; excerpt: string; excerptTruncated: boolean }>
  }
  type Ledger = {
    scope: string
    scopeNote: string
    limit: number
    total: number
    truncated: boolean
    threads: LedgerThread[]
  }

  /** 取出投影。缺失时给出可读失败信息，而不是让后续断言抛 `undefined` 的类型错。 */
  function ledgerOf(context: unknown): Ledger {
    const ledger = (context as { foreshadowLedger?: unknown }).foreshadowLedger
    expect(ledger, '交付引导上下文必须带上有界伏笔投影 foreshadowLedger').toBeTruthy()
    return ledger as Ledger
  }

  function saveThreads(database: NovelDatabaseService, project: NovelProject, threads: NovelPlotThread[]): NovelProject {
    const current = database.getProject(project.id)
    database.saveProject(
      NovelProjectSchema.parse({ ...current, plotThreads: threads }),
      current.revision,
      '测试注入伏笔台账'
    )
    return database.getProject(project.id)
  }

  function saveEntries(database: NovelDatabaseService, project: NovelProject, entries: WorldEntry[]): NovelProject {
    const current = database.getProject(project.id)
    database.saveProject(
      NovelProjectSchema.parse({ ...current, worldBible: { ...current.worldBible!, entries } }),
      current.revision,
      '测试注入世界词条'
    )
    return database.getProject(project.id)
  }

  /** 以 `makeNovel` 自带的那条伏笔为模板；模板的章节锚点指向 setup() 里已被换掉的章节 ID。 */
  function threadTemplate(project: NovelProject): NovelPlotThread {
    return structuredClone(project.plotThreads[0]!) as NovelPlotThread
  }

  const WHOLE = { kind: 'outline', projectId: 'guide-project' } as const

  it('整稿范围：带上真实伏笔标题、准备度缺口、认知差与证据摘录，且只带字段白名单', () => {
    const { database, project } = setup()
    // 让章节锚点有效：投影应当把它解析成**章号**，而不是把内部章节 ID 发出去。
    // 注意埋设证据自带的 `chapterId` 是它自己的锚点，与 `setupChapterId` 分开，两者都要指向真实章节。
    const current = saveThreads(database, project, [{
      ...threadTemplate(project),
      setupChapterId: 'body-1',
      setupEvidence: { chapterId: 'body-1', excerpt: '刻有星纹的古钟' }
    }])
    const context = assistantGuideAdapter('delivery', database)
      .readContext(current, { kind: 'outline', projectId: current.id }).context as Record<string, unknown>

    const ledger = ledgerOf(context)
    expect(ledger.scope, '整稿范围的投影范围要如实标注').toBe('whole-project')
    expect(ledger.total).toBe(current.plotThreads.length)
    expect(ledger.truncated).toBe(false)

    expect(ledger.threads).toHaveLength(1)
    const thread = ledger.threads[0]!
    expect(thread.title, '带的是可读标题，不是 ID 清单').toBe('古钟星纹')
    expect(thread.status).toBe('推进中')
    expect(thread.targetPayoffChapter, '计划回收章必须如实投影').toBe(2)
    expect(thread.characters, '角色投影只保留可发送的条目名').toEqual(['林砚'])
    expect(typeof thread.readiness.score, '准备度是可解释的分数，不是字符串').toBe('number')
    expect(typeof thread.readiness.level).toBe('string')
    expect(Array.isArray(thread.readiness.gaps), '缺口必须一起给出，作者才知道依据').toBe(true)
    expect(Array.isArray(thread.evidence), '证据要带摘录，否则模型只能凭标题猜').toBe(true)
    expect(thread.evidence[0]!.phase).toBe('埋设')
    expect(thread.evidence[0]!.chapterNumber, '章节锚点能解析时投影成章号').toBe(1)
    expect(thread.evidence[0]!.excerpt).toContain('刻有星纹的古钟')

    expect(
      Object.keys(thread).sort(),
      '投影只带字段白名单，绝不整条转发 plotThreads'
    ).toEqual(['characters', 'cognitionGap', 'evidence', 'readiness', 'status', 'targetPayoffChapter', 'title'])

    const serialized = JSON.stringify(ledger)
    expect(serialized, '不泄漏伏笔主键').not.toContain('thread-clock')
    expect(serialized, '不泄漏正文段落主键').not.toContain(current.chapters[0]!.blocks[0]!.id)
    expect(serialized, '不泄漏内部时间戳（准备度快照的 assessedAt 不能进来）').not.toContain(current.updatedAt)
    expect(serialized, '不泄漏内部字段名').not.toContain('evidencePool')

    // 章节锚点解析不出来时**省略**章号，既不编一个、也不把内部 ID 当章号发出去。
    // 这里故意换回原始模板（它的埋设证据锚点也是失效 ID），让两处锚点都解析不出来。
    const unresolved = saveThreads(database, current, [{ ...threadTemplate(project), setupChapterId: 'missing-chapter' }])
    const unresolvedLedger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(unresolved, { kind: 'outline', projectId: unresolved.id }).context as Record<string, unknown>)
    expect(
      Object.hasOwn(unresolvedLedger.threads[0]!.evidence[0]!, 'chapterNumber'),
      '锚点解析不出来时省略章号'
    ).toBe(false)
    expect(JSON.stringify(unresolvedLedger), '不把内部章节 ID 当章号发出去').not.toContain('missing-chapter')
    database.close()
  })

  it('章节范围：只带上与本审稿章相关的伏笔，后面才埋的不提前泄漏', () => {
    const { database, project } = setup()
    const template = threadTemplate(project)
    // 夹具前提（与实现无关）：`makeNovel` 那条模板伏笔的章节锚点已被 setup() 换成失效 ID，
    // 所以它在本项目的任何章节范围下都“无法确定关联” —— 正好是下面那条空投影用例的前提。
    expect(project.chapters.some((item) => item.id === template.setupChapterId), '夹具前提：锚点必须是失效的').toBe(false)

    const current = saveThreads(database, project, [
      { ...template, id: 'thread-body-1', title: '第一章埋下的钟声', setupChapterId: 'body-1', targetPayoffChapter: undefined },
      { ...template, id: 'thread-body-2', title: '第二章才埋的线索', setupChapterId: 'body-2', targetPayoffChapter: undefined, setupEvidence: { chapterId: 'body-2', excerpt: '第二章的埋设证据' } }
    ])

    const ledger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(current, { kind: 'chapter', projectId: current.id, objectId: 'body-1' }).context as Record<string, unknown>)
    expect(ledger.scope).toBe('chapter')
    expect(ledger.threads.map((item) => item.title), '只带与第 1 章相关的伏笔').toEqual(['第一章埋下的钟声'])
    expect(JSON.stringify(ledger), '第 2 章才埋的伏笔不能提前出现在第 1 章的审稿材料里').not.toContain('第二章才埋的线索')

    const later = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(current, { kind: 'chapter', projectId: current.id, objectId: 'body-2' }).context as Record<string, unknown>)
    expect(later.threads.map((item) => item.title).sort(), '第 2 章范围同时看得到已埋的与本章才埋的').toEqual(['第一章埋下的钟声', '第二章才埋的线索'])
    database.close()
  })

  it('章节范围无法确定关联时给出明确空投影并写明原因，不猜测关联', () => {
    const { database, project } = setup()
    // `makeNovel` 模板伏笔的 setupChapterId 已被 setup() 换成不存在的章节 ID，
    // 且没有 progress 记录 ⇒ 本章内没有可确定的关联伏笔。
    const ledger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(project, { kind: 'chapter', projectId: project.id, objectId: 'body-1' }).context as Record<string, unknown>)

    expect(ledger.scope).toBe('chapter')
    expect(ledger.threads, '无法确定关联时是明确的空投影').toEqual([])
    expect(ledger.total).toBe(0)
    expect(ledger.truncated).toBe(false)
    expect(ledger.scopeNote, '空投影必须写明原因').toContain('不参与猜测')
    database.close()
  })

  it('超过上限时按确定顺序稳定截断：未闭环优先、计划回收章升序，且两次读取完全一致', () => {
    const { database, project } = setup()
    const template = threadTemplate(project)
    const payoffs = [7, 3, 11, 1, 9, 5, 12, 2, 10, 4, 6, 8]
    const current = saveThreads(database, project, [
      ...payoffs.map((payoff, index) => ({
        ...template,
        id: `thread-active-${index}`,
        title: `推进中的伏笔${String(index).padStart(2, '0')}`,
        status: '推进中' as const,
        setupChapterId: 'body-1',
        setupEvidence: { chapterId: 'body-1', excerpt: `计划第 ${payoff} 章的埋设证据` },
        targetPayoffChapter: payoff,
        progress: []
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        ...template,
        id: `thread-done-${index}`,
        title: `已回收的伏笔${index}`,
        status: '已回收' as const,
        setupChapterId: 'body-1',
        resolutionChapterId: 'body-1',
        targetPayoffChapter: undefined,
        progress: []
      })),
      ...Array.from({ length: 9 }, (_, index) => ({
        ...template,
        id: `thread-dropped-${index}`,
        title: `已放弃的伏笔${index}`,
        status: '已放弃' as const,
        setupChapterId: 'body-1',
        archivedAt: project.updatedAt,
        archiveReason: '作者确认不再使用',
        targetPayoffChapter: undefined,
        progress: []
      }))
    ])

    const adapter = assistantGuideAdapter('delivery', database)
    const first = adapter.readContext(current, WHOLE).context as Record<string, unknown>
    const second = adapter.readContext(current, WHOLE).context as Record<string, unknown>
    const ledger = ledgerOf(first)

    expect(ledger.total, 'total 是范围判定通过、截断之前的条数').toBe(payoffs.length + 8 + 9)
    expect(ledger.limit).toBe(10)
    expect(ledger.truncated, '被截断时必须如实标注').toBe(true)
    expect(ledger.threads, '上限内的条数不超过声明上限').toHaveLength(10)
    expect(
      ledger.threads.map((item) => item.targetPayoffChapter),
      '同一优先级内按计划回收章升序，截断结果才是确定的'
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(
      ledger.threads.filter((item) => item.status === '推进中'),
      '未闭环的伏笔优先保留'
    ).toHaveLength(10)

    expect(
      assistantGuideContextDigest(first),
      '同一份伏笔台账两次读取的上下文摘要必须一致，否则作者每答一题都会被要求重新分析'
    ).toBe(assistantGuideContextDigest(second))
    database.close()
  })

  it('排序必须是真全序：状态与计划回收章都相同时继续按标题兜底，不依赖输入数组的原始顺序', () => {
    const { database, project } = setup()
    const template = threadTemplate(project)
    const flat = (title: string, id: string, excerpt: string): NovelPlotThread => ({
      ...template,
      id,
      title,
      status: '已埋设' as const,
      setupChapterId: 'body-1',
      setupEvidence: { chapterId: 'body-1', excerpt },
      targetPayoffChapter: undefined,
      progress: []
    })

    // 故意按标题**降序**投喂。若比较器在「同状态 + 都无计划回收章」这一格提前返回（而不是继续往
    // 下比标题），排序就会退化成「保留输入数组序」，下面这条断言会直接失败。
    const descending = saveThreads(database, project, [
      flat('探针伏笔D', 'thread-flat-d', 'D 的埋设证据'),
      flat('探针伏笔C', 'thread-flat-c', 'C 的埋设证据'),
      flat('探针伏笔B', 'thread-flat-b', 'B 的埋设证据'),
      flat('探针伏笔A', 'thread-flat-a', 'A 的埋设证据')
    ])
    const ledger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(descending, WHOLE).context as Record<string, unknown>)
    expect(
      ledger.threads.map((item) => item.title),
      '同状态且都无计划回收章时必须继续按标题兜底排序，否则截断取舍会随输入顺序漂移'
    ).toEqual(['探针伏笔A', '探针伏笔B', '探针伏笔C', '探针伏笔D'])

    // 标题也相同 ⇒ 必须再用身份兜底，仍是一个全序（不得原地不动）。
    const tied = saveThreads(database, project, [
      flat('同题伏笔', 'thread-tie-z', '来自 z'),
      flat('同题伏笔', 'thread-tie-a', '来自 a')
    ])
    const tiedLedger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(tied, WHOLE).context as Record<string, unknown>)
    expect(
      tiedLedger.threads.map((item) => item.evidence[0]!.excerpt),
      '标题也相同时按身份兜底，仍是确定的全序'
    ).toEqual(['来自 a', '来自 z'])

    // 混合：有计划回收章的排在前（升序），无值的排在其后并按**标题码点**兜底。
    // 注意「无计划乙」排在「无计划甲」前面是**故意的**：比较用 UTF-16 码点（甲 U+7532 > 乙 U+4E59），
    // 不用 locale 排序 —— 后者会随 ICU 版本与系统区域变化，正好破坏「截断取舍确定」这条不变量。
    // 输入顺序也刻意与期望顺序不同，否则这条断言会假通过。
    const mixed = saveThreads(database, project, [
      flat('无计划甲', 'thread-mix-a', '甲'),
      { ...flat('有计划七', 'thread-mix-7', '七'), targetPayoffChapter: 7 },
      flat('无计划乙', 'thread-mix-b', '乙'),
      { ...flat('有计划二', 'thread-mix-2', '二'), targetPayoffChapter: 2 }
    ])
    const mixedLedger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(mixed, WHOLE).context as Record<string, unknown>)
    expect(
      mixedLedger.threads.map((item) => item.title),
      '计划回收章升序在前、无值排最后并按标题码点兜底'
    ).toEqual(['有计划二', '有计划七', '无计划乙', '无计划甲'])
    database.close()
  })

  it('单条体积病态时也不会静默清空整份投影：逐字段截断，且投影总量始终有界', () => {
    const { database, project } = setup()
    const template = threadTemplate(project)
    // 病态输入：一个超长标题 + 海量角色名。若不做逐字段截断，这一条就能独自越过 6000 上限，
    // 使硬闸在首轮 break ⇒ `threads: []`：范围里明明有伏笔，投影却是空的，且只有 truncated 提示。
    const entry = project.worldBible!.entries[0]!
    const manyEntries = Array.from({ length: 40 }, (_, index) => ({
      ...entry,
      id: `char-bulk-${index}`,
      name: `角色${String(index).padStart(2, '0')}·${'长'.repeat(80)}`
    }))
    const withCharacters = saveEntries(database, project, [entry, ...manyEntries])
    const current = saveThreads(database, withCharacters, [
      {
        ...template,
        id: 'thread-huge',
        title: '巨'.repeat(9_000),
        status: '推进中' as const,
        setupChapterId: 'body-1',
        setupEvidence: { chapterId: 'body-1', excerpt: '巨'.repeat(5_000) },
        characterIds: [entry.id, ...manyEntries.map((item) => item.id)],
        targetPayoffChapter: undefined,
        progress: []
      },
      // 两条都**必须**清掉 `targetPayoffChapter`：模板自带非空值，不清就会按章号排在前面，
      // 病态条排不到首位，也就复现不出「整份投影被清空」。平手后比较落到标题码点：
      // '巨'(U+5DE8) < '普'(U+666E) ⇒ 病态条**排在最前**，未截断时它会独自顶破 6000 上限，
      // 硬闸在首轮 `break` ⇒ `threads: []`，范围里有伏笔却一条都看不到，只有 `truncated` 提示。
      { ...threadTemplate(project), title: '普通的伏笔', setupChapterId: 'body-1', targetPayoffChapter: undefined }
    ])

    const ledger = ledgerOf(assistantGuideAdapter('delivery', database)
      .readContext(current, WHOLE).context as Record<string, unknown>)

    expect(ledger.total, '范围里确实有伏笔').toBe(2)
    // ★ 判别性断言：修复前病态条排最前、独自顶破 6000 上限 ⇒ 硬闸首轮 break ⇒ threads 为空。
    expect(ledger.threads.length, '病态单条不得把整份投影清空').toBeGreaterThan(0)
    expect(ledger.threads[0]!.title.startsWith('巨'), '前提：病态条确实排在首位').toBe(true)

    const huge = ledger.threads.find((item) => item.title.startsWith('巨'))
    expect(huge, '被截断的巨标题仍应作为一条投影出来，而不是被静默丢弃').toBeTruthy()
    // ★ 判别性断言：`title` 在 schema 里是无限长的 `z.string()`。
    expect(huge!.title.length, '标题必须逐字段截断').toBeLessThanOrEqual(200)
    // ★ 判别性断言：`characterIds` 在 schema 里是无限长的 `z.array(z.string())`（这里给了 41 个）。
    expect(huge!.characters.length, '角色名条数必须有上限').toBeLessThanOrEqual(12)
    // 下面两条是**护栏**而非判别：`WorldEntrySchema.name` 已被 schema 限制在 120 字、摘录本就已截断。
    // 保留它们是因为**前端写库不经 zod**（本项目已知约定），越过 120 字的名字仍可能落进数据库。
    expect(Math.max(...huge!.characters.map((name) => name.length)), '角色名必须逐字段截断').toBeLessThanOrEqual(200)
    expect(huge!.evidence[0]!.excerpt.length, '证据摘录必须逐字段截断').toBeLessThanOrEqual(200)

    // 上界推导：硬闸只在 `used + 单条 > 6000` 时 break，所以各条之和 ≤ 6000；
    // 再加投影外壳（scope/scopeNote/limit/total/truncated，约 250 字）与数组标点，总量必然远低于 7000。
    const serialized = JSON.stringify(ledger)
    expect(serialized.length, '整份投影必须始终有界，不得因病态单条而裸奔').toBeLessThanOrEqual(7_000)
    database.close()
  })

  it('可见性策略：伏笔关联的「永不发送」「仅审校」词条名不进投影，也不进整份上下文', () => {
    const { database, project } = setup()
    const NECESSARY = '林砚'
    const FORBIDDEN = '禁发角色·投影探针'
    const REVIEW_ONLY = '仅审校角色·投影探针'
    const entry = project.worldBible!.entries[0]!
    const current = saveEntries(database, project, [
      entry,
      { ...entry, id: 'char-forbidden', name: FORBIDDEN, aiVisibility: '永不发送' },
      { ...entry, id: 'char-review-only', name: REVIEW_ONLY, aiVisibility: '仅审校' }
    ])
    const template = threadTemplate(current)
    const withCharacters = saveThreads(database, current, [{
      ...template,
      characterIds: [entry.id, 'char-forbidden', 'char-review-only']
    }])

    const context = assistantGuideAdapter('delivery', database).readContext(withCharacters, WHOLE).context as Record<string, unknown>
    const ledger = ledgerOf(context)

    expect(ledger.threads[0]!.characters, '只投影可发送条目的名称').toEqual([NECESSARY])
    expect(JSON.stringify(ledger), '「永不发送」的词条名绝不能进伏笔投影').not.toContain(FORBIDDEN)
    expect(JSON.stringify(ledger), '「仅审校」的词条名绝不能进伏笔投影').not.toContain(REVIEW_ONLY)
    expect(JSON.stringify(context), '整份交付上下文的红线同样成立').not.toContain(FORBIDDEN)
    expect(JSON.stringify(context), '整份交付上下文的红线同样成立').not.toContain(REVIEW_ONLY)
    database.close()
  })

  it('非交付领域（大纲/世界观/正文）不新增交付的伏笔台账投影，交付域仍照旧', () => {
    const { database, project } = setup()
    /*
     * G-3 收窄：memory 域现在**有意**新增自己的有界线程投影（`threadLedger`），
     * 所以它不再属于「不新增任何投影」的集合。这里只保留真正不该出现交付台账的三个领域，
     * 且**不弱化**原断言 —— 断言仍是「该键必须不存在」。
     */
    const cases = [
      ['outline', { kind: 'story-core', projectId: project.id }],
      ['world', { kind: 'world', projectId: project.id }],
      ['writing', { kind: 'chapter', projectId: project.id, objectId: 'body-1' }]
    ] as const

    for (const [domain, target] of cases) {
      const context = assistantGuideAdapter(domain, database).readContext(project, target).context as Record<string, unknown>
      expect(
        Object.hasOwn(context, 'foreshadowLedger'),
        `${domain} 领域不得因为本轮的交付投影而多出伏笔台账`
      ).toBe(false)
    }

    // 保持交付域的原有断言：台账必须真实存在，不因其它领域的投影调整而丢失。
    const delivery = assistantGuideAdapter('delivery', database)
      .readContext(project, { kind: 'outline', projectId: project.id }).context as Record<string, unknown>
    expect(Object.hasOwn(delivery, 'foreshadowLedger'), '交付域仍然照旧带自己的伏笔台账').toBe(true)
    database.close()
  })

  it('允许引用的证据范围与真实发送的投影一致，且结果写入边界不变', () => {
    const { database, project } = setup()
    const adapter = assistantGuideAdapter('delivery', database)

    const whole = adapter.readContext(project, { kind: 'outline', projectId: project.id })
    const wholeContext = whole.context as Record<string, unknown>
    expect(Object.hasOwn(wholeContext, 'foreshadowLedger')).toBe(true)
    expect(whole.allowedEvidenceRefs, '发了材料就必须允许引用它').toContain('context.foreshadowLedger')
    for (const ref of whole.allowedEvidenceRefs) {
      if (!ref.startsWith('context.')) continue
      expect(
        Object.hasOwn(wholeContext, ref.slice('context.'.length)),
        `允许引用的 ${ref} 必须在上下文里真实存在`
      ).toBe(true)
    }

    const scoped = adapter.readContext(project, { kind: 'chapter', projectId: project.id, objectId: 'body-1' })
    const scopedContext = scoped.context as Record<string, unknown>
    expect(
      Object.hasOwn(scopedContext, 'foreshadowLedger'),
      '即使投影为空，键也要存在，避免 refs 与上下文摘要随内容漂移'
    ).toBe(true)
    expect(scoped.allowedEvidenceRefs).toContain('context.foreshadowLedger')

    expect(whole.allowedResultKinds, '结果写入边界不受投影影响').toEqual(['revision-proposal', 'export-precheck'])
    expect(scoped.allowedResultKinds, '章节范围仍然只允许局部审稿').toEqual(['revision-proposal'])
    database.close()
  })
})

/**
 * G-3：记忆引导的**有界线程投影**。
 *
 * 记忆引导对应的人设是「记忆伏笔管理员」（`projectAssistantCatalog.ts:62-68`），
 * `focusAreas` =「客观事实与角色认知差」「伏笔证据与回收准备度」「状态的生效与失效章节」。
 * 与交付审稿的伏笔台账不同，记忆投影必须：
 *   · 恒定**本章**范围（`target.kind !== 'chapter'` 直接抛错，不存在整稿分支）；
 *   · 保留 `cognitionGap` 与 `readiness{level,score,gaps}`；
 *   · **不过滤** `已失效` 证据，并让每条证据携带 `status` ——「失效章节」正是本领域要核对的。
 */
describe('memory 引导的线程投影', () => {
  type MemoryEvidence = { phase: string; chapterNumber?: number; excerpt: string; excerptTruncated: boolean; status: string }
  type MemoryThread = {
    title: string
    status: string
    targetPayoffChapter?: number
    characters: string[]
    readiness: { level: string; score: number; gaps: string[] }
    cognitionGap: string
    evidence: MemoryEvidence[]
  }
  type MemoryLedger = {
    scope: string
    scopeNote: string
    limit: number
    total: number
    truncated: boolean
    threads: MemoryThread[]
  }

  const MEMORY_LIMIT = 10
  const MEMORY_EVIDENCE_LIMIT = 3
  const MEMORY_CHARACTER_LIMIT = 12
  const MEMORY_EXCERPT_CHARS = 200
  const MEMORY_TOTAL_CHARS = 6_000
  const MEMORY_KEY = 'threadLedger'
  /** 整条 `plotThreads` 的内部字段名：修复前随整份台账出站，修复后一个都不该出现。 */
  const INTERNAL_FIELDS = ['evidencePool', 'setupMethod', 'resolutionMethod', 'revisionHistory', 'otherCharacters', 'assessedAt']

  function memoryRead(database: NovelDatabaseService, project: NovelProject, chapterId = 'body-1') {
    return assistantGuideAdapter('memory', database).readContext(database.getProject(project.id), {
      kind: 'chapter',
      projectId: project.id,
      objectId: chapterId
    })
  }

  function ledgerOf(context: unknown): MemoryLedger {
    const ledger = (context as Record<string, unknown>)[MEMORY_KEY]
    expect(ledger, '记忆引导上下文必须带上有界线程投影 threadLedger').toBeTruthy()
    expect(Array.isArray(ledger), '线程投影是有外壳的对象，不是裸数组').toBe(false)
    return ledger as MemoryLedger
  }

  function saveThreads(database: NovelDatabaseService, project: NovelProject, threads: NovelPlotThread[]): NovelProject {
    const current = database.getProject(project.id)
    database.saveProject(NovelProjectSchema.parse({ ...current, plotThreads: threads }), current.revision, '测试注入记忆线程台账')
    return database.getProject(project.id)
  }

  function saveEntries(database: NovelDatabaseService, project: NovelProject, entries: WorldEntry[]): NovelProject {
    const current = database.getProject(project.id)
    database.saveProject(NovelProjectSchema.parse({ ...current, worldBible: { ...current.worldBible!, entries } }), current.revision, '测试注入世界词条')
    return database.getProject(project.id)
  }

  function threadTemplate(project: NovelProject): NovelPlotThread {
    return structuredClone(project.plotThreads[0]!) as NovelPlotThread
  }

  /** 一条锚点指向本章、可被本章投影纳入的线程。 */
  function scopedThread(project: NovelProject, overrides: Partial<NovelPlotThread> = {}): NovelPlotThread {
    return {
      ...threadTemplate(project),
      setupChapterId: 'body-1',
      setupEvidence: { chapterId: 'body-1', excerpt: '刻有星纹的古钟' },
      progress: [],
      ...overrides
    }
  }

  // 1) 不再整份转发 + 新键是对象
  it('不再整份转发伏笔台账：内部字段一个都不出站，新键是有外壳的对象', () => {
    const { database, project } = setup()
    // 把所有内部字段都填满：修复前整条 plotThreads 出站，这些字段会随上下文一起泄漏。
    const current = saveThreads(database, project, [scopedThread(project, {
      detail: 'INTERNAL_DETAIL_SENTINEL',
      setupMethod: '视觉细节',
      resolutionMethod: '内部回收说明',
      evidencePool: [{
        id: 'pool-1', phase: '埋设', chapterId: 'body-1', excerpt: '证据池里的原文', note: '', source: '作者记录', confidence: 0.5, status: '有效'
      }],
      revisionHistory: [{
        id: 'rev-1', changedAt: project.updatedAt, fromStatus: '计划', toStatus: '已埋设', reason: '记录埋设'
      }],
      cognition: {
        reader: '读者知道', protagonist: '林砚知道', gapSummary: '认知差概况',
        otherCharacters: [{ characterId: 'char-1', characterName: 'OTHER_CHARACTER_SENTINEL', knowledge: '知道内情', evidenceIds: ['pool-1'] }]
      },
      readiness: {
        score: 0.5, level: '接近回收', fulfilled: [], gaps: ['缺少回收证据'], basis: ['内部依据'],
        recommendation: '内部建议', assessedAt: project.updatedAt
      }
    })])

    const context = memoryRead(database, current).context as Record<string, unknown>
    const serialized = JSON.stringify(context)

    expect(Object.hasOwn(context, 'threads'), '旧的裸数组键 threads 必须被替换').toBe(false)
    expect(Object.hasOwn(context, 'plotThreads'), '绝不整份转发 plotThreads').toBe(false)
    const ledger = ledgerOf(context)
    expect(ledger.threads.length, '本章范围内确实有可投影的线程').toBeGreaterThan(0)

    for (const field of INTERNAL_FIELDS) {
      expect(serialized, `整份上下文不得出现内部字段 ${field}`).not.toContain(field)
    }
    // `detail` 用带引号的键名判定：世界观词条的 `details` 是合法字段，会包含子串 `detail`。
    expect(serialized, '不得出现内部字段 detail').not.toContain('"detail":')
    expect(serialized, 'detail 的值不得出站').not.toContain('INTERNAL_DETAIL_SENTINEL')
    expect(serialized, 'cognition.otherCharacters[].characterName 不得出站').not.toContain('OTHER_CHARACTER_SENTINEL')
    database.close()
  })

  // 2) 字段白名单精确等值
  it('字段白名单精确等值：绝不把整条线程 spread 出去', () => {
    const { database, project } = setup()
    const current = saveThreads(database, project, [scopedThread(project, { title: '本章的线程', targetPayoffChapter: 3 })])
    const ledger = ledgerOf(memoryRead(database, current).context)

    expect(Object.keys(ledger).sort()).toEqual(['limit', 'scope', 'scopeNote', 'threads', 'total', 'truncated'])
    const thread = ledger.threads[0]!
    expect(Object.keys(thread).sort()).toEqual(['characters', 'cognitionGap', 'evidence', 'readiness', 'status', 'targetPayoffChapter', 'title'])
    expect(Object.keys(thread.readiness).sort()).toEqual(['gaps', 'level', 'score'])
    expect(Object.keys(thread.evidence[0]!).sort()).toEqual(['chapterNumber', 'excerpt', 'excerptTruncated', 'phase', 'status'])
    database.close()
  })

  // 2b) 与交付审稿的关键差异：保留失效证据并携带状态
  it('证据携带生效/失效状态：已失效证据不被剔除（与交付审稿的关键差异）', () => {
    const { database, project } = setup()
    const current = saveThreads(database, project, [scopedThread(project, {
      evidencePool: [
        { id: 'ev-valid', phase: '埋设', chapterId: 'body-1', excerpt: '仍然有效的埋设证据', note: '', source: '作者记录', confidence: 1, status: '有效' },
        { id: 'ev-dead', phase: '推进', chapterId: 'body-1', excerpt: '已经失效的推进证据', note: '', source: '作者记录', confidence: 1, status: '已失效' }
      ]
    })])
    const ledger = ledgerOf(memoryRead(database, current).context)
    const thread = ledger.threads.find((item) => item.title === '古钟星纹')!

    expect(thread.evidence.every((item) => typeof item.status === 'string' && item.status.length > 0), '每条证据都必须带状态').toBe(true)
    expect(
      thread.evidence.some((item) => item.status === '已失效'),
      '「已失效」正是记忆领域要核对的失效章节，绝不能被过滤掉（交付审稿会过滤）'
    ).toBe(true)
    database.close()
  })

  // 3) 病态单条不得清空整份
  it('单条体积病态时也不会静默清空整份投影：逐字段截断，且整份始终有界', () => {
    const { database, project } = setup()
    const entry = project.worldBible!.entries[0]!
    const manyEntries = Array.from({ length: 40 }, (_, index) => ({
      ...entry,
      id: `char-bulk-${index}`,
      name: `角色${String(index).padStart(2, '0')}·${'长'.repeat(80)}`
    }))
    const withCharacters = saveEntries(database, project, [entry, ...manyEntries])
    const current = saveThreads(database, withCharacters, [
      {
        ...scopedThread(withCharacters),
        id: 'thread-huge',
        title: '巨'.repeat(9_000),
        status: '推进中',
        setupEvidence: { chapterId: 'body-1', excerpt: '巨'.repeat(5_000) },
        characterIds: [entry.id, ...manyEntries.map((item) => item.id)],
        targetPayoffChapter: undefined
      },
      // 状态权重：推进中(1) < 已埋设(2) ⇒ 病态条必然排在最前，才复现得出「首轮顶破上限清空整份」。
      { ...scopedThread(withCharacters), id: 'thread-normal', title: '普通的线程', status: '已埋设', targetPayoffChapter: undefined }
    ])
    const ledger = ledgerOf(memoryRead(database, current).context)

    expect(ledger.total, '范围里确实有线程').toBe(2)
    // ★ 判别性断言：修复前病态条排最前、独自顶破 6000 上限 ⇒ 硬闸首轮 break ⇒ threads 为空。
    expect(ledger.threads.length, '病态单条不得把整份投影清空').toBeGreaterThan(0)
    expect(ledger.threads[0]!.title.startsWith('巨'), '前提：病态条确实排在首位').toBe(true)

    const huge = ledger.threads.find((item) => item.title.startsWith('巨'))!
    expect(huge.title.length, '标题必须逐字段截断').toBeLessThanOrEqual(200)
    expect(huge.characters.length, '角色名条数必须有上限').toBeLessThanOrEqual(MEMORY_CHARACTER_LIMIT)
    expect(huge.evidence.length, '证据条数必须有上限').toBeLessThanOrEqual(MEMORY_EVIDENCE_LIMIT)
    expect(huge.evidence[0]!.excerpt.length, '证据摘录必须逐字段截断').toBeLessThanOrEqual(MEMORY_EXCERPT_CHARS)
    expect(JSON.stringify(ledger).length, '整份投影（含外壳）必须始终有界').toBeLessThanOrEqual(MEMORY_TOTAL_CHARS)
    database.close()
  })

  // 4) 上限
  it('上限如实：条数不超过 limit，整份投影（含外壳）不超过 6000，truncated 与 total 一致', () => {
    const { database, project } = setup()
    const many = saveThreads(database, project, Array.from({ length: 12 }, (_, index) => ({
      ...scopedThread(project),
      id: `mem-${index}`,
      title: `本章线程${String(index).padStart(2, '0')}`,
      status: '已埋设' as const,
      targetPayoffChapter: undefined
    })))
    const ledger = ledgerOf(memoryRead(database, many).context)

    expect(ledger.limit, '上限必须在投影里声明').toBe(MEMORY_LIMIT)
    expect(ledger.total, 'total 是截断前的范围条数').toBe(12)
    expect(ledger.threads.length, '条数不超过声明上限').toBeLessThanOrEqual(ledger.limit)
    expect(ledger.total > ledger.threads.length, '前提：确实发生了截断').toBe(true)
    expect(ledger.truncated, 'total > threads.length 时必须如实标注').toBe(true)
    expect(JSON.stringify(ledger).length, '整份投影含外壳都必须有界').toBeLessThanOrEqual(MEMORY_TOTAL_CHARS)

    const few = saveThreads(database, many, [scopedThread(project, { title: '唯一线程' })])
    const small = ledgerOf(memoryRead(database, few).context)
    expect(small.total).toBe(1)
    expect(small.threads).toHaveLength(1)
    expect(small.truncated, '未截断时不得谎报').toBe(false)
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(MEMORY_TOTAL_CHARS)
    database.close()
  })

  // 5) 稳定全序
  it('稳定全序：同状态且都无计划回收章时按标题码点升序，两次读取逐字节一致', () => {
    const { database, project } = setup()
    const flat = (title: string, id: string): NovelPlotThread => ({
      ...scopedThread(project),
      id,
      title,
      status: '已埋设',
      targetPayoffChapter: undefined
    })
    // 故意按标题**降序**投喂：比较器若在「同状态 + 都无计划回收章」这一格提前返回，
    // 排序会退化成保留输入数组序，下面断言会直接失败。
    const descending = saveThreads(database, project, [
      flat('探针线程D', 'mem-d'),
      flat('探针线程C', 'mem-c'),
      flat('探针线程B', 'mem-b'),
      flat('探针线程A', 'mem-a')
    ])
    const adapter = assistantGuideAdapter('memory', database)
    const first = adapter.readContext(database.getProject(descending.id), { kind: 'chapter', projectId: descending.id, objectId: 'body-1' }).context as Record<string, unknown>
    const second = adapter.readContext(database.getProject(descending.id), { kind: 'chapter', projectId: descending.id, objectId: 'body-1' }).context as Record<string, unknown>

    expect(ledgerOf(first).threads.map((item) => item.title), '同状态且都无计划回收章时按标题码点兜底').toEqual(['探针线程A', '探针线程B', '探针线程C', '探针线程D'])
    expect(
      assistantGuideContextDigest(first),
      '同一份台账两次读取的上下文摘要必须一致，否则作者每答一题都会被要求重新分析'
    ).toBe(assistantGuideContextDigest(second))
    database.close()
  })

  // 6) 判别性隐私用例
  it('隐私红线：禁发条目的名字与 cognition 里的角色名一个字都不出站', () => {
    const { database, project } = setup()
    const FORBIDDEN = '禁发线程角色·探针'
    const entry = project.worldBible!.entries[0]!
    const withEntries = saveEntries(database, project, [
      entry,
      { ...entry, id: 'char-forbidden', name: FORBIDDEN, aiVisibility: '永不发送' }
    ])
    const current = saveThreads(database, withEntries, [scopedThread(withEntries, {
      characterIds: [entry.id, 'char-forbidden'],
      detail: 'NEVER_SEND_THREAD_SENTINEL',
      cognition: {
        reader: '', protagonist: '', gapSummary: '',
        otherCharacters: [{ characterName: 'NEVER_SEND_THREAD_SENTINEL', knowledge: '禁发知识', evidenceIds: [] }]
      }
    })])

    const context = memoryRead(database, current).context as Record<string, unknown>
    const serialized = JSON.stringify(context)
    const ledger = ledgerOf(context)

    expect(ledger.threads[0]!.characters, '只投影可发送条目的名称').toEqual([entry.name])
    expect(serialized, '「永不发送」词条名绝不能出站').not.toContain(FORBIDDEN)
    expect(serialized, 'detail 的 sentinel 绝不能出站').not.toContain('NEVER_SEND_THREAD_SENTINEL')
    database.close()
  })

  // 7) 范围无法确定 → 明确空投影
  it('范围无法确定时给出明确空投影并写明原因，不猜测关联', () => {
    const { database, project } = setup()
    // 模板线程的 setupChapterId 已被 setup() 换成不存在的章节 ID，且没有 progress ⇒ 本章内无可确定关联。
    const ledger = ledgerOf(memoryRead(database, project).context)

    expect(ledger.scope).toBe('chapter')
    expect(ledger.threads, '无法确定关联时是明确的空投影').toEqual([])
    expect(ledger.total).toBe(0)
    expect(ledger.truncated).toBe(false)
    expect(ledger.scopeNote, '空投影必须写明原因').toContain('不参与猜测')
    database.close()
  })

  // 8) 引用一致性
  it('引用一致性：只允许引用真实发送的内容，删除多余的 project.memories / project.plotThreads', () => {
    const { database, project } = setup()
    const current = saveThreads(database, project, [scopedThread(project)])
    const prepared = memoryRead(database, current)
    const ctx = prepared.context as Record<string, unknown>

    expect(prepared.allowedEvidenceRefs, '不得再放行实际未发送的 project.plotThreads').not.toContain('project.plotThreads')
    expect(prepared.allowedEvidenceRefs, '不得再放行实际未发送的 project.memories').not.toContain('project.memories')
    expect(prepared.allowedEvidenceRefs, '必须放行实际发送的线程投影').toContain(`context.${MEMORY_KEY}`)
    expect(prepared.allowedEvidenceRefs, '本文章节引用仍要保留').toContain('chapter:body-1')

    for (const ref of prepared.allowedEvidenceRefs) {
      if (!ref.startsWith('context.')) continue
      expect(Object.hasOwn(ctx, ref.slice('context.'.length)), `允许引用的 ${ref} 必须在上下文里真实存在`).toBe(true)
    }
    const undefinedCount = Object.keys(ctx).filter((key) => ctx[key] === undefined).length
    expect(undefinedCount, '每个 context.X 的取值都不能是 undefined').toBe(0)
    database.close()
  })

  // 9) 护栏
  it('护栏：outline/world/writing 没有该键；delivery 仍只有 foreshadowLedger、没有记忆的新键', () => {
    const { database, project } = setup()
    for (const [domain, target] of [
      ['outline', { kind: 'story-core', projectId: project.id }],
      ['world', { kind: 'world', projectId: project.id }],
      ['writing', { kind: 'chapter', projectId: project.id, objectId: 'body-1' }]
    ] as const) {
      const context = assistantGuideAdapter(domain, database).readContext(project, target).context as Record<string, unknown>
      expect(Object.hasOwn(context, MEMORY_KEY), `${domain} 领域不得出现记忆线程投影`).toBe(false)
    }
    const delivery = assistantGuideAdapter('delivery', database)
      .readContext(project, { kind: 'outline', projectId: project.id }).context as Record<string, unknown>
    expect(Object.hasOwn(delivery, 'foreshadowLedger'), 'delivery 仍然只带自己的伏笔台账').toBe(true)
    expect(Object.hasOwn(delivery, MEMORY_KEY), 'delivery 不得出现记忆线程投影的键').toBe(false)
    database.close()
  })
})
