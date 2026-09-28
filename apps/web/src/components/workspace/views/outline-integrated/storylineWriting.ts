import type { OutlineWritingDraft } from './outlineIntegrationModel'

/**
 * M5 · 事件线（`project.storylines`）的唯一写入口。
 *
 * 这些是纯函数：只改传入的草稿对象，页面负责把它们包进
 * `updateProject → 900ms 防抖 → persistNow`，与其它模块共用同一条保存通道。
 *
 * 三条写入规则：
 *   1. **暂停必须留原因与返回条件**：状态改成「计划暂停」前，`pause.reason` 与
 *      `pause.returnCondition` 必须都已填写，否则拒绝写入（契约的 superRefine 要求）。
 *   2. **不按章数虚构推进百分比**：`currentProgress` 只作为作者自己写的字段保留，
 *      这里不提供「按已完成章节数自动算比例」的入口。
 *   3. **不为通过校验而编造内容**：事件线标题、关键节点标题都是契约必填，因此创建时
 *      必须由作者给出标题；给不出标题就不创建，绝不填「未命名」之类的占位符。
 */

/* ------------------------------------------------------------------ *
 * 选项常量：与契约枚举逐字一致，由单测对照契约断言，避免两边漂移。
 * ------------------------------------------------------------------ */

export const STORYLINE_STATUS_OPTIONS = [
  '未开始', '推进中', '等待条件', '计划暂停', '长期悬置', '已完成', '已放弃'
] as const

export const PAUSE_SCOPE_OPTIONS = [
  '下一章', '当前批次', '当前剧情阶段', '本卷', '指定后续卷', '等待事件触发', '作者暂未决定'
] as const

export const STORYLINE_RETURN_POSITION_OPTIONS = [
  '下一章开头', '当前批次下一个可用章节', '当前剧情阶段下一节点', '本卷后半段', '指定后续卷', '等待条件满足后决定'
] as const

export const STORYLINE_NODE_STATUS_OPTIONS = ['未开始', '进行中', '已完成', '已取消'] as const

/** 可手写的事件线文本字段。 */
export const STORYLINE_TEXT_FIELDS = [
  'title', 'type', 'whyNecessary', 'openingState', 'finalGoal', 'endCondition', 'nextAction', 'costPaid'
] as const

export type StorylineTextField = (typeof STORYLINE_TEXT_FIELDS)[number]

export const STORYLINE_NODE_TEXT_FIELDS = ['title', 'description'] as const
export type StorylineNodeTextField = (typeof STORYLINE_NODE_TEXT_FIELDS)[number]

export const STORYLINE_PLAN_TEXT_FIELDS = ['subGoal', 'method', 'obstacle', 'outcome', 'nextTrigger'] as const
export type StorylinePlanTextField = (typeof STORYLINE_PLAN_TEXT_FIELDS)[number]

/** 可手写的暂停字段（原因与返回条件是状态改为「计划暂停」的前置条件）。 */
export const STORYLINE_PAUSE_TEXT_FIELDS = ['reason', 'returnCondition', 'currentState', 'behindTheScenesChange'] as const
export type StorylinePauseTextField = (typeof STORYLINE_PAUSE_TEXT_FIELDS)[number]

/* ------------------------------------------------------------------ *
 * 草稿形状：只声明会读写的字段，便于测试直接构造最小对象。
 * ------------------------------------------------------------------ */

export type StorylineEvidenceDraft = { chapterId: string; blockId?: string; excerpt: string }

export type StorylineNodeDraft = {
  id: string
  title: string
  description: string
  targetChapterNumber?: number
  status: string
  evidence: StorylineEvidenceDraft[]
}

export type StorylineChapterPlanDraft = {
  chapterId: string
  chapterNumber: number
  subGoal: string
  method: string
  obstacle: string
  outcome: string
  nextTrigger: string
  changes: string[]
  status: string
  evidence: StorylineEvidenceDraft[]
}

export type StorylinePauseDraft = {
  reason: string
  currentState: string
  unresolvedQuestions: string[]
  returnCondition: string
  expectedReturnPosition: string
  expectedReturnChapterNumber?: number
  latestAllowedChapterNumber?: number
  scope: string
  behindTheScenesChange: string
  pausedAtChapterNumber?: number
}

export type StorylineDraft = {
  id: string
  title: string
  type: string
  whyNecessary: string
  startChapterId?: string
  startChapterNumber?: number
  expectedEndChapterNumber?: number
  openingState: string
  finalGoal: string
  endCondition: string
  characterIds: string[]
  entryIds: string[]
  relatedPlotThreadIds: string[]
  keyNodes: StorylineNodeDraft[]
  chapterPlans: StorylineChapterPlanDraft[]
  currentProgress: number
  costPaid: string
  unresolvedQuestions: string[]
  nextAction: string
  status: string
  pause?: StorylinePauseDraft
  evidenceChain: StorylineEvidenceDraft[]
  updatedAt: string
}

export type StorylineWritingDraft = OutlineWritingDraft & {
  storylines?: StorylineDraft[]
  /** 关联世界词条时需要确认目标存在；只读 id 与名称，不复制词条资料。 */
  worldBible?: { entries: Array<{ id: string; name: string }> }
  /** 删除前展示关联伏笔标题用；只读 id 与标题，映射不到时用 id 兜底。 */
  plotThreads?: Array<{ id: string; title: string }>
}

export type WriteResult = { ok: boolean; message?: string; id?: string }

/* ------------------------------------------------------------------ *
 * 内部工具
 * ------------------------------------------------------------------ */

function findLine(draft: StorylineWritingDraft, lineId: string): StorylineDraft | undefined {
  return draft.storylines?.find((line) => line.id === lineId)
}

function touch(line: StorylineDraft, now: string): void {
  line.updatedAt = now
}

/** 「计划暂停」的前置条件：原因与返回条件都必须已经写下。 */
export function storylinePauseReady(line: Pick<StorylineDraft, 'pause'>): boolean {
  return Boolean(line.pause?.reason.trim() && line.pause?.returnCondition.trim())
}

/* ------------------------------------------------------------------ *
 * 创建
 * ------------------------------------------------------------------ */

/** 契约完整、文本全空的事件线；标题由作者提供（契约要求非空）。 */
export function applyAddStoryline(
  draft: StorylineWritingDraft,
  title: string,
  now: string,
  id: string
): WriteResult {
  const trimmed = title.trim()
  if (!trimmed) return { ok: false, message: '请先填写事件线名称；本模块不会替你编一个名字。' }
  if (!Array.isArray(draft.storylines)) draft.storylines = []
  if (draft.storylines.some((line) => line.id === id)) return { ok: false, message: '这条事件线已经存在。' }

  draft.storylines.push({
    id,
    title: trimmed,
    type: '',
    whyNecessary: '',
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
    updatedAt: now
  })
  return { ok: true, id }
}

/* ------------------------------------------------------------------ *
 * 事件线本体
 * ------------------------------------------------------------------ */

export function applyStorylineFieldEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  field: StorylineTextField,
  value: string,
  now: string
): boolean {
  const line = findLine(draft, lineId)
  if (!line) return false
  // 名称是契约必填，不能改成空串；要清空请改「状态」或删除整条线
  if (field === 'title' && !value.trim()) return false
  if (line[field] === value) return false
  line[field] = value
  touch(line, now)
  return true
}

/** 起止章号；预计结束章不能早于开始章（契约 superRefine）。 */
export function applyStorylineChapterRangeEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  range: { startChapterNumber?: number; expectedEndChapterNumber?: number },
  now: string
): WriteResult {
  const line = findLine(draft, lineId)
  if (!line) return { ok: false, message: '找不到这条事件线。' }

  const nextStart = range.startChapterNumber ?? line.startChapterNumber
  const nextEnd = range.expectedEndChapterNumber ?? line.expectedEndChapterNumber
  if (nextStart !== undefined && nextEnd !== undefined && nextEnd < nextStart) {
    return { ok: false, message: '预计结束章不能早于开始章。' }
  }
  if (nextStart !== undefined && (!Number.isInteger(nextStart) || nextStart <= 0)) return { ok: false, message: '开始章号必须是正整数。' }
  if (nextEnd !== undefined && (!Number.isInteger(nextEnd) || nextEnd <= 0)) return { ok: false, message: '预计结束章号必须是正整数。' }

  line.startChapterNumber = nextStart
  line.expectedEndChapterNumber = nextEnd
  touch(line, now)
  return { ok: true }
}

/**
 * 状态切换。改成「计划暂停」之前，暂停原因与返回条件必须已经写好；
 * 这一步没有做到就直接拒绝，不会生成一个契约不完整的事件线。
 */
export function applyStorylineStatusEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  status: string,
  now: string
): WriteResult {
  const line = findLine(draft, lineId)
  if (!line) return { ok: false, message: '找不到这条事件线。' }
  if (!(STORYLINE_STATUS_OPTIONS as readonly string[]).includes(status)) return { ok: false, message: '不认识的事件线状态。' }
  if (status === '计划暂停' && !storylinePauseReady(line)) {
    return { ok: false, message: '改为「计划暂停」前，请先填写暂停原因与返回条件。' }
  }
  if (line.status === status) return { ok: false, message: '状态没有变化。' }

  line.status = status
  touch(line, now)
  return { ok: true }
}

/** 写暂停原因 / 返回条件 / 当前状态等文本；暂停对象不存在时按合同默认值初始化。 */
export function applyStorylinePauseEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  patch: Partial<Record<StorylinePauseTextField, string>> & {
    scope?: string
    expectedReturnPosition?: string
    expectedReturnChapterNumber?: number
  },
  now: string
): boolean {
  const line = findLine(draft, lineId)
  if (!line) return false

  const current: StorylinePauseDraft = line.pause ?? {
    reason: '',
    currentState: '',
    unresolvedQuestions: [],
    returnCondition: '',
    expectedReturnPosition: '下一章开头',
    scope: '下一章',
    behindTheScenesChange: ''
  }
  let changed = false
  for (const field of STORYLINE_PAUSE_TEXT_FIELDS) {
    const value = patch[field]
    if (value === undefined || current[field] === value) continue
    current[field] = value
    changed = true
  }
  if (patch.scope !== undefined && current.scope !== patch.scope) { current.scope = patch.scope; changed = true }
  if (patch.expectedReturnPosition !== undefined && current.expectedReturnPosition !== patch.expectedReturnPosition) {
    current.expectedReturnPosition = patch.expectedReturnPosition
    changed = true
  }
  if (patch.expectedReturnChapterNumber !== current.expectedReturnChapterNumber) {
    current.expectedReturnChapterNumber = patch.expectedReturnChapterNumber
    changed = true
  }
  if (!changed) return false

  line.pause = current
  touch(line, now)
  return true
}

/* ------------------------------------------------------------------ *
 * 关键节点
 * ------------------------------------------------------------------ */

export function applyAddStorylineNode(
  draft: StorylineWritingDraft,
  lineId: string,
  title: string,
  now: string,
  id: string
): WriteResult {
  const line = findLine(draft, lineId)
  if (!line) return { ok: false, message: '找不到这条事件线。' }
  if (!title.trim()) return { ok: false, message: '请先填写节点名称。' }
  if (line.keyNodes.some((node) => node.id === id)) return { ok: false, message: '这个节点已经存在。' }

  line.keyNodes.push({ id, title: title.trim(), description: '', status: '未开始', evidence: [] })
  touch(line, now)
  return { ok: true, id }
}

export function applyStorylineNodeFieldEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  nodeId: string,
  field: StorylineNodeTextField,
  value: string,
  now: string
): boolean {
  const line = findLine(draft, lineId)
  const node = line?.keyNodes.find((item) => item.id === nodeId)
  if (!line || !node) return false
  if (field === 'title' && !value.trim()) return false
  if (node[field] === value) return false
  node[field] = value
  touch(line, now)
  return true
}

export function applyStorylineNodeStatusEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  nodeId: string,
  status: string,
  now: string
): boolean {
  const line = findLine(draft, lineId)
  const node = line?.keyNodes.find((item) => item.id === nodeId)
  if (!line || !node) return false
  if (!(STORYLINE_NODE_STATUS_OPTIONS as readonly string[]).includes(status)) return false
  if (node.status === status) return false
  node.status = status
  touch(line, now)
  return true
}

export function applyRemoveStorylineNode(
  draft: StorylineWritingDraft,
  lineId: string,
  nodeId: string,
  now: string
): boolean {
  const line = findLine(draft, lineId)
  if (!line) return false
  const index = line.keyNodes.findIndex((item) => item.id === nodeId)
  if (index < 0) return false
  line.keyNodes.splice(index, 1)
  touch(line, now)
  return true
}

/* ------------------------------------------------------------------ *
 * 章节关联（chapterPlans）：绑定真实章节，不按章数推算进度
 * ------------------------------------------------------------------ */

export function applyAddStorylineChapterPlan(
  draft: StorylineWritingDraft,
  lineId: string,
  chapter: { id: string; chapterNumber: number },
  now: string
): WriteResult {
  const line = findLine(draft, lineId)
  if (!line) return { ok: false, message: '找不到这条事件线。' }
  if (line.chapterPlans.some((plan) => plan.chapterId === chapter.id)) {
    return { ok: false, message: '这一章已经在这条事件线的关联里了。' }
  }
  line.chapterPlans.push({
    chapterId: chapter.id,
    chapterNumber: chapter.chapterNumber,
    subGoal: '',
    method: '',
    obstacle: '',
    outcome: '',
    nextTrigger: '',
    changes: [],
    status: '计划',
    evidence: []
  })
  line.chapterPlans.sort((left, right) => left.chapterNumber - right.chapterNumber)
  touch(line, now)
  return { ok: true, id: chapter.id }
}

export function applyStorylineChapterPlanFieldEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  chapterId: string,
  field: StorylinePlanTextField,
  value: string,
  now: string
): boolean {
  const line = findLine(draft, lineId)
  const plan = line?.chapterPlans.find((item) => item.chapterId === chapterId)
  if (!line || !plan) return false
  if (plan[field] === value) return false
  plan[field] = value
  touch(line, now)
  return true
}

export function applyRemoveStorylineChapterPlan(
  draft: StorylineWritingDraft,
  lineId: string,
  chapterId: string,
  now: string
): boolean {
  const line = findLine(draft, lineId)
  if (!line) return false
  const index = line.chapterPlans.findIndex((item) => item.chapterId === chapterId)
  if (index < 0) return false
  line.chapterPlans.splice(index, 1)
  touch(line, now)
  return true
}

/* ------------------------------------------------------------------ *
 * 关联世界词条：只维护 entryIds 这一份引用，不动词条资料
 * ------------------------------------------------------------------ */

/**
 * 关联 / 解绑一条事件线引用的世界词条。
 * 引用关系只有 `storyline.entryIds` 这一处；不复制词条内容，也不去改词条的 `relations`。
 */
export function applyStorylineEntryLinkEdit(
  draft: StorylineWritingDraft,
  lineId: string,
  entryId: string,
  linked: boolean,
  now: string
): WriteResult {
  const line = findLine(draft, lineId)
  if (!line) return { ok: false, message: '找不到这条事件线。' }
  const entries = draft.worldBible?.entries
  if (linked && entries && !entries.some((entry) => entry.id === entryId)) {
    return { ok: false, message: '找不到这个要关联的世界词条。' }
  }
  const current = line.entryIds ?? []
  const already = current.includes(entryId)
  if (linked === already) {
    return { ok: false, message: linked ? '这条事件线已经关联了该词条。' : '这条事件线没有关联该词条。' }
  }
  line.entryIds = linked ? [...current, entryId] : current.filter((id) => id !== entryId)
  touch(line, now)
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 删除整条事件线
 * ------------------------------------------------------------------ *
 * 「事件线」= project.storylines[]（跨卷、跨章纲批次延续的重要事件线）。
 * 只删选中的那一条及其自带内容（keyNodes / chapterPlans / evidenceChain 都嵌在该条内部，
 * 自然随之消失）；绝不连带删除正文、章纲、世界词条、记忆或伏笔。
 * 借鉴 worldWriting.ts 的 applyRemoveWorldConstraint：「先查引用 → 拒绝或删除」。
 */

export type StorylineReferenceReport = {
  title: string
  /** 去重后的关联章节数：来自 startChapterId / keyNodes[].evidence[].chapterId / chapterPlans[].chapterId。 */
  chapterCount: number
  nodeCount: number
  chapterPlanCount: number
  plotThreadTitles: string[]
  entryNames: string[]
  characterIds: string[]
}

/**
 * 只读汇总，供界面在删除前展示「关联章节、节点和引用」。
 * 找不到线时返回全空的报告，不抛异常。
 */
export function storylineReferenceReport(draft: StorylineWritingDraft, lineId: string): StorylineReferenceReport {
  const line = findLine(draft, lineId)
  if (!line) {
    return { title: '', chapterCount: 0, nodeCount: 0, chapterPlanCount: 0, plotThreadTitles: [], entryNames: [], characterIds: [] }
  }
  const chapterIds = new Set<string>()
  if (line.startChapterId) chapterIds.add(line.startChapterId)
  for (const node of line.keyNodes) {
    for (const evidence of node.evidence) {
      if (evidence.chapterId) chapterIds.add(evidence.chapterId)
    }
  }
  for (const plan of line.chapterPlans) {
    if (plan.chapterId) chapterIds.add(plan.chapterId)
  }

  const plotThreadTitles = line.relatedPlotThreadIds.map((id) => {
    const thread = draft.plotThreads?.find((item) => item.id === id)
    return thread?.title || id
  })
  const entries = draft.worldBible?.entries ?? []
  const entryNames = line.entryIds.map((id) => entries.find((entry) => entry.id === id)?.name || id)

  return {
    title: line.title,
    chapterCount: chapterIds.size,
    nodeCount: line.keyNodes.length,
    chapterPlanCount: line.chapterPlans.length,
    plotThreadTitles,
    entryNames,
    characterIds: [...line.characterIds]
  }
}

/**
 * 删除整条事件线。
 * - 找不到线 → 拒绝；
 * - 仍有外部引用（externalRefs 非空）→ 拒绝且**不执行删除**（防御性：当前全仓没有任何对象
 *   反向引用事件线 id，但未来若有引用可安全阻止，避免留下悬空关联）；
 * - 否则按 id 过滤掉这一条。
 */
export function applyRemoveStoryline(
  draft: StorylineWritingDraft,
  lineId: string,
  externalRefs?: string[]
): WriteResult {
  const line = findLine(draft, lineId)
  if (!line) return { ok: false, message: '事件线不存在。' }

  if (externalRefs && externalRefs.length > 0) {
    return { ok: false, message: '仍有外部引用（' + externalRefs.join('、') + '）指向该事件线，请先解除后再删除。' }
  }

  draft.storylines = (draft.storylines ?? []).filter((item) => item.id !== lineId)
  return { ok: true, id: lineId }
}
