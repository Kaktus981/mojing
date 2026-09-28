import { describe, expect, it, vi } from 'vitest'
import type { ProviderService } from './ai/provider'
import { CreativeChatService } from './creativeChat'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import { listCreativeSkillCatalog } from './creativeSkillRuntime'

describe('创作对话助手', () => {
  it('精确作用域技能只有模型调用成功后才记录已加载，失败不留下假记录', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    database.saveProvider({ name: '测试模型', baseUrl: 'http://127.0.0.1:1/v1', model: 'test', contextWindow: 8_000, supportsStreaming: false, supportsJsonSchema: false, hasApiKey: true })
    const skill = database.createCustomCreativeCapability(project.id, { name: '精确章护栏', description: '只分析本章。', taskScopes: ['正文创作'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保持本章口吻。' })
    database.saveAssistantSkillConfiguration({ projectId: project.id, stage: 'writing', enabled: true, providerId: null, capabilityIds: [skill.id] })
    const generate = vi.fn().mockRejectedValueOnce(new Error('模型未响应')).mockResolvedValueOnce({ answer: '已收到。', references: [], actions: [] })
    const service = new CreativeChatService(database, { generate } as unknown as ProviderService)
    const input = { stage: 'writing' as const, mode: '问题分析' as const, content: '核对本章。', taskType: '自由讨论' as const, target: { kind: 'chapter' as const, projectId: project.id, objectId: project.chapters[0]!.id } }

    await expect(service.send(project.id, input)).rejects.toThrow('模型未响应')
    expect(listCreativeSkillCatalog(database, project.id).find((item) => item.id === skill.id)).toMatchObject({ status: '已启用', loaded: false })
    const response = await service.send(project.id, input)
    expect(response.skillLoadReceipt).toMatchObject({ stage: 'writing', capabilityIds: [skill.id] })
    expect(response.skillLoadReceipt?.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(generate.mock.calls[1]![0].user).toContain('精确章护栏')
    expect(listCreativeSkillCatalog(database, project.id).find((item) => item.id === skill.id)).toMatchObject({ status: '已加载', loaded: true, loadedStages: ['writing'] })
    database.close()
  })

  it('将当前阶段已装配的文字 Skill 作为低优先级提示注入模型，停用后不再注入', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const skill = database.createCustomCreativeCapability(project.id, { name: '规则护栏', description: '检查规则一致性。', taskScopes: ['世界设定'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [], skillText: '遇到未知规则时先标记待确认，不要替作者补全。' })
    database.saveAssistantSkillConfiguration({ projectId: project.id, stage: 'world', enabled: true, providerId: null, capabilityIds: [skill.id] })
    const generate = vi.fn().mockResolvedValue({ answer: '已收到。', references: [], actions: [] })
    const provider = { generate } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)
    await service.send(project.id, { stage: 'world', mode: '灵感讨论', content: '检查规则。' })
    const firstRequest = generate.mock.calls[0]![0] as { system: string; user: string }
    expect(firstRequest.system).not.toContain('规则护栏')
    expect(firstRequest.user).toContain('规则护栏')
    expect(firstRequest.user).toContain('遇到未知规则时先标记待确认')
    database.saveCreativeCapabilityConfiguration({ projectId: project.id, capabilityId: skill.id, enabled: false })
    await service.send(project.id, { stage: 'world', mode: '灵感讨论', content: '再次检查。' })
    expect(generate.mock.calls[1]![0].user).not.toContain('规则护栏')
    database.close()
  })

  it('按阶段保存对话、展示参考，并且不修改正式作品', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    const storedProject = database.createProject(project)
    const provider = { generate: vi.fn().mockResolvedValue({
      answer: '可以先强化主角隐瞒古钟的现实代价，再决定是否生成改稿候选。',
      references: [{ title: '第一章《古钟初鸣》', reason: '作者正在讨论当前章节的选择后果。' }],
      actions: [
        { label: '生成局部改稿候选', instruction: '只强化隐瞒秘密带来的现实代价。', kind: 'chapter-revision', chapterId: project.chapters[0]!.id },
        { label: '越权生成世界观', instruction: '不应出现', kind: 'world-foundation' }
      ]
    }) } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)

    const response = await service.send(project.id, { stage: 'writing', targetId: project.chapters[0]!.id, mode: '生成准备', content: '准备一个局部改稿候选。' })
    expect(response.messages).toHaveLength(2)
    expect(response.messages[1]).toMatchObject({ role: 'assistant', references: [{ title: '第一章《古钟初鸣》' }] })
    expect(response.messages[1]!.actions.map((action) => action.kind)).toEqual(['chapter-revision'])
    expect(database.listCreativeConversations(project.id, 'writing')[0]).toMatchObject({ id: response.conversation.id, messageCount: 2 })
    expect(database.listCreativeMessages(project.id, response.conversation.id).map((item) => item.role)).toEqual(['user', 'assistant'])
    // 创建项目时会为旧章纲补齐规划摘要；正式项目不应因对话而改变。
    expect(database.getProject(project.id)).toEqual(storedProject)
    database.close()
  })

  it('阶段和项目之间互相隔离，删除对话不会删除正文', () => {
    const database = new NovelDatabaseService(':memory:'), first = makeNovel(1), second = makeNovel(1)
    database.createProject(first); database.createProject(second)
    const idea = database.createCreativeConversation({ projectId: first.id, stage: 'idea' })
    database.createCreativeConversation({ projectId: first.id, stage: 'world' })
    database.createCreativeConversation({ projectId: second.id, stage: 'idea' })
    database.appendCreativeMessage({ conversationId: idea.id, role: 'user', content: '讨论故事种子', mode: '灵感讨论', references: [], actions: [], projectRevision: first.revision })
    expect(database.listCreativeConversations(first.id, 'idea')).toHaveLength(1)
    expect(database.listCreativeConversations(first.id, 'idea', true)).toHaveLength(0)
    database.appendCreativeMessage({ conversationId: idea.id, role: 'assistant', content: '成功回复', mode: '灵感讨论', references: [], actions: [], projectRevision: first.revision })
    expect(database.listCreativeConversations(first.id, 'idea', true)).toHaveLength(1)
    expect(database.listCreativeConversations(first.id)).toHaveLength(2)
    expect(database.listCreativeConversations(second.id)).toHaveLength(1)
    database.removeCreativeConversation(first.id, idea.id)
    expect(database.listCreativeMessages(first.id, idea.id)).toEqual([])
    expect(database.getProject(first.id).chapters).toHaveLength(1)
    database.close()
  })

  it('默认不保存失败对话；开启保留后可在历史中查看失败原因', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const provider = { generate: vi.fn().mockRejectedValue(new Error('模型暂时不可用')) } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)

    await expect(service.send(project.id, { stage: 'idea', mode: '灵感讨论', content: '测试失败不保留。' })).rejects.toThrow('模型暂时不可用')
    expect(database.listCreativeConversations(project.id, 'idea')).toHaveLength(0)

    await expect(service.send(project.id, { stage: 'idea', mode: '灵感讨论', content: '测试失败保留。', retainFailedConversation: true })).rejects.toThrow('模型暂时不可用')
    const retained = database.listCreativeConversations(project.id, 'idea')
    expect(retained).toHaveLength(1)
    expect(database.listCreativeMessages(project.id, retained[0]!.id).map((item) => item.role)).toEqual(['user', 'assistant'])
    expect(database.listCreativeMessages(project.id, retained[0]!.id)[1]!.content).toContain('本次对话未成功')
    database.close()
  })

  it('已有成功对话再次失败时只移除失败消息，不删除成功历史', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const provider = { generate: vi.fn().mockResolvedValueOnce({ answer: '成功回复', references: [], actions: [] }).mockRejectedValueOnce(new Error('第二次失败')) } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)
    const first = await service.send(project.id, { stage: 'idea', mode: '灵感讨论', content: '第一次成功。' })
    await expect(service.send(project.id, { conversationId: first.conversation.id, stage: 'idea', mode: '灵感讨论', content: '第二次失败。' })).rejects.toThrow('第二次失败')
    expect(database.listCreativeMessages(project.id, first.conversation.id).map((item) => item.content)).toEqual(['第一次成功。', '成功回复'])
    database.close()
  })

  it('灵感讨论和问题分析不会携带生成动作，生成准备只保留当前阶段动作', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const provider = { generate: vi.fn().mockResolvedValue({
      answer: '先核对证据，再决定是否生成候选。', references: [], actions: [
        { label: '生成世界观', instruction: '补充世界观', kind: 'world-foundation' },
        { label: '生成本章', instruction: '写当前章节', kind: 'chapter', chapterId: project.chapters[0]!.id },
        { label: '生成卷纲', instruction: '生成卷纲', kind: 'outline-volume', volumeNumber: 1 }
      ]
    }) } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)

    const analysis = await service.send(project.id, { stage: 'world', mode: '问题分析', content: '有哪些设定风险？' })
    expect(analysis.messages[1]!.actions).toEqual([])

    const prepared = await service.send(project.id, { stage: 'world', mode: '生成准备', content: '准备补充世界观。' })
    expect(prepared.messages[1]!.actions.map((action) => action.kind)).toEqual(['world-foundation'])
    database.close()
  })

  it('综合协作普通提问不携带动作，明确允许候选时仍受阶段白名单保护', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const provider = { generate: vi.fn().mockResolvedValue({
      answer: '先讨论，再决定是否准备候选。', references: [], actions: [
        { label: '生成世界观候选', instruction: '只补充当前世界规则', kind: 'world-foundation' },
        { label: '越权生成正文', instruction: '不应出现', kind: 'chapter', chapterId: project.chapters[0]!.id }
      ]
    }) } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)

    const discussion = await service.send(project.id, { stage: 'world', mode: '综合协作', content: '给我三个方向。' })
    expect(discussion.messages[1]!.actions).toEqual([])
    const prepared = await service.send(project.id, { stage: 'world', mode: '综合协作', content: '生成一个世界观候选。', allowCandidateActions: true })
    expect(prepared.messages[1]!.actions.map((action) => action.kind)).toEqual(['world-foundation'])
    database.close()
  })

  it('拒绝不存在或不匹配的章节目标，不回落到第一章', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(2)
    database.createProject(project)
    const generate = vi.fn().mockResolvedValue({ answer: '建议', references: [], actions: [] })
    const provider = { generate } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)

    await expect(service.send(project.id, { stage: 'writing', targetId: 'missing-chapter', mode: '问题分析', content: '检查这一章。' })).rejects.toThrow('当前章节不存在')
    expect(generate).not.toHaveBeenCalled()

    const first = await service.send(project.id, { stage: 'writing', targetId: project.chapters[0]!.id, mode: '问题分析', content: '检查第一章。' })
    await expect(service.send(project.id, { conversationId: first.conversation.id, stage: 'writing', targetId: project.chapters[1]!.id, mode: '问题分析', content: '改为检查第二章。' })).rejects.toThrow('当前创作对象已经变化')
    database.close()
  })

  it('上下文包含各阶段可读资料摘要而不是内部标识', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    project.worldConstraints.push({ id: 'constraint-1', term: '古钟', definition: '会改变秩序的遗物', notDefinition: '', entityType: '物品', allowedUsages: [], forbiddenUsages: [], unresolvedQuestions: ['是否可复制'], facts: [], source: { fieldPath: '/seed', excerpt: '古钟' }, status: '待确认', createdAt: project.createdAt, updatedAt: project.updatedAt })
    database.createProject(project)
    const generate = vi.fn().mockResolvedValue({ answer: '建议', references: [], actions: [] })
    const provider = { generate } as unknown as ProviderService
    const service = new CreativeChatService(database, provider)

    await service.send(project.id, { stage: 'idea', mode: '灵感讨论', content: '继续推演。' })
    const prompt = String((generate.mock.calls[0]![0] as { user: string }).user)
    expect(prompt).toContain('待确认术语')
    expect(prompt).toContain('古钟')
    expect(prompt).not.toContain('constraint-1')
    database.close()
  })

  it('六阶段请求携带独立职责和对应中文资料证据', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(2)
    const now = new Date().toISOString(), first = project.chapters[0]!, second = project.chapters[1]!
    project.settings.audience = '喜欢悬疑成长故事的读者'
    project.settings.contentLimits = '不描写无意义虐待'
    project.settings.rhetoricIntensity = 0
    project.worldConstraints.push({
      id: 'term-clock', term: '忆钟', definition: '会以持有者记忆为代价鸣响的古物', notDefinition: '普通计时器', entityType: '物品',
      allowedUsages: ['以记忆换取鸣响'], forbiddenUsages: [], unresolvedQuestions: ['谁能听见钟声'], facts: [],
      source: { fieldPath: '/seed', excerpt: '改变世界秩序的古钟' }, status: '待确认', createdAt: now, updatedAt: now
    })
    project.worldQualityFindings.push({
      id: 'audit-clock', type: '无依据事实', severity: '高', confidence: .94,
      evidence: { fieldPath: '/historySummary', excerpt: '所有人都遗忘了钟声' }, constraintIds: ['term-clock'],
      explanation: '现有资料没有说明所有人都会遗忘。', baseFieldDigest: 'digest', status: '待处理', source: 'AI 语义审校', createdAt: now
    })
    const card = project.outline!.volumes[0]!.chapters[1]!
    card.objective = '确认第二次钟声的代价'
    card.conflict = '林砚必须在真相和同伴安全之间选择'
    card.turningPoint = '同伴先听见钟声'
    card.beats = [{ id: 'beat-2-1', order: 1, title: '封闭钟楼', purpose: '迫使林砚作出选择', conflict: '同伴拒绝离开', outcome: '钟声再次响起', location: '钟楼', timeframe: '午夜', characterIds: ['char-1'], reveal: '钟声并非只对持有者生效', threadActions: ['推进古钟星纹'] }]
    card.beatStatus = '已确认'
    project.memories.push({
      id: 'memory-1', chapterId: first.id, chapterNumber: 1, status: '正式', sourceDigest: first.sourceDigest,
      summary: '林砚隐瞒古钟。', keyEvents: ['古钟第一次鸣响'], characterStates: [],
      facts: [{ id: 'fact-1', category: '秘密', content: '林砚独自知道古钟会夺走记忆', certainty: '正式', locked: true, source: { chapterId: first.id, excerpt: '并决定隐瞒此事' } }],
      objectStates: ['古钟仍在旧城'], timelineEvents: [], styleSignals: [], updatedAt: now
    })
    project.reviews.push({
      id: 'review-2', chapterId: second.id, category: '连续性', severity: '高', title: '知情范围提前扩大',
      description: '第二章让同伴直接说出古钟代价。', evidence: [{ chapterId: second.id, excerpt: '同伴说出古钟会夺走记忆' }],
      recommendation: '先补充同伴获得信息的场景证据。', status: '待处理', createdAt: now
    })
    database.createProject(project)
    database.saveMemoryProposals([{
      id: 'proposal-2', projectId: project.id, chapterId: second.id, sourceDigest: second.sourceDigest,
      category: '剧情事实', candidate: { content: '同伴也听见了钟声' }, source: { chapterId: second.id, excerpt: '同伴忽然捂住耳朵' },
      confidence: .8, risk: '中', status: '待确认', createdAt: now
    }])
    const generate = vi.fn().mockResolvedValue({ answer: '已按当前阶段资料分析。', references: [], actions: [] })
    const service = new CreativeChatService(database, { generate } as unknown as ProviderService)
    const stages = [
      ['idea', undefined], ['world', undefined], ['outline', card.id], ['writing', second.id], ['memory', second.id], ['delivery', undefined]
    ] as const
    for (const [stage, targetId] of stages) await service.send(project.id, { stage, targetId, mode: '问题分析', content: '请分析当前资料。' })
    const prompts = generate.mock.calls.map(([request]) => String(request.user))

    expect(prompts[0]).toContain('阶段职责：只围绕故事种子')
    expect(prompts[0]).toContain('待确认术语')
    expect(prompts[1]).toContain('阶段职责：只围绕世界规则')
    expect(prompts[1]).toContain('所有人都遗忘了钟声')
    expect(prompts[2]).toContain('阶段职责：只围绕总纲、卷纲、章卡')
    expect(prompts[2]).toContain('当前目标章：第2章')
    expect(prompts[2]).toContain('封闭钟楼')
    expect(prompts[3]).toContain('阶段职责：只围绕当前章节')
    expect(prompts[3]).toContain('修辞强度：极少')
    expect(prompts[3]).toContain('普通段落原则上不主动添加显性比喻')
    expect(prompts[3]).toContain('确认第二次钟声的代价')
    expect(prompts[3]).toContain('林砚隐瞒古钟')
    expect(prompts[4]).toContain('阶段职责：只围绕正式记忆')
    expect(prompts[4]).toContain('同伴忽然捂住耳朵')
    expect(prompts[4]).toContain('古钟星纹')
    expect(prompts[5]).toContain('阶段职责：只围绕连续性')
    expect(prompts[5]).toContain('同伴说出古钟会夺走记忆')
    expect(prompts[0]).not.toContain('普通段落原则上不主动添加显性比喻')
    expect(prompts[1]).not.toContain('普通段落原则上不主动添加显性比喻')
    expect(prompts[2]).not.toContain('普通段落原则上不主动添加显性比喻')
    expect(prompts[4]).not.toContain('普通段落原则上不主动添加显性比喻')
    expect(new Set(prompts.map((prompt) => prompt.match(/阶段职责：([^\n]+)/)?.[1])).size).toBe(6)
    database.close()
  })

  it('灵感讨论和问题分析清空生成动作，生成准备才保留阶段内动作', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const generate = vi.fn().mockResolvedValue({
      answer: '先确认局部范围。', references: [], actions: [
        { label: '生成当前章局部候选', instruction: '只处理当前章。', kind: 'chapter-revision', chapterId: project.chapters[0]!.id },
        { label: '越权世界生成', instruction: '不应保留。', kind: 'world-foundation' }
      ]
    })
    const service = new CreativeChatService(database, { generate } as unknown as ProviderService)

    for (const mode of ['灵感讨论', '问题分析'] as const) {
      const response = await service.send(project.id, { stage: 'writing', targetId: project.chapters[0]!.id, mode, content: '先讨论这一章。' })
      expect(response.messages[1]!.actions).toEqual([])
      expect(String(generate.mock.calls.at(-1)?.[0].user)).toContain('actions 必须为空')
    }
    const prepared = await service.send(project.id, { stage: 'writing', targetId: project.chapters[0]!.id, mode: '生成准备', content: '准备生成当前章局部候选。' })
    expect(prepared.messages[1]!.actions.map((action) => action.kind)).toEqual(['chapter-revision'])
    expect(String(generate.mock.calls.at(-1)?.[0].user)).toContain('当前阶段允许的最小范围候选动作')
    database.close()
  })

  it('清理模型回复中的外部品牌、内部编号和技术路径', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const provider = { generate: vi.fn().mockResolvedValue({
      answer: '参考万象谱的 chapter-1 和 /worldBible/historySummary，并返回 JSON。',
      references: [{ title: 'creative-chat · thread-clock', reason: '来自 block-1 的 writing_companion 记录。' }],
      actions: []
    }) } as unknown as ProviderService
    const response = await new CreativeChatService(database, provider).send(project.id, { stage: 'world', mode: '问题分析', content: '检查显示内容。' })
    const visible = JSON.stringify(response.messages[1])
    expect(visible).not.toMatch(/万象谱|creative-chat|writing_companion|chapter-1|thread-clock|block-1|\/worldBible\/historySummary|JSON/i)
    expect(visible).toContain('同类创作工具')
    database.close()
  })

  it('拒绝其他小说的助手身份，并把当前项目专职身份发给模型', async () => {
    const database = new NovelDatabaseService(':memory:'), first = makeNovel(1), second = makeNovel(1)
    first.title = '雾港之书'; second.title = '山海之书'
    database.createProject(first); database.createProject(second)
    const generate = vi.fn().mockResolvedValue({ answer: '只分析当前小说。', references: [], actions: [] })
    const service = new CreativeChatService(database, { generate } as unknown as ProviderService)
    const firstWorld = service.listProjectAssistants(first.id).find((item) => item.stage === 'world')!
    const secondWorld = service.listProjectAssistants(second.id).find((item) => item.stage === 'world')!

    await expect(service.send(first.id, { assistantId: secondWorld.id, stage: 'world', mode: '问题分析', content: '检查世界观。' })).rejects.toThrow('不属于当前小说项目')
    expect(generate).not.toHaveBeenCalled()
    await service.send(first.id, { assistantId: firstWorld.id, stage: 'world', mode: '问题分析', content: '检查世界观。' })
    const request = generate.mock.calls[0]![0] as { system: string; user: string }
    expect(request.system).toContain('世界构筑顾问')
    expect(request.system).toContain('雾港之书')
    expect(request.system).not.toContain('山海之书')
    database.close()
  })

  it('记忆阶段按目标章节隔离未来事实、角色认知和伏笔', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(2)
    const now = new Date().toISOString(), first = project.chapters[0]!, second = project.chapters[1]!
    project.memories = [
      {
        id: 'memory-first', chapterId: first.id, chapterNumber: 1, status: '正式', sourceDigest: first.sourceDigest,
        summary: '第一章建立了旧城线索。', keyEvents: ['发现旧城线索'], characterStates: [],
        facts: [{ id: 'fact-first', category: '秘密', content: '旧城存在一条线索', certainty: '正式', locked: false, source: { chapterId: first.id, excerpt: '旧城线索' } }],
        objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: now
      },
      {
        id: 'memory-future', chapterId: second.id, chapterNumber: 2, status: '正式', sourceDigest: second.sourceDigest,
        summary: '第二章才揭露王都真相。', keyEvents: ['揭露王都真相'], characterStates: [],
        facts: [
          { id: 'fact-future', category: '秘密', content: '王都藏有真正的钥匙', certainty: '正式', locked: true, source: { chapterId: second.id, excerpt: '真正的钥匙' }, appliesFromChapter: 2 },
          { id: 'fact-early-planned', category: '秘密', content: '第十章才会发生的事件', certainty: '正式', locked: false, source: { chapterId: second.id, excerpt: '第十章' }, appliesFromChapter: 10 },
          { id: 'fact-knowledge', category: '秘密', content: '主角误以为钥匙已毁', certainty: '正式', locked: false, perspective: '角色认知', knownToCharacterIds: ['char-1'], source: { chapterId: second.id, excerpt: '主角误以为' }, appliesFromChapter: 2 }
        ],
        objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: now
      }
    ]
    project.plotThreads = [
      { id: 'thread-past', title: '旧城线索', detail: '追查线索', characterIds: [], status: '推进中', setupChapterId: first.id, setupMethod: '对话', targetPayoffChapter: 4, resolutionMethod: '', progress: [], updatedAt: now },
      { id: 'thread-future', title: '王都真相', detail: '尚未出现', characterIds: [], status: '计划', setupChapterId: second.id, setupMethod: '尚未埋设', targetPayoffChapter: 8, resolutionMethod: '', progress: [], updatedAt: now }
    ]
    database.createProject(project)
    const generate = vi.fn().mockResolvedValue({ answer: '按当前章节分析。', references: [], actions: [] })
    const service = new CreativeChatService(database, { generate } as unknown as ProviderService)

    await service.send(project.id, { stage: 'memory', targetId: first.id, mode: '问题分析', content: '检查第一章记忆。' })
    const prompt = String(generate.mock.calls[0]![0].user)
    expect(prompt).toContain('旧城存在一条线索')
    expect(prompt).not.toContain('王都藏有真正的钥匙')
    expect(prompt).not.toContain('第十章才会发生的事件')
    expect(prompt).not.toContain('王都真相')

    await service.send(project.id, { stage: 'memory', targetId: second.id, mode: '问题分析', content: '检查第二章记忆。' })
    const secondPrompt = String(generate.mock.calls[1]![0].user)
    expect(secondPrompt).toContain('王都藏有真正的钥匙')
    expect(secondPrompt).toContain('王都真相')
    expect(secondPrompt).toContain('主角误以为钥匙已毁')
    expect(secondPrompt).not.toContain('第十章才会发生的事件')
    database.close()
  })
})
