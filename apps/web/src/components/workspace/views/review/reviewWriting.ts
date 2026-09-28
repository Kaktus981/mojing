/**
 * M7 · 人工审稿问题与导出前本地预检的纯逻辑。
 *
 * 两条硬规则：
 *   1. 审稿问题可以**由作者手工建立**，但它必须挂真实章节与真实段落摘录；
 *      没有可引用段落时要写成「作者手动说明：…」，不伪造正文证据。
 *   2. 处理记录（ReviewResolution）由作者填写；忽略类处理必须写理由，
 *      声明「正文已手动修复」必须附上新的正文证据。改状态不会自动改正文。
 */

export type WriteResult = { ok: boolean; message?: string }

/** 与契约 ReviewItemSchema 的枚举保持一致。 */
export const REVIEW_CATEGORIES = ['逻辑', '节奏', '角色', '文风', '连续性', '伏笔', '世界规则'] as const
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number]
export const REVIEW_SEVERITIES = ['高', '中', '低'] as const
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number]
export const REVIEW_STATUSES = ['待处理', '已完成', '已忽略'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
/** 与契约 ReviewResolutionMethodSchema 逐字一致。 */
export const REVIEW_RESOLUTION_METHODS = [
  '正文已手动修复', '候选已应用并复核', '无需修改', '重复问题', '风险已知仍忽略', '暂不处理', '其他'
] as const
export type ReviewResolutionMethod = (typeof REVIEW_RESOLUTION_METHODS)[number]
/** 这些处理方式等于「不改正文」，必须写清理由，日后才能复核。 */
export const REVIEW_METHODS_REQUIRING_REASON: readonly ReviewResolutionMethod[] = ['无需修改', '重复问题', '风险已知仍忽略', '暂不处理', '其他']
/** 作者手动说明的前缀：没有可引用段落时用它如实标注。 */
export const MANUAL_EVIDENCE_PREFIX = '作者手动说明：'

export type ReviewEvidenceDraft = { chapterId: string; blockId?: string; excerpt: string }

export type ReviewIssueDraft = {
  id: string
  chapterId?: string
  category: string
  severity: string
  title: string
  description: string
  evidence: ReviewEvidenceDraft[]
  recommendation: string
  status: string
  createdAt: string
  resolution?: { method: string; reason: string; resolvedAt: string; proposalIds: string[]; evidence: ReviewEvidenceDraft[] }
}

export type ReviewWritingDraft = {
  chapters: Array<{ id: string; chapterNumber: number; blocks: Array<{ id: string; text: string }> }>
  reviews: ReviewIssueDraft[]
}

/**
 * 段落证据校验。三种合法写法：
 *   - 指向真实段落，且摘录确实是该段落里的原文；
 *   - 指向真实章节 + 真实段落，但摘录以「作者手动说明：」开头（作者转述）；
 *   - 不指段落，只以「作者手动说明：」开头。
 * 其余一律拒绝，避免出现无法定位的“证据”。
 */
export function reviewEvidenceProblem(draft: ReviewWritingDraft, evidence: ReviewEvidenceDraft): string | undefined {
  const chapter = draft.chapters.find((item) => item.id === evidence.chapterId)
  if (!chapter) return '证据必须挂在真实存在的章节上。'
  const excerpt = evidence.excerpt.trim()
  if (!excerpt) return '证据摘录不能为空。'
  if (evidence.blockId) {
    const block = chapter.blocks.find((item) => item.id === evidence.blockId)
    if (!block) return '这段证据指向的段落不存在。'
    if (block.text.includes(excerpt)) return undefined
    if (excerpt.startsWith(MANUAL_EVIDENCE_PREFIX)) return undefined
    return '摘录必须是该段落里的原文，或写成「作者手动说明：…」。'
  }
  if (excerpt.startsWith(MANUAL_EVIDENCE_PREFIX)) return undefined
  return '请先选中具体段落，或把摘录写成「作者手动说明：…」。'
}

/** 新建人工审稿问题。问题只记录，不改正文。 */
export function applyAddReviewIssue(
  draft: ReviewWritingDraft,
  input: { id: string; category: string; severity: string; title: string; description: string; recommendation?: string; chapterId?: string; evidence?: ReviewEvidenceDraft[] },
  now: string
): WriteResult {
  const title = input.title.trim()
  if (!title) return { ok: false, message: '请先填写问题标题。' }
  if (!input.description.trim()) return { ok: false, message: '请填写问题的具体描述，否则日后无法复核。' }
  if (!REVIEW_CATEGORIES.includes(input.category as ReviewCategory)) return { ok: false, message: '请选择有效的问题类别。' }
  if (!REVIEW_SEVERITIES.includes(input.severity as ReviewSeverity)) return { ok: false, message: '请选择有效的影响程度。' }
  if (draft.reviews.some((item) => item.id === input.id)) return { ok: false, message: '这条问题已经存在。' }

  const evidence = input.evidence ?? []
  if (input.chapterId && !draft.chapters.some((item) => item.id === input.chapterId)) return { ok: false, message: '关联的章节不存在。' }
  for (const item of evidence) {
    const problem = reviewEvidenceProblem(draft, item)
    if (problem) return { ok: false, message: problem }
  }

  draft.reviews.push({
    id: input.id,
    chapterId: input.chapterId,
    category: input.category,
    severity: input.severity,
    title,
    description: input.description.trim(),
    evidence,
    recommendation: input.recommendation?.trim() ?? '',
    status: '待处理',
    createdAt: now
  })
  return { ok: true }
}

/** 记录处理意见；同时把状态落到对应的终态。改状态不会自动改正文。 */
export function applyReviewResolution(
  draft: ReviewWritingDraft,
  issueId: string,
  input: { method: string; reason?: string; proposalIds?: string[]; evidence?: ReviewEvidenceDraft[]; status: '已完成' | '已忽略' },
  now: string
): WriteResult {
  const issue = draft.reviews.find((item) => item.id === issueId)
  if (!issue) return { ok: false, message: '找不到这条审稿问题。' }
  if (!REVIEW_RESOLUTION_METHODS.includes(input.method as ReviewResolutionMethod)) return { ok: false, message: '请选择有效的处理方式。' }

  const method = input.method as ReviewResolutionMethod
  const reason = input.reason?.trim() ?? ''
  if (REVIEW_METHODS_REQUIRING_REASON.includes(method) && !reason) {
    return { ok: false, message: `「${method}」没有改正文，必须写清处理理由，日后才能复核。` }
  }
  const evidence = input.evidence ?? []
  if (method === '正文已手动修复' && evidence.length === 0) {
    return { ok: false, message: '声明「正文已手动修复」必须附上新的正文证据（真实段落摘录或「作者手动说明：…」）。' }
  }
  for (const item of evidence) {
    const problem = reviewEvidenceProblem(draft, item)
    if (problem) return { ok: false, message: problem }
  }

  issue.resolution = { method, reason, resolvedAt: now, proposalIds: input.proposalIds ?? [], evidence }
  issue.status = input.status
  return { ok: true }
}

/** 重新打开：状态回到「待处理」，上次处理记录保留作为历史，不删除也不覆盖。 */
export function applyReopenReviewIssue(draft: ReviewWritingDraft, issueId: string): WriteResult {
  const issue = draft.reviews.find((item) => item.id === issueId)
  if (!issue) return { ok: false, message: '找不到这条审稿问题。' }
  if (issue.status === '待处理') return { ok: false, message: '这条问题本来就是待处理。' }
  issue.status = '待处理'
  return { ok: true }
}

/** 只改状态（不写处理记录）。旧视图只有这条通道，保留以便兼容。 */
export function applyReviewStatusEdit(draft: ReviewWritingDraft, issueId: string, status: string): WriteResult {
  const issue = draft.reviews.find((item) => item.id === issueId)
  if (!issue) return { ok: false, message: '找不到这条审稿问题。' }
  if (!REVIEW_STATUSES.includes(status as ReviewStatus)) return { ok: false, message: '无效的问题状态。' }
  if (issue.status === status) return { ok: false, message: undefined }
  issue.status = status
  return { ok: true }
}
