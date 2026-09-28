import { createHash, randomUUID } from 'node:crypto'
import type { Chapter, ChapterMemory, CharacterState, MemoryPerspective, MemoryProposal, NovelProject, NovelPlotThread, ProseBlock, StoryFact } from '../../contracts/src/novel'
import type { NovelMemoryRecall, NovelMemoryLayer } from '../../contracts/src/novelApi'
import { planMemoryProposalBatch, type MemoryProposalBatchBlocker, type MemoryProposalBatchDecision, type MemoryProposalFact } from '../../contracts/src/novel'

export interface MemoryResolveOptions {
  /** 默认同时返回两条轨道，调用方可显式限制为一条轨道。 */
  perspective?: MemoryPerspective | '全部'
  /** 角色认知轨道只对列出的角色可见；客观事实轨道忽略此筛选。 */
  characterIds?: string[]
}

export function chapterDigest(chapter: Chapter): string {
  return createHash('sha256').update(JSON.stringify({ title: chapter.title, blocks: chapter.blocks })).digest('hex')
}

export function normalizeProse(text: string, previous: ProseBlock[] = []): ProseBlock[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  return paragraphs.map((paragraph, index) => ({ id: previous[index]?.text === paragraph ? previous[index]!.id : randomUUID(), text: paragraph }))
}

export function chapterText(chapter: Chapter): string {
  return chapter.blocks.map((block) => block.text).join('\n\n')
}

export function wordCount(project: NovelProject): number {
  return project.chapters.reduce((sum, chapter) => sum + chapter.blocks.reduce((chapterSum, block) => chapterSum + block.text.replace(/\s/g, '').length, 0), 0)
}

export function reconcileNovelAfterEdit(current: NovelProject, input: NovelProject): NovelProject {
  const changedNumbers: number[] = []
  for (const chapter of input.chapters) {
    const before = current.chapters.find((item) => item.id === chapter.id)
    const digest = chapterDigest(chapter)
    chapter.sourceDigest = digest
    if (before && chapterDigest(before) !== digest) changedNumbers.push(chapter.chapterNumber)
    const memory = input.memories.find((item) => item.chapterId === chapter.id)
    if (memory && memory.sourceDigest !== digest) memory.status = '需更新'
  }
  for (const branch of input.branches) {
    if (branch.sourceDigest || current.branches.some((item) => item.id === branch.id)) continue
    const source = input.chapters.find((item) => item.id === branch.baseChapterId)
    if (source) branch.sourceDigest = source.sourceDigest
  }
  if (changedNumbers.length) {
    const earliest = Math.min(...changedNumbers)
    for (const memory of input.memories) {
      if (memory.chapterNumber > earliest && memory.status === '正式') memory.status = '待复核'
    }
    for (const review of input.reviews) {
      const chapter = input.chapters.find((item) => item.id === review.chapterId)
      if (chapter && chapter.chapterNumber >= earliest && review.status === '已完成') review.status = '待处理'
    }
  }
  return input
}

export function invalidateMemoryProposals(proposals: MemoryProposal[], project: NovelProject): MemoryProposal[] {
  return proposals.map((proposal) => {
    if (proposal.status !== '待确认') return proposal
    const chapter = project.chapters.find((item) => item.id === proposal.chapterId)
    return !chapter || chapterDigest(chapter) !== proposal.sourceDigest ? { ...proposal, status: '已失效' as const } : proposal
  })
}

export function applyAcceptedMemory(project: NovelProject, proposal: MemoryProposal, candidateOverride?: unknown): void {
  const chapter = project.chapters.find((item) => item.id === proposal.chapterId)
  if (!chapter) throw new Error('找不到记忆提案对应的章节。')
  if (chapterDigest(chapter) !== proposal.sourceDigest) throw new Error('章节内容已经变化，此记忆提案已失效，请重新分析。')
  const candidate = candidateOverride ?? proposal.candidate
  const now = new Date().toISOString()
  let memory = project.memories.find((item) => item.chapterId === chapter.id)
  if (!memory) {
    memory = {
      id: randomUUID(), chapterId: chapter.id, chapterNumber: chapter.chapterNumber, status: '正式', sourceDigest: proposal.sourceDigest,
      summary: '', keyEvents: [], characterStates: [], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: now
    }
    project.memories.push(memory)
  }
  memory.sourceDigest = proposal.sourceDigest
  memory.status = '正式'
  memory.updatedAt = now
  if (proposal.category === '章节摘要') {
    const nextSummary = String(candidate ?? '')
    if (memory.summary && memory.summary !== nextSummary) {
      memory.editHistory = [...(memory.editHistory ?? []), { changedAt: now, summary: memory.summary, keyEvents: [...memory.keyEvents] }]
    }
    memory.summary = nextSummary
  }
  else if (proposal.category === '角色状态') {
    const normalized = withApplicability(candidate, proposal, chapter.chapterNumber) as CharacterState
    closeReplacedItem(project.memories.flatMap((item) => item.characterStates), normalized)
    memory.characterStates = upsertById(memory.characterStates, normalized)
  } else if (proposal.category === '剧情事实' || proposal.category === '关系变化' || proposal.category === '知识变化') {
    const normalized = withApplicability(candidate, proposal, chapter.chapterNumber, proposal.category === '知识变化' ? '角色认知' : undefined) as StoryFact
    closeReplacedItem(project.memories.flatMap((item) => item.facts), normalized)
    memory.facts = upsertById(memory.facts, normalized)
  }
  else if (proposal.category === '道具状态') {
    if (proposal.reason && proposal.targetId) memory.objectStates = memory.objectStates.map((item) => item === proposal.targetId ? String(candidate) : item)
    else memory.objectStates = appendUnique(memory.objectStates, candidate)
  }
  else if (proposal.category === '时间事件') {
    if (proposal.reason && proposal.targetId) memory.timelineEvents = memory.timelineEvents.map((item) => item === proposal.targetId ? String(candidate) : item)
    else memory.timelineEvents = appendUnique(memory.timelineEvents, candidate)
  }
  else if (proposal.category === '伏笔') applyThreadCandidate(project, candidate, proposal)
}

/** 人工修订提案使用的正式值快照；仅有实际存在的记录才可被修订。 */
export function memoryRevisionTarget(project: NovelProject, chapterId: string, category: MemoryProposal['category'], targetId?: string): unknown {
  const memory = project.memories.find((item) => item.chapterId === chapterId)
  if (category === '章节摘要') {
    if (!memory) throw new Error('这一章还没有正式记忆可修订。')
    return memory.summary
  }
  if (!targetId) throw new Error('请选择要修订的正式记录。')
  if (category === '伏笔') {
    const thread = project.plotThreads.find((item) => item.id === targetId)
    if (!thread) throw new Error('要修订的伏笔不存在。')
    return thread
  }
  if (!memory) throw new Error('这一章还没有正式记忆可修订。')
  const entries = category === '角色状态' ? memory.characterStates
    : category === '道具状态' ? memory.objectStates
      : category === '时间事件' ? memory.timelineEvents : memory.facts
  const target = (entries as unknown[]).find((item) => typeof item === 'string' ? item === targetId : typeof item === 'object' && item !== null && 'id' in item && item.id === targetId)
  if (target === undefined) throw new Error('要修订的正式记录不存在或不属于该章节。')
  return target
}

export function memoryRevisionTargetDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

export interface MemoryProposalBatchFailure { ok: false; blockers: MemoryProposalBatchBlocker[] }
export type MemoryProposalBatchResult = { ok: true; project: NovelProject; appliedProposalIds: string[] } | MemoryProposalBatchFailure

/**
 * 记忆提案的批量接受。语义是全成或全不成：任一提案不存在、已失效、状态冲突、
 * 项目版本变化、来源正文变化或缺少原文证据时，整批都不写入正式记忆。
 *
 * 函数本身是纯的：只在项目副本上应用，失败时原项目与调用方数据完全不变；
 * 数据库事务由调用方负责，把副本一次写入即可保证原子性。
 */
export function applyMemoryProposalBatch(
  project: NovelProject,
  proposals: readonly MemoryProposal[],
  decisions: readonly MemoryProposalBatchDecision[],
  currentRevision: number
): MemoryProposalBatchResult {
  if (project.revision !== currentRevision) {
    return { ok: false, blockers: [{ proposalId: decisions[0]?.proposalId ?? '', code: '项目版本变化', message: '项目版本已变化，请重新校验提案依据后再接受。' }] }
  }
  const facts: MemoryProposalFact[] = decisions.flatMap((decision) => {
    const proposal = proposals.find((item) => item.id === decision.proposalId)
    if (!proposal) return []
    const chapter = project.chapters.find((item) => item.id === proposal.chapterId)
    return [{
      id: proposal.id,
      status: proposal.status,
      sourceDigest: proposal.sourceDigest,
      currentSourceDigest: chapter ? chapterDigest(chapter) : '缺少对应章节',
      proposalTargetDigest: proposal.baseTargetDigest,
      currentTargetDigest: proposal.baseTargetDigest ? (() => {
        try { return memoryRevisionTargetDigest(memoryRevisionTarget(project, proposal.chapterId, proposal.category, proposal.targetId)) }
        catch { return '目标已不存在' }
      })() : undefined,
      hasSourceEvidence: Boolean(proposal.source?.excerpt?.trim())
    }]
  })
  const plan = planMemoryProposalBatch(decisions, facts, currentRevision)
  if (plan.status !== '全部成功') return { ok: false, blockers: plan.blockers }

  const acceptedTargets = new Set<string>()
  for (const decision of decisions) {
    if (decision.status !== '已接受') continue
    const proposal = proposals.find((item) => item.id === decision.proposalId)!
    if (!proposal.targetId && proposal.category !== '章节摘要') continue
    const bucket = ['剧情事实', '关系变化', '知识变化'].includes(proposal.category) ? '事实' : proposal.category
    const target = `${bucket}:${proposal.category === '伏笔' ? '' : proposal.chapterId}:${proposal.targetId ?? ''}`
    if (acceptedTargets.has(target)) {
      return { ok: false, blockers: [{ proposalId: proposal.id, code: '提案状态冲突', message: '同一批中有多条提案修改同一正式记录，请分开确认。' }] }
    }
    acceptedTargets.add(target)
  }

  const next = structuredClone(project)
  const appliedProposalIds: string[] = []
  for (const decision of decisions) {
    if (decision.status !== '已接受') continue
    const proposal = proposals.find((item) => item.id === decision.proposalId)
    if (!proposal) continue
    try {
      applyAcceptedMemory(next, proposal, decision.candidate)
    } catch {
      return { ok: false, blockers: [{ proposalId: proposal.id, code: '提案已失效', message: '提案依据已变化，整批未写入正式记忆。' }] }
    }
    appliedProposalIds.push(proposal.id)
  }
  return { ok: true, project: next, appliedProposalIds }
}

function upsertById<T extends { id: string }>(items: T[], value: unknown): T[] {
  const candidate = value as T
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string') throw new Error('记忆候选缺少稳定编号。')
  const index = items.findIndex((item) => item.id === candidate.id)
  if (index < 0) return [...items, candidate]
  return items.map((item, itemIndex) => itemIndex === index ? candidate : item)
}

function appendUnique(items: string[], value: unknown): string[] {
  const values = Array.isArray(value) ? value.map(String) : [String(value ?? '')]
  return [...new Set([...items, ...values.map((item) => item.trim()).filter(Boolean)])]
}

function withApplicability(value: unknown, proposal: MemoryProposal, sourceChapter: number, defaultPerspective?: MemoryPerspective): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('记忆候选格式不正确。')
  const candidate = value as Record<string, unknown>
  return {
    ...candidate,
    appliesFromChapter: proposal.appliesFromChapter ?? candidate.appliesFromChapter ?? sourceChapter,
    appliesThroughChapter: proposal.appliesThroughChapter ?? candidate.appliesThroughChapter,
    replacesId: proposal.replacesId ?? candidate.replacesId,
    perspective: candidate.perspective ?? defaultPerspective ?? '客观事实',
    knownToCharacterIds: Array.isArray(candidate.knownToCharacterIds) ? candidate.knownToCharacterIds.map(String) : [],
    knowledgeEvidence: Array.isArray(candidate.knowledgeEvidence) ? candidate.knowledgeEvidence : []
  }
}

function closeReplacedItem<T extends { id: string; appliesFromChapter?: number; appliesThroughChapter?: number; replacesId?: string }>(items: T[], replacement: T): void {
  if (!replacement.replacesId) return
  const replaced = items.find((item) => item.id === replacement.replacesId)
  if (!replaced) return
  const replacementStart = replacement.appliesFromChapter ?? 1
  const replacedStart = replaced.appliesFromChapter ?? 1
  if (replacementStart > replacedStart) replaced.appliesThroughChapter = replacementStart - 1
}

function applyThreadCandidate(project: NovelProject, value: unknown, proposal: MemoryProposal): void {
  const candidate = value as NovelPlotThread
  if (!candidate || typeof candidate !== 'object') throw new Error('伏笔候选格式不正确。')
  const previous = project.plotThreads.find((item) => item.id === (candidate.id || proposal.targetId))
  const normalized: NovelPlotThread = {
    ...candidate,
    id: candidate.id || proposal.targetId || randomUUID(),
    revisionHistory: [...(previous?.revisionHistory ?? candidate.revisionHistory ?? []), ...(previous && previous.status !== candidate.status ? [{
      id: randomUUID(), changedAt: new Date().toISOString(), fromStatus: previous.status, toStatus: candidate.status,
      chapterId: proposal.chapterId, reason: '章节记忆提案已确认', evidence: proposal.source
    }] : [])],
    updatedAt: new Date().toISOString()
  }
  const index = project.plotThreads.findIndex((item) => item.id === normalized.id)
  if (index < 0) project.plotThreads.push(normalized)
  else project.plotThreads[index] = normalized
}

export function memoryHealth(project: NovelProject, proposals: MemoryProposal[]): { stale: number; pending: number; unresolvedThreads: number } {
  return {
    stale: project.memories.filter((item) => item.status !== '正式').length,
    pending: proposals.filter((item) => item.status === '待确认').length,
    unresolvedThreads: project.plotThreads.filter((item) => ['计划', '已埋设', '推进中', '逾期'].includes(item.status)).length
  }
}

export function compactMemory(memory: ChapterMemory, targetChapter?: number, includeTemporal = true): unknown {
  const characterStates = includeTemporal ? (targetChapter ? memory.characterStates.filter((item) => isApplicable(item, memory.chapterNumber, targetChapter)) : memory.characterStates) : []
  const facts = includeTemporal ? (targetChapter ? memory.facts.filter((item) => item.certainty !== '废弃' && isApplicable(item, memory.chapterNumber, targetChapter)) : memory.facts) : []
  return {
    chapterNumber: memory.chapterNumber,
    summary: memory.summary,
    keyEvents: memory.keyEvents,
    characterStates,
    facts,
    // 保留兼容字段的同时按事实视角分组，方便生成器和审校器明确区分两条记忆轨道。
    tracks: {
      objectiveFacts: { characterStates: characterStates.filter((item) => item.perspective !== '角色认知'), facts: facts.filter((item) => item.perspective !== '角色认知') },
      characterKnowledge: { characterStates: characterStates.filter((item) => item.perspective === '角色认知'), facts: facts.filter((item) => item.perspective === '角色认知') }
    },
    objectStates: memory.objectStates,
    timelineEvents: memory.timelineEvents
  }
}

export function resolveCharacterStates(memories: ChapterMemory[], targetChapter: number, options: MemoryResolveOptions = {}): CharacterState[] {
  return resolveCharacterStateRows(memories, targetChapter, options).map(({ item }) => item)
}

/** 便捷读取角色认知轨道，避免调用方意外把所有角色的认知都注入上下文。 */
export function resolveCharacterKnowledge(memories: ChapterMemory[], targetChapter: number, characterIds: string[] = []): CharacterState[] {
  if (!characterIds.length) return []
  return resolveCharacterStates(memories, targetChapter, { perspective: '角色认知', characterIds })
}

function resolveCharacterStateRows(memories: ChapterMemory[], targetChapter: number, options: MemoryResolveOptions): Array<{ item: CharacterState; sourceChapter: number; memoryId: string }> {
  const rows = memories
    .filter((memory) => memory.status === '正式' && memory.chapterNumber <= targetChapter)
    .flatMap((memory) => memory.characterStates.map((item) => ({ item: normalizeCharacterState(item), sourceChapter: memory.chapterNumber, memoryId: memory.id })))
  const replacedIds = new Set(rows.filter(({ item, sourceChapter }) => item.replacesId && effectiveStart(item, sourceChapter) <= targetChapter).map(({ item }) => item.replacesId!))
  const perspective = options.perspective ?? '全部'
  const allowedCharacterIds = options.characterIds ? new Set(options.characterIds) : undefined
  const current = rows.filter(({ item, sourceChapter }) => {
    if (replacedIds.has(item.id) || !isApplicable(item, sourceChapter, targetChapter)) return false
    if (perspective !== '全部' && (item.perspective ?? '客观事实') !== perspective) return false
    return (item.perspective ?? '客观事实') !== '角色认知' || !allowedCharacterIds || (item.knownToCharacterIds ?? []).some((id) => allowedCharacterIds.has(id))
  })
  const latest = new Map<string, { item: CharacterState; sourceChapter: number; memoryId: string }>()
  for (const row of current) {
    const previous = latest.get(`${row.item.characterId}:${row.item.perspective}`)
    if (!previous || compareTemporalRows(previous, row) <= 0) latest.set(`${row.item.characterId}:${row.item.perspective}`, row)
  }
  return [...latest.values()]
}

export function resolveStoryFacts(memories: ChapterMemory[], targetChapter: number, options: MemoryResolveOptions = {}): StoryFact[] {
  return resolveStoryFactRows(memories, targetChapter, options).map(({ item }) => item)
}

function resolveStoryFactRows(memories: ChapterMemory[], targetChapter: number, options: MemoryResolveOptions): Array<{ item: StoryFact; sourceChapter: number; memoryId: string }> {
  const rows = memories
    .filter((memory) => memory.status === '正式' && memory.chapterNumber <= targetChapter)
    .flatMap((memory) => memory.facts.map((item) => ({ item: normalizeStoryFact(item), sourceChapter: memory.chapterNumber, memoryId: memory.id })))
  const replacedIds = new Set(rows.filter(({ item, sourceChapter }) => item.replacesId && effectiveStart(item, sourceChapter) <= targetChapter).map(({ item }) => item.replacesId!))
  const perspective = options.perspective ?? '全部'
  const allowedCharacterIds = options.characterIds ? new Set(options.characterIds) : undefined
  return rows
    .filter(({ item, sourceChapter }) => item.certainty !== '废弃' && !replacedIds.has(item.id) && isApplicable(item, sourceChapter, targetChapter))
    .filter(({ item }) => (perspective === '全部' || (item.perspective ?? '客观事实') === perspective) && ((item.perspective ?? '客观事实') !== '角色认知' || !allowedCharacterIds || (item.knownToCharacterIds ?? []).some((id) => allowedCharacterIds.has(id))))
    .sort(compareTemporalRows)
}

/** 旧版本项目可能没有双轨字段；读取时将其解释为客观事实且不改变原项目。 */
function normalizeCharacterState(item: CharacterState): CharacterState {
  const legacy = item as CharacterState & { perspective?: MemoryPerspective; knownToCharacterIds?: string[]; knowledgeEvidence?: CharacterState['knowledgeEvidence'] }
  return { ...item, perspective: legacy.perspective ?? '客观事实', knownToCharacterIds: legacy.knownToCharacterIds ?? [], knowledgeEvidence: legacy.knowledgeEvidence ?? [] }
}

function normalizeStoryFact(item: StoryFact): StoryFact {
  const legacy = item as StoryFact & { perspective?: MemoryPerspective; knownToCharacterIds?: string[]; knowledgeEvidence?: StoryFact['knowledgeEvidence'] }
  return { ...item, perspective: legacy.perspective ?? '客观事实', knownToCharacterIds: legacy.knownToCharacterIds ?? [], knowledgeEvidence: legacy.knowledgeEvidence ?? [] }
}

/**
 * 返回当前章节实际可用的记忆及来源证据。reason 是稳定的业务解释，供
 * 上下文预览/记忆面板使用，不依赖 JSON 字段路径，也不修改原始记忆。
 */
export function explainMemoryRecall(memories: ChapterMemory[], targetChapter: number, options: MemoryResolveOptions = {}): NovelMemoryRecall[] {
  const states = resolveCharacterStateRows(memories, targetChapter, options)
  const facts = resolveStoryFactRows(memories, targetChapter, options)
  return [...states.map(({ item, sourceChapter, memoryId }) => recallRecord(memoryId, item.id, '角色状态', item, item.source, item.perspective ?? '客观事实', item.knownToCharacterIds ?? [], sourceChapter, targetChapter, '动态状态')), ...facts.map(({ item, sourceChapter, memoryId }) => recallRecord(memoryId, item.id, '剧情事实', item, item.source, item.perspective ?? '客观事实', item.knownToCharacterIds ?? [], sourceChapter, targetChapter, '剧情证据'))]
    .sort((a, b) => a.sourceChapterNumber - b.sourceChapterNumber || a.itemId.localeCompare(b.itemId))
}

function recallRecord(memoryId: string, itemId: string, category: '角色状态' | '剧情事实', item: CharacterState | StoryFact, source: CharacterState['source'], perspective: MemoryPerspective, knownToCharacterIds: string[], sourceChapter: number, targetChapter: number, layer: NovelMemoryLayer): NovelMemoryRecall {
  const start = item.appliesFromChapter ?? sourceChapter
  const end = item.appliesThroughChapter
  const timing = end ? `第${start}至${end}章生效` : `从第${start}章起生效`
  const lens = perspective === '角色认知' ? '角色认知轨道' : '客观事实轨道'
  const evidence = [...((item as CharacterState | StoryFact).knowledgeEvidence ?? []), source].filter((candidate, index, all) => all.findIndex((other) => other.chapterId === candidate.chapterId && other.blockId === candidate.blockId && other.excerpt === candidate.excerpt) === index)
  const knowledgeHint = perspective === '角色认知' ? (knownToCharacterIds.length ? `，已标记 ${knownToCharacterIds.length} 名知情角色` : '，尚未标记具体知情角色') : ''
  return { memoryId, itemId, category, perspective, source: { ...source }, sourceChapterNumber: sourceChapter, appliesFromChapter: start, appliesThroughChapter: end, knownToCharacterIds: [...knownToCharacterIds], item, recallReason: `来源于第${sourceChapter}章的${lens}，${timing}${knowledgeHint}，当前生成目标为第${targetChapter}章。`, layer, evidence }
}

function effectiveStart(item: { appliesFromChapter?: number }, sourceChapter: number): number {
  return item.appliesFromChapter ?? sourceChapter
}

function isApplicable(item: { appliesFromChapter?: number; appliesThroughChapter?: number }, sourceChapter: number, targetChapter: number): boolean {
  return effectiveStart(item, sourceChapter) <= targetChapter && (item.appliesThroughChapter === undefined || targetChapter <= item.appliesThroughChapter)
}

function compareTemporalRows<T extends { appliesFromChapter?: number }>(left: { item: T; sourceChapter: number }, right: { item: T; sourceChapter: number }): number {
  return effectiveStart(left.item, left.sourceChapter) - effectiveStart(right.item, right.sourceChapter) || left.sourceChapter - right.sourceChapter
}
