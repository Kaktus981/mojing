import type {
  ChapterMemory,
  CharacterState,
  MemoryProposal,
  NovelMemoryHealth,
  NovelPlotThread,
  NovelProject,
  PlotThreadEvidence,
  StoryFact
} from '../../../../../../../packages/contracts/src'

/**
 * 记忆与伏笔 · 五个二级页面的纯数据模型。
 *
 * 三条原则（与前两个栏目一致）：
 *   1. 五个入口必须呈现**不同**内容，可被测试直接证明；
 *   2. 展示值只能来自传入的 `NovelProject` / `memoryProposals` / `memoryHealth`
 *      —— 不补占位、不造假健康度、不造假准备度、不造假百分比；
 *   3. 后端未接通的能力显式建模为 `notice`，页面只如实说明并保持禁用。
 *
 * 本文件额外守住两条本栏目独有的红线：
 *   - **不覆盖/删除旧记录**：正式章节记忆页只读；替换关系只展示真实 `replacesId` 链。
 *   - **未来信息不进入更早章节**：召回严格按 `appliesFromChapter` / 章节号过滤。
 */

export type MemoryPageId = 'memory-workbench' | 'memory-recall' | 'memory-proposals' | 'foreshadowing' | 'memory-ledger'

export const MEMORY_PAGE_IDS: readonly MemoryPageId[] = [
  'memory-workbench',
  'memory-recall',
  'memory-proposals',
  'foreshadowing',
  'memory-ledger'
]

export type MemoryPageKind = 'workbench' | 'recall' | 'proposals' | 'foreshadowing' | 'ledger'

const PAGE_KIND: Record<MemoryPageId, MemoryPageKind> = {
  'memory-workbench': 'workbench',
  'memory-recall': 'recall',
  'memory-proposals': 'proposals',
  foreshadowing: 'foreshadowing',
  'memory-ledger': 'ledger'
}

export function isMemoryPageId(value: string): value is MemoryPageId {
  return (MEMORY_PAGE_IDS as readonly string[]).includes(value)
}

export function memoryPageKind(subnavId: string): MemoryPageKind {
  return isMemoryPageId(subnavId) ? PAGE_KIND[subnavId] : 'workbench'
}

export type MemoryNotice = { id: string; title: string; detail: string }

export const MEMORY_NOTICE_BATCH: MemoryNotice = {
  id: 'memory-batch',
  title: '批量处理会整体校验',
  detail:
    '选中的提案会一起校验；只要有一条已失效或依据发生变化，整批都不会写入。'
}

export const MEMORY_NOTICE_MANUAL: MemoryNotice = {
  id: 'memory-manual',
  title: '分析记忆的摘要可提出修订',
  detail:
    '在章节记忆台账中填写新摘要与原因，提交后进入待确认提案；接受前不会改变正式记忆。作者手写记忆仍可直接维护。'
}

export const MEMORY_NOTICE_THREAD_DELETE: MemoryNotice = {
  id: 'memory-thread-delete',
  title: '作废伏笔',
  detail:
    '需要作废伏笔时，请标记为「已放弃」；证据和历史会保留。'
}

export const MEMORY_NOTICE_RECALL_SCOPE: MemoryNotice = {
  id: 'memory-recall-scope',
  title: '只参考当前章节可用的记忆',
  detail:
    '只参考截至目标章节已生效的记忆；后续章节的信息不会带入。'
}

// ---------------------------------------------------------------- 通用工具

/** 缺省生效起点：契约里 appliesFromChapter 可选，未填写按「从第 1 章起」处理。 */
const DEFAULT_FROM_CHAPTER = 1

type Applicability = { appliesFromChapter?: number; appliesThroughChapter?: number }

/** 该条目在 `chapterNumber` 这一章是否应当被召回。未来信息一律为 false。 */
export function isApplicableAt(item: Applicability, chapterNumber: number): boolean {
  const from = item.appliesFromChapter ?? DEFAULT_FROM_CHAPTER
  if (from > chapterNumber) return false
  const through = item.appliesThroughChapter
  if (through !== undefined && through < chapterNumber) return false
  return true
}

/** 该条目的生效起点是否晚于目标章（即「未来信息」）。 */
export function isFutureFor(item: Applicability, chapterNumber: number): boolean {
  return (item.appliesFromChapter ?? DEFAULT_FROM_CHAPTER) > chapterNumber
}

export function chapterLabel(chapterNumber: number | undefined): string {
  return chapterNumber === undefined ? '未标注章号' : `第 ${chapterNumber} 章`
}

function rangeLabel(item: Applicability): string {
  const from = item.appliesFromChapter
  const through = item.appliesThroughChapter
  if (from === undefined && through === undefined) return '未限定（按第一章起、长期有效）'
  if (from === undefined) return `第 1 章 起 至 ${chapterLabel(through)}`
  if (through === undefined) return `${chapterLabel(from)} 起，长期有效`
  return `${chapterLabel(from)} 至 ${chapterLabel(through)}`
}

export type TargetChapter = {
  id: string
  chapterNumber: number
  title: string
  status: string
  sourceDigest: string
}

export type TargetResolution = {
  chapter?: TargetChapter
  /** 目标章节是怎么定下来的，界面如实标注，不让用户以为一定是自己选的那一章。 */
  source: '已选章节' | '最新章节' | '尚无章节'
}

/**
 * 目标章节：优先用调用方传入的选中章节；没有选中时退回「章号最大的章节」，
 * 并明确标注来源为「最新章节」。
 */
export function resolveTargetChapter(project: NovelProject, preferredChapterId?: string): TargetResolution {
  const selected = preferredChapterId ? project.chapters.find((chapter) => chapter.id === preferredChapterId) : undefined
  if (selected) {
    return { chapter: toTargetChapter(selected), source: '已选章节' }
  }
  const latest = [...project.chapters].sort((a, b) => b.chapterNumber - a.chapterNumber)[0]
  if (!latest) return { source: '尚无章节' }
  return { chapter: toTargetChapter(latest), source: '最新章节' }
}

function toTargetChapter(chapter: NovelProject['chapters'][number]): TargetChapter {
  return {
    id: chapter.id,
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    status: chapter.status,
    sourceDigest: chapter.sourceDigest
  }
}

function countBy<T>(items: readonly T[], pick: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of items) {
    const key = pick(item)
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

/**
 * 目标章涉及的角色 id：来自同名章纲卡上的真实 `characterIds`。
 * 找不到章纲卡就返回空数组（不猜主角是谁）。
 */
export function resolveTargetCharacterIds(project: NovelProject, chapterNumber: number | undefined): string[] {
  if (chapterNumber === undefined) return []
  const volumes = project.outline?.volumes ?? []
  for (const volume of volumes) {
    const card = volume.chapters.find((item) => item.chapterNumber === chapterNumber)
    if (card) return [...card.characterIds]
  }
  return []
}

// ---------------------------------------------------------------- 页面 1 · 记忆工作台

export type MemoryWorkbenchHealth = {
  /** 没有健康检查快照时为 false —— 页面据此显示「未评估」，且不生成任何百分比。 */
  assessed: boolean
  lastSuccessAt?: string
  lastFailureAt?: string
  entries: { key: string; label: string; value: number }[]
}

export type MemoryWorkbenchModel = {
  kind: 'workbench'
  hasProject: boolean
  target?: { chapterNumber: number; title: string; status: string; source: TargetResolution['source'] }
  health: MemoryWorkbenchHealth
  memories: { total: number; formal: number; needsUpdate: number; pendingReview: number }
  proposals: { total: number; pending: number; accepted: number; rejected: number; expired: number }
  threads: { total: number; open: number; overdue: number; protectedFromDelete: number }
  /** 当前目标章的召回摘要（只数真实条目，不给分数）。 */
  recall: { objective: number; cognition: number; futureExcluded: number; layers: { layer: string; count: number }[] }
  todos: { id: string; label: string; detail: string; page: MemoryPageId }[]
}

const HEALTH_FIELDS: readonly { key: keyof NovelMemoryHealth; label: string }[] = [
  { key: 'pendingProposals', label: '待确认提案' },
  { key: 'staleMemories', label: '需更新的章节记忆' },
  { key: 'missingSummaries', label: '缺少摘要' },
  { key: 'unresolvedThreads', label: '未回收伏笔' },
  { key: 'overdueThreads', label: '逾期伏笔' },
  { key: 'unindexedChapters', label: '未索引章节' },
  { key: 'indexedMentions', label: '已索引提及' },
  { key: 'staleOutlineCards', label: '章纲已过期' },
  { key: 'pendingSceneQualityFindings', label: '场景待处理' },
  { key: 'pendingWorldExpansions', label: '世界扩展待确认' },
  { key: 'storylineRisks', label: '事件线风险' },
  { key: 'unresolvedReviews', label: '未处理审稿问题' },
  { key: 'activeJobs', label: '进行中任务' },
  { key: 'failedJobs', label: '失败任务' },
  { key: 'recoverableJobs', label: '可恢复任务' }
]

export function buildMemoryWorkbench(input: {
  project: NovelProject
  proposals: readonly MemoryProposal[]
  health?: NovelMemoryHealth
  targetChapterId?: string
}): MemoryWorkbenchModel {
  const { project, proposals, health } = input
  const resolution = resolveTargetChapter(project, input.targetChapterId)
  const memories = project.memories
  const threads = project.plotThreads

  const healthModel: MemoryWorkbenchHealth = health
    ? {
        assessed: true,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: health.lastFailureAt,
        entries: HEALTH_FIELDS.map((field) => ({
          key: String(field.key),
          label: field.label,
          value: Number(health[field.key] ?? 0)
        }))
      }
    : { assessed: false, entries: [] }

  const recall = resolution.chapter
    ? buildMemoryRecall(project, resolution.chapter.chapterNumber, resolution.source)
    : undefined

  const pending = proposals.filter((proposal) => proposal.status === '待确认')
  const staleMemories = memories.filter((memory) => memory.status === '需更新')

  const todos: MemoryWorkbenchModel['todos'] = []
  if (pending.length > 0) {
    todos.push({
      id: 'pending-proposals',
      label: `${pending.length} 条记忆提案待确认`,
      detail: '未接受的提案不会进入正式上下文。',
      page: 'memory-proposals'
    })
  }
  if (staleMemories.length > 0) {
    todos.push({
      id: 'stale-memories',
      label: `${staleMemories.length} 章正式记忆需更新`,
      detail: '正文摘要已变化，旧记录不会被自动覆盖。',
      page: 'memory-ledger'
    })
  }
  const overdue = threads.filter((thread) => thread.status === '逾期')
  if (overdue.length > 0) {
    todos.push({
      id: 'overdue-threads',
      label: `${overdue.length} 条伏笔已逾期`,
      detail: '查看证据池与状态历史后决定推进或放弃。',
      page: 'foreshadowing'
    })
  }
  if (recall && recall.futureExcluded.count > 0) {
    todos.push({
      id: 'future-excluded',
      label: `${recall.futureExcluded.count} 条记忆因生效范围在目标章之后被排除`,
      detail: `目标章为 ${chapterLabel(recall.chapterNumber)}，这些信息不会进入更早章节。`,
      page: 'memory-recall'
    })
  }

  return {
    kind: 'workbench',
    hasProject: true,
    target: resolution.chapter
      ? {
          chapterNumber: resolution.chapter.chapterNumber,
          title: resolution.chapter.title,
          status: resolution.chapter.status,
          source: resolution.source
        }
      : undefined,
    health: healthModel,
    memories: {
      total: memories.length,
      formal: memories.filter((memory) => memory.status === '正式').length,
      needsUpdate: staleMemories.length,
      pendingReview: memories.filter((memory) => memory.status === '待复核').length
    },
    proposals: {
      total: proposals.length,
      pending: pending.length,
      accepted: proposals.filter((proposal) => proposal.status === '已接受').length,
      rejected: proposals.filter((proposal) => proposal.status === '已拒绝').length,
      expired: proposals.filter((proposal) => proposal.status === '已失效').length
    },
    threads: {
      total: threads.length,
      open: threads.filter((thread) => !['已回收', '已放弃'].includes(thread.status)).length,
      overdue: overdue.length,
      protectedFromDelete: threads.filter((thread) => threadHasHistory(thread)).length
    },
    recall: {
      objective: recall?.objective.length ?? 0,
      cognition: recall?.cognition.length ?? 0,
      futureExcluded: recall?.futureExcluded.count ?? 0,
      layers: recall?.layers ?? []
    },
    todos
  }
}

// ---------------------------------------------------------------- 页面 2 · 长篇记忆召回

export type RecallItem = {
  id: string
  kind: '角色状态' | '剧情事实'
  title: string
  detail: string
  /** 条目所属的正式章节记忆的章号 —— 一定是「≤ 目标章」的真实章号。 */
  sourceChapterNumber: number
  memoryStatus: string
  perspective: '客观事实' | '角色认知'
  knownTo: string[]
  excerpt: string
  blockId?: string
  range: string
  reason: string
  replacesId?: string
  locked: boolean
  layer: string
  evidenceExcerpts: string[]
}

export type MemoryRecallModel = {
  kind: 'recall'
  hasProject: boolean
  chapterNumber?: number
  targetSource: TargetResolution['source']
  objective: RecallItem[]
  cognition: RecallItem[]
  /** 生效起点晚于目标章的条目：被排除，并如实计数。 */
  futureExcluded: { count: number; items: { id: string; label: string; appliesFromChapter: number }[] }
  /** 章号大于目标章的章节记忆档案：整章都不参与召回。 */
  futureChapterMemories: { count: number; chapterNumbers: number[] }
  layers: { layer: string; label: string; count: number }[]
  notice: MemoryNotice
}

/** 状态 → 动态状态层；事实 → 剧情证据层；与契约里 NovelMemoryRecallSchema.layer 的语义一致。 */
const LAYER_FOR_KIND: Record<RecallItem['kind'], string> = {
  角色状态: '动态状态',
  剧情事实: '剧情证据'
}

const LAYER_LABELS: Record<string, string> = {
  稳定事实: '稳定事实',
  动态状态: '动态状态',
  剧情证据: '剧情证据',
  近期正文: '近期正文',
  远期召回: '远期召回'
}

export function buildMemoryRecall(
  project: NovelProject,
  chapterNumber?: number,
  targetSource: TargetResolution['source'] = '已选章节'
): MemoryRecallModel {
  if (chapterNumber === undefined) {
    return {
      kind: 'recall',
      hasProject: true,
      targetSource: '尚无章节',
      objective: [],
      cognition: [],
      futureExcluded: { count: 0, items: [] },
      futureChapterMemories: { count: 0, chapterNumbers: [] },
      layers: [],
      notice: MEMORY_NOTICE_RECALL_SCOPE
    }
  }

  const objective: RecallItem[] = []
  const cognition: RecallItem[] = []
  const futureExcluded: MemoryRecallModel['futureExcluded']['items'] = []
  const futureChapterNumbers: number[] = []

  for (const memory of project.memories) {
    // 未来章节的档案整章不参与：更早章节绝不能读到后来的真相。
    if (memory.chapterNumber > chapterNumber) {
      futureChapterNumbers.push(memory.chapterNumber)
      continue
    }
    for (const fact of memory.facts) {
      const item = toFactItem(project, memory, fact)
      if (isFutureFor(fact, chapterNumber)) {
        futureExcluded.push({ id: fact.id, label: fact.content, appliesFromChapter: fact.appliesFromChapter ?? DEFAULT_FROM_CHAPTER })
        continue
      }
      if (!isApplicableAt(fact, chapterNumber)) continue
      ;(item.perspective === '角色认知' ? cognition : objective).push(item)
    }
    for (const state of memory.characterStates) {
      const item = toStateItem(project, memory, state)
      if (isFutureFor(state, chapterNumber)) {
        futureExcluded.push({
          id: state.id,
          label: `${state.characterName} 的状态`,
          appliesFromChapter: state.appliesFromChapter ?? DEFAULT_FROM_CHAPTER
        })
        continue
      }
      if (!isApplicableAt(state, chapterNumber)) continue
      ;(item.perspective === '角色认知' ? cognition : objective).push(item)
    }
  }

  const all = [...objective, ...cognition]
  const byLayer = countBy(all, (item) => item.layer)
  const layers = Object.keys(byLayer)
    .sort()
    .map((layer) => ({ layer, label: LAYER_LABELS[layer] ?? layer, count: byLayer[layer] ?? 0 }))

  return {
    kind: 'recall',
    hasProject: true,
    chapterNumber,
    targetSource,
    objective,
    cognition,
    futureExcluded: { count: futureExcluded.length, items: futureExcluded },
    futureChapterMemories: {
      count: futureChapterNumbers.length,
      chapterNumbers: [...new Set(futureChapterNumbers)].sort((a, b) => a - b)
    },
    layers,
    notice: MEMORY_NOTICE_RECALL_SCOPE
  }
}

function toFactItem(project: NovelProject, memory: ChapterMemory, fact: StoryFact): RecallItem {
  const perspective = fact.perspective ?? '客观事实'
  return {
    id: fact.id,
    kind: '剧情事实',
    title: `${fact.category}：${fact.content || '未填写内容'}`,
    detail: `${fact.certainty}${fact.locked ? ' · 已锁定' : ''}`,
    sourceChapterNumber: memory.chapterNumber,
    memoryStatus: memory.status,
    perspective,
    knownTo: resolveNames(project, fact.knownToCharacterIds),
    excerpt: fact.source.excerpt,
    blockId: fact.source.blockId,
    range: rangeLabel(fact),
    reason: buildReason(memory, rangeLabel(fact), fact.locked),
    replacesId: fact.replacesId,
    locked: fact.locked,
    layer: LAYER_FOR_KIND['剧情事实'],
    evidenceExcerpts: (fact.knowledgeEvidence ?? []).map((evidence) => evidence.excerpt)
  }
}

function toStateItem(project: NovelProject, memory: ChapterMemory, state: CharacterState): RecallItem {
  const perspective = state.perspective ?? '客观事实'
  const detail = [
    state.location ? `位置：${state.location}` : '',
    state.physicalState ? `状态：${state.physicalState}` : '',
    state.emotion ? `情绪：${state.emotion}` : '',
    state.ability ? `能力：${state.ability}` : ''
  ].filter(Boolean).join(' · ')
  return {
    id: state.id,
    kind: '角色状态',
    title: state.characterName || state.characterId,
    detail: detail || '未填写状态细节',
    sourceChapterNumber: memory.chapterNumber,
    memoryStatus: memory.status,
    perspective,
    knownTo: resolveNames(project, state.knownToCharacterIds),
    excerpt: state.source.excerpt,
    blockId: state.source.blockId,
    range: rangeLabel(state),
    reason: buildReason(memory, rangeLabel(state), false),
    replacesId: state.replacesId,
    locked: false,
    layer: LAYER_FOR_KIND['角色状态'],
    evidenceExcerpts: (state.knowledgeEvidence ?? []).map((evidence) => evidence.excerpt)
  }
}

/** 召回原因只用真实字段拼：来源章节 + 记忆状态 + 生效范围，不做任何启发式猜测。 */
function buildReason(memory: ChapterMemory, range: string, locked: boolean): string {
  return `${chapterLabel(memory.chapterNumber)}${memory.status}记忆 · 生效范围 ${range}${locked ? ' · 已锁定' : ''}`
}

/** knownToCharacterIds 是 id 列表；能在世界观词条里查到名字就显示名字，否则如实显示 id。 */
function resolveNames(project: NovelProject, ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) return []
  const entries = project.worldBible?.entries ?? []
  return ids.map((id) => entries.find((entry) => entry.id === id)?.name ?? id)
}

// ---------------------------------------------------------------- 页面 3 · 记忆变更提案

export type ProposalComparisonSide = { present: boolean; text: string; detail?: string }

export type ProposalRow = {
  id: string
  category: string
  status: string
  risk: string
  confidence: number
  chapterNumber?: number
  chapterTitle: string
  createdAt: string
  targetId?: string
  /** 当前正式值：按 targetId 在正式章节记忆里现查。 */
  current: ProposalComparisonSide
  /** 生成时正式值：提案里的 before 快照。 */
  generated: ProposalComparisonSide
  candidate: ProposalComparisonSide
  candidateJson: string
  /** before 与当前正式值不一致 → 生成之后正式值又变了。 */
  changedSinceGeneration: boolean
  /** 提案基于的正文摘要与章节当前摘要不一致 → 提案可能已过期。 */
  basedOnStaleText: boolean
  digestKnown: boolean
  excerpt: string
  appliesRange: string
}

export type MemoryProposalsModel = {
  kind: 'proposals'
  hasProject: boolean
  pending: ProposalRow[]
  resolved: ProposalRow[]
  expired: ProposalRow[]
  counts: { pending: number; resolved: number; expired: number }
  /** 单条和批量接受/拒绝已接通；分析记忆摘要可提交人工修订提案。 */
  singleResolveAvailable: true
  batch: { enabled: true; notice: MemoryNotice }
  manual: { enabled: true; notice: MemoryNotice }
}

export function buildMemoryProposals(input: {
  project: NovelProject
  proposals: readonly MemoryProposal[]
}): MemoryProposalsModel {
  const { project, proposals } = input
  const rows = proposals.map((proposal) => toProposalRow(project, proposal))
  const pending = rows.filter((row) => row.status === '待确认')
  const expired = rows.filter((row) => row.status === '已失效')
  const resolved = rows.filter((row) => row.status === '已接受' || row.status === '已拒绝')
  return {
    kind: 'proposals',
    hasProject: true,
    pending,
    resolved,
    expired,
    counts: { pending: pending.length, resolved: resolved.length, expired: expired.length },
    singleResolveAvailable: true,
    batch: { enabled: true, notice: MEMORY_NOTICE_BATCH },
    manual: { enabled: true, notice: MEMORY_NOTICE_MANUAL }
  }
}

function toProposalRow(project: NovelProject, proposal: MemoryProposal): ProposalRow {
  const chapter = project.chapters.find((item) => item.id === proposal.chapterId)
  const current = findFormalValue(project, proposal)
  const generatedPresent = proposal.before !== undefined && proposal.before !== null
  const changed = generatedPresent && !sameValue(proposal.before, current.raw)
  const digestKnown = typeof chapter?.sourceDigest === 'string' && chapter.sourceDigest.length > 0 && proposal.sourceDigest.length > 0
  return {
    id: proposal.id,
    category: proposal.category,
    status: proposal.status,
    risk: proposal.risk,
    confidence: proposal.confidence,
    chapterNumber: chapter?.chapterNumber,
    chapterTitle: chapter?.title ?? '未知章节',
    createdAt: proposal.createdAt,
    targetId: proposal.targetId,
    current: { present: current.present, text: current.text, detail: current.detail },
    generated: {
      present: generatedPresent,
      text: generatedPresent ? describeValue(proposal.before) : '生成时没有正式值（新增）'
    },
    candidate: { present: true, text: describeValue(proposal.candidate) },
    candidateJson: safeJson(proposal.candidate),
    changedSinceGeneration: changed,
    basedOnStaleText: digestKnown && chapter?.sourceDigest !== proposal.sourceDigest,
    digestKnown,
    excerpt: proposal.source.excerpt,
    appliesRange: rangeLabel(proposal)
  }
}

/** 在正式章节记忆里按 targetId 查现值；查不到就如实说「未记载」，不编一个出来。 */
function findFormalValue(project: NovelProject, proposal: MemoryProposal): { present: boolean; text: string; detail?: string; raw: unknown } {
  const targetId = proposal.targetId
  if (targetId) {
    for (const memory of project.memories) {
      const fact = memory.facts.find((item) => item.id === targetId)
      if (fact) {
        return {
          present: true,
          text: `${fact.category}：${fact.content}`,
          detail: `第 ${memory.chapterNumber} 章 · ${fact.certainty}${fact.locked ? ' · 已锁定' : ''}`,
          raw: fact
        }
      }
      const state = memory.characterStates.find((item) => item.id === targetId)
      if (state) {
        return {
          present: true,
          text: `${state.characterName}：${state.location || state.emotion || '已记录状态'}`,
          detail: `第 ${memory.chapterNumber} 章 · ${state.physicalState || state.ability || '未填写细节'}`,
          raw: state
        }
      }
    }
    return { present: false, text: `目标记录已不存在（targetId: ${targetId}）`, raw: undefined }
  }

  if (proposal.category === '章节摘要') {
    const memory = project.memories.find((item) => item.chapterId === proposal.chapterId)
    if (memory) {
      return { present: true, text: memory.summary || '摘要为空', detail: `第 ${memory.chapterNumber} 章 · ${memory.status}`, raw: memory }
    }
    return { present: false, text: '该章节还没有正式记忆', raw: undefined }
  }

  return { present: false, text: '未记载（该类别还没有正式记录）', raw: undefined }
}

function sameValue(a: unknown, b: unknown): boolean {
  return safeJson(a) === safeJson(b)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/** 候选项在列表里只给一行摘要；完整内容放进 pre 里由作者自己对照。 */
function describeValue(value: unknown): string {
  if (value === undefined || value === null) return '空值'
  if (typeof value === 'string') return value || '空字符串'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `数组 · ${value.length} 项`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const preferred = ['summary', 'content', 'knowledge', 'description', 'name', 'title']
    for (const key of preferred) {
      const hit = record[key]
      if (typeof hit === 'string' && hit) return hit
    }
    const keys = Object.keys(record)
    return `对象 · ${keys.length} 个字段${keys.length > 0 ? `（${keys.slice(0, 5).join('、')}${keys.length > 5 ? '…' : ''}）` : ''}`
  }
  return String(value)
}

// ---------------------------------------------------------------- 页面 4 · 伏笔中心

export type ThreadEvidenceRow = {
  id: string
  phase: string
  chapterNumber?: number
  excerpt: string
  note: string
  source: string
  status: string
  confidence: number
  legacy: boolean
}

export type ThreadRow = {
  id: string
  title: string
  detail: string
  status: string
  archivedFromStatus?: string
  setup: { chapterNumber?: number; method: string; excerpt?: string }
  payoff: { targetChapter?: number; resolutionChapterNumber?: number; method: string; excerpt?: string }
  evidence: ThreadEvidenceRow[]
  byPhase: { phase: string; count: number }[]
  cognition?: {
    reader: string
    protagonist: string
    others: { name: string; knowledge: string; evidenceCount: number }[]
    gapSummary: string
    updatedAt?: string
  }
  legacyCognitiveGap?: string
  readiness: {
    assessed: boolean
    score?: number
    level?: string
    fulfilled: string[]
    gaps: string[]
    basis: string[]
    recommendation: string
    assessedAt?: string
    legacyRevealReadiness?: number
  }
  history: { id: string; changedAt: string; fromStatus: string; toStatus: string; reason: string; chapterNumber?: number }[]
  protectedFromDelete: boolean
  protectionReasons: string[]
  updatedAt: string
}

export type ForeshadowingModel = {
  kind: 'foreshadowing'
  hasProject: boolean
  threads: ThreadRow[]
  counts: { total: number; open: number; overdue: number; protectedFromDelete: number; unassessedReadiness: number }
  phases: { phase: string; count: number }[]
  notice: MemoryNotice
}

const EVIDENCE_PHASES = ['埋设', '推进', '回收', '旁证', '冲突'] as const

/** 有证据 / 引用 / 状态历史的伏笔：不允许硬删除，页面因此完全不渲染删除入口。 */
export function threadHasHistory(thread: NovelPlotThread): boolean {
  return (
    (thread.evidencePool?.length ?? 0) > 0 ||
    (thread.progress?.length ?? 0) > 0 ||
    (thread.revisionHistory?.length ?? 0) > 0 ||
    thread.setupEvidence !== undefined ||
    thread.resolutionEvidence !== undefined
  )
}

function protectionReasons(thread: NovelPlotThread): string[] {
  const reasons: string[] = []
  if ((thread.evidencePool?.length ?? 0) > 0) reasons.push(`${thread.evidencePool?.length ?? 0} 项证据池记录`)
  if ((thread.progress?.length ?? 0) > 0) reasons.push(`${thread.progress?.length ?? 0} 条推进记录`)
  if ((thread.revisionHistory?.length ?? 0) > 0) reasons.push(`${thread.revisionHistory?.length ?? 0} 条状态历史`)
  if (thread.setupEvidence) reasons.push('埋设原文证据')
  if (thread.resolutionEvidence) reasons.push('回收原文证据')
  return reasons
}

export function buildForeshadowing(project: NovelProject): ForeshadowingModel {
  const threads = project.plotThreads.map((thread) => toThreadRow(project, thread))
  return {
    kind: 'foreshadowing',
    hasProject: true,
    threads,
    counts: {
      total: threads.length,
      open: threads.filter((thread) => !['已回收', '已放弃'].includes(thread.status)).length,
      overdue: threads.filter((thread) => thread.status === '逾期').length,
      protectedFromDelete: threads.filter((thread) => thread.protectedFromDelete).length,
      unassessedReadiness: threads.filter((thread) => !thread.readiness.assessed).length
    },
    phases: EVIDENCE_PHASES.map((phase) => ({
      phase,
      count: threads.reduce((sum, thread) => sum + (thread.byPhase.find((item) => item.phase === phase)?.count ?? 0), 0)
    })),
    notice: MEMORY_NOTICE_THREAD_DELETE
  }
}

function toThreadRow(project: NovelProject, thread: NovelPlotThread): ThreadRow {
  const evidence: ThreadEvidenceRow[] = (thread.evidencePool ?? []).map((item: PlotThreadEvidence) => ({
    id: item.id,
    phase: item.phase,
    chapterNumber: chapterNumberOf(project, item.chapterId),
    excerpt: item.excerpt,
    note: item.note,
    source: item.source,
    status: item.status,
    confidence: item.confidence,
    legacy: false
  }))

  // 旧字段仍然保留：归一化成同一种证据行，但标记 legacy，界面如实区分来源。
  if (thread.setupEvidence) {
    evidence.push(legacyEvidence(project, 'setup', thread.setupEvidence, '埋设'))
  }
  if (thread.resolutionEvidence) {
    evidence.push(legacyEvidence(project, 'resolution', thread.resolutionEvidence, '回收'))
  }
  for (const progress of thread.progress ?? []) {
    evidence.push({
      id: progress.id,
      phase: '推进',
      chapterNumber: chapterNumberOf(project, progress.chapterId),
      excerpt: progress.source.excerpt,
      note: progress.description,
      source: '作者记录',
      status: '有效',
      confidence: 1,
      legacy: true
    })
  }

  const byPhase = EVIDENCE_PHASES.map((phase) => ({ phase, count: evidence.filter((item) => item.phase === phase).length }))

  const cognition = thread.cognition
    ? {
        reader: thread.cognition.reader,
        protagonist: thread.cognition.protagonist,
        others: thread.cognition.otherCharacters.map((item) => ({
          name: item.characterName || item.characterId || '未命名角色',
          knowledge: item.knowledge,
          evidenceCount: item.evidenceIds.length
        })),
        gapSummary: thread.cognition.gapSummary,
        updatedAt: thread.cognition.updatedAt
      }
    : undefined

  const readiness = thread.readiness
    ? {
        assessed: true,
        score: thread.readiness.score,
        level: thread.readiness.level,
        fulfilled: thread.readiness.fulfilled,
        gaps: thread.readiness.gaps,
        basis: thread.readiness.basis,
        recommendation: thread.readiness.recommendation,
        assessedAt: thread.readiness.assessedAt,
        legacyRevealReadiness: thread.revealReadiness
      }
    : {
        assessed: false,
        fulfilled: [],
        gaps: [],
        basis: [],
        recommendation: '',
        legacyRevealReadiness: thread.revealReadiness
      }

  return {
    id: thread.id,
    title: thread.title,
    detail: thread.detail,
    status: thread.status,
    archivedFromStatus: thread.archivedFromStatus,
    setup: {
      chapterNumber: chapterNumberOf(project, thread.setupChapterId),
      method: thread.setupMethod,
      excerpt: thread.setupEvidence?.excerpt
    },
    payoff: {
      targetChapter: thread.targetPayoffChapter,
      resolutionChapterNumber: chapterNumberOf(project, thread.resolutionChapterId),
      method: thread.resolutionMethod,
      excerpt: thread.resolutionEvidence?.excerpt
    },
    evidence,
    byPhase,
    cognition,
    legacyCognitiveGap: thread.cognitiveGap,
    readiness,
    history: (thread.revisionHistory ?? [])
      .map((revision) => ({
        id: revision.id,
        changedAt: revision.changedAt,
        fromStatus: revision.fromStatus,
        toStatus: revision.toStatus,
        reason: revision.reason,
        chapterNumber: chapterNumberOf(project, revision.chapterId)
      }))
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt)),
    protectedFromDelete: threadHasHistory(thread),
    protectionReasons: protectionReasons(thread),
    updatedAt: thread.updatedAt
  }
}

function legacyEvidence(
  project: NovelProject,
  prefix: string,
  source: { chapterId: string; blockId?: string; excerpt: string },
  phase: string
): ThreadEvidenceRow {
  return {
    id: `${prefix}-${source.chapterId}-${source.blockId ?? 'block'}`,
    phase,
    chapterNumber: chapterNumberOf(project, source.chapterId),
    excerpt: source.excerpt,
    note: '来自旧版记录保留的证据，保持原样读取',
    source: '作者记录',
    status: '有效',
    confidence: 1,
    legacy: true
  }
}

function chapterNumberOf(project: NovelProject, chapterId?: string): number | undefined {
  if (!chapterId) return undefined
  return project.chapters.find((chapter) => chapter.id === chapterId)?.chapterNumber
}

// ---------------------------------------------------------------- 页面 5 · 正式章节记忆

/**
 * 一条真实的替换关系。替换是**条目**级的事实：`replacesId` 长在剧情事实 /
 * 角色状态上，章节记忆本身没有该字段。所以台账按条目 id 记录两端，
 * 并带上对端条目所在章节的真实章号（查不到就留空，不猜）。
 */
export type LedgerReplacement = {
  /** 本记录里的条目 id。 */
  itemId: string
  /** 对端条目 id：本记录里的条目取代了它，或它取代了本记录里的条目。 */
  otherItemId: string
  /** 对端条目所在章节的真实章号；查不到时 undefined。 */
  otherChapterNumber?: number
}

export type LedgerRow = {
  id: string
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  status: string
  summary: string
  updatedAt: string
  sourceDigest: string
  /** 与章节当前正文摘要的真实比对结果；任一为空时 undefined（不猜）。 */
  digestMatches?: boolean
  digestNote: string
  keyEvents: string[]
  facts: { total: number; locked: number; byCertainty: { certainty: string; count: number }[] }
  characterStates: { total: number; perspectives: { perspective: string; count: number }[] }
  objectStates: string[]
  timelineEvents: string[]
  styleSignals: string[]
  /** 本记录里的条目取代了别处的条目（依据条目自己的 replacesId）。 */
  replaces: LedgerReplacement[]
  /** 本记录里的条目被别处的条目取代（反向收集：别人 replacesId === 本条目 id）。 */
  replacedBy: LedgerReplacement[]
  excerpts: string[]
}

export type MemoryLedgerModel = {
  kind: 'ledger'
  hasProject: boolean
  rows: LedgerRow[]
  counts: { total: number; formal: number; needsUpdate: number; pendingReview: number; withReplacementChain: number }
  /** 台账只读；页首可提交人工摘要修订提案。 */
  readOnly: true
  manual: { enabled: true; notice: MemoryNotice }
}

export function buildMemoryLedger(project: NovelProject): MemoryLedgerModel {
  const index = indexMemoryItems(project)
  const rows = [...project.memories]
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((memory) => toLedgerRow(project, memory, index))

  return {
    kind: 'ledger',
    hasProject: true,
    rows,
    counts: {
      total: rows.length,
      formal: rows.filter((row) => row.status === '正式').length,
      needsUpdate: rows.filter((row) => row.status === '需更新').length,
      pendingReview: rows.filter((row) => row.status === '待复核').length,
      withReplacementChain: rows.filter((row) => row.replaces.length > 0 || row.replacedBy.length > 0).length
    },
    readOnly: true,
    manual: { enabled: true, notice: MEMORY_NOTICE_MANUAL }
  }
}

type ItemLocation = { itemId: string; memoryId: string; chapterNumber: number }

/**
 * 替换关系只存在于**条目层级**（剧情事实 / 角色状态各自带 replacesId），
 * 章节记忆本身没有该字段。所以台账按条目 id 建索引，正反两个方向都只读真实字段，
 * 不按章节去猜「谁取代了谁」。
 */
function indexMemoryItems(project: NovelProject): {
  byId: Map<string, ItemLocation>
  /** key = 被取代的条目 id，value = 声明取代它的条目所在位置。 */
  incoming: Map<string, ItemLocation[]>
} {
  const byId = new Map<string, ItemLocation>()
  const incoming = new Map<string, ItemLocation[]>()
  for (const memory of project.memories) {
    for (const item of [...memory.facts, ...memory.characterStates]) {
      byId.set(item.id, { itemId: item.id, memoryId: memory.id, chapterNumber: memory.chapterNumber })
      const replacesId = item.replacesId
      if (!replacesId) continue
      const list = incoming.get(replacesId) ?? []
      list.push({ itemId: item.id, memoryId: memory.id, chapterNumber: memory.chapterNumber })
      incoming.set(replacesId, list)
    }
  }
  return { byId, incoming }
}

function toLedgerRow(
  project: NovelProject,
  memory: ChapterMemory,
  index: { byId: Map<string, ItemLocation>; incoming: Map<string, ItemLocation[]> }
): LedgerRow {
  const chapter = project.chapters.find((item) => item.id === memory.chapterId)
  const digestKnown = Boolean(memory.sourceDigest) && Boolean(chapter?.sourceDigest)
  const digestMatches = digestKnown ? memory.sourceDigest === chapter?.sourceDigest : undefined

  const certainty = countBy(memory.facts, (fact) => fact.certainty)
  const perspectives = countBy(memory.characterStates, (state) => state.perspective ?? '客观事实')

  const excerpts = [
    ...memory.facts.map((fact) => fact.source.excerpt),
    ...memory.characterStates.map((state) => state.source.excerpt),
    ...memory.facts.flatMap((fact) => (fact.knowledgeEvidence ?? []).map((evidence) => evidence.excerpt))
  ].filter((text) => text.trim().length > 0)

  const replaces: LedgerReplacement[] = []
  const replacedBy: LedgerReplacement[] = []
  for (const item of [...memory.facts, ...memory.characterStates]) {
    if (item.replacesId) {
      replaces.push({
        itemId: item.id,
        otherItemId: item.replacesId,
        otherChapterNumber: index.byId.get(item.replacesId)?.chapterNumber
      })
    }
    for (const other of index.incoming.get(item.id) ?? []) {
      replacedBy.push({ itemId: item.id, otherItemId: other.itemId, otherChapterNumber: other.chapterNumber })
    }
  }

  return {
    id: memory.id,
    chapterId: memory.chapterId,
    chapterNumber: memory.chapterNumber,
    chapterTitle: chapter?.title ?? '章节已不存在',
    status: memory.status,
    summary: memory.summary,
    updatedAt: memory.updatedAt,
    sourceDigest: memory.sourceDigest,
    digestMatches,
    digestNote:
      digestMatches === undefined
        ? '缺少摘要比对依据（正文摘要或记忆摘要为空），不做推断'
        : digestMatches
          ? '记忆摘要与正文当前摘要一致'
          : '正文摘要已变化：记忆里的定稿状态可能已经过期',
    keyEvents: memory.keyEvents,
    facts: {
      total: memory.facts.length,
      locked: memory.facts.filter((fact) => fact.locked).length,
      byCertainty: Object.keys(certainty)
        .sort()
        .map((key) => ({ certainty: key, count: certainty[key] ?? 0 }))
    },
    characterStates: {
      total: memory.characterStates.length,
      perspectives: Object.keys(perspectives)
        .sort()
        .map((key) => ({ perspective: key, count: perspectives[key] ?? 0 }))
    },
    objectStates: memory.objectStates,
    timelineEvents: memory.timelineEvents,
    styleSignals: memory.styleSignals,
    replaces,
    replacedBy,
    excerpts
  }
}
