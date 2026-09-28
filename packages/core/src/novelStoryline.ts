import type {
  ChapterOutline, NovelOutline, NovelPlotThread, PlotThreadCognition, PlotThreadEvidence,
  PlotThreadEvidencePhase, PlotThreadReadiness
} from '../../contracts/src/novel'
import type {
  ChapterLineAssignment, NovelStoryline, RollingOutlineWindow, StorylineChapterPlan, StorylineStatus
} from '../../contracts/src/novelStoryline'

export interface ChapterLineAssignmentCheck {
  mainCount: number
  supportCount: number
  valid: boolean
  warnings: string[]
  overloadedAssignments: number[]
}

/**
 * 检查单章的剧情线分配。规则是提醒而不是硬门禁：高潮可能合理地让多条
 * 线同时发生变化，因此调用方应把 warning 展示给作者，由作者填写例外。
 */
export function evaluateChapterLineAssignments(assignments: ChapterLineAssignment[]): ChapterLineAssignmentCheck {
  const mainCount = assignments.filter((item) => item.role === '主线').length
  const supportCount = assignments.filter((item) => item.role === '辅助线').length
  const overloadedAssignments = assignments
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.exceptionReason && ((item.role === '主线' && mainCount > 1) || (item.role === '辅助线' && supportCount > 2)))
    .map(({ index }) => index)
  const warnings: string[] = []
  if (mainCount === 0) warnings.push('本章还没有指定主线，建议先明确本章最主要的推进任务。')
  if (mainCount > 1) warnings.push(`本章有 ${mainCount} 条主线，可能分散读者注意力；如属于阶段高潮，请说明多线汇合原因。`)
  if (supportCount > 2) warnings.push(`本章有 ${supportCount} 条辅助线，建议合并、暂停或拆分；复杂高潮可保留并说明例外。`)
  return { mainCount, supportCount, valid: overloadedAssignments.length === 0, warnings, overloadedAssignments }
}

export interface StorylineProgressView {
  progress: number
  level: '未开始' | '推进中' | '接近完成' | '已完成'
  completedNodes: number
  totalNodes: number
  completedChapters: number
  plannedChapters: number
}

/** 以节点和章计划的完成情况计算可解释的进度；不修改事件线原值。 */
export function calculateStorylineProgress(line: NovelStoryline): StorylineProgressView {
  const nodes = line.keyNodes
  const plans = line.chapterPlans
  const completedNodes = nodes.filter((node) => node.status === '已完成').length
  const completedChapters = plans.filter((plan) => plan.status === '已完成').length
  const nodeRatio = nodes.length ? completedNodes / nodes.length : undefined
  const chapterRatio = plans.length ? completedChapters / plans.length : undefined
  const computed = [nodeRatio, chapterRatio].filter((value): value is number => value !== undefined)
  const progress = clamp(computed.length ? computed.reduce((sum, value) => sum + value, 0) / computed.length : line.currentProgress)
  const level = line.status === '已完成' || progress >= 1 ? '已完成' : progress >= .8 ? '接近完成' : progress > 0 ? '推进中' : '未开始'
  return { progress, level, completedNodes, totalNodes: nodes.length, completedChapters, plannedChapters: plans.length }
}

export interface StorylineHealthView {
  status: StorylineStatus
  progress: StorylineProgressView
  pauseReason?: string
  returnPosition?: string
  returnCondition?: string
  breakRisk: '低' | '中' | '高'
  riskReasons: string[]
  nextPlan?: StorylineChapterPlan
}

/**
 * 给“剧情线台账”使用的解释结果。断线风险基于已有计划和暂停说明，
 * 只生成提醒，不自动替作者改变剧情线状态。
 */
export function assessStorylineHealth(line: NovelStoryline, currentChapterNumber: number): StorylineHealthView {
  const progress = calculateStorylineProgress(line)
  const futurePlans = line.chapterPlans.filter((plan) => plan.chapterNumber >= currentChapterNumber && plan.status !== '已跳过')
  const nextPlan = futurePlans.sort((left, right) => left.chapterNumber - right.chapterNumber)[0]
  const riskReasons: string[] = []
  if (line.status === '计划暂停' || line.status === '长期悬置') {
    if (!line.pause?.returnCondition) riskReasons.push('已暂停但没有记录明确的返回条件。')
    if (!line.pause?.expectedReturnChapterNumber && !line.pause?.expectedReturnPosition) riskReasons.push('没有记录预计返回位置。')
    if (line.pause?.latestAllowedChapterNumber && currentChapterNumber > line.pause.latestAllowedChapterNumber) riskReasons.push('已经超过计划的最晚处理范围。')
  }
  if (['推进中', '等待条件'].includes(line.status) && !nextPlan) riskReasons.push('近期没有可执行的剧情线计划，可能在滚动窗口中断线。')
  if (line.expectedEndChapterNumber && currentChapterNumber > line.expectedEndChapterNumber && line.status !== '已完成') riskReasons.push('已超过预计结束章节但事件尚未收束。')
  const breakRisk = riskReasons.some((reason) => reason.includes('超过') || reason.includes('中断线')) ? '高' : riskReasons.length ? '中' : '低'
  return {
    status: line.status,
    progress,
    pauseReason: line.pause?.reason,
    returnPosition: line.pause?.expectedReturnPosition,
    returnCondition: line.pause?.returnCondition,
    breakRisk,
    riskReasons,
    nextPlan
  }
}

export interface RollingOutlineWindowView {
  window: RollingOutlineWindow
  chapters: ChapterOutline[]
  beforeChapterIds: string[]
  afterChapterIds: string[]
  visibleStorylineIds: string[]
}

/**
 * 计算近期详细规划窗口。当前章作为窗口起点，窗口默认 20 章且限制在
 * 10—30 章；完整卷纲和跨窗口事件线由调用方继续保存，不会被裁剪掉。
 */
export function buildRollingOutlineWindow(
  outline: NovelOutline,
  currentChapterNumber: number,
  storylines: NovelStoryline[] = [],
  options: { windowSize?: number; now?: string } = {}
): RollingOutlineWindowView {
  const windowSize = Math.min(30, Math.max(10, Math.trunc(options.windowSize ?? outline.rollingWindow?.windowSize ?? 20)))
  const all = outline.volumes.flatMap((volume) => volume.chapters).sort((left, right) => left.chapterNumber - right.chapterNumber)
  const currentIndex = Math.max(0, all.findIndex((chapter) => chapter.chapterNumber >= currentChapterNumber))
  const startIndex = all.length ? currentIndex : 0
  const selected = all.slice(startIndex, startIndex + windowSize)
  const start = selected[0]?.chapterNumber ?? Math.max(1, currentChapterNumber)
  const end = selected.at(-1)?.chapterNumber ?? start
  const beforeChapterIds = all.slice(Math.max(0, startIndex - 3), startIndex).map((chapter) => chapter.id)
  const afterChapterIds = all.slice(startIndex + selected.length, startIndex + selected.length + 3).map((chapter) => chapter.id)
  const selectedNumbers = new Set(selected.map((chapter) => chapter.chapterNumber))
  const visibleStorylineIds = storylines.filter((line) => {
    if (line.chapterPlans.some((plan) => selectedNumbers.has(plan.chapterNumber))) return true
    const lineStart = line.startChapterNumber ?? Number.POSITIVE_INFINITY
    const lineEnd = line.expectedEndChapterNumber ?? Number.NEGATIVE_INFINITY
    return lineStart <= end && lineEnd >= start
  }).map((line) => line.id)
  const window: RollingOutlineWindow = {
    currentChapterNumber: selected.some((chapter) => chapter.chapterNumber === currentChapterNumber) ? currentChapterNumber : start,
    detailStartChapterNumber: start,
    detailEndChapterNumber: end,
    windowSize,
    coarseThroughChapterNumber: all.at(-1)?.chapterNumber,
    updatedAt: options.now ?? new Date().toISOString()
  }
  return { window, chapters: selected, beforeChapterIds, afterChapterIds, visibleStorylineIds }
}

/** 判断章节计划是否真的产生了可观察推进；“无变化”不能作为有效推进。 */
export function hasMeaningfulStorylineChange(plan: Pick<StorylineChapterPlan, 'changes'>): boolean {
  return plan.changes.some((change) => change !== '无变化')
}

/**
 * 将旧版三个证据字段和新版 evidencePool 归一为同一条证据链。
 *
 * 该函数只读输入并返回新数组，便于在导入旧项目、记忆召回和界面展示时
 * 使用；它不会把 AI 推测自动写入正式伏笔。显式 evidencePool 优先，旧字段
 * 只在没有相同“阶段+章节+摘录”记录时补入。
 */
export function normalizePlotThreadEvidence(thread: NovelPlotThread): PlotThreadEvidence[] {
  const result: PlotThreadEvidence[] = []
  const seen = new Set<string>()
  const add = (value: Partial<PlotThreadEvidence> & Pick<PlotThreadEvidence, 'phase' | 'chapterId' | 'excerpt'>, fallbackIndex: number): void => {
    const chapterId = String(value.chapterId ?? '').trim()
    const excerpt = String(value.excerpt ?? '').trim()
    if (!chapterId || !excerpt) return
    const phase = value.phase
    const key = `${phase}|${chapterId}|${value.blockId ?? ''}|${excerpt}`
    if (seen.has(key)) return
    seen.add(key)
    result.push({
      id: String(value.id ?? `legacy-${phase}-${fallbackIndex + 1}`), phase, chapterId,
      ...(value.blockId ? { blockId: value.blockId } : {}), excerpt,
      note: String(value.note ?? '').trim(), source: value.source ?? '作者记录',
      confidence: clamp(value.confidence ?? 1), status: value.status ?? '有效',
      ...(value.createdAt ? { createdAt: value.createdAt } : {})
    })
  }

  // Explicit records are retained first so an author's annotation wins over a
  // compatibility record reconstructed from setup/progress/resolution fields.
  for (const [index, item] of (thread.evidencePool ?? []).entries()) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<PlotThreadEvidence>
    if (!['埋设', '推进', '回收', '旁证', '冲突'].includes(String(candidate.phase))) continue
    add(candidate as Partial<PlotThreadEvidence> & Pick<PlotThreadEvidence, 'phase' | 'chapterId' | 'excerpt'>, index)
  }
  if (thread.setupEvidence) add({ ...thread.setupEvidence, phase: '埋设', note: thread.setupMethod, source: '正文' }, result.length)
  ;(thread.progress ?? []).forEach((progress, index) => add({ ...progress.source, phase: '推进', note: progress.description, source: '正文' }, result.length + index))
  if (thread.resolutionEvidence) add({ ...thread.resolutionEvidence, phase: '回收', note: thread.resolutionMethod, source: '正文' }, result.length)
  return result
}

/** 兼容更直观的调用名称；内部仍使用同一份归一化结果。 */
export const buildPlotThreadEvidencePool = normalizePlotThreadEvidence

export interface PlotThreadCognitionView {
  reader: string
  protagonist: string
  otherCharacters: Array<{ characterId?: string; characterName: string; knowledge: string; evidenceIds: string[] }>
  gapSummary: string
  /** 便于界面直接显示的别名；不含内部字段路径。 */
  gap: string
  warnings: string[]
  evidence: PlotThreadEvidence[]
}

/** 读取结构化认知差；旧版自由文本 cognitiveGap 会作为概况保留。 */
export function explainPlotThreadCognition(thread: NovelPlotThread): PlotThreadCognitionView {
  const source = thread.cognition as PlotThreadCognition | undefined
  const otherCharacters = (source?.otherCharacters ?? []).map((item) => ({
    ...(item.characterId ? { characterId: item.characterId } : {}),
    characterName: item.characterName ?? '', knowledge: item.knowledge ?? '', evidenceIds: [...(item.evidenceIds ?? [])]
  }))
  const reader = source?.reader?.trim() ?? ''
  const protagonist = source?.protagonist?.trim() ?? ''
  const gapSummary = source?.gapSummary?.trim() || thread.cognitiveGap?.trim() || ''
  const warnings: string[] = []
  if (!reader) warnings.push('尚未记录读者已经知道的内容。')
  if (!protagonist) warnings.push('尚未记录主角已经知道的内容。')
  if (otherCharacters.some((item) => !item.knowledge.trim())) warnings.push('有其他角色的认知记录缺少具体内容。')
  if (!gapSummary && (reader || protagonist || otherCharacters.length)) warnings.push('尚未写明读者与角色之间的认知差。')
  return { reader, protagonist, otherCharacters, gapSummary, gap: gapSummary, warnings, evidence: normalizePlotThreadEvidence(thread) }
}

export interface PlotThreadReadinessView extends PlotThreadReadiness {
  evidenceCount: number
  phaseCounts: Record<PlotThreadEvidencePhase, number>
}

/**
 * 计算可解释的伏笔回收准备度。分数只是提醒，不会自动把伏笔标记为已回收；
 * 只有明确的回收状态和回收证据才代表完成。旧版手工分数会被保留为参考，
 * 但满足项/缺口仍按当前证据重新列出。
 */
export function calculatePlotThreadReadiness(thread: NovelPlotThread, options: { now?: string } = {}): PlotThreadReadinessView {
  const evidence = normalizePlotThreadEvidence(thread)
  const activeEvidence = evidence.filter((item) => item.status !== '已失效')
  const phaseCounts: Record<PlotThreadEvidencePhase, number> = { 埋设: 0, 推进: 0, 回收: 0, 旁证: 0, 冲突: 0 }
  activeEvidence.forEach((item) => { phaseCounts[item.phase] += 1 })
  const cognition = explainPlotThreadCognition(thread)
  const fulfilled: string[] = []
  const gaps: string[] = []
  const basis: string[] = [`当前有 ${activeEvidence.length} 条有效证据：埋设 ${phaseCounts.埋设}、推进 ${phaseCounts.推进}、回收 ${phaseCounts.回收}。`]
  let computed = 0
  if (phaseCounts.埋设 > 0) { computed += .25; fulfilled.push('已经记录埋设证据。') } else gaps.push('缺少能说明伏笔如何埋下的原文证据。')
  if (phaseCounts.推进 > 0) { computed += Math.min(.25, .1 + phaseCounts.推进 * .05); fulfilled.push(`已有 ${phaseCounts.推进} 条推进证据。`) } else gaps.push('还没有记录伏笔推进或线索变化。')
  if (thread.targetPayoffChapter) { computed += .15; fulfilled.push(`已安排第 ${thread.targetPayoffChapter} 章作为计划回收点。`) } else gaps.push('尚未安排计划回收章节。')
  if (cognition.reader || cognition.protagonist || cognition.otherCharacters.length) {
    computed += .15
    fulfilled.push('已记录至少一方的认知范围。')
    if (!cognition.reader || !cognition.protagonist) gaps.push('读者或主角的认知记录仍不完整。')
  } else gaps.push('尚未记录读者、主角和其他角色分别知道什么。')
  if (phaseCounts.回收 > 0 || thread.resolutionChapterId) {
    computed += .20
    if (phaseCounts.回收 > 0) fulfilled.push('已经记录回收证据。')
    else gaps.push('已填写回收章节，但还没有摘录实际回收证据。')
  } else if (thread.status === '已回收') {
    gaps.push('伏笔状态标为已回收，但缺少回收章节和原文证据。')
  }
  // Keep an explicitly saved score visible for old projects and author edits;
  // never use it to remove evidence gaps.
  const savedScore = thread.readiness?.score ?? thread.revealReadiness
  const score = clamp(typeof savedScore === 'number' && Number.isFinite(savedScore) ? savedScore : computed)
  if (savedScore !== undefined) basis.push(`保留作者此前记录的准备度 ${Math.round(score * 100)}%。`)
  const level: PlotThreadReadiness['level'] = thread.status === '已放弃' && thread.archivedAt
    ? '已归档' : thread.status === '已回收' ? '已回收' : score >= .75 ? '可以回收' : score >= .45 ? '接近回收' : score > 0 ? '正在准备' : '未准备'
  const recommendation = level === '已归档' ? '伏笔已归档，历史证据仍保留；如需继续使用，请先恢复伏笔。'
    : level === '已回收' ? (gaps.length ? `请补齐：${gaps[0]}` : '证据链已闭合，可以在审稿中核对回收效果。')
      : gaps.length ? `下一步建议：${gaps[0]}` : '证据链已较完整，可以检查回收是否自然。'
  return {
    score, level, fulfilled, gaps, basis, recommendation,
    assessedAt: options.now ?? new Date().toISOString(), evidenceCount: activeEvidence.length, phaseCounts
  }
}

/** 追加一条证据时只更新证据池，不会删除旧证据或改变伏笔状态。 */
export function appendPlotThreadEvidence(thread: NovelPlotThread, input: Omit<PlotThreadEvidence, 'id'> & { id?: string }): NovelPlotThread {
  const id = input.id ?? `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const evidencePool = [...normalizePlotThreadEvidence(thread), { ...input, id }]
  return { ...thread, evidencePool, updatedAt: new Date().toISOString() }
}

export interface PlotThreadArchiveOptions {
  reason?: string
  chapterId?: string
  evidence?: { chapterId: string; blockId?: string; excerpt: string }
  archivedAt?: string
}

/**
 * 放弃伏笔采用归档语义：只改变状态并追加历史，绝不删除证据、推进记录或
 * 回收记录。这样作者以后可以恢复并继续推进，而不会丢失原先的依据。
 */
export function archivePlotThread(thread: NovelPlotThread, options: PlotThreadArchiveOptions = {}): NovelPlotThread {
  const at = options.archivedAt ?? new Date().toISOString()
  const reason = options.reason?.trim() || '作者暂时放弃该伏笔，保留历史证据。'
  const alreadyArchived = thread.status === '已放弃' && Boolean(thread.archivedAt)
  const history = [...(thread.revisionHistory ?? [])]
  if (!alreadyArchived) history.push({
    id: `plot-archive-${at}-${history.length + 1}`, changedAt: at, fromStatus: thread.status, toStatus: '已放弃',
    ...(options.chapterId ? { chapterId: options.chapterId } : {}), reason,
    ...(options.evidence ? { evidence: options.evidence } : {})
  })
  return {
    ...thread, status: '已放弃', archivedAt: at, archiveReason: reason,
    archivedFromStatus: alreadyArchived ? thread.archivedFromStatus : thread.status,
    revisionHistory: history, evidencePool: normalizePlotThreadEvidence(thread), updatedAt: at
  }
}

/** 恢复归档伏笔；所有原证据和归档历史均保留。 */
export function restoreArchivedPlotThread(thread: NovelPlotThread, status: Exclude<NovelPlotThread['status'], '已放弃'> = '推进中', options: { reason?: string; chapterId?: string; restoredAt?: string } = {}): NovelPlotThread {
  if (thread.status !== '已放弃' && !thread.archivedAt) return { ...thread }
  const at = options.restoredAt ?? new Date().toISOString()
  const history = [...(thread.revisionHistory ?? []), {
    id: `plot-restore-${at}-${(thread.revisionHistory?.length ?? 0) + 1}`, changedAt: at,
    fromStatus: thread.status, toStatus: status, ...(options.chapterId ? { chapterId: options.chapterId } : {}),
    reason: options.reason?.trim() || '作者恢复已归档伏笔，继续保留原证据。'
  }]
  return {
    ...thread, status, archivedAt: undefined, archiveReason: undefined,
    archivedFromStatus: undefined, revisionHistory: history,
    evidencePool: normalizePlotThreadEvidence(thread), updatedAt: at
  }
}

export function isArchivedPlotThread(thread: Pick<NovelPlotThread, 'status' | 'archivedAt'>): boolean {
  return thread.status === '已放弃' || Boolean(thread.archivedAt)
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}
