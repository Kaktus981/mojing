import type { NovelContextEntry, NovelContextLayerLedger, NovelGenerationEstimate, NovelMemoryLayer } from '../../contracts/src/novelApi'
import { rhetoricGuidance, type NovelProject, type StoryDirectionCard, type StoryDirectionFieldKey } from '../../contracts/src/novel'
import type { NovelDatabaseService } from './novelDatabase'
import { chapterText, compactMemory, resolveCharacterKnowledge, resolveCharacterStates, resolveStoryFacts } from './novelMemory'

interface Component { entry: NovelContextEntry; value: unknown }

export interface BuiltNovelContext extends NovelGenerationEstimate {
  json: string
  /** 五层召回账本，包含被纳入与因预算排除的条目。 */
  layers: NovelContextLayerLedger[]
}

const MEMORY_LAYERS: Array<{ layer: NovelMemoryLayer; title: string; summary: string }> = [
  { layer: '稳定事实', title: '稳定事实', summary: '创作规格、已确认设定、人物底线和已定稿规划。' },
  { layer: '动态状态', title: '动态状态', summary: '按目标章节已经生效的角色状态与角色认知。' },
  { layer: '剧情证据', title: '剧情证据', summary: '章节摘要、事实、剧情线和伏笔的证据链。' },
  { layer: '近期正文', title: '近期正文', summary: '用于直接承接的相邻章节完整正文。' },
  { layer: '远期召回', title: '远期召回', summary: '通过实体、别名和全文索引找回的旧证据。' }
]

const LAYER_BY_ID: Record<string, NovelMemoryLayer> = {
  settings: '稳定事实', 'story-direction': '稳定事实', 'world-constraints': '稳定事实', 'world-core': '稳定事实', 'world-entries': '稳定事实', outline: '稳定事实',
  'character-states': '动态状态', 'character-knowledge': '动态状态',
  storylines: '剧情证据', memories: '剧情证据', 'story-facts': '剧情证据', threads: '剧情证据',
  recent: '近期正文', 'entity-mentions': '远期召回', retrieved: '远期召回'
}

export function buildNovelContext(database: NovelDatabaseService, project: NovelProject, chapterId?: string, tokenBudget = 60_000, includeWritingStyle = false): BuiltNovelContext {
  const chapter = project.chapters.find((item) => item.id === chapterId)
  const outlineCard = project.outline?.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapterId || item.chapterNumber === chapter?.chapterNumber)
  const characterIds = new Set(outlineCard?.characterIds ?? [])
  const referencedEntries = (project.worldBible?.entries ?? []).filter((entry) => characterIds.has(entry.id))
  const query = [chapter?.title, outlineCard?.objective, outlineCard?.conflict, ...referencedEntries.flatMap((entry) => [entry.name, ...entry.aliases])].filter(Boolean).join(' ')
  const allRetrieved = database.search(project.id, query, 24)
  const chapterNumberById = new Map(project.chapters.map((item) => [item.id, item.chapterNumber]))
  const retrieved = chapter ? allRetrieved.filter((item) => {
    if (item.sourceType === 'world') return true
    if (item.sourceType === 'chapter' || item.sourceType === 'memory') return (chapterNumberById.get(item.sourceId) ?? Number.POSITIVE_INFINITY) <= chapter.chapterNumber
    return false
  }) : allRetrieved.filter((item) => item.sourceType === 'world')
  const retrievedIds = new Set(retrieved.map((item) => item.sourceId))
  const safeRetrieved = retrieved.filter((item) => item.sourceType !== 'memory')
  const components: Component[] = []

  const rhetoric = rhetoricGuidance(project.settings.rhetoricIntensity)
    add(components, 'settings', '创作规格', '题材、视角、文风与修辞强度', {
    题材模板: project.settings.genreTemplate,
    目标字数: project.settings.targetWords,
    预计卷数: project.settings.plannedVolumes,
    预计章节数: project.settings.plannedChapters,
    叙事视角: project.settings.pointOfView,
    时态: project.settings.tense,
    目标读者: project.settings.audience,
    语言与文风: project.settings.style,
    修辞强度: `${rhetoric.label}（${rhetoric.level}/4）`,
    档位说明: rhetoric.description,
    修辞要求: rhetoric.instruction,
    内容边界: project.settings.contentLimits,
    单章目标字数: project.settings.chapterTargetWords ?? 2_000,
    叙述展开程度: project.settings.writingDetail ?? '标准',
    生成方式: project.settings.writingGenerationMode ?? '协作生成',
    输出语言: project.settings.language
  }, 100, '最高', '每次创作都必须遵守；修辞强度只影响 AI 新正文和改稿候选，不会改写已有正文。')
  const activeDirection = (project.directionCards ?? []).find((card) => card.id === project.activeDirectionCardId && card.status === '已采用')
  if (activeDirection) add(components, 'story-direction', '故事方向', activeDirection.title, compactStoryDirection(activeDirection), 105, '最高', '作者已采用的完整故事方向卡；按字段确认状态保持题材、主角目标、冲突、代价、悬念和阅读体验一致。')
  const styleProfile = project.settings.styleProfileSnapshot
  if (styleProfile && includeWritingStyle) add(components, 'style-profile', '文风范本', styleProfile.name, {
    文风说明: styleProfile.description, 写作特征: styleProfile.traits,
    建议遵守: styleProfile.guidelines, 需要避免: styleProfile.avoidPatterns
  }, 101, '最高', '作者为本项目选择的抽象文风范本；仅借鉴一般技法，不包含或复刻来源作品原句。')
  const confirmedConstraints = (project.worldConstraints ?? []).filter((item) => item.status === '已确认' || item.status === '已锁定')
  if (confirmedConstraints.length) {
    add(components, 'world-constraints', '必须遵守的设定事实', `${confirmedConstraints.length} 条已确认术语边界`, confirmedConstraints, 110, '最高', '作者已经确认；完整纳入且不得被普通世界摘要覆盖。')
  }
  if (project.worldBible) {
    add(components, 'world-core', '世界观', '世界摘要、规则与历史', { summary: project.worldBible.summary, premise: project.worldBible.premise, themes: project.worldBible.themes, rules: project.worldBible.rules, geography: project.worldBible.geography, historySummary: project.worldBible.historySummary }, 100, project.worldBible.status === '定稿' ? '最高' : '未确认', project.worldBible.status === '定稿' ? '用户已经定稿。' : '世界观仍为草稿，生成结果需要复核。')
    const entries = project.worldBible.entries.filter((entry) => entry.aiVisibility !== '永不发送' && entry.aiVisibility !== '仅审校' && (entry.locked || characterIds.has(entry.id) || entry.aiVisibility === '始终可见' || retrievedIds.has(entry.id)))
    if (entries.length) add(components, 'world-entries', '世界词条', `${entries.length} 个相关词条`, entries, 98, '正式', '按章纲角色、别名和全文检索召回。')
  }
  if (project.outline) add(components, 'outline', '小说大纲', '总纲与当前卷章规划', { synopsis: project.outline.synopsis, mainConflict: project.outline.mainConflict, endingDirection: project.outline.endingDirection, current: outlineCard }, 97, project.outline.status === '定稿' ? '最高' : '未确认', project.outline.status === '定稿' ? '用户已经定稿。' : '大纲仍为草稿，生成结果需要复核。')
  const storylines = (project.storylines ?? []).filter((line) => line.status !== '已放弃' && (!chapter || line.chapterPlans.some((plan) => plan.chapterNumber >= chapter.chapterNumber - 2 && plan.chapterNumber <= chapter.chapterNumber + 12) || (line.startChapterNumber ?? Number.POSITIVE_INFINITY) <= chapter.chapterNumber && (line.expectedEndChapterNumber ?? Number.NEGATIVE_INFINITY) >= chapter.chapterNumber)).map((line) => ({
    id: line.id, title: line.title, type: line.type, status: line.status, finalGoal: line.finalGoal, endCondition: line.endCondition,
    currentProgress: line.currentProgress, nextAction: line.nextAction, unresolvedQuestions: line.unresolvedQuestions,
    keyNodes: line.keyNodes.filter((node) => node.status !== '已完成').slice(0, 8), chapterPlans: chapter ? line.chapterPlans.filter((plan) => plan.chapterNumber >= chapter.chapterNumber - 2 && plan.chapterNumber <= chapter.chapterNumber + 12).slice(0, 20) : line.chapterPlans.slice(0, 20), pause: line.pause
  }))
  if (storylines.length) add(components, 'storylines', '重要事件线', `${storylines.length} 条当前相关事件线`, storylines, 96, '正式', '跨章节事件线只注入当前窗口相关计划、未完成节点和暂停返回条件；不会把远期正文当成当前事实。')

  if (chapter) {
    const recent = project.chapters.filter((item) => item.chapterNumber < chapter.chapterNumber && item.chapterNumber >= chapter.chapterNumber - 2)
    if (recent.length) add(components, 'recent', '近期原文', '最近两章完整正文', recent.map((item) => ({ chapterNumber: item.chapterNumber, title: item.title, text: chapterText(item) })), 92, '正式', '保留最近两章全文以维持直接衔接。', recent.flatMap((item) => [{ chapterId: item.id, blockId: item.blocks[0]?.id, excerpt: chapterText(item).slice(0, 240) }]))
    const relevantMemories = project.memories.filter((memory) => memory.status === '正式' && memory.chapterNumber < chapter.chapterNumber && (memory.chapterNumber >= chapter.chapterNumber - 8 || retrievedIds.has(memory.chapterId)))
    // 客观状态与角色认知必须分开召回：角色认知只允许进入本章指定出场人物
    // 的视角上下文，避免把作者知道的秘密提前泄露给其他角色。
    const characterStates = resolveCharacterStates(project.memories, chapter.chapterNumber, { perspective: '客观事实' })
    const characterKnowledge = resolveCharacterKnowledge(project.memories, chapter.chapterNumber, [...characterIds])
    const facts = resolveStoryFacts(project.memories, chapter.chapterNumber, { perspective: '客观事实' })
    const knownFacts = resolveStoryFacts(project.memories, chapter.chapterNumber, { perspective: '角色认知', characterIds: [...characterIds] })
    if (characterStates.length) add(components, 'character-states', '角色当前状态', `${characterStates.length} 名角色在本章生效的状态`, characterStates, 99, '正式', '只采用本章已经生效的最新状态；后续章节变化不会提前出现。', characterStates.map((item) => item.source))
    if (characterKnowledge.length || knownFacts.length) add(components, 'character-knowledge', '角色已知信息', `${characterKnowledge.length + knownFacts.length} 条本章角色已经知道的内容`, { characterStates: characterKnowledge, facts: knownFacts }, 97, '正式', '只纳入章纲出场角色明确知道或相信的内容；客观事实不会自动变成角色认知。', [...characterKnowledge, ...knownFacts].flatMap((item) => [...(item.knowledgeEvidence ?? []), item.source]))
    if (facts.length) add(components, 'story-facts', '当前剧情事实', `${facts.length} 条在本章生效的事实`, facts, 98, '正式', '按适用章节和替换关系筛选，已被后续事实替换的内容不会并存。', facts.flatMap((item) => [...(item.knowledgeEvidence ?? []), item.source]))
    if (relevantMemories.length) add(components, 'memories', '长篇记忆', `${relevantMemories.length} 章正式记忆`, relevantMemories.map((memory) => compactMemory(memory, chapter.chapterNumber, false)), 96, '正式', '按近期范围和全文检索召回章节摘要；角色状态与事实由适用章节规则单独筛选。', relevantMemories.map((memory) => ({ chapterId: memory.chapterId, excerpt: memory.summary || memory.keyEvents.slice(0, 2).join('；') })))
    const threads = project.plotThreads.filter((thread) => thread.status !== '已放弃' && (thread.status !== '已回收' || thread.resolutionChapterId === chapter.id) && (!thread.targetPayoffChapter || thread.targetPayoffChapter <= chapter.chapterNumber + 10 || outlineCard?.setupThreadIds.includes(thread.id) || outlineCard?.payoffThreadIds.includes(thread.id))).map((thread) => ({
      ...thread,
      progress: thread.progress.filter((item) => (chapterNumberById.get(item.chapterId) ?? Number.POSITIVE_INFINITY) <= chapter.chapterNumber),
      resolutionChapterId: thread.resolutionChapterId && (chapterNumberById.get(thread.resolutionChapterId) ?? Number.POSITIVE_INFINITY) <= chapter.chapterNumber ? thread.resolutionChapterId : undefined,
      resolutionMethod: thread.resolutionChapterId && (chapterNumberById.get(thread.resolutionChapterId) ?? Number.POSITIVE_INFINITY) <= chapter.chapterNumber ? thread.resolutionMethod : '',
      resolutionEvidence: thread.resolutionEvidence && (chapterNumberById.get(thread.resolutionEvidence.chapterId) ?? Number.POSITIVE_INFINITY) <= chapter.chapterNumber ? thread.resolutionEvidence : undefined
    }))
    if (threads.length) add(components, 'threads', '伏笔台账', `${threads.length} 条相关伏笔`, threads, 95, '正式', '包含即将回收、当前章计划处理和仍未解决的伏笔。', threads.flatMap((thread) => [thread.setupEvidence, thread.resolutionEvidence, ...thread.progress.map((item) => item.source)].filter((source): source is NonNullable<typeof source> => Boolean(source))))
    const mentions = [...characterIds].flatMap((entryId) => database.listMentions(project.id, entryId)).filter((mention) => mention.chapterNumber < chapter.chapterNumber).slice(-24)
    if (mentions.length) add(components, 'entity-mentions', '实体出现记录', `${mentions.length} 条相关人物或词条旧文证据`, mentions.map((mention) => ({ entry: mention.entryName, chapterNumber: mention.chapterNumber, excerpt: mention.excerpt })), 82, '参考', '由词条名称和作者维护的别名精确索引，可用于找回远期出场证据。', mentions.map((mention) => ({ chapterId: mention.chapterId, blockId: mention.blockId, excerpt: mention.excerpt })))
  }
  if (safeRetrieved.length) add(components, 'retrieved', '远期召回', `${safeRetrieved.length} 条相关旧资料`, safeRetrieved.map((item) => ({ title: item.title, body: item.body.slice(0, 2_000), sourceType: item.sourceType })), 75, '参考', '由实体别名和 SQLite 全文检索找到；结构化记忆另行按适用章节筛选。', safeRetrieved.flatMap((item) => {
    const chapterNumber = item.sourceType === 'chapter' ? Number(item.title.match(/第(\d+)章/)?.[1]) : undefined
    const sourceChapter = chapterNumber ? project.chapters.find((chapter) => chapter.chapterNumber === chapterNumber) : undefined
    return sourceChapter ? [{ chapterId: sourceChapter.id, excerpt: item.body.slice(0, 240) }] : []
  }))

  const payload: Array<{ title: string; content: unknown }> = []
  const entries: NovelContextEntry[] = []
  let used = 0
  // 锁定事实按完整内容纳入，不能像普通参考资料一样静默裁剪。先记下
  // 它们的真实占用，供估算界面和发送前的 Provider 预算门禁解释原因。
  const lockedTokens = components
    .filter((component) => component.entry.authority === '最高' && component.entry.id === 'world-constraints')
    .reduce((total, component) => total + roughTokenEstimate(JSON.stringify(component.value)), 0)
  for (const component of components.sort((a, b) => b.entry.priority - a.entry.priority)) {
    const serialized = JSON.stringify(component.value)
    const tokens = roughTokenEstimate(serialized)
    if (component.entry.id === 'world-constraints' || used + tokens <= tokenBudget) {
      entries.push({ ...component.entry, estimatedTokens: tokens })
      payload.push({ title: component.entry.id === 'style-profile' ? '当前项目文风画像' : component.entry.title, content: component.value })
      used += tokens
    } else if (component.entry.priority >= 95 && tokenBudget - used > 200) {
      const remainingChars = Math.floor((tokenBudget - used) / 0.65)
      const trimmed = serialized.slice(0, Math.max(300, remainingChars))
      const trimmedTokens = roughTokenEstimate(trimmed)
      entries.push({ ...component.entry, estimatedTokens: trimmedTokens, trimmed: true, reason: `${component.entry.reason} 内容过长，已裁剪。` })
      payload.push({ title: component.entry.id === 'style-profile' ? '当前项目文风画像' : component.entry.title, content: `${trimmed}【已裁剪】` })
      used += trimmedTokens
    } else entries.push({ ...component.entry, included: false, estimatedTokens: tokens, reason: '上下文容量不足，按优先级排除。' })
  }
  const estimatedOutputTokens = chapterId ? 4_000 : 8_000
  const warnings = planningWarnings(project)
  if (lockedTokens > tokenBudget) {
    warnings.push(`已锁定的核心设定约占 ${lockedTokens.toLocaleString()} Token，超过本次上下文预算 ${tokenBudget.toLocaleString()} Token；发送前将阻止请求，不会静默裁剪。`)
  }
  if (used + estimatedOutputTokens + 1_024 > tokenBudget) {
    warnings.push(`输入与预留输出合计约 ${ (used + estimatedOutputTokens).toLocaleString()} Token，已接近本次上下文预算；建议缩小范围或分段生成。`)
  }
  const layers = MEMORY_LAYERS.map(({ layer, title, summary }) => {
    const layerEntries = entries.filter((entry) => entry.layer === layer)
    return {
      layer, title, summary, entries: layerEntries,
      includedCount: layerEntries.filter((entry) => entry.included).length,
      excludedCount: layerEntries.filter((entry) => !entry.included).length,
      estimatedTokens: layerEntries.filter((entry) => entry.included).reduce((total, entry) => total + entry.estimatedTokens, 0)
    }
  })
  return { json: JSON.stringify(payload), estimatedInputTokens: used, estimatedOutputTokens, contextWindow: tokenBudget, warnings, entries, layers }
}

export function planningWarnings(project: NovelProject): string[] {
  const warnings: string[] = []
  const pendingConstraints = (project.worldConstraints ?? []).filter((item) => item.status === '待确认').length
  if (pendingConstraints) warnings.push(`还有 ${pendingConstraints} 条 AI 提取的术语边界等待确认。`)
  else if (!(project.worldConstraints ?? []).some((item) => item.status === '已确认' || item.status === '已锁定')) warnings.push('尚未确认核心术语边界，AI 可能对未说明的设定自行推断。')
  if (!project.worldBible) warnings.push('尚未建立世界观。')
  else if (project.worldBible.status !== '定稿') warnings.push('世界观仍为草稿。')
  if (!project.outline) warnings.push('尚未建立小说大纲。')
  else if (project.outline.status !== '定稿') warnings.push('小说大纲仍为草稿。')
  return warnings
}

const STORY_DIRECTION_CONTEXT_FIELDS: Array<{ key: StoryDirectionFieldKey; label: string }> = [
  { key: 'genreDirection', label: '题材方向' },
  { key: 'logline', label: '一句话故事' },
  { key: 'protagonistIdentity', label: '主角身份' },
  { key: 'protagonistSituation', label: '主角处境' },
  { key: 'protagonistGoal', label: '主角目标' },
  { key: 'mainObstacle', label: '主要阻力' },
  { key: 'specialPremise', label: '特殊设定' },
  { key: 'cost', label: '行动代价' },
  { key: 'failureConsequence', label: '失败后果' },
  { key: 'centralMystery', label: '最大悬念' },
  { key: 'readingExperience', label: '阅读体验' },
  { key: 'openingSituation', label: '开篇起点' }
]

/**
 * 只把作者能看懂的业务字段发送给模型。旧版精简卡继续通过兼容字段提供
 * 一句话故事、主角信息、主要阻力和阅读体验，不要求作者先迁移旧项目。
 */
function compactStoryDirection(card: StoryDirectionCard): Record<string, unknown> {
  const legacyFallbacks: Partial<Record<StoryDirectionFieldKey, string>> = {
    logline: card.premise,
    protagonistIdentity: card.protagonistHook,
    mainObstacle: card.coreConflict,
    readingExperience: card.emotionalPromise,
    openingSituation: card.openingSituation
  }
  const values: Record<string, string> = {}
  const statuses: Record<string, string> = {}
  for (const field of STORY_DIRECTION_CONTEXT_FIELDS) {
    const value = card[field.key]?.trim() || legacyFallbacks[field.key]?.trim() || ''
    values[field.label] = value
    statuses[field.label] = card.fieldStatuses?.[field.key] ?? (value ? '暂时采用' : '尚未确定')
  }
  return {
    方向名称: card.title,
    ...values,
    尚未确定事项: card.unresolvedQuestions,
    内容确认状态: statuses
  }
}

function add(components: Component[], id: string, category: string, title: string, value: unknown, priority: number, authority: NovelContextEntry['authority'], reason: string, sourceRefs: NovelContextEntry['sourceRefs'] = []): void {
  components.push({ entry: { id, category, title, included: true, reason, authority, estimatedTokens: 0, priority, trimmed: false, layer: LAYER_BY_ID[id] ?? '稳定事实', sourceRefs: sourceRefs.length ? sourceRefs : undefined }, value })
}

export function roughTokenEstimate(value: string): number {
  const chinese = (value.match(/[\u3400-\u9fff]/g) ?? []).length
  return Math.max(1, Math.ceil(chinese * 0.65 + (value.length - chinese) / 4))
}
