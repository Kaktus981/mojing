import type { NovelProject } from '../../../../../../../packages/contracts/src'

/**
 * 小说大纲 · 六个二级页面的纯数据模型。
 *
 * 为什么把映射抽成纯函数：
 *   1. 六个二级入口必须呈现**不同**内容，这一点要能被测试直接证明，而不是靠肉眼看页面；
 *   2. 所有展示值只能来自传入的真实 `NovelProject`，不允许页面自己补默认值或造统计；
 *   3. 能力缺口（例如结构调整接口、近期规划窗口）在这里显式建模为 `capability`
 *      说明，页面只负责如实渲染「尚未接通」，避免出现假按钮或假数据。
 */

export type OutlinePageId =
  | 'outline-foundation'
  | 'chapter-directory'
  | 'rolling-outline'
  | 'chapter-beats'
  | 'storylines'
  | 'outline-structure'

/** 六个二级入口的稳定顺序，与 workspaceNavigation 的 outline stage 一致。 */
export const OUTLINE_PAGE_IDS: readonly OutlinePageId[] = [
  'outline-foundation',
  'chapter-directory',
  'rolling-outline',
  'chapter-beats',
  'storylines',
  'outline-structure'
]

export type OutlinePageKind = 'foundation' | 'directory' | 'rolling' | 'beats' | 'storylines' | 'structure'

const PAGE_KIND: Record<OutlinePageId, OutlinePageKind> = {
  'outline-foundation': 'foundation',
  'chapter-directory': 'directory',
  'rolling-outline': 'rolling',
  'chapter-beats': 'beats',
  'storylines': 'storylines',
  'outline-structure': 'structure'
}

export function isOutlinePageId(value: string): value is OutlinePageId {
  return (OUTLINE_PAGE_IDS as readonly string[]).includes(value)
}

export function outlinePageKind(subnavId: string): OutlinePageKind {
  return isOutlinePageId(subnavId) ? PAGE_KIND[subnavId] : 'foundation'
}

/** 哪些页面必须以大纲对象为前提（「重要事件线」不受影响，它可以只依赖 storylines）。 */
export function outlinePageNeedsOutline(kind: OutlinePageKind): boolean {
  return kind !== 'storylines'
}

/** 能力缺口说明：页面必须原样显示，不得用假成功掩盖。 */
export type OutlineCapabilityNotice = {
  id: string
  title: string
  detail: string
}

export const VOLUME_NUMERALS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾']

export function volumeNumeral(volumeNumber: number): string {
  return VOLUME_NUMERALS[volumeNumber - 1] ?? String(volumeNumber)
}

import { countChapterWords } from '../../paragraphModel'

/** 全站唯一字数口径：见 paragraphModel.countChapterWords（不计空白）。 */
function countWords(chapter: NovelProject['chapters'][number]): number {
  return countChapterWords(chapter.blocks)
}

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value && value.trim())
}

/** 章纲卡 + 正文的真实合并视图；所有字段都直接来自项目数据。 */
export type OutlineChapterCard = {
  cardId: string
  volumeNumber: number
  chapterNumber: number
  title: string
  /** 真实存值：章纲 status（未规划 / 已规划 / 已写作 / 已定稿）。 */
  cardStatus: string
  /** 真实存值：剧情步骤确认状态（未生成 / 待确认 / 已确认）。 */
  beatStatus: string
  beatCount: number
  pendingFindingCount: number
  /** 真实存值：上游规划变化后是否标记复核。 */
  downstreamPending: boolean
  downstreamReason?: string
  /** 章纲可手写字段的真实存值；界面直接绑定这些值，不另存副本。 */
  pov: string
  objective: string
  conflict: string
  turningPoint: string
  reveal: string
  endingHook: string
  /** 是否已有正文（按 chapterNumber 关联 project.chapters，不做书名式猜测）。 */
  hasBody: boolean
  /** 真实存值：正文 status（草稿 / 待审校 / 定稿）；没有正文时为 undefined。 */
  bodyStatus?: string
  words: number
}

export type OutlineVolumeModel = {
  id: string
  volumeNumber: number
  numeral: string
  title: string
  goal: string
  climax: string
  resolution: string
  missingFields: string[]
  chapters: OutlineChapterCard[]
  writtenCount: number
  words: number
  /** 由章纲真实 status 统计（如「已规划 3 · 未规划 1」），不替换成自造枚举。 */
  statusTally: string
  isCurrent: boolean
}

function buildCard(
  card: NonNullable<NovelProject['outline']>['volumes'][number]['chapters'][number],
  bodies: NovelProject['chapters']
): OutlineChapterCard {
  // 正文与章纲优先按稳定身份（id）关联；章号只是阅读顺序，结构变更会重排它。
  // 旧项目里正文与章纲身份不同，才退回章号关联。
  const body = bodies.find((chapter) => chapter.id === card.id)
    ?? bodies.find((chapter) => chapter.chapterNumber === card.chapterNumber)
  return {
    cardId: card.id,
    volumeNumber: card.volumeNumber,
    chapterNumber: card.chapterNumber,
    title: card.title,
    cardStatus: card.status,
    beatStatus: card.beatStatus,
    beatCount: card.beats.length,
    pendingFindingCount: card.beatFindings.filter((finding) => finding.status === '待处理').length,
    downstreamPending: card.downstreamReviewStatus === '待复核',
    downstreamReason: card.downstreamReviewReason,
    pov: card.pov,
    objective: card.objective,
    conflict: card.conflict,
    turningPoint: card.turningPoint,
    reveal: card.reveal,
    endingHook: card.endingHook,
    hasBody: Boolean(body),
    bodyStatus: body?.status,
    words: body ? countWords(body) : 0
  }
}

function statusTally(cards: OutlineChapterCard[]): string {
  if (cards.length === 0) return '暂无章纲'
  const tally = new Map<string, number>()
  for (const card of cards) tally.set(card.cardStatus, (tally.get(card.cardStatus) ?? 0) + 1)
  return [...tally.entries()].map(([status, count]) => `${status} ${count}`).join(' · ')
}

function buildVolumes(project: NovelProject, currentVolumeNumber?: number): OutlineVolumeModel[] {
  return (project.outline?.volumes ?? []).map((volume) => {
    const chapters = volume.chapters.map((card) => buildCard(card, project.chapters))
    const missingFields: string[] = []
    if (!nonEmpty(volume.goal)) missingFields.push('本卷目标')
    if (!nonEmpty(volume.climax)) missingFields.push('本卷高潮')
    if (!nonEmpty(volume.resolution)) missingFields.push('本卷收束')
    return {
      id: volume.id,
      volumeNumber: volume.volumeNumber,
      numeral: volumeNumeral(volume.volumeNumber),
      title: volume.title,
      goal: volume.goal,
      climax: volume.climax,
      resolution: volume.resolution,
      missingFields,
      chapters,
      writtenCount: chapters.filter((card) => card.hasBody).length,
      words: chapters.reduce((sum, card) => sum + card.words, 0),
      statusTally: statusTally(chapters),
      isCurrent: volume.volumeNumber === currentVolumeNumber
    }
  })
}

/** 当前卷：优先跟随选中章节，其次跟随近期规划窗口的当前章；都没有时取第一卷。 */
export function resolveCurrentVolumeNumber(project: NovelProject, currentChapterId?: string): number | undefined {
  const volumes = project.outline?.volumes ?? []
  if (volumes.length === 0) return undefined
  const selected = currentChapterId ? project.chapters.find((chapter) => chapter.id === currentChapterId) : undefined
  const selectedNumber = selected?.chapterNumber
    ?? project.outline?.volumes.flatMap((volume) => volume.chapters).find((card) => card.id === currentChapterId)?.chapterNumber
  const bySelected = volumes.find((volume) => volume.chapters.some((card) => card.chapterNumber === selectedNumber))
  if (bySelected) return bySelected.volumeNumber
  const windowNumber = project.outline?.rollingWindow?.currentChapterNumber
  const byWindow = volumes.find((volume) => volume.chapters.some((card) => card.chapterNumber === windowNumber))
  if (byWindow) return byWindow.volumeNumber
  return volumes[0]!.volumeNumber
}

export type OutlineFoundationModel = {
  kind: 'foundation'
  /** 项目是否已有大纲对象；没有时页面显示诚实空态而不是空表格。 */
  hasOutline: boolean
  status: string
  updatedAt: string
  themes: string[]
  synopsis: string
  mainConflict: string
  endingDirection: string
  missingFields: string[]
  volumes: OutlineVolumeModel[]
  currentVolumeNumber?: number
  totals: {
    plannedChapterCount: number
    writtenChapterCount: number
    words: number
    openThreadCount: number
  }
}

export function openPlotThreadCount(project: NovelProject): number {
  return project.plotThreads.filter((thread) => !['已回收', '已放弃'].includes(thread.status)).length
}

/** 页面 1 · 总纲与卷纲。 */
export function buildOutlineFoundation(project: NovelProject, currentChapterId?: string): OutlineFoundationModel {
  const outline = project.outline
  const currentVolumeNumber = resolveCurrentVolumeNumber(project, currentChapterId)
  const volumes = buildVolumes(project, currentVolumeNumber)
  const missingFields: string[] = []
  if (outline && !nonEmpty(outline.synopsis)) missingFields.push('总纲')
  if (outline && !nonEmpty(outline.mainConflict)) missingFields.push('主冲突')
  if (outline && !nonEmpty(outline.endingDirection)) missingFields.push('结局方向')
  return {
    kind: 'foundation',
    hasOutline: Boolean(outline),
    status: outline?.status ?? '',
    updatedAt: outline?.updatedAt ?? '',
    themes: outline?.themes ?? [],
    synopsis: outline?.synopsis ?? '',
    mainConflict: outline?.mainConflict ?? '',
    endingDirection: outline?.endingDirection ?? '',
    missingFields,
    volumes,
    currentVolumeNumber,
    totals: {
      plannedChapterCount: volumes.reduce((sum, volume) => sum + volume.chapters.length, 0),
      writtenChapterCount: project.chapters.length,
      words: project.chapters.reduce((sum, chapter) => sum + countWords(chapter), 0),
      openThreadCount: openPlotThreadCount(project)
    }
  }
}

export type OutlineDirectoryModel = {
  kind: 'directory'
  volumes: OutlineVolumeModel[]
  currentVolumeNumber?: number
  /** 有正文但没有对应章纲卡（真实差额），必须如实提示而不是隐藏。 */
  bodyWithoutCard: Array<{ chapterId: string; chapterNumber: number; title: string; status: string }>
  totalCards: number
  totalBodies: number
}

/** 页面 2 · 章节目录。 */
export function buildChapterDirectory(project: NovelProject, currentChapterId?: string): OutlineDirectoryModel {
  const volumes = buildVolumes(project, resolveCurrentVolumeNumber(project, currentChapterId))
  const cardNumbers = new Set(volumes.flatMap((volume) => volume.chapters.map((card) => card.chapterNumber)))
  return {
    kind: 'directory',
    volumes,
    currentVolumeNumber: volumes.find((volume) => volume.isCurrent)?.volumeNumber,
    bodyWithoutCard: project.chapters
      .filter((chapter) => !cardNumbers.has(chapter.chapterNumber))
      .map((chapter) => ({ chapterId: chapter.id, chapterNumber: chapter.chapterNumber, title: chapter.title, status: chapter.status })),
    totalCards: volumes.reduce((sum, volume) => sum + volume.chapters.length, 0),
    totalBodies: project.chapters.length
  }
}

export type OutlineRollingWindowModel = {
  currentChapterNumber: number
  detailStartChapterNumber: number
  detailEndChapterNumber: number
  windowSize: number
  coarseThroughChapterNumber?: number
  updatedAt: string
}

export type OutlineRollingModel = {
  kind: 'rolling'
  connected: boolean
  window?: OutlineRollingWindowModel
  inWindow: OutlineChapterCard[]
  outsideWindow: OutlineChapterCard[]
  notice?: OutlineCapabilityNotice
}

const ROLLING_NOT_CONNECTED: OutlineCapabilityNotice = {
  id: 'rolling-window',
  title: '「近期」筛选目前不可用',
  detail:
    '这个项目还没有保存近期详细规划窗口（rollingWindow），因此无法判定「近期」应覆盖哪些章节。为避免编造章节范围或更新时间，本页不展示任何章节列表。窗口由规划流程写入后会立即出现在这里。'
}

/** 页面 3 · 近期详细规划。只展示真实窗口内容，缺依据时明确说明未接通。 */
export function buildRollingOutline(project: NovelProject): OutlineRollingModel {
  const window = project.outline?.rollingWindow
  const allCards = (project.outline?.volumes ?? []).flatMap((volume) =>
    volume.chapters.map((card) => buildCard(card, project.chapters))
  )
  if (!window) {
    return { kind: 'rolling', connected: false, inWindow: [], outsideWindow: allCards, notice: ROLLING_NOT_CONNECTED }
  }
  const inWindow = allCards
    .filter((card) => card.chapterNumber >= window.detailStartChapterNumber && card.chapterNumber <= window.detailEndChapterNumber)
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
  const outsideWindow = allCards
    .filter((card) => !inWindow.includes(card))
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
  return {
    kind: 'rolling',
    connected: true,
    window: {
      currentChapterNumber: window.currentChapterNumber,
      detailStartChapterNumber: window.detailStartChapterNumber,
      detailEndChapterNumber: window.detailEndChapterNumber,
      windowSize: window.windowSize,
      coarseThroughChapterNumber: window.coarseThroughChapterNumber,
      updatedAt: window.updatedAt
    },
    inWindow,
    outsideWindow
  }
}

export type OutlineBeatModel = {
  id: string
  order: number
  title: string
  purpose: string
  conflict: string
  outcome: string
  location: string
  timeframe: string
  reveal: string
  characterIds: string[]
  threadActions: string[]
}

export type OutlineBeatFindingModel = {
  id: string
  severity: '高' | '中' | '低'
  category: string
  message: string
  suggestion: string
  status: string
}

export type OutlineBeatsModel = {
  kind: 'beats'
  /** 没有可用章纲时为空；页面据 targetNotice 显示诚实空态。 */
  card?: OutlineChapterCard
  headline?: string
  beats: OutlineBeatModel[]
  beatStatus?: string
  findings: OutlineBeatFindingModel[]
  pendingFindingCount: number
  lines: Array<{ lineId: string; role: string; purpose?: string; exceptionReason?: string }>
  /** 剧情步骤目前只能只读展示，页面必须只读。 */
  editable: false
  notice: OutlineCapabilityNotice
  /** 没有可用章纲时的诚实说明；有目标章时为 undefined。 */
  targetNotice?: string
}

const BEATS_NOT_EDITABLE: OutlineCapabilityNotice = {
  id: 'beats-editing',
  title: '剧情步骤需要校验，目前不能直接编辑',
  detail:
    '剧情步骤的新增、删除与确认都要先校验上游摘要，这套校验流程目前尚未开放。因此本页只读展示已保存的步骤，不提供可点的假保存。'
}

export type OutlineBeatsTarget = {
  card?: OutlineChapterCard
  /** 需要选章纲但项目里还没有任何章纲时的说明；undefined 表示已找到目标。 */
  targetNotice?: string
}

/** 解析「剧情步骤」的当前目标章：显式选择优先，其次跟随正文选中章，最后取第一章纲。 */
export function resolveBeatsTargetCard(project: NovelProject, chapterId?: string): OutlineBeatsTarget {
  const entries = (project.outline?.volumes ?? []).flatMap((volume) =>
    volume.chapters.map((card) => ({ card, chapterNumber: card.chapterNumber }))
  )
  if (entries.length === 0) {
    return { targetNotice: '这个项目还没有章纲，先在第「总纲与卷纲」或「章节目录」建立章节结构。' }
  }
  const selectedBodyNumber = project.chapters.find((chapter) => chapter.id === chapterId)?.chapterNumber
  const wanted = entries.find((entry) => entry.card.id === chapterId)
    ?? entries.find((entry) => entry.chapterNumber === selectedBodyNumber)
    ?? entries[0]!
  return { card: buildCard(wanted.card, project.chapters) }
}

/** 页面 4 · 剧情步骤。 */
export function buildChapterBeats(project: NovelProject, chapterId?: string): OutlineBeatsModel {
  const target = resolveBeatsTargetCard(project, chapterId)
  if (!target.card) {
    return {
      kind: 'beats',
      beats: [],
      findings: [],
      pendingFindingCount: 0,
      lines: [],
      editable: false,
      notice: BEATS_NOT_EDITABLE,
      targetNotice: target.targetNotice
    }
  }
  const targetCard = target.card
  const card = (project.outline?.volumes ?? [])
    .flatMap((volume) => volume.chapters)
    .find((item) => item.id === targetCard.cardId)!
  return {
    kind: 'beats',
    card: targetCard,
    headline: `第 ${card.chapterNumber} 章《${card.title}》`,
    beats: [...card.beats]
      .sort((left, right) => left.order - right.order)
      .map((beat) => ({
        id: beat.id,
        order: beat.order,
        title: beat.title,
        purpose: beat.purpose,
        conflict: beat.conflict,
        outcome: beat.outcome,
        location: beat.location,
        timeframe: beat.timeframe,
        reveal: beat.reveal,
        characterIds: beat.characterIds,
        threadActions: beat.threadActions
      })),
    beatStatus: card.beatStatus,
    findings: card.beatFindings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      message: finding.message,
      suggestion: finding.suggestion,
      status: finding.status
    })),
    pendingFindingCount: card.beatFindings.filter((finding) => finding.status === '待处理').length,
    lines: (card.lineAssignments ?? []).map((line) => ({
      lineId: line.lineId,
      role: line.role,
      purpose: line.purpose,
      exceptionReason: line.exceptionReason
    })),
    editable: false,
    notice: BEATS_NOT_EDITABLE
  }
}

export type OutlineStorylineModel = {
  id: string
  title: string
  type: string
  status: string
  progressPercent: number
  startChapterNumber?: number
  expectedEndChapterNumber?: number
  finalGoal: string
  nextAction: string
  keyNodes: Array<{ id: string; title: string; targetChapterNumber?: number; status: string }>
  chapterPlans: Array<{ chapterNumber: number; subGoal: string; status: string; changes: string[] }>
  paused: boolean
  pauseReason?: string
  pauseReturnCondition?: string
  pauseReturnPosition?: string
  evidenceCount: number
  unresolvedQuestionCount: number
}

export type OutlineStorylinesModel = {
  kind: 'storylines'
  lines: OutlineStorylineModel[]
  relatedOpenThreadCount: number
  notice?: OutlineCapabilityNotice
}

/** 页面 5 · 重要事件线。只使用项目自身保存的剧情线，不按章节数推测事件。 */
export function buildStorylines(project: NovelProject): OutlineStorylinesModel {
  const raw = project.storylines ?? []
  const lines: OutlineStorylineModel[] = raw.map((line) => ({
    id: line.id,
    title: line.title,
    type: line.type,
    status: line.status,
    progressPercent: Math.round(Math.max(0, Math.min(1, line.currentProgress)) * 100),
    startChapterNumber: line.startChapterNumber,
    expectedEndChapterNumber: line.expectedEndChapterNumber,
    finalGoal: line.finalGoal,
    nextAction: line.nextAction,
    keyNodes: (line.keyNodes ?? []).map((node) => ({
      id: node.id,
      title: node.title,
      targetChapterNumber: node.targetChapterNumber,
      status: node.status
    })),
    chapterPlans: (line.chapterPlans ?? []).map((plan) => ({
      chapterNumber: plan.chapterNumber,
      subGoal: plan.subGoal,
      status: plan.status,
      changes: plan.changes
    })),
    paused: line.status === '计划暂停',
    pauseReason: line.pause?.reason,
    pauseReturnCondition: line.pause?.returnCondition,
    pauseReturnPosition: line.pause?.expectedReturnPosition,
    evidenceCount: (line.evidenceChain ?? []).length,
    unresolvedQuestionCount: (line.unresolvedQuestions ?? []).length
  }))
  return {
    kind: 'storylines',
    lines,
    relatedOpenThreadCount: openPlotThreadCount(project),
    notice: lines.length
      ? undefined
      : {
          id: 'storylines-source',
          title: '项目里还没有剧情线记录',
          detail:
            '重要事件线记录调查、战争、营救等跨章事件。当前项目还没有这样的记录，因此本页不展示任何事件：既不会按章节数量虚构事件，也尚未开放「从章节事件自动归集事件线」的能力。'
        }
  }
}

export type OutlineStructureFindingModel = {
  id: string
  severity: '高' | '中' | '低'
  category: string
  title: string
  detail: string
  chapterNumbers: number[]
}

export type OutlineStructureActionModel = {
  operation: string
  label: string
  enabled: boolean
  reason: string
}

export type OutlineStructureModel = {
  kind: 'structure'
  /** 本地结构检查结果：全部由项目数据现场推导，不调用任何 AI。 */
  findings: OutlineStructureFindingModel[]
  severityCounts: { 高: number; 中: number; 低: number }
  actions: OutlineStructureActionModel[]
  /** 结构操作只能在服务端生成影响评估与待确认候选，当前客户端没有该端点。 */
  operable: false
  notice: OutlineCapabilityNotice
}

export const OUTLINE_STRUCTURE_OPERATIONS: readonly string[] = ['插入章节', '删除章节', '调序', '跨卷移动', '拆分章节', '合并章节']

const STRUCTURE_NOT_CONNECTED: OutlineCapabilityNotice = {
  id: 'structure-edit',
  title: '结构调整需要评估，目前不能直接改动',
  detail:
    '结构调整需要先评估会波及的正文、记忆、伏笔与审稿，并产出待确认的候选。这套评估流程当前尚未开放，所以所有结构操作都处于禁用状态：AI 只能给出候选，不能直接移动、删除或改写正式卷章。'
}

/** 页面 6 · 结构调整。只做本地可确认的结构检查。 */
export function buildOutlineStructure(project: NovelProject): OutlineStructureModel {
  const volumes = buildVolumes(project)
  const cards = volumes.flatMap((volume) => volume.chapters)
  const findings: OutlineStructureFindingModel[] = []
  const outline = project.outline

  if (outline) {
    const missing: string[] = []
    if (!nonEmpty(outline.synopsis)) missing.push('总纲')
    if (!nonEmpty(outline.mainConflict)) missing.push('主冲突')
    if (!nonEmpty(outline.endingDirection)) missing.push('结局方向')
    if (missing.length) {
      findings.push({
        id: 'foundation-fields',
        severity: '中',
        category: '大纲基础',
        title: `总纲缺少${missing.join('、')}`,
        detail: '这些内容决定每卷和每章的方向，缺失时后续规划容易失去约束。',
        chapterNumbers: []
      })
    }
  }

  const cardNumbers = new Set(cards.map((card) => card.chapterNumber))
  const bodyWithoutCard = project.chapters.filter((chapter) => !cardNumbers.has(chapter.chapterNumber))
  if (bodyWithoutCard.length) {
    findings.push({
      id: 'body-without-card',
      severity: '高',
      category: '卷章对应',
      title: `有 ${bodyWithoutCard.length} 章正文没有对应章纲`,
      detail: `${bodyWithoutCard.map((chapter) => `第 ${chapter.chapterNumber} 章`).join('、')}在章纲结构里不存在，调序或跨卷移动时无法被安全追踪。`,
      chapterNumbers: bodyWithoutCard.map((chapter) => chapter.chapterNumber)
    })
  }

  const duplicates = [...cards.reduce((map, card) => {
    map.set(card.chapterNumber, (map.get(card.chapterNumber) ?? 0) + 1)
    return map
  }, new Map<number, number>()).entries()].filter(([, count]) => count > 1).map(([number]) => number)
  if (duplicates.length) {
    findings.push({
      id: 'duplicate-numbers',
      severity: '高',
      category: '章节编号',
      title: `有 ${duplicates.length} 个章节编号重复`,
      detail: `第 ${duplicates.join('、')} 章在章纲里出现多次；编号只表示阅读顺序，重复会让定位与引用产生歧义。`,
      chapterNumbers: duplicates.sort((left, right) => left - right)
    })
  }

  const sorted = [...cardNumbers].sort((left, right) => left - right)
  const gaps: number[] = []
  for (let index = 1; index < sorted.length; index += 1) {
    for (let missing = sorted[index - 1]! + 1; missing < sorted[index]!; missing += 1) gaps.push(missing)
  }
  if (gaps.length) {
    findings.push({
      id: 'number-gaps',
      severity: '低',
      category: '章节编号',
      title: `章节编号有 ${gaps.length} 处缺口`,
      detail: `缺少第 ${gaps.join('、')} 章的章纲；如果这是有意跳过，可忽略本条。`,
      chapterNumbers: gaps
    })
  }

  const unplanned = cards.filter((card) => card.cardStatus === '未规划')
  if (unplanned.length) {
    findings.push({
      id: 'unplanned-cards',
      severity: '低',
      category: '章纲状态',
      title: `有 ${unplanned.length} 章章纲仍是「未规划」`,
      detail: '未规划的章纲没有目标、冲突与转折，正文生成前需要补齐。',
      chapterNumbers: unplanned.map((card) => card.chapterNumber)
    })
  }

  const beatsUnconfirmed = cards.filter((card) => card.beatStatus !== '已确认')
  if (beatsUnconfirmed.length) {
    findings.push({
      id: 'beats-unconfirmed',
      severity: '中',
      category: '剧情步骤',
      title: `有 ${beatsUnconfirmed.length} 章的剧情步骤未确认`,
      detail: `${beatsUnconfirmed.map((card) => `第 ${card.chapterNumber} 章（${card.beatStatus}）`).join('、')}；未确认的步骤不能作为整章生成的依据。`,
      chapterNumbers: beatsUnconfirmed.map((card) => card.chapterNumber)
    })
  }

  const downstream = cards.filter((card) => card.downstreamPending)
  if (downstream.length) {
    findings.push({
      id: 'downstream-review',
      severity: '中',
      category: '上游变更',
      title: `有 ${downstream.length} 章因上游规划变化标记为待复核`,
      detail: downstream.map((card) => `第 ${card.chapterNumber} 章${card.downstreamReason ? `：${card.downstreamReason}` : ''}`).join('；'),
      chapterNumbers: downstream.map((card) => card.chapterNumber)
    })
  }

  const emptyVolumes = volumes.filter((volume) => volume.chapters.length === 0)
  if (emptyVolumes.length) {
    findings.push({
      id: 'empty-volumes',
      severity: '低',
      category: '卷结构',
      title: `有 ${emptyVolumes.length} 卷还没有章节`,
      detail: emptyVolumes.map((volume) => `第 ${volume.volumeNumber} 卷《${volume.title}》`).join('、'),
      chapterNumbers: []
    })
  }

  const volumesMissingGoal = volumes.filter((volume) => !nonEmpty(volume.goal))
  if (volumesMissingGoal.length) {
    findings.push({
      id: 'volumes-missing-goal',
      severity: '中',
      category: '卷结构',
      title: `有 ${volumesMissingGoal.length} 卷没有填写本卷目标`,
      detail: volumesMissingGoal.map((volume) => `第 ${volume.volumeNumber} 卷《${volume.title}》`).join('、'),
      chapterNumbers: []
    })
  }

  const severityCounts = {
    高: findings.filter((finding) => finding.severity === '高').length,
    中: findings.filter((finding) => finding.severity === '中').length,
    低: findings.filter((finding) => finding.severity === '低').length
  }

  return {
    kind: 'structure',
    findings,
    severityCounts,
    actions: OUTLINE_STRUCTURE_OPERATIONS.map((operation) => ({
      operation,
      label: operation,
      enabled: false,
      reason: '需要先评估影响并产出待确认候选；这套流程目前尚未开放，因此不能在这里直接改写正式卷章。'
    })),
    operable: false,
    notice: STRUCTURE_NOT_CONNECTED
  }
}

/**
 * 章节目录里单击章节应当进入「章纲编辑」，而不是正文创作。
 * 抽成纯函数是为了让测试可以直接锁住这个交互契约（stageId 不能是 writing）。
 */
export function resolveChapterOpenTarget(chapterCardId: string): { stageId: 'outline'; subnavId: 'chapter-beats'; chapterId: string } {
  return { stageId: 'outline', subnavId: 'chapter-beats', chapterId: chapterCardId }
}
