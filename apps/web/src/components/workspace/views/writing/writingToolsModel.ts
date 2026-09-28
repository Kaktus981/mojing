/**
 * M6 · 正文创作的子页面写通道（纯函数）。
 *
 * 覆盖三件事：
 *   1. **写作控制**：这一章的写作口径（故事时间 / 叙述方式 / 视角）与正文状态。
 *      这里刻意只编辑「本章相关字段」，不复制项目级的创作规格编辑器。
 *   2. **章后交接**：本章结果、偏差原因、下章调整与交接状态。
 *      交接只写正文自己的复盘字段，**不会**自动生成正式记忆。
 *   3. **查找与替换**：区分当前章 / 全书，命中带真实位置；批量替换分两步——
 *      先出预览，再在执行时逐段复核「这一段还是预览时那一段吗」，不一致就整批拒绝，
 *      因此不会覆盖作者在预览之后写下的新内容；替换后可撤销，撤销同样做一致性核对。
 */

export const NARRATIVE_MODE_OPTIONS = ['顺叙', '倒叙', '插叙', '回忆'] as const
export const CHAPTER_STATUS_OPTIONS = ['草稿', '待审校', '定稿'] as const
export const HANDOFF_STATUS_OPTIONS = ['未交接', '已完成待复盘', '已交接', '需补写'] as const
export const RETRO_PLAN_RESULT_OPTIONS = ['已按计划完成', '实现方式变化', '计划未兑现', '计划外新增', '高风险冲突'] as const
/** 可手写的章纲写作控制字段。 */
export const CHAPTER_CONTROL_FIELDS = ['storyTime', 'narrativeMode', 'pov'] as const
export type ChapterControlField = (typeof CHAPTER_CONTROL_FIELDS)[number]

export type WriteResult = { ok: boolean; message?: string }

type OutlineChapterDraft = {
  id: string
  storyTime?: string
  narrativeMode?: string
  pov: string
}

type RetroDraft = {
  planResult?: string
  actualResult: string
  deviationReason: string
  nextAdjustment: string
  confirmedAt?: string
}

type BodyChapterDraft = {
  id: string
  chapterNumber: number
  title: string
  status: string
  blocks: Array<{ id: string; text: string }>
  handoffStatus?: string
  retro?: RetroDraft
}

export type WritingToolsDraft = {
  chapters: BodyChapterDraft[]
  outline?: { volumes: Array<{ chapters: OutlineChapterDraft[] }> }
}

function findOutlineChapter(draft: WritingToolsDraft, chapterId: string): OutlineChapterDraft | undefined {
  for (const volume of draft.outline?.volumes ?? []) {
    const chapter = volume.chapters.find((item) => item.id === chapterId)
    if (chapter) return chapter
  }
  return undefined
}

function emptyRetro(): RetroDraft {
  return { actualResult: '', deviationReason: '', nextAdjustment: '' }
}

/* ------------------------------------------------------------------ *
 * 写作控制
 * ------------------------------------------------------------------ */

/** 写本章的写作口径；叙述方式只接受契约枚举，其余为文本。 */
export function applyChapterControlEdit(
  draft: WritingToolsDraft,
  chapterId: string,
  field: ChapterControlField,
  value: string
): boolean {
  const chapter = findOutlineChapter(draft, chapterId)
  if (!chapter) return false
  if (field === 'narrativeMode') {
    if (value && !(NARRATIVE_MODE_OPTIONS as readonly string[]).includes(value)) return false
    if (chapter.narrativeMode === value || (!chapter.narrativeMode && !value)) return false
    chapter.narrativeMode = value || undefined
    return true
  }
  if (field === 'storyTime') {
    if (chapter.storyTime === value || (!chapter.storyTime && !value)) return false
    chapter.storyTime = value || undefined
    return true
  }
  if (chapter.pov === value) return false
  chapter.pov = value
  return true
}

/** 正文状态（草稿 / 待审校 / 定稿）。 */
export function applyChapterStatusEdit(
  draft: WritingToolsDraft,
  chapterId: string,
  status: string
): boolean {
  const chapter = draft.chapters.find((item) => item.id === chapterId)
  if (!chapter) return false
  if (!(CHAPTER_STATUS_OPTIONS as readonly string[]).includes(status)) return false
  if (chapter.status === status) return false
  chapter.status = status
  return true
}

/* ------------------------------------------------------------------ *
 * 章后交接
 * ------------------------------------------------------------------ */

/** 写复盘字段。这里只改正文自己的复盘记录，不触碰记忆、伏笔或正文内容。 */
export function applyChapterRetroEdit(
  draft: WritingToolsDraft,
  chapterId: string,
  patch: Partial<Pick<RetroDraft, 'planResult' | 'actualResult' | 'deviationReason' | 'nextAdjustment'>>,
  now: string
): boolean {
  const chapter = draft.chapters.find((item) => item.id === chapterId)
  if (!chapter) return false

  if (patch.planResult !== undefined && !(RETRO_PLAN_RESULT_OPTIONS as readonly string[]).includes(patch.planResult)) return false

  const current = chapter.retro ?? emptyRetro()
  let changed = false
  for (const field of ['planResult', 'actualResult', 'deviationReason', 'nextAdjustment'] as const) {
    const value = patch[field]
    if (value === undefined || current[field] === value) continue
    if (field === 'planResult') current.planResult = value
    else current[field] = value
    changed = true
  }
  if (!changed) return false

  chapter.retro = current
  void now
  return true
}

/**
 * 交接状态。标记「已交接」前必须写下本章实际结果，
 * 避免出现「什么都没有交接却显示已交接」的假完成；同时记录确认时间。
 */
export function applyChapterHandoffStatusEdit(
  draft: WritingToolsDraft,
  chapterId: string,
  status: string,
  now: string
): WriteResult {
  const chapter = draft.chapters.find((item) => item.id === chapterId)
  if (!chapter) return { ok: false, message: '找不到这一章。' }
  if (!(HANDOFF_STATUS_OPTIONS as readonly string[]).includes(status)) return { ok: false, message: '不认识的交接状态。' }

  const retro = chapter.retro ?? emptyRetro()
  if (status === '已交接' && !retro.actualResult.trim()) {
    return { ok: false, message: '标记「已交接」前请先写下本章结果，否则这次交接没有任何内容。' }
  }
  if (status === '已完成待复盘' && !retro.actualResult.trim() && !retro.deviationReason.trim()) {
    return { ok: false, message: '标记「已完成待复盘」前，请至少写下本章结果或偏差原因。' }
  }

  chapter.handoffStatus = status
  if (status === '已交接') {
    retro.confirmedAt = now
    chapter.retro = retro
  } else if (chapter.retro) {
    chapter.retro = { ...chapter.retro, confirmedAt: undefined }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 查找与替换
 * ------------------------------------------------------------------ */

export type SearchScope = 'chapter' | 'book'

export type ProseHit = {
  chapterId: string
  chapterNumber: number
  chapterTitle: string
  blockId: string
  blockIndex: number
  /** 命中在段落内的字符偏移，用于「命中位置」显示。 */
  offset: number
  before: string
  excerpt: string
}

/** 查找：区分当前章与全书，命中带真实章节与段落位置，原文由调用方展示。 */
export function searchProse(
  chapters: Array<{ id: string; chapterNumber: number; title: string; blocks: Array<{ id: string; text: string }> }>,
  query: string,
  scope: SearchScope,
  currentChapterId?: string
): ProseHit[] {
  const needle = query
  if (!needle) return []
  const scoped = scope === 'chapter' ? chapters.filter((chapter) => chapter.id === currentChapterId) : chapters
  const hits: ProseHit[] = []
  for (const chapter of scoped) {
    chapter.blocks.forEach((block, blockIndex) => {
      let index = block.text.indexOf(needle)
      while (index >= 0) {
        hits.push({
          chapterId: chapter.id,
          chapterNumber: chapter.chapterNumber,
          chapterTitle: chapter.title,
          blockId: block.id,
          blockIndex,
          offset: index,
          before: block.text,
          excerpt: block.text.slice(Math.max(0, index - 12), index + needle.length + 12)
        })
        index = block.text.indexOf(needle, index + needle.length)
      }
    })
  }
  return hits
}

export type ReplaceStep = { chapterId: string; blockId: string; before: string; after: string }
export type ReplacePlan = { query: string; replacement: string; steps: ReplaceStep[]; hitCount: number }

/** 预览：按段落合并命中，算出每一段替换后的整段文本；不改任何数据。 */
export function planReplaceAll(hits: ProseHit[], query: string, replacement: string): ReplacePlan {
  const steps = new Map<string, ReplaceStep>()
  for (const hit of hits) {
    const key = `${hit.chapterId}::${hit.blockId}`
    const existing = steps.get(key) ?? { chapterId: hit.chapterId, blockId: hit.blockId, before: hit.before, after: '' }
    steps.set(key, existing)
  }
  const list = [...steps.values()].map((step) => ({
    ...step,
    after: step.before.split(query).join(replacement)
  }))
  return { query, replacement, steps: list, hitCount: hits.length }
}

/**
 * 执行替换。逐段复核「现在这一段还是预览时那一段吗」：
 * 任何一段被改过就整批拒绝并说明原因，绝不覆盖预览之后写下的新内容。
 */
export function applyReplacePlan(draft: WritingToolsDraft, plan: ReplacePlan): { ok: boolean; message?: string; applied: number } {
  if (plan.steps.length === 0) return { ok: false, message: '这次替换没有任何内容。', applied: 0 }

  const conflicts: string[] = []
  for (const step of plan.steps) {
    const chapter = draft.chapters.find((item) => item.id === step.chapterId)
    const block = chapter?.blocks.find((item) => item.id === step.blockId)
    if (!block) { conflicts.push(`第${chapter?.chapterNumber ?? '?'}章有一处段落已经不存在`); continue }
    if (block.text !== step.before) conflicts.push(`第${chapter!.chapterNumber}章有一处段落已经变化`)
  }
  if (conflicts.length > 0) {
    return { ok: false, message: `替换已取消：${conflicts.slice(0, 3).join('；')}${conflicts.length > 3 ? ' 等' : ''}。请重新查找后再替换，避免覆盖新写的内容。`, applied: 0 }
  }

  for (const step of plan.steps) {
    const chapter = draft.chapters.find((item) => item.id === step.chapterId)!
    chapter.blocks.find((item) => item.id === step.blockId)!.text = step.after
  }
  return { ok: true, applied: plan.steps.length }
}

/** 撤销替换：同样逐段核对，只有「还是替换后的样子」才还原。 */
export function undoReplacePlan(draft: WritingToolsDraft, plan: ReplacePlan): { ok: boolean; message?: string; restored: number } {
  if (plan.steps.length === 0) return { ok: false, message: '没有可撤销的替换。', restored: 0 }
  for (const step of plan.steps) {
    const chapter = draft.chapters.find((item) => item.id === step.chapterId)
    const block = chapter?.blocks.find((item) => item.id === step.blockId)
    if (!block || block.text !== step.after) {
      return { ok: false, message: '替换之后这些段落又被改过，撤销会覆盖新内容，因此已取消。', restored: 0 }
    }
  }
  for (const step of plan.steps) {
    const chapter = draft.chapters.find((item) => item.id === step.chapterId)!
    chapter.blocks.find((item) => item.id === step.blockId)!.text = step.before
  }
  return { ok: true, restored: plan.steps.length }
}
