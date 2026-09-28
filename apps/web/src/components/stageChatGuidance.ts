import type { CreativeChatMode, CreativeChatStage, NovelMemoryHealth, NovelProject } from '../../../../packages/contracts/src'

export interface StageChatIssue {
  title: string
  detail: string
  prompt: string
  severity: '高' | '中' | '提示'
  source?: string
  certainty?: '本地可确认' | '状态提醒'
}

export interface StageChatReadiness {
  label: string
  detail: string
  complete: boolean
}

export interface StageChatGuidance {
  steps: string[]
  dimensions: string[]
  issues: StageChatIssue[]
  readiness: StageChatReadiness[]
}

export interface StageChatSignals {
  pendingRevisionCount?: number
  pendingMemoryProposalCount?: number
  recoverableJobCount?: number
}

export const ASSISTANT_DISPLAY_SECTIONS = ['小说大纲', '世界观', '正文创作', '记忆 / 伏笔', '审稿 / 导出'] as const

export type AssistantDisplaySection = typeof ASSISTANT_DISPLAY_SECTIONS[number] | '项目工具'

export interface StageChatQuickAction {
  label: string
  prompt: string
}

export interface StageChatAssistantProfile {
  displaySection: AssistantDisplaySection
  name: string
  welcome: string
  contextSources: readonly string[]
  quickActions: readonly StageChatQuickAction[]
  resultPresentation: string
  proposalTypes: readonly string[]
}

interface StageChatAssistantBlueprint extends Omit<StageChatAssistantProfile, 'welcome'> {
  welcome: (projectTitle: string) => string
}

const DISPLAY_SECTION_BY_STAGE: Record<CreativeChatStage, Exclude<AssistantDisplaySection, '项目工具'>> = {
  idea: '小说大纲',
  outline: '小说大纲',
  world: '世界观',
  writing: '正文创作',
  memory: '记忆 / 伏笔',
  delivery: '审稿 / 导出'
}

const ASSISTANT_BLUEPRINTS: Record<Exclude<AssistantDisplaySection, '项目工具'>, StageChatAssistantBlueprint> = {
  '小说大纲': {
    displaySection: '小说大纲',
    name: '大纲架构师',
    welcome: (_title) => '从人物欲望、意外变故或无法回避的选择开始，把故事骨架理清。',
    contextSources: ['故事种子、方向卡与创作规格', '已确认的世界观与角色资料', '总纲、卷纲、章卡与伏笔计划'],
    quickActions: [
      { label: '梳理故事核心', prompt: '请基于当前故事种子，梳理主角欲望、核心冲突和必须付出的代价。' },
      { label: '比较结构方向', prompt: '请给出三种可比较的长篇结构方向，并说明各自的主要风险。' },
      { label: '检查章节因果', prompt: '请检查当前章卡的目标、冲突和转折是否形成清晰因果链。' }
    ],
    resultPresentation: '以结构卡和并列方向展示；选定后只进入大纲候选区。',
    proposalTypes: ['故事方向候选', '大纲结构候选', '剧情步骤候选']
  },
  '世界观': {
    displaySection: '世界观',
    name: '世界观构建助手',
    welcome: (_title) => '从规则、资源和代价入手，逐步搭出可信的世界。',
    contextSources: ['已确认的术语边界与锁定规则', '角色、势力、地点和体系词条', '世界时间线与审校证据'],
    quickActions: [
      { label: '推演规则影响', prompt: '请从日常生活、制度和资源角度，推演当前世界规则的连锁影响。' },
      { label: '核对设定边界', prompt: '请核对当前术语和规则是否互相矛盾，并标明判断依据。' },
      { label: '规划局部补全', prompt: '请列出补全当前世界观模块前必须确认的事项。' }
    ],
    resultPresentation: '以设定卡、关系影响和证据对照展示；修改仅形成世界观候选。',
    proposalTypes: ['世界设定候选', '世界词条候选', '审校修复提案']
  },
  '正文创作': {
    displaySection: '正文创作',
    name: '写作陪伴助手',
    welcome: (_title) => '围绕当前场景，陪你续写、改写并守住人物当时所知。',
    contextSources: ['当前章节正文与选中范围', '本章章卡与已确认剧情步骤', '前文记忆与人物当前认知'],
    quickActions: [
      { label: '续写下一段', prompt: '请先总结当前场景的目标和阻力，再给出下一段的续写候选。' },
      { label: '增强场景张力', prompt: '请分析当前场景为什么缺少张力，并给出最小改写方向。' },
      { label: '检查人物反应', prompt: '请根据人物性格和当前已知信息，检查人物反应是否成立。' }
    ],
    resultPresentation: '以原文对照和可选文本片段展示；续写与改稿仍需人工采用。',
    proposalTypes: ['场景步骤候选', '正文续写候选', '局部改写候选']
  },
  '记忆 / 伏笔': {
    displaySection: '记忆 / 伏笔',
    name: '连贯性助手',
    welcome: (_title) => '沿着正文证据核对事实、认知差和伏笔回收。',
    contextSources: ['正式章节记忆与生效区间', '原文证据池与角色认知差', '伏笔埋设、推进与回收台账'],
    quickActions: [
      { label: '核对人物所知', prompt: '请按章节时间点核对主要人物知道什么，并标出证据。' },
      { label: '检查记忆缺口', prompt: '请找出有正文但缺少正式摘要或原文依据的章节。' },
      { label: '评估伏笔回收', prompt: '请按证据完整度和认知差，评估当前伏笔的回收准备度。' }
    ],
    resultPresentation: '以事实—证据—生效章节链路展示；提取结果先进入记忆提案。',
    proposalTypes: ['章节记忆提案', '伏笔推进提案', '连续性审查提案']
  },
  '审稿 / 导出': {
    displaySection: '审稿 / 导出',
    name: '审稿与出版助手',
    welcome: (_title) => '按问题优先级检查全书，准备清晰、可核对的交付结果。',
    contextSources: ['全书正文与章节定位证据', '正式记忆、伏笔与规划状态', '审稿问题、修订候选与导出要求'],
    quickActions: [
      { label: '排定审稿顺序', prompt: '请按影响范围和修复成本，排出当前审稿问题的处理顺序。' },
      { label: '检查全书连贯', prompt: '请检查全书的人物状态、世界规则和时间线连贯性，并标出证据。' },
      { label: '准备导出检查', prompt: '请列出导出成稿前必须完成的检查项和尚未满足的条件。' }
    ],
    resultPresentation: '以问题级别、原文定位和最小修改范围展示；导出前不自动改写正文。',
    proposalTypes: ['审稿报告候选', '连续性修订候选', '出版检查提案']
  }
}

export function getStageChatAssistantProfile(stage: CreativeChatStage, projectTitle: string): StageChatAssistantProfile {
  const blueprint = ASSISTANT_BLUEPRINTS[DISPLAY_SECTION_BY_STAGE[stage]]
  return { ...blueprint, welcome: blueprint.welcome(projectTitle) }
}

export function getProjectToolsAssistantProfile(_projectTitle: string): StageChatAssistantProfile {
  return {
    displaySection: '项目工具',
    name: '项目工具助手',
    welcome: '处理任务、技能、文风和版本工具，结果由你确认。',
    contextSources: ['当前工具页面与真实操作状态', '项目配置、任务和技能信息', '版本快照与可恢复范围'],
    quickActions: [
      { label: '解释当前工具', prompt: '请根据当前页面的真实状态，说明我现在能做什么。' },
      { label: '检查操作前提', prompt: '请列出当前操作还缺哪些前提，只依据页面展示的数据。' },
      { label: '整理下一步', prompt: '请按当前工具的真实状态，给出下一步操作建议。' }
    ],
    resultPresentation: '只说明当前工具的状态、前提和操作建议，不直接改变项目内容。',
    proposalTypes: ['工具操作建议', '项目级任务提案']
  }
}

const MODE_STEPS: Record<CreativeChatMode, string[]> = {
  灵感讨论: ['先从下方选择一个探索方向，或直接描述你脑中的画面。', '让 AI 提供多个可比较的方向，不满意时继续追问或改变约束。', '确认想法后切换到“生成准备”，再请求局部候选。'],
  问题分析: ['先查看“当前发现的问题”，了解墨境根据现有资料能确认的风险。', '点击某个问题的“询问 AI”，让助手结合证据解释原因和改法。', '也可以直接输入自己的疑问；分析不会自动修改正式内容。'],
  生成准备: ['先检查下方准备清单，明确生成目标和不能改变的事实。', '选择一个预设问题，或补充范围、风格和保护要求。', '发送后 AI 只会准备待确认候选，应用前仍需你确认。'],
  // StageChatDock 固定以「综合协作」调用本函数（助手自行判断该走哪个环节），
  // 而 Record<CreativeChatMode, …> 此前漏了这一键，使 guidance.steps 为 undefined，
  // 切到「引导型对话」时读 .length 直接抛错。补齐后三个键位与其余模式同构。
  综合协作: ['先直接描述你要处理的事情，不必预先判断它属于哪个环节。', '助手会自行判断该讨论想法、分析问题还是准备生成，并在回复里说明依据。', '需要收窄范围时，再按下方清单切换到具体的准备或推进目标。']
}

const DIMENSIONS: Record<CreativeChatStage, string[]> = {
  idea: ['主角欲望与代价', '核心冲突与独特限制', '读者期待与题材气质'],
  world: ['规则如何影响普通人的生活', '力量、制度与资源的相互制约', '地域、历史和文化的差异'],
  outline: ['每卷的目标、转折和结果', '角色选择如何推动因果链', '伏笔埋设、推进与回收节奏'],
  writing: ['人物在当前信息下会怎样反应', '场景目标、阻力与情绪变化', '对白、动作和感官细节'],
  memory: ['客观事实与角色认知的差异', '伏笔回收的证据和准备度', '时间生效与前后章节影响'],
  delivery: ['读者体验与主题呼应', '连续性、人物弧光和中文质量', '问题优先级与最小修改范围']
}

export function buildStageChatGuidance(project: NovelProject, stage: CreativeChatStage, mode: CreativeChatMode, selectedChapterId?: string, memoryHealth?: NovelMemoryHealth, signals: StageChatSignals = {}): StageChatGuidance {
  const issues: StageChatIssue[] = []
  const readiness: StageChatReadiness[] = []
  const chaptersWithText = project.chapters.filter((chapter) => chapter.blocks.some((block) => block.text.trim()))
  const pendingQuality = project.worldQualityFindings.filter((finding) => finding.status === '待处理')
  const unresolvedThreads = project.plotThreads.filter((thread) => !['已回收', '已放弃'].includes(thread.status))
  const riskyThreads = unresolvedThreads.filter((thread) => thread.status === '逾期' || (['已埋设', '推进中'].includes(thread.status) && (!thread.targetPayoffChapter || !thread.setupEvidence)))
  const missingMemoryChapterCount = chaptersWithText.filter((chapter) => !project.memories.some((memory) => memory.chapterId === chapter.id && memory.status === '正式' && memory.summary.trim())).length
  const currentChapter = selectedChapterId ? project.chapters.find((chapter) => chapter.id === selectedChapterId) : undefined
  const currentCard = currentChapter ? project.outline?.volumes.flatMap((volume) => volume.chapters).find((card) => card.id === currentChapter.id || card.chapterNumber === currentChapter.chapterNumber) : undefined
  const pendingTerms = project.worldConstraints.filter((item) => item.status === '待确认')

  if (stage === 'idea') {
    readiness.push({ label: '故事种子', detail: '至少写清主角、世界或核心矛盾中的一项。', complete: Boolean(project.seed.trim()) })
    readiness.push({ label: '创作边界', detail: '补充希望避免的内容，减少后续生成漂移。', complete: Boolean(project.settings.contentLimits.trim()) })
    readiness.push({ label: '核心术语', detail: '存在自定义术语时，确认 AI 提取的概念边界；没有特殊术语也可继续。', complete: pendingTerms.length === 0 })
    if (!project.seed.trim()) issues.push({ title: '故事种子还没有内容', detail: '没有稳定的起点时，AI 无法判断题材、主角和冲突范围。', prompt: '请根据我现在的空白，告诉我故事种子至少应该写哪些信息。', severity: '高' })
    if (pendingTerms.length) issues.push({ title: `有 ${pendingTerms.length} 个核心术语等待确认`, detail: `${pendingTerms.slice(0, 3).map((item) => `“${item.term}”`).join('、')}仍是 AI 提取结果，确认前不会成为正式设定。`, prompt: '请逐项解释待确认核心术语是什么、不是什么，以及我需要决定哪些事项。', severity: '中', source: '核心术语边界', certainty: '本地可确认' })
    const unresolved = project.worldConstraints.filter((item) => ['已确认', '已锁定'].includes(item.status) && item.unresolvedQuestions.length)
    if (unresolved.length) issues.push({ title: `有 ${unresolved.length} 个术语仍有未决定事项`, detail: unresolved.slice(0, 3).map((item) => `“${item.term}”还有 ${item.unresolvedQuestions.length} 项`).join('；'), prompt: '请围绕尚未决定的术语事项给出互不混淆的可选方向，并说明影响。', severity: '提示', source: '作者确认的术语卡', certainty: '本地可确认' })
  }

  if (stage === 'world') {
    readiness.push({ label: '世界观主体', detail: '建立世界基础、规则和时间线。', complete: Boolean(project.worldBible) })
    readiness.push({ label: '术语边界', detail: '存在自定义概念时，处理待确认术语。', complete: pendingTerms.length === 0 })
    readiness.push({ label: '高风险问题', detail: '处理锁定事实冲突后再应用候选。', complete: pendingQuality.filter((finding) => finding.severity === '高').length === 0 })
    if (!project.worldBible) issues.push({ title: '世界观还没有建立', detail: '正文和大纲生成前需要先确定世界基础。', prompt: '请告诉我建立这个故事世界观时最先需要决定的五件事。', severity: '高' })
    else {
      if (!project.worldBible.rules.length) issues.push({ title: '世界规则为空', detail: '没有不可违反的规则，长篇容易出现能力和因果漂移。', prompt: '请根据当前故事种子建议三条不可违反的世界规则。', severity: '中' })
      if (!project.worldBible.entries.length) issues.push({ title: '世界词条还没有内容', detail: '人物、势力和地点缺少可召回的结构化资料。', prompt: '请建议我优先建立哪些世界词条，并说明原因。', severity: '提示' })
      const entryIds = new Set(project.worldBible.entries.map((entry) => entry.id))
      const brokenRelations = project.worldBible.entries.flatMap((entry) => entry.relations.filter((relation) => !entryIds.has(relation.targetEntryId)).map(() => entry.name))
      if (brokenRelations.length) issues.push({ title: `有 ${brokenRelations.length} 条实体关系找不到对应词条`, detail: `${[...new Set(brokenRelations)].slice(0, 3).join('、')}的关联对象可能已经删除或尚未建立。`, prompt: '请根据现有中文词条，建议失效关系应该如何重新连接。', severity: '中', source: '世界词条关系', certainty: '本地可确认' })
    }
    pendingQuality.slice(0, 4).forEach((finding) => issues.push({ title: `“${finding.evidence.excerpt.slice(0, 36)}”需要核对`, detail: finding.explanation, prompt: `请解释“${finding.evidence.excerpt.slice(0, 80)}”为什么可能有问题，并给出不新增设定的最小修改方向。`, severity: finding.severity === '低' ? '提示' : finding.severity, source: '世界观审校', certainty: '本地可确认' }))
    if (signals.pendingRevisionCount) issues.push({ title: `有 ${signals.pendingRevisionCount} 个世界观候选等待确认`, detail: '候选尚未进入正式世界观，继续生成前建议先处理。', prompt: '请比较待确认世界观候选与正式设定可能产生的影响。', severity: '提示', source: '世界观候选', certainty: '本地可确认' })
  }

  if (stage === 'outline') {
    readiness.push({ label: '世界观定稿', detail: '大纲应建立在稳定的世界规则之上。', complete: project.worldBible?.status === '定稿' })
    readiness.push({ label: '总纲与卷纲', detail: '先确定主冲突、结局方向和卷级目标。', complete: Boolean(project.outline) })
    readiness.push({ label: '目标章剧情步骤', detail: currentCard ? `为第 ${currentCard.chapterNumber} 章确认具体剧情步骤。` : '选择目标章节后确认具体剧情步骤。', complete: Boolean(currentCard?.beats.length && currentCard.beatStatus === '已确认') })
    if (!project.outline) issues.push({ title: '小说大纲还没有建立', detail: '没有总纲和卷章结构时，长篇生成缺少方向约束。', prompt: '请根据当前世界观，告诉我大纲最先应该确定哪些内容。', severity: '高' })
    else {
      const cards = project.outline.volumes.flatMap((volume) => volume.chapters)
      const foundationFields: Array<[string, string]> = [
        ['总纲', project.outline.synopsis],
        ['主冲突', project.outline.mainConflict],
        ['结局方向', project.outline.endingDirection]
      ]
      const foundationMissing = foundationFields.filter(([, value]) => !value.trim()).map(([label]) => label)
      if (foundationMissing.length) issues.push({ title: `大纲基础缺少${foundationMissing.join('、')}`, detail: '这些字段用于约束每卷和每章的方向。', prompt: `请根据现有资料，帮助我补齐大纲的${foundationMissing.join('、')}。`, severity: '中', source: '大纲基础', certainty: '本地可确认' })
      if (currentCard) {
        const cardFields: Array<[string, string]> = [
          ['目标', currentCard.objective],
          ['冲突', currentCard.conflict],
          ['转折', currentCard.turningPoint]
        ]
        const cardMissing = cardFields.filter(([, value]) => !value.trim()).map(([label]) => label)
        if (cardMissing.length) issues.push({ title: `第 ${currentCard.chapterNumber} 章章纲缺少${cardMissing.join('、')}`, detail: '目标章卡的关键字段不完整，生成正文时容易失去因果方向。', prompt: `请根据总纲，为第 ${currentCard.chapterNumber} 章补充${cardMissing.join('、')}的可选方向。`, severity: '中', source: `第 ${currentCard.chapterNumber} 章章纲`, certainty: '本地可确认' })
      }
      if (currentCard && (!currentCard.beats.length || currentCard.beatStatus !== '已确认')) issues.push({ title: `第 ${currentCard.chapterNumber} 章还没有确认剧情步骤`, detail: '当前选中章节不能稳定地按步骤生成整章。', prompt: `请告诉我第 ${currentCard.chapterNumber} 章的剧情步骤应该先确认什么。`, severity: '中', source: `第 ${currentCard.chapterNumber} 章章纲`, certainty: '本地可确认' })
      const beatFindings = currentCard?.beatFindings.filter((finding) => finding.status === '待处理') ?? []
      if (beatFindings.length) issues.push({ title: `当前章有 ${beatFindings.length} 条剧情步骤建议待处理`, detail: '这些建议尚未接受或忽略，可能影响正文生成。', prompt: '请解释当前章待处理的剧情步骤建议，并给出处理顺序。', severity: '提示', source: `第 ${currentCard?.chapterNumber} 章剧情步骤`, certainty: '本地可确认' })
      if (cards.some((chapter) => chapter.downstreamReviewStatus === '待复核')) issues.push({ title: '部分章纲标记为待复核', detail: '上游规划变化后，相关正文和章卡需要重新核对。', prompt: '请解释规划变化可能影响哪些章节，以及我应如何复核。', severity: '提示' })
    }
    if (signals.pendingRevisionCount) issues.push({ title: `有 ${signals.pendingRevisionCount} 个大纲候选等待确认`, detail: '候选尚未写入正式大纲，继续展开前建议先比较。', prompt: '请告诉我如何比较待确认大纲候选与当前正式大纲。', severity: '提示', source: '大纲候选', certainty: '本地可确认' })
  }

  if (stage === 'writing') {
    readiness.push({ label: '目标章节', detail: '选择一个卷章，AI 才能知道要讨论哪一章。', complete: Boolean(currentChapter) })
    readiness.push({ label: '剧情步骤', detail: '确认本章步骤后再请求整章生成。', complete: Boolean(currentCard?.beats.length && currentCard.beatStatus === '已确认') })
    const priorChapters = currentChapter ? chaptersWithText.filter((chapter) => chapter.chapterNumber < currentChapter.chapterNumber) : []
    const priorMemoryGaps = priorChapters.filter((chapter) => !project.memories.some((memory) => memory.chapterId === chapter.id && memory.status === '正式' && memory.summary.trim()))
    readiness.push({ label: '前文记忆', detail: '当前章之前已有正文的章节应有可用正式记忆。', complete: priorMemoryGaps.length === 0 })
    if (!currentChapter) issues.push({ title: '还没有选择目标章节', detail: '请先在正文创作左侧目录中选择章节。', prompt: '请告诉我在开始创作一章正文前，需要先准备哪些资料。', severity: '高' })
    else {
      if (!currentCard) issues.push({ title: '当前章节没有对应章纲', detail: '正文可能缺少目标、冲突和结尾钩子约束。', prompt: '请根据当前章节信息，建议一张最小可用的章纲卡片。', severity: '中' })
      else if (!currentCard.beats.length || currentCard.beatStatus !== '已确认') issues.push({ title: '当前章剧情步骤尚未确认', detail: '整章 AI 生成需要先确认每一步对应的场景安排。', prompt: '请帮我把当前章拆成可确认的剧情步骤。', severity: '中' })
      if (currentCard?.beatFindings.some((finding) => finding.status === '待处理')) issues.push({ title: '当前章还有剧情步骤建议待处理', detail: '确认或忽略后再生成正文，可以减少步骤冲突。', prompt: '请逐条解释当前章待处理的剧情步骤建议，并给出最小调整方案。', severity: '提示', source: `第 ${currentChapter.chapterNumber} 章剧情步骤`, certainty: '本地可确认' })
      if (currentCard?.downstreamReviewStatus === '待复核') issues.push({ title: `第 ${currentChapter.chapterNumber} 章需要复核`, detail: currentCard.downstreamReviewReason || '上游规划已经变化，当前章安排可能不再匹配。', prompt: `请对照当前总纲，说明第 ${currentChapter.chapterNumber} 章哪些内容需要重新确认。`, severity: '中', source: `第 ${currentChapter.chapterNumber} 章章纲`, certainty: '本地可确认' })
      if (priorMemoryGaps.length) issues.push({ title: `当前章之前有 ${priorMemoryGaps.length} 章缺少可用正式记忆`, detail: `${priorMemoryGaps.slice(0, 4).map((chapter) => `第 ${chapter.chapterNumber} 章`).join('、')}可能无法为当前章提供可靠连续性依据。`, prompt: '请说明前文记忆缺口可能影响当前章哪些人物状态和剧情事实。', severity: '中', source: '前文章节记忆', certainty: '本地可确认' })
    }
    if (project.worldBible?.status !== '定稿' || project.outline?.status !== '定稿') issues.push({ title: '世界观或大纲尚未定稿', detail: '继续写作会保留规划风险，后续可能需要复核。', prompt: '请说明当前规划未定稿会给本章创作带来哪些风险。', severity: '提示' })
  }

  if (stage === 'memory') {
    readiness.push({ label: '章节摘要', detail: '有正文的章节应有正式记忆摘要。', complete: memoryHealth ? memoryHealth.missingSummaries === 0 : missingMemoryChapterCount === 0 })
    readiness.push({ label: '提案确认', detail: 'AI 提取的记忆确认后才会进入正式上下文。', complete: memoryHealth ? memoryHealth.pendingProposals === 0 : true })
    readiness.push({ label: '伏笔台账', detail: '为未回收伏笔保留证据和计划。', complete: unresolvedThreads.length === 0 || project.plotThreads.every((thread) => Boolean(thread.targetPayoffChapter)) })
    const pendingMemoryCount = memoryHealth?.pendingProposals ?? signals.pendingMemoryProposalCount ?? 0
    if (pendingMemoryCount) issues.push({ title: `有 ${pendingMemoryCount} 条记忆提案待确认`, detail: '未确认前不会影响后续正式上下文。', prompt: '请按风险说明待确认记忆提案，告诉我哪些需要优先处理。', severity: '中', source: '记忆提案', certainty: '本地可确认' })
    if ((memoryHealth?.missingSummaries ?? missingMemoryChapterCount) > 0) issues.push({ title: '部分有正文的章节缺少正式摘要', detail: '远期章节可能无法被准确召回。', prompt: '请告诉我哪些章节缺少记忆摘要，以及应提取哪些信息。', severity: '中' })
    if (riskyThreads.length) issues.push({ title: `有 ${riskyThreads.length} 条伏笔存在逾期或证据缺口`, detail: '只有逾期、缺少计划回收章或缺少埋设证据的伏笔会列为问题。', prompt: '请按逾期和证据风险排列这些伏笔，并给出下一步。', severity: riskyThreads.some((thread) => thread.status === '逾期') ? '高' : '中', source: '伏笔台账', certainty: '本地可确认' })
  }

  if (stage === 'delivery') {
    readiness.push({ label: '审稿问题', detail: '先处理高风险连续性和设定问题。', complete: project.reviews.filter((review) => review.status === '待处理').length === 0 })
    readiness.push({ label: '伏笔闭环', detail: '确认重要伏笔已回收、放弃或有明确计划。', complete: unresolvedThreads.length === 0 })
    readiness.push({ label: '规划稳定', detail: '世界观和大纲定稿后再进行最终审稿。', complete: project.worldBible?.status === '定稿' && project.outline?.status === '定稿' })
    const pendingReviews = project.reviews.filter((review) => review.status === '待处理')
    pendingReviews.slice(0, 4).forEach((review) => { const chapter = review.chapterId ? project.chapters.find((item) => item.id === review.chapterId) : undefined; const evidence = review.evidence[0]?.excerpt; issues.push({ title: `${review.severity === '高' ? '高风险：' : ''}${review.title}`, detail: `${review.description}${evidence ? `；证据：“${evidence.slice(0, 80)}”` : ''}`, prompt: `请解释“${review.title}”会影响哪些内容，并给出最小修改顺序。`, severity: review.severity === '低' ? '提示' : review.severity, source: chapter ? `第 ${chapter.chapterNumber} 章《${chapter.title}》` : '全书审稿', certainty: '本地可确认' }) })
    if (riskyThreads.length) issues.push({ title: `有 ${riskyThreads.length} 条伏笔存在逾期或证据缺口`, detail: '导出前建议先处理高风险伏笔；普通未回收伏笔只显示在准备清单。', prompt: '请检查这些高风险伏笔是否会影响结尾，并给出处理建议。', severity: riskyThreads.some((thread) => thread.status === '逾期') ? '高' : '中' })
    if ((memoryHealth?.missingSummaries ?? missingMemoryChapterCount) > 0) issues.push({ title: '部分正文尚未完成记忆归档', detail: '连续性审查可能遗漏远期事实和人物状态。', prompt: '请说明最终审稿前为什么需要补齐章节记忆。', severity: '提示' })
    if (signals.recoverableJobCount) issues.push({ title: `有 ${signals.recoverableJobCount} 个失败任务可以恢复`, detail: '可以从保存的检查点继续，不必重新开始。', prompt: '请说明这些可恢复任务会影响最终审稿的哪些环节。', severity: '提示', source: 'AI 任务历史', certainty: '本地可确认' })
  }

  const severityOrder: Record<StageChatIssue['severity'], number> = { 高: 0, 中: 1, 提示: 2 }
  issues.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity])
  return { steps: MODE_STEPS[mode], dimensions: DIMENSIONS[stage], issues, readiness }
}
