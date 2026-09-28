import {
  CreativeChatReplySchema, CreativeChatSendSchema, type CreativeChatMessage, type CreativeChatSend,
  type CreativeChatStage, type CreativeConversation, type CreativeChatMode, type NovelProject, type CreativeChatAction, rhetoricGuidance,
  assistantScopeKey, type AssistantSkillLoadReceipt
} from '../../contracts/src'
import type { ProviderService } from './ai/provider'
import type { NovelDatabaseService } from './novelDatabase'
import { chapterText, resolveCharacterKnowledge, resolveStoryFacts } from './novelMemory'
import { calculatePlotThreadReadiness, explainPlotThreadCognition, normalizePlotThreadEvidence } from './novelStoryline'
import { buildProjectAssistants, getProjectAssistant } from './projectAssistantCatalog'
import { resolveCreativeSkills, withCreativeSkillGuidance } from './creativeSkillRuntime'
import { resolveAssistantRun, type ResolvedAssistantRun } from './assistantWorkflow'

const STAGE_LABEL: Record<CreativeChatStage, string> = { idea: '灵感与规格', world: '世界观', outline: '小说大纲', writing: '正文创作', memory: '记忆与伏笔', delivery: '审稿与导出' }
const MODE_RULE: Record<CreativeChatMode, string> = {
  灵感讨论: '提供多个可比较的原创方向，说明各自吸引力和代价；不要把任何方向当成作者决定。',
  问题分析: '只分析有现有资料依据的问题，先解释证据和影响，再给最小修改方向；主观判断必须标成建议作者判断。',
  生成准备: '先复述生成目标、范围、必须遵守的事实和可能影响；信息不足时先提出需要作者补充的事项，不要直接生成正式内容。',
  综合协作: '先判断作者是想探索方向、检查问题，还是准备候选；不确定时优先讨论或追问，绝不擅自启动生成。'
}
const STAGE_FOCUS: Record<CreativeChatStage, string> = {
  idea: '只围绕故事种子、题材方向、主角欲望、核心冲突和创作规格展开；未知设定先列为待决定事项。',
  world: '只围绕世界规则、术语边界、人物与势力、地点、历史、力量和资源关系展开；不要把推测写成世界事实。',
  outline: '只围绕总纲、卷纲、章卡、因果链、转折、信息揭露和伏笔节奏展开；局部规划不能覆盖其他卷章。',
  writing: '只围绕当前章节的章卡、剧情步骤、人物状态、场景目标和正文表达展开；不得跳过当前章节范围改写全书。',
  memory: '只围绕正式记忆、客观事实、角色认知、生效时间、证据和伏笔生命周期展开；未知信息必须保持未知。',
  delivery: '只围绕连续性、人物弧光、伏笔闭环、中文质量、审稿证据和导出前风险展开；建议必须可定位、可执行。'
}

const SYSTEM = `你是“墨境”的创作对话助手。你负责和作者讨论灵感、分析问题、准备一项可控的创作任务。
必须使用自然、完整、清晰的中文；明确主语，不偷换术语，不把未确认信息写成事实。
你可以提出多个方向，但不要假装作者已经确认。不得直接修改正式世界观、正文、记忆或伏笔。
如果作者需要实际生成，返回一个最小范围的候选动作；动作只会在作者再次确认后执行。没有合适动作时 actions 返回空数组。
references 只写中文资料名称和“为什么参考”，不要返回字段路径、JSON、内部 ID 或技术名词。`

export class CreativeChatService {
  constructor(private readonly database: NovelDatabaseService, private readonly provider: ProviderService) {}

  listProjectAssistants(projectId: string) {
    const project = this.database.getProject(projectId)
    const counts = Object.fromEntries((['idea', 'world', 'outline', 'writing', 'memory', 'delivery'] as CreativeChatStage[]).map((stage) => [stage, this.database.listCreativeConversations(projectId, stage, true).length]))
    return buildProjectAssistants(project, counts)
  }

  async send(projectId: string, raw: CreativeChatSend): Promise<{ conversation: CreativeConversation; messages: CreativeChatMessage[]; context?: ResolvedAssistantRun['context']; effective?: ResolvedAssistantRun['effective']; skillLoadReceipt?: AssistantSkillLoadReceipt }> {
    const input = CreativeChatSendSchema.parse(raw)
    const project = this.database.getProject(projectId)
    /**
     * 精确作用域是服务端重算出来的，不是客户端说了算：
     * 作者报告的目标 + 任务类型先过白名单和归属校验，跨项目/已删除对象一律拒绝。
     * 旧客户端不传 target/taskType 时走原来的阶段级技能装配，行为不变。
     */
    const run = input.target && input.taskType
      ? resolveAssistantRun({
        database: this.database, project, stage: input.stage, target: input.target,
        taskType: input.taskType, intent: input.intent, selection: input.selection,
        explicitProviderId: input.providerId
      })
      : undefined
    if (run?.effective.unavailable) throw Object.assign(new Error(run.effective.unavailable.message), { code: run.effective.unavailable.code })
    const installedSkills = run
      ? { providerId: run.effective.providerId || undefined, skillPrompt: run.skillPrompt, markLoaded: run.markLoaded }
      : resolveCreativeSkills(this.database, project.id, input.stage)
    const assistant = getProjectAssistant(project, input.stage, this.database.listCreativeConversations(project.id, input.stage).length)
    if (input.assistantId && input.assistantId !== assistant.id) throw new Error('该创作助手不属于当前小说项目或当前创作阶段。')
    validateStageTarget(project, input.stage, input.targetId)
    // 精确目标必须落回会话 key：换目标就换会话，旧候选/旧讨论不会串到新目标上。
    const scopedTargetId = input.target ? assistantScopeKey(input.target) : input.targetId
    let conversation = input.conversationId ? this.database.getCreativeConversation(project.id, input.conversationId) : undefined
    if (input.conversationId && !conversation) throw new Error('找不到当前项目的这段对话，请重新选择或开始新对话。')
    if (!conversation) conversation = this.database.createCreativeConversation({ projectId: project.id, stage: input.stage, targetId: scopedTargetId })
    if (conversation.stage !== input.stage) throw new Error('对话所属创作阶段不一致。')
    if (conversation.assistantId !== assistant.id) throw new Error('这段对话不属于当前项目助手。')
    if (conversation.targetId !== (scopedTargetId ?? '')) throw new Error('当前创作对象已经变化，请为新章节或新范围开始一段新对话。')
    const previous = this.database.listCreativeMessages(project.id, conversation.id)
    const userMessage = this.database.appendCreativeMessage({ conversationId: conversation.id, role: 'user', content: input.content.trim(), mode: input.mode, references: [], actions: [], projectRevision: project.revision })
    const boundedHistory = [...previous, userMessage].slice(-12).map((item) => `${item.role === 'user' ? '作者' : '助手'}：${item.content}`).join('\n')
    // 精确作用域必须真的进入上下文：只把 target 用在会话 key 上、而正文上下文仍停留在
    // 「尚未选择章节」，会让作者以为助手看到了当前章，实际什么都没读。
    const contextTargetId = input.target && (input.target.kind === 'chapter' || input.target.kind === 'beat')
      ? input.target.objectId
      : input.targetId
    const context = buildStageContext(project, input.stage, contextTargetId, this.database.listMemoryProposals(project.id))
    let reply: ReturnType<typeof CreativeChatReplySchema.parse>
    let skillLoadReceipt: AssistantSkillLoadReceipt | undefined
    try {
      reply = await this.provider.generate(withCreativeSkillGuidance({
      system: `${SYSTEM}\n你在当前项目中的专职身份是“${assistant.name}”：${assistant.role}。只能服务小说《${project.title}》，不能引用或混入其他项目的资料与对话。`,
      user: `当前项目助手：${assistant.name}\n专属欢迎说明：${assistant.welcome}\n当前阶段：${STAGE_LABEL[input.stage]}\n阶段职责：${STAGE_FOCUS[input.stage]}\n本轮工作方式：${input.mode}\n工作规则：${MODE_RULE[input.mode]}\n${context}\n\n最近对话：\n${boundedHistory}\n\n本轮作者消息：${input.content}\n\n请回复结构化结果：先给出可执行的中文建议，再列出实际参考资料。${input.mode === '生成准备' || (input.mode === '综合协作' && input.allowCandidateActions) ? '作者本轮明确要求准备生成或修改；可以返回当前阶段允许的最小范围候选动作，但仍需作者再次点击确认。' : '本轮只用于讨论或分析，actions 必须为空，不要启动生成任务。'}`,
      schema: CreativeChatReplySchema,
      schemaName: 'mojing_creative_chat_reply',
      temperature: 0.55,
      maxOutputTokens: 2_500,
      providerId: input.providerId ?? installedSkills.providerId,
      usageContext: { projectId: project.id, operation: `项目助手·${assistant.name}` }
      }, installedSkills))
      skillLoadReceipt = installedSkills.markLoaded?.()
    } catch (error) {
      if (input.retainFailedConversation) {
        const message = error instanceof Error ? error.message : String(error)
        this.database.appendCreativeMessage({ conversationId: conversation.id, role: 'assistant', content: `本次对话未成功：${message}`, mode: input.mode, references: [], actions: [], projectRevision: project.revision })
      } else if (previous.length === 0) {
        this.database.removeCreativeConversation(project.id, conversation.id)
      } else {
        this.database.removeCreativeMessage(project.id, userMessage.id)
      }
      throw error
    }
    const actionsAllowed = input.mode === '生成准备' || (input.mode === '综合协作' && input.allowCandidateActions)
    const actions = reply.actions.filter((action) => actionAllowed(this.database, project, input.stage, actionsAllowed, input.targetId, action)).slice(0, 3).map(cleanAction)
    const references = reply.references.slice(0, 8).map((item) => ({ title: cleanVisibleText(item.title), reason: cleanVisibleText(item.reason) }))
    this.database.appendCreativeMessage({ conversationId: conversation.id, role: 'assistant', content: cleanVisibleText(reply.answer), mode: input.mode, references, actions, projectRevision: project.revision })
    conversation = this.database.getCreativeConversation(project.id, conversation.id)!
    const messages = this.database.listCreativeMessages(project.id, conversation.id).slice(-2)
    return {
      conversation,
      messages,
      ...(run ? { context: run.context, effective: run.effective } : {}),
      ...(skillLoadReceipt ? { skillLoadReceipt } : {})
    }
  }
}

function allowedKinds(stage: CreativeChatStage, allowCandidateActions: boolean): Set<string> {
  if (!allowCandidateActions) return new Set()
  const map: Record<CreativeChatStage, string[]> = {
    idea: ['story-direction', 'writing-specs', 'world-constraint-extraction', 'world-foundation'], world: ['world-section', 'world-foundation', 'world-audit'],
    outline: ['outline-foundation', 'outline-volume', 'scene-beats'], writing: ['chapter', 'chapter-revision', 'scene-beats'],
    memory: ['memory-extraction', 'memory-rebuild', 'continuity-audit', 'foreshadow-review'], delivery: ['continuity-audit', 'foreshadow-review']
  }
  return new Set(map[stage])
}

function validateStageTarget(project: NovelProject, stage: CreativeChatStage, targetId?: string): void {
  if (!targetId) return
  if ((stage === 'writing' || stage === 'memory') && !project.chapters.some((chapter) => chapter.id === targetId)) throw new Error('当前章节不存在，请重新选择章节。')
  if (stage === 'outline' && !project.outline?.volumes.some((volume) => volume.chapters.some((chapter) => chapter.id === targetId))) throw new Error('当前章纲不存在，请重新选择章节范围。')
}

function actionAllowed(database: NovelDatabaseService, project: NovelProject, stage: CreativeChatStage, allowCandidateActions: boolean, targetId: string | undefined, action: CreativeChatAction): boolean {
  if (!allowedKinds(stage, allowCandidateActions).has(action.kind)) return false
  if (['scene-beats', 'chapter', 'chapter-revision', 'memory-extraction'].includes(action.kind)) {
    if (!targetId || action.chapterId !== targetId || !project.chapters.some((chapter) => chapter.id === targetId)) return false
  }
  if (action.kind === 'outline-volume') {
    const volume = project.outline?.volumes.find((item) => item.volumeNumber === action.volumeNumber)
    if (!volume) return false
    if (targetId && !volume.chapters.some((chapter) => chapter.id === targetId)) return false
  }
  if (action.kind === 'world-section' && !WORLD_ENTRY_TYPES.has(action.worldEntryType ?? '')) return false
  if (action.kind === 'world-audit' || action.kind === 'world-repair-suggestion') {
    if (!action.proposalId) return false
    try {
      const proposal = database.getRevision(action.proposalId)
      if (proposal.projectId !== project.id || proposal.target !== 'worldBible' || proposal.status !== '待处理') return false
      if (action.kind === 'world-repair-suggestion' && (!action.findingId || !proposal.qualityFindings?.some((finding) => finding.id === action.findingId))) return false
    } catch { return false }
  }
  return true
}

const WORLD_ENTRY_TYPES = new Set(['角色', '修行体系', '国家', '货币', '势力', '地点', '种族', '宗教', '文化', '历史', '历法', '科技魔法', '物品', '自定义'])

function cleanAction(action: CreativeChatAction): CreativeChatAction {
  return { ...action, label: cleanVisibleText(action.label), instruction: cleanVisibleText(action.instruction) }
}

function cleanVisibleText(value: string): string {
  return value
    .replace(/\b(?:chapter|thread|block|character|beat|seat|capability)-[a-z0-9_-]+\b/gi, '对应内容')
    .replace(/(?:\/[a-z_][a-z0-9_-]*){2,}/gi, '对应资料位置')
    .replace(/万象谱|墨伴|writing_companion|creative-chat/gi, '同类创作工具')
    .replace(/JSON/gi, '结构化数据')
}

function buildStageContext(project: NovelProject, stage: CreativeChatStage, targetId?: string, memoryProposals: ReturnType<NovelDatabaseService['listMemoryProposals']> = []): string {
  const settings = project.settings
  const rhetoric = rhetoricGuidance(settings.rhetoricIntensity)
  const rhetoricText = `修辞强度：${rhetoric.label}。${rhetoric.description}正文生成时遵守：${rhetoric.instruction}这是软性密度参考，不要机械计数。`
  const profile = settings.styleProfileSnapshot
  const styleProfileText = profile ? `抽象文风画像：${JSON.stringify({ 文风说明: profile.description, 写作特征: profile.traits, 建议遵守: profile.guidelines, 需要避免: profile.avoidPatterns })}。只借鉴一般技法，不得猜测或模仿具体作者，不得复现来源文本；若与修辞强度冲突，以修辞强度为上限。` : '抽象文风画像：本项目未启用。'
  const common = `题材：${settings.genreTemplate}；视角：${settings.pointOfView}；目标篇幅：${settings.plannedChapters}章；文风：${settings.style || '未指定'}；故事种子：${project.seed.slice(0, 4_000)}`
  if (stage === 'idea') {
    const confirmed = project.worldConstraints.filter((item) => item.status === '已确认' || item.status === '已锁定')
    const pending = project.worldConstraints.filter((item) => item.status === '待确认')
    return `${common}\n目标读者：${settings.audience || '未指定'}；内容边界：${settings.contentLimits || '未指定'}\n已确认术语：${confirmed.map((item) => `${item.term}：${item.definition}`).join('；') || '暂无'}\n待确认术语：${pending.map((item) => `${item.term}（${item.unresolvedQuestions.join('、') || '尚无未决事项'}）`).join('；') || '暂无'}`
  }
  if (stage === 'world') {
    const pending = project.worldConstraints.filter((item) => item.status === '待确认')
    const confirmed = project.worldConstraints.filter((item) => item.status === '已确认' || item.status === '已锁定')
    const findings = project.worldQualityFindings.filter((item) => item.status === '待处理').slice(0, 8)
    return `${common}\n世界摘要：${project.worldBible?.premise ?? '尚未建立'}\n规则：${(project.worldBible?.rules ?? []).slice(0, 12).join('；') || '暂无'}\n已确认术语边界：${confirmed.map((item) => `${item.term}是“${item.definition}”，不是“${item.notDefinition || '未补充'}”；未决事项：${item.unresolvedQuestions.join('、') || '无'}`).join('；') || '暂无'}\n词条：${(project.worldBible?.entries ?? []).slice(0, 24).map((item) => `${item.type}·${item.name}：${item.summary}`).join('；') || '暂无'}\n时间线：${(project.worldBible?.timeline ?? []).slice(0, 12).map((item) => `${item.dateLabel}·${item.title}：${item.description}`).join('；') || '暂无'}\n待确认术语：${pending.map((item) => `${item.term}：${item.definition}`).join('；') || '暂无'}\n待处理审校：${findings.map((item) => `“${item.evidence.excerpt}”：${item.explanation}`).join('；') || '暂无'}`
  }
  if (stage === 'outline') {
    const target = targetId ? project.outline?.volumes.flatMap((volume) => volume.chapters).find((chapter) => chapter.id === targetId) : undefined
    const volumeText = (project.outline?.volumes ?? []).map((volume) => `第${volume.volumeNumber}卷《${volume.title}》：目标“${volume.goal || '未填写'}”；高潮“${volume.climax || '未填写'}”；收束“${volume.resolution || '未填写'}”`).join('；') || '暂无'
    const cards = (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters).slice(0, 24)
    const cardText = cards.map((chapter) => `第${chapter.chapterNumber}章《${chapter.title}》：目标“${chapter.objective || '未填写'}”；冲突“${chapter.conflict || '未填写'}”；转折“${chapter.turningPoint || '未填写'}”；步骤状态“${chapter.beatStatus}”`).join('；') || '暂无'
    const targetText = target ? `\n当前目标章：第${target.chapterNumber}章《${target.title}》；步骤：${target.beats.map((beat) => beat.title).join('、') || '暂无'}` : ''
    const constraints = project.worldConstraints.filter((item) => item.status === '已确认' || item.status === '已锁定').map((item) => `${item.term}：${item.definition}`).join('；') || '暂无'
    const threads = project.plotThreads.filter((item) => !['已回收', '已放弃'].includes(item.status)).slice(0, 12).map((item) => `${item.title}（${item.status}，计划第${item.targetPayoffChapter ?? '未定'}章回收）`).join('；') || '暂无'
    return `${common}\n世界摘要：${project.worldBible?.premise ?? '尚未建立'}\n不可违反的世界规则：${project.worldBible?.rules.slice(0, 12).join('；') || '暂无'}\n已确认术语：${constraints}\n总纲：${project.outline?.synopsis ?? '尚未建立'}\n主冲突：${project.outline?.mainConflict ?? '尚未建立'}\n卷级规划：${volumeText}\n章卡：${cardText}${targetText}\n未完成伏笔：${threads}`
  }
  if (stage === 'writing') {
    const ordered = [...project.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber)
    const chapter = targetId ? ordered.find((item) => item.id === targetId) : undefined
    const index = chapter ? ordered.findIndex((item) => item.id === chapter.id) : -1
    const neighbors = index >= 0 ? ordered.slice(Math.max(0, index - 2), index + 3).filter((item) => item.id !== chapter?.id) : []
    const plan = chapter ? project.outline?.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapter.id) : undefined
    const priorMemories = chapter ? project.memories.filter((item) => item.chapterNumber < chapter.chapterNumber && item.status === '正式').slice(-6) : []
    const characterIds = new Set(plan?.characterIds ?? [])
    const characters = project.worldBible?.entries.filter((entry) => characterIds.has(entry.id)).map((entry) => `${entry.name}：${entry.summary}`).join('；') || '暂无'
    // 角色认知和剧情事实必须按目标章节的生效时间召回，不能只按记忆记录所在章节筛选。
    // 否则“第 2 章才生效”的事实若被提前提取到第 1 章记忆中，会泄露未来信息。
    const visibleFacts = chapter
      ? resolveStoryFacts(project.memories, Math.max(0, chapter.chapterNumber - 1), { perspective: '客观事实' }).map((fact) => fact.content).slice(-12)
      : []
    const visibleKnowledge = chapter
      ? resolveCharacterKnowledge(project.memories, Math.max(0, chapter.chapterNumber - 1), [...characterIds]).flatMap((state) => state.knowledge).slice(-12)
      : []
    return `${common}\n${rhetoricText}\n${styleProfileText}\n当前章节：${chapter ? `第${chapter.chapterNumber}章《${chapter.title}》\n${chapterText(chapter).slice(0, 12_000)}` : '尚未选择章节'}\n当前章纲：${plan ? `目标“${plan.objective}”；冲突“${plan.conflict}”；转折“${plan.turningPoint}”；步骤“${plan.beats.map((beat) => beat.title).join('、') || '暂无'}”` : '暂无'}\n本章人物：${characters}\n不可违反的世界规则：${project.worldBible?.rules.slice(0, 12).join('；') || '暂无'}\n前文正式记忆：${priorMemories.map((item) => `第${item.chapterNumber}章：${item.summary}`).join('；') || '暂无'}\n本章人物已知事实：${visibleFacts.join('；') || '暂无'}\n本章人物已知认知：${visibleKnowledge.join('；') || '暂无'}\n相邻章节：${neighbors.map((item) => `第${item.chapterNumber}章《${item.title}》`).join('、') || '暂无'}`
  }
  if (stage === 'memory') {
    const targetChapterNumber = targetId ? project.chapters.find((item) => item.id === targetId)?.chapterNumber : undefined
    const targetMemory = targetId ? project.memories.find((item) => item.chapterId === targetId && item.status === '正式') : undefined
    const visibleMemories = targetChapterNumber === undefined
      ? project.memories.filter((item) => item.status === '正式').slice(-18)
      : project.memories.filter((item) => item.status === '正式' && item.chapterNumber <= targetChapterNumber).slice(-18)
    const pending = memoryProposals.filter((item) => {
      if (item.status !== '待确认' || targetChapterNumber === undefined) return item.status === '待确认'
      const sourceNumber = project.chapters.find((chapter) => chapter.id === item.chapterId)?.chapterNumber
      // 当前章节尚未形成正式记忆时，仍允许查看本章提案；未知来源不注入上下文。
      return sourceNumber !== undefined && sourceNumber <= targetChapterNumber
    }).slice(0, 8)
    const targetFacts = targetMemory?.facts.filter((fact) => isMemoryItemVisible(fact, targetMemory.chapterNumber, targetMemory.chapterNumber)).map((fact) => `${fact.perspective ?? '客观事实'}：${fact.content}；证据“${fact.source.excerpt}”`).join('；') || '暂无'
    const visibleThreads = targetChapterNumber === undefined ? project.plotThreads : project.plotThreads.filter((thread) => plotThreadVisibleBefore(thread, project, targetChapterNumber))
    const threadText = visibleThreads.slice(-18).map((item) => {
      const readiness = calculatePlotThreadReadiness(item)
      const cognition = explainPlotThreadCognition(item)
      const evidence = normalizePlotThreadEvidence(item).slice(-6).map((entry) => `${entry.phase}证据“${entry.excerpt}”（第${entry.chapterId}章）`).join('；') || '暂无'
      return `${item.title}（${item.status}；准备度${Math.round(readiness.score * 100)}%·${readiness.level}；缺口${readiness.gaps.slice(0, 2).join('、') || '无'}；读者知道“${cognition.reader || '未记录'}”；主角知道“${cognition.protagonist || '未记录'}”；证据：${evidence}）`
    }).join('；') || '暂无'
    return `${common}\n目标章节记忆：${targetMemory ? `第${targetMemory.chapterNumber}章：${targetMemory.summary}` : '未指定'}\n目标章节事实与证据：${targetFacts}\n正式记忆：${visibleMemories.map((item) => `第${item.chapterNumber}章摘要：${item.summary || '未填写'}；关键事件：${item.keyEvents.slice(0, 4).join('、') || '暂无'}；角色状态 ${item.characterStates.length} 条；剧情事实 ${item.facts.length} 条`).join('；') || '暂无'}\n待确认记忆提案：${pending.map((item) => `${item.category}：${item.source.excerpt}`).join('；') || '暂无'}\n伏笔证据与认知差：${threadText}`
  }
  const deliveryThreads = project.plotThreads.slice(-18).map((item) => {
    const readiness = calculatePlotThreadReadiness(item)
    const cognition = explainPlotThreadCognition(item)
    return `${item.title}（${item.status}；${readiness.level} ${Math.round(readiness.score * 100)}%；缺口${readiness.gaps.slice(0, 2).join('、') || '无'}；认知差${cognition.gapSummary || '未记录'}）`
  }).join('；') || '暂无'
  return `${common}\n总纲：${project.outline?.synopsis ?? '尚未建立'}\n正式记忆概况：${project.memories.slice(-12).map((item) => `第${item.chapterNumber}章：${item.summary}`).join('；') || '暂无'}\n审稿问题：${project.reviews.filter((item) => item.status === '待处理').slice(0, 18).map((item) => `${item.title}：${item.description}；证据：${item.evidence[0]?.excerpt || '暂无'}；建议：${item.recommendation}`).join('；') || '暂无'}\n伏笔准备度与认知差：${deliveryThreads}`
}

/**
 * 判断一项记忆在目标章节是否已经生效。来源章节只是“作者记录它的地方”，
 * 不能替代 appliesFrom/Through；规划中的未来事实因此不会被阶段助手提前看到。
 */
function isMemoryItemVisible(item: { appliesFromChapter?: number; appliesThroughChapter?: number }, sourceChapter: number, targetChapter: number): boolean {
  const start = item.appliesFromChapter ?? sourceChapter
  return start <= targetChapter && (item.appliesThroughChapter === undefined || targetChapter <= item.appliesThroughChapter)
}

/** 只向章节级记忆助手展示已经埋设或已经推进到目标章节的伏笔。 */
function plotThreadVisibleBefore(thread: NovelProject['plotThreads'][number], project: NovelProject, targetChapter: number): boolean {
  const chapterNumber = (chapterId?: string): number | undefined => chapterId ? project.chapters.find((chapter) => chapter.id === chapterId)?.chapterNumber : undefined
  const setup = chapterNumber(thread.setupChapterId)
  if (setup !== undefined && setup <= targetChapter) return true
  return thread.progress.some((item) => {
    const progressChapter = chapterNumber(item.chapterId)
    return progressChapter !== undefined && progressChapter <= targetChapter
  })
}
