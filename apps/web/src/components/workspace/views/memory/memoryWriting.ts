/**
 * M6 · 记忆与伏笔的手写通道（纯函数）。
 *
 * 两条不可越过的边界：
 *   1. **不伪造证据**：伏笔的「埋设 / 推进 / 实际回收」都必须带上真实证据。
 *      证据要么来自正文里真实存在的段落（章节 + 段落 + 摘录），
 *      要么明确写成「作者手动说明」并保留作者自己的话，绝不凭空生成引用。
 *   2. **不冒充正文已证实**：作者手写的正式记忆 `sourceDigest` 留空，
 *      表示它没有与正文摘要绑定；台账里据此把它标成「作者手写」。
 *      AI 提取出来的记忆（`sourceDigest` 非空）不在这里直接改写，
 *      仍然只能走记忆变更提案——避免静默覆盖服务端分析结果。
 */

export const PLOT_THREAD_STATUS_OPTIONS = ['计划', '已埋设', '推进中', '已回收', '已放弃', '逾期'] as const
export const PLOT_THREAD_TEXT_FIELDS = ['title', 'detail', 'setupMethod', 'resolutionMethod'] as const
export type PlotThreadTextField = (typeof PLOT_THREAD_TEXT_FIELDS)[number]

/** 作者手动说明的固定前缀：让「这不是正文引用」在数据里就看得出来。 */
export const MANUAL_EVIDENCE_PREFIX = '作者手动说明：'

export type WriteResult = { ok: boolean; message?: string }

export type EvidenceDraft = { chapterId: string; blockId?: string; excerpt: string }

export type PlotThreadDraft = {
  id: string
  title: string
  detail: string
  characterIds: string[]
  status: string
  setupChapterId?: string
  setupMethod: string
  setupEvidence?: EvidenceDraft
  targetPayoffChapter?: number
  resolutionChapterId?: string
  resolutionMethod: string
  resolutionEvidence?: EvidenceDraft
  progress: Array<{ id: string; chapterId: string; description: string; source: EvidenceDraft }>
  revealReadiness?: number
  cognitiveGap?: string
  archiveReason?: string
  archivedAt?: string
  archivedFromStatus?: string
  revisionHistory?: Array<{ id: string; changedAt: string; fromStatus: string; toStatus: string; reason: string }>
  updatedAt: string
}

export type ChapterMemoryDraft = {
  id: string
  chapterId: string
  chapterNumber: number
  status: string
  sourceDigest: string
  summary: string
  keyEvents: string[]
  characterStates: unknown[]
  facts: unknown[]
  objectStates: string[]
  timelineEvents: string[]
  styleSignals: string[]
  editHistory?: Array<{ changedAt: string; summary: string; keyEvents: string[] }>
  updatedAt: string
}

export type MemoryWritingDraft = {
  plotThreads: PlotThreadDraft[]
  memories: ChapterMemoryDraft[]
  chapters: Array<{ id: string; chapterNumber: number; blocks: Array<{ id: string; text: string }> }>
}

/** 作者手写记忆的判据：没有与正文摘要绑定。 */
export function isAuthorWrittenMemory(memory: Pick<ChapterMemoryDraft, 'sourceDigest'>): boolean {
  return !memory.sourceDigest
}

/* ------------------------------------------------------------------ *
 * 伏笔
 * ------------------------------------------------------------------ */

export function applyAddPlotThread(
  draft: MemoryWritingDraft,
  input: { title: string; detail?: string },
  now: string,
  id: string
): WriteResult {
  const title = input.title.trim()
  if (!title) return { ok: false, message: '请先填写伏笔名称。' }
  if (draft.plotThreads.some((thread) => thread.id === id)) return { ok: false, message: '这条伏笔已经存在。' }

  draft.plotThreads.push({
    id,
    title,
    detail: input.detail ?? '',
    characterIds: [],
    status: '计划',
    setupMethod: '',
    resolutionMethod: '',
    progress: [],
    updatedAt: now
  })
  return { ok: true }
}

export function applyPlotThreadFieldEdit(
  draft: MemoryWritingDraft,
  threadId: string,
  field: PlotThreadTextField,
  value: string,
  now: string
): boolean {
  const thread = draft.plotThreads.find((item) => item.id === threadId)
  if (!thread) return false
  if (field === 'title' && !value.trim()) return false
  if (thread[field] === value) return false
  thread[field] = value
  thread.updatedAt = now
  return true
}

/**
 * 状态切换。埋设与回收必须已经有真实证据，否则拒绝：
 * 不能让一条「已回收」的伏笔实际没有任何出处。
 */
export function applyPlotThreadStatusEdit(
  draft: MemoryWritingDraft,
  threadId: string,
  status: string,
  now: string
): WriteResult {
  const thread = draft.plotThreads.find((item) => item.id === threadId)
  if (!thread) return { ok: false, message: '找不到这条伏笔。' }
  if (!(PLOT_THREAD_STATUS_OPTIONS as readonly string[]).includes(status)) return { ok: false, message: '不认识的伏笔状态。' }

  if ((status === '已埋设' || status === '推进中') && !thread.setupEvidence) {
    return { ok: false, message: '这条伏笔还没有埋设证据；请先记录它在哪一章、哪一段出现。' }
  }
  if (status === '已回收' && !thread.resolutionEvidence) {
    return { ok: false, message: '标记「已回收」前必须先记录真实回收证据；没有证据就不能算回收。' }
  }
  if (thread.status === status) return { ok: false, message: '状态没有变化。' }

  const previous = thread.status
  thread.status = status
  thread.revisionHistory = [...(thread.revisionHistory ?? []), {
    id: `plot-manual-${now}-${(thread.revisionHistory?.length ?? 0) + 1}`,
    changedAt: now, fromStatus: previous, toStatus: status,
    reason: status === '已放弃' ? '作者作废伏笔并保留旧证据。' : previous === '已放弃' ? '作者恢复伏笔并保留旧证据。' : '作者调整伏笔状态。'
  }]
  if (status === '已放弃') {
    thread.archivedAt = now
    thread.archivedFromStatus = previous
    thread.archiveReason = '作者作废伏笔并保留旧证据。'
  } else if (previous === '已放弃') {
    thread.archivedAt = undefined
    thread.archivedFromStatus = undefined
    thread.archiveReason = undefined
  }
  thread.updatedAt = now
  return { ok: true }
}

/** 埋设：记录章节、方法与证据（证据摘录非空）。 */
export function applyPlotThreadSetup(
  draft: MemoryWritingDraft,
  threadId: string,
  input: { chapterId: string; method: string; evidence: EvidenceDraft },
  now: string
): WriteResult {
  const thread = draft.plotThreads.find((item) => item.id === threadId)
  if (!thread) return { ok: false, message: '找不到这条伏笔。' }
  if (thread.status === '已放弃') return { ok: false, message: '伏笔已作废；如需继续使用，请先恢复状态。' }
  if (!draft.chapters.some((chapter) => chapter.id === input.chapterId)) return { ok: false, message: '找不到这一章，无法记录埋设证据。' }
  if (!input.evidence.excerpt.trim()) return { ok: false, message: '埋设证据不能为空。' }
  if (thread.setupEvidence) return { ok: false, message: '已有埋设证据。请先作废旧伏笔并新建替代伏笔，避免覆盖原证据。' }

  thread.setupChapterId = input.chapterId
  thread.setupMethod = input.method
  thread.setupEvidence = { ...input.evidence }
  if (thread.status === '计划') {
    thread.status = '已埋设'
    thread.revisionHistory = [...(thread.revisionHistory ?? []), { id: `plot-setup-${now}`, changedAt: now, fromStatus: '计划', toStatus: '已埋设', reason: '作者记录埋设证据。' }]
  }
  thread.updatedAt = now
  return { ok: true }
}

/** 推进：追加一条带证据的推进记录。 */
export function applyPlotThreadProgress(
  draft: MemoryWritingDraft,
  threadId: string,
  input: { chapterId: string; description: string; evidence: EvidenceDraft; progressId: string },
  now: string
): WriteResult {
  const thread = draft.plotThreads.find((item) => item.id === threadId)
  if (!thread) return { ok: false, message: '找不到这条伏笔。' }
  if (thread.status === '已放弃') return { ok: false, message: '伏笔已作废；如需继续使用，请先恢复状态。' }
  if (!draft.chapters.some((chapter) => chapter.id === input.chapterId)) return { ok: false, message: '找不到这一章，无法记录推进。' }
  if (!input.evidence.excerpt.trim()) return { ok: false, message: '推进记录必须带证据摘录。' }
  if (thread.progress.some((item) => item.id === input.progressId)) return { ok: false, message: '这条推进记录已经存在。' }

  thread.progress.push({
    id: input.progressId,
    chapterId: input.chapterId,
    description: input.description,
    source: { ...input.evidence }
  })
  if (thread.status === '计划' || thread.status === '已埋设') {
    const previous = thread.status
    thread.status = '推进中'
    thread.revisionHistory = [...(thread.revisionHistory ?? []), { id: `plot-progress-${now}-${thread.progress.length}`, changedAt: now, fromStatus: previous, toStatus: '推进中', reason: '作者记录推进证据。' }]
  }
  thread.updatedAt = now
  return { ok: true }
}

/** 安排回收：只写目标章号与期望位置，不改数据以外的状态。 */
export function applyPlotThreadPayoffPlan(
  draft: MemoryWritingDraft,
  threadId: string,
  targetPayoffChapter: number | undefined,
  now: string
): WriteResult {
  const thread = draft.plotThreads.find((item) => item.id === threadId)
  if (!thread) return { ok: false, message: '找不到这条伏笔。' }
  if (targetPayoffChapter !== undefined && (!Number.isInteger(targetPayoffChapter) || targetPayoffChapter <= 0)) {
    return { ok: false, message: '计划回收章必须是正整数。' }
  }
  thread.targetPayoffChapter = targetPayoffChapter
  thread.updatedAt = now
  return { ok: true }
}

/** 实际回收：必须带证据，成功后状态置为「已回收」。 */
export function applyPlotThreadResolution(
  draft: MemoryWritingDraft,
  threadId: string,
  input: { chapterId: string; method: string; evidence: EvidenceDraft },
  now: string
): WriteResult {
  const thread = draft.plotThreads.find((item) => item.id === threadId)
  if (!thread) return { ok: false, message: '找不到这条伏笔。' }
  if (thread.status === '已放弃') return { ok: false, message: '伏笔已作废；如需继续使用，请先恢复状态。' }
  if (!draft.chapters.some((chapter) => chapter.id === input.chapterId)) return { ok: false, message: '找不到这一章，无法记录回收证据。' }
  if (!input.evidence.excerpt.trim()) return { ok: false, message: '回收证据不能为空；没有证据就不能标记已回收。' }
  if (thread.resolutionEvidence) return { ok: false, message: '已有回收证据。请先作废旧伏笔并新建替代伏笔，避免覆盖原证据。' }

  const previous = thread.status
  thread.resolutionChapterId = input.chapterId
  thread.resolutionMethod = input.method
  thread.resolutionEvidence = { ...input.evidence }
  thread.status = '已回收'
  if (previous !== '已回收') thread.revisionHistory = [...(thread.revisionHistory ?? []), { id: `plot-resolution-${now}`, changedAt: now, fromStatus: previous, toStatus: '已回收', reason: '作者记录实际回收证据。' }]
  thread.updatedAt = now
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 正式记忆（作者手写）
 * ------------------------------------------------------------------ */

export function applyAddChapterMemory(
  draft: MemoryWritingDraft,
  chapterId: string,
  input: { summary: string; keyEvents?: string[] },
  now: string,
  id: string
): WriteResult {
  const chapter = draft.chapters.find((item) => item.id === chapterId)
  if (!chapter) return { ok: false, message: '找不到这一章。' }
  if (!input.summary.trim()) return { ok: false, message: '请先写下这条记忆的内容。' }
  if (draft.memories.some((memory) => memory.id === id)) return { ok: false, message: '这条记忆已经存在。' }
  if (draft.memories.some((memory) => memory.chapterId === chapterId)) {
    return { ok: false, message: '这一章已经有正式记忆；请直接修订现有条目，避免同一章出现两份口径。' }
  }

  draft.memories.push({
    id,
    chapterId,
    chapterNumber: chapter.chapterNumber,
    // 「待复核」而不是「正式」：作者手写的内容还没有被正文摘要核对过，不能自称已证实。
    status: '待复核',
    // 摘录留空表示「未与正文摘要绑定」，台账据此标为作者手写。
    sourceDigest: '',
    summary: input.summary.trim(),
    keyEvents: [...(input.keyEvents ?? [])],
    characterStates: [],
    facts: [],
    objectStates: [],
    timelineEvents: [],
    styleSignals: [],
    updatedAt: now
  })
  return { ok: true }
}

/** 只允许修订作者手写的记忆；AI 提取的记录仍然只能走变更提案。 */
export function applyChapterMemoryEdit(
  draft: MemoryWritingDraft,
  memoryId: string,
  patch: { summary?: string; keyEvents?: string[] },
  now: string
): WriteResult {
  const memory = draft.memories.find((item) => item.id === memoryId)
  if (!memory) return { ok: false, message: '找不到这条记忆。' }
  if (!isAuthorWrittenMemory(memory)) {
    return { ok: false, message: '这条记忆来自分析结果，不能直接改写；请在记忆提案里处理。' }
  }

  const originalSummary = memory.summary
  const originalKeyEvents = [...memory.keyEvents]
  let changed = false
  if (patch.summary !== undefined && patch.summary !== memory.summary) {
    if (!patch.summary.trim()) return { ok: false, message: '记忆内容不能清空。' }
    memory.summary = patch.summary
    changed = true
  }
  if (patch.keyEvents !== undefined && patch.keyEvents.join('\n') !== memory.keyEvents.join('\n')) {
    memory.keyEvents = [...patch.keyEvents]
    changed = true
  }
  if (!changed) return { ok: false, message: '内容没有变化。' }

  memory.editHistory = [...(memory.editHistory ?? []), { changedAt: now, summary: originalSummary, keyEvents: originalKeyEvents }]
  memory.updatedAt = now
  return { ok: true }
}
