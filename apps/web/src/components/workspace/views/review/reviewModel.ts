import {
  NovelVersionRestorePreviewSchema,
  branchFreshness,
  reviewResolutionState,
  versionRestoreState,
  type BranchFreshnessState,
  type NovelBranch,
  type NovelProject,
  type NovelRevisionProposal,
  type NovelVersionSummary,
  type ReviewResolutionState
} from '../../../../../../../packages/contracts/src'
import { countChapterWords } from '../../paragraphModel'

/**
 * 审稿与导出 · 五个二级页面的纯数据模型。
 *
 * 三条原则（与大纲 / 世界观 / 记忆三个栏目一致）：
 *   1. 五个入口必须呈现**不同**内容，可被测试直接证明；
 *   2. 展示值只能来自传入的 `NovelProject` / store 的 `revisions` / `versions`
 *      —— 不补占位、不造假准备度、不造假「检查通过」、不造假「全部完成」；
 *   3. 后端未接通的能力显式建模为 `notice`，页面只如实说明并保持禁用。
 *
 * 本文件额外守住本栏目独有的三条红线：
 *   - **旧问题不补造处理记录**：已标记完成 / 忽略但没有 `resolution` 的问题，
 *     一律由 `reviewResolutionState()` 标为「缺少处理记录」并计数，绝不伪造一条完成记录。
 *   - **分支新鲜度必须真实比对**：一律由 `branchFreshness()` 按摘要计算，
 *     缺依据时记为「来源缺失」，不猜「最新」，也不给出百分比。
 *   - **版本历史不伪造差异、不伪造受控恢复**：差异预览与受控恢复都走真实服务端
 *     （GET .../restore-preview + POST .../restore），页面只展示服务端返回的真实差异与
 *     契约纯函数判定的恢复状态。恢复状态同时依赖「预览属于哪条快照 / 预览绑定的
 *     revision / 当前稿是否已保存」三件事 —— 换选中、改正文、预览过期、保存中一律
 *     不可提交，**不接入**旧的直接恢复通道。
 */

export type ReviewPageId =
  | 'export-manuscript'
  | 'review-issues'
  | 'revision-candidates'
  | 'story-branches'
  | 'version-history'

export const REVIEW_PAGE_IDS: readonly ReviewPageId[] = [
  'export-manuscript',
  'review-issues',
  'revision-candidates',
  'story-branches',
  'version-history'
]

export type ReviewPageKind = 'export' | 'issues' | 'candidates' | 'branches' | 'history'

const PAGE_KIND: Record<ReviewPageId, ReviewPageKind> = {
  'export-manuscript': 'export',
  'review-issues': 'issues',
  'revision-candidates': 'candidates',
  'story-branches': 'branches',
  'version-history': 'history'
}

export function isReviewPageId(value: string): value is ReviewPageId {
  return (REVIEW_PAGE_IDS as readonly string[]).includes(value)
}

/** 未知 / 失效 id 回落到本栏目默认页（导出成稿），与导航的 defaultSubnavId 一致。 */
export function reviewPageKind(subnavId: string): ReviewPageKind {
  return isReviewPageId(subnavId) ? PAGE_KIND[subnavId] : 'export'
}

export type ReviewNotice = { id: string; title: string; detail: string }

/**
 * 能力现状说明（作者向）。
 *
 * 这些文案出现在作者主界面的提示卡里，因此只写「能做什么 / 不能做什么 / 为什么 / 你该怎么办」，
 * 不写契约名、字段路径、端点路径这类只有开发者需要的信息 —— 那些留在源码注释与交接文档里。
 * 对确实做不到的事，一律如实说明并把按钮保持禁用，绝不用假成功糊过去；风险与「改动还没保存」
 * 一类的安全说明必须保留，不能为了去掉术语而一起删掉。
 */
export const REVIEW_NOTICE_RESOLUTION: ReviewNotice = {
  id: 'review-resolution-entry',
  title: '处理记录跟着作品一起保存',
  detail:
    '处理审稿问题时，可记录状态、理由和证据。缺少处理记录的问题会单独标出。'
}

export const REVIEW_NOTICE_CREATE: ReviewNotice = {
  id: 'review-create',
  title: '问题可以自己记，也可以让 AI 找',
  detail:
    '审稿问题有三个来源：你在上面的表单里手动记录（不运行 AI 也能用）、连续性冷读运行后由 AI 生成、以及规划改动后自动补建的「规划变化后复核正文」。手动记录的问题必须能定位到章节或段落，证据要么是正文原文，要么写成「作者手动说明：…」。问题可以标为已完成、已忽略，也可以重新打开，但不提供删除 —— 保留记录比删掉更安全。任何状态变化都不会自动改写正文。'
}

export const REVIEW_NOTICE_EXPORT_PREFLIGHT: ReviewNotice = {
  id: 'export-preflight',
  title: '导出前先在本机做一次完整性检查',
  detail:
    '导出前会先保存，并在本机检查章节编号、引用和正文。保存失败或发现影响导出的问题会阻断导出；草稿与待审问题只作提醒。检查不调用 AI，也不能代替通读全稿。'
}

export const REVIEW_NOTICE_CANDIDATE_GATE: ReviewNotice = {
  id: 'candidate-gate',
  title: '修改候选由你确认',
  detail:
    '可逐条处理，也可勾选互不冲突且没有待核对风险的候选批量处理。批量操作会整体提交；过期、带检查或结构调整的候选仍需逐条核对。'
}

export const REVIEW_NOTICE_BRANCH_ADOPT: ReviewNotice = {
  id: 'branch-adopt',
  title: '采用分支只生成候选，不会直接替换正文',
  detail:
    '采用一条故事分支后，墨境会依据分支的最后一章生成一条待处理的修改候选，不会直接替换正式章节。分支正文与正式正文始终分开存放，所以可以放心试写；采用之后仍然要在「AI 修改候选」里逐条确认，内容才会真正进入正文。'
}

export const REVIEW_NOTICE_BRANCH_FRESHNESS: ReviewNotice = {
  id: 'branch-freshness',
  title: '分支与原章节的关系',
  detail:
    '墨境会检查来源章节在分支生成后是否变化。若缺少比对依据，会标为「来源缺失」；来源已变化时，请重新比较后再采用。'
}

// ------------------------------------------------- 版本历史（页 5）的四处据实缺口

export const REVIEW_NOTICE_DIFF_PREVIEW: ReviewNotice = {
  id: 'version-diff-preview',
  title: '先预览差异，再决定是否恢复',
  detail:
    '选中一个版本后点击「预览差异」，查看它与当前稿在正文、大纲、世界观等内容上的真实比对。预览失败时不会显示差异内容，恢复保持禁用。'
}

export const REVIEW_NOTICE_CONTROLLED_RESTORE: ReviewNotice = {
  id: 'version-controlled-restore',
  title: '恢复：先看差异，再确认，还能回退',
  detail:
    '恢复前，预览必须是当前选中这条快照的；当前稿已经保存，且预览后没有改动，包括还没保存完的改动。任何条件对不上都会被拒绝，请重新预览差异。墨境会先留下一条「恢复前快照」，方便再次回退。'
}

export const REVIEW_NOTICE_NAMED_CHECKPOINT: ReviewNotice = {
  id: 'version-named-checkpoint',
  title: '检查点的名字会原样记进版本历史',
  detail:
    '创建检查点时可以顺手写个名字，比如「定稿前」；这个名字会原样出现在版本历史里，方便回头分辨哪条是哪个节点。名字留空时会记为「手动检查点」。名字只是标记，不会影响正文内容，也不会改动任何别的数据。'
}

export const REVIEW_NOTICE_VERSION_REMOVE: ReviewNotice = {
  id: 'version-remove',
  title: '删除只针对单条快照，不做批量',
  detail:
    '删除只会移除你选中的那一条快照，正在写的内容不受影响。本页在删除前会再问你一次，删除时系统还会弹出一次确认，两次都通过才会真正删掉。删除后这条快照无法恢复，所以请看清版本号再确认；批量删除、静默删除都不提供。'
}

// ---------------------------------------------------------------- 通用工具

export function chapterWordCount(chapter: NovelProject['chapters'][number]): number {
  return countChapterWords(chapter.blocks)
}

export function formatWords(value: number): string {
  return value.toLocaleString('zh-CN')
}

export function formatTime(value: string | undefined): string {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function severityTone(severity: string): 'danger' | 'amber' | 'info' {
  if (severity === '高') return 'danger'
  if (severity === '中') return 'amber'
  return 'info'
}

/** 章节标签：章号缺失时如实写「未标注章号」，不猜一个数字。 */
export function chapterLabel(chapterNumber: number | undefined): string {
  return chapterNumber === undefined ? '未标注章号' : `第 ${chapterNumber} 章`
}

// ================================================================ 页 1 · 导出成稿

export type ExportFormatId = 'docx' | 'md' | 'txt' | 'json'

export type ExportFormat = {
  id: ExportFormatId
  label: string
  ext: string
  desc: string
  /** 是否属于「完整备份」：JSON 会连带世界观、大纲、记忆与伏笔。 */
  backup: boolean
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: 'docx', label: 'Word 成稿', ext: '.docx', desc: '按卷章排版，可直接交付', backup: false },
  { id: 'md', label: 'Markdown', ext: '.md', desc: '保留标题层级，便于二次编辑', backup: false },
  { id: 'txt', label: '纯文本', ext: '.txt', desc: '仅正文，无任何标记', backup: false },
  { id: 'json', label: '完整 JSON 备份', ext: '.json', desc: '含世界观、大纲、记忆与伏笔', backup: true }
]

export type ExportChapterRow = {
  id: string
  label: string
  title: string
  status: string
  words: number
  blocks: number
  /** 该章所有段落文字为空：导出后会得到一个空章。 */
  empty: boolean
}

export type ExportManifestModel = {
  kind: 'export'
  hasProject: boolean
  chapterCount: number
  volumeCount: number
  totalWords: number
  emptyChapters: number
  /** 草稿也可导出；只有「一章都没有」才是无正文。 */
  status: '就绪' | '无正文'
  canExport: boolean
  formats: readonly ExportFormat[]
  rows: ExportChapterRow[]
  /** 章号最大的一章，作为「最新一章」如实展示。 */
  latest?: ExportChapterRow
  versions: { total: number; latestRevision?: number; latestAt?: string; latestReason?: string }
  notice: ReviewNotice
}

export function buildExportManifest(
  project: NovelProject | undefined,
  versions: readonly NovelVersionSummary[]
): ExportManifestModel {
  const formats = EXPORT_FORMATS
  if (!project) {
    return {
      kind: 'export',
      hasProject: false,
      chapterCount: 0,
      volumeCount: 0,
      totalWords: 0,
      emptyChapters: 0,
      status: '无正文',
      canExport: false,
      formats,
      rows: [],
      versions: { total: versions.length },
      notice: REVIEW_NOTICE_EXPORT_PREFLIGHT
    }
  }

  const rows: ExportChapterRow[] = [...project.chapters]
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => {
      const words = chapterWordCount(chapter)
      return {
        id: chapter.id,
        label: chapterLabel(chapter.chapterNumber),
        title: chapter.title || '未命名',
        status: chapter.status,
        words,
        blocks: chapter.blocks.length,
        empty: words === 0
      }
    })

  const totalWords = rows.reduce((sum, row) => sum + row.words, 0)
  const volumeNumbers = new Set(project.chapters.map((chapter) => chapter.volumeNumber))
  // rows 已按 chapterNumber 升序排列，最后一行就是章号最大的一章。
  const latest = rows.at(-1)
  const latestVersion = [...versions].sort((a, b) => b.revision - a.revision)[0]

  return {
    kind: 'export',
    hasProject: true,
    chapterCount: rows.length,
    volumeCount: volumeNumbers.size,
    totalWords,
    emptyChapters: rows.filter((row) => row.empty).length,
    status: rows.length ? '就绪' : '无正文',
    canExport: rows.length > 0,
    formats,
    rows,
    latest,
    versions: {
      total: versions.length,
      latestRevision: latestVersion?.revision,
      latestAt: latestVersion?.createdAt,
      latestReason: latestVersion ? latestVersion.reason || latestVersion.source : undefined
    },
    notice: REVIEW_NOTICE_EXPORT_PREFLIGHT
  }
}

// ================================================================ 页 2 · 审稿问题

export type ReviewIssueEvidence = { chapterLabel: string; excerpt: string }

export type ReviewIssueRow = {
  id: string
  category: string
  severity: string
  severityTone: 'danger' | 'amber' | 'info'
  title: string
  description: string
  recommendation: string
  status: string
  /** 真实处理记录完整度：待处理 / 已记录 / 缺少处理记录。 */
  resolutionState: ReviewResolutionState
  resolutionMethod?: string
  resolutionReason?: string
  resolutionAt?: string
  linkedProposalCount: number
  /** 证据涉及的章节，按证据顺序拼接；没有证据时写明「无证据」。 */
  location: string
  evidence: ReviewIssueEvidence[]
  createdAt: string
}

export type ReviewIssueCategoryRow = { category: string; total: number; pending: number }

export type ReviewIssuesModel = {
  kind: 'issues'
  hasProject: boolean
  rows: ReviewIssueRow[]
  counts: {
    total: number
    pending: number
    completed: number
    ignored: number
    /** 待处理中的高风险数量。 */
    severe: number
    /** 已结束但缺少 resolution 的问题数量（旧数据）。 */
    missingResolution: number
    /** 关联了修改候选的问题数量。 */
    linked: number
  }
  bySeverity: { severity: string; total: number; pending: number }[]
  byCategory: ReviewIssueCategoryRow[]
  notice: ReviewNotice
  createNotice: ReviewNotice
}

export function buildReviewIssues(project: NovelProject | undefined): ReviewIssuesModel {
  if (!project) {
    return {
      kind: 'issues',
      hasProject: false,
      rows: [],
      counts: { total: 0, pending: 0, completed: 0, ignored: 0, severe: 0, missingResolution: 0, linked: 0 },
      bySeverity: [],
      byCategory: [],
      notice: REVIEW_NOTICE_RESOLUTION,
      createNotice: REVIEW_NOTICE_CREATE
    }
  }

  const chapterById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]))

  const rows: ReviewIssueRow[] = project.reviews.map((review) => {
    const evidence = review.evidence.map((item) => {
      const chapter = chapterById.get(item.chapterId)
      return {
        chapterLabel: chapter ? chapterLabel(chapter.chapterNumber) : '未知章节',
        excerpt: item.excerpt
      }
    })
    const location = evidence.length ? evidence.map((item) => item.chapterLabel).join(' ↔ ') : '无证据'
    return {
      id: review.id,
      category: review.category,
      severity: review.severity,
      severityTone: severityTone(review.severity),
      title: review.title,
      description: review.description,
      recommendation: review.recommendation,
      status: review.status,
      resolutionState: reviewResolutionState(review),
      resolutionMethod: review.resolution?.method,
      resolutionReason: review.resolution?.reason || undefined,
      resolutionAt: review.resolution?.resolvedAt,
      linkedProposalCount: review.linkedProposalIds?.length ?? 0,
      location,
      evidence,
      createdAt: review.createdAt
    }
  })

  const pending = rows.filter((row) => row.status === '待处理')
  const severityOrder = ['高', '中', '低']
  const categoryOrder = ['连续性', '逻辑', '节奏', '角色', '文风', '伏笔', '世界规则']

  return {
    kind: 'issues',
    hasProject: true,
    rows,
    counts: {
      total: rows.length,
      pending: pending.length,
      completed: rows.filter((row) => row.status === '已完成').length,
      ignored: rows.filter((row) => row.status === '已忽略').length,
      severe: pending.filter((row) => row.severity === '高').length,
      missingResolution: rows.filter((row) => row.resolutionState === '缺少处理记录').length,
      linked: rows.filter((row) => row.linkedProposalCount > 0).length
    },
    bySeverity: severityOrder.map((severity) => ({
      severity,
      total: rows.filter((row) => row.severity === severity).length,
      pending: pending.filter((row) => row.severity === severity).length
    })),
    byCategory: categoryOrder
      .map((category) => ({
        category,
        total: rows.filter((row) => row.category === category).length,
        pending: pending.filter((row) => row.category === category).length
      }))
      .filter((entry) => entry.total > 0),
    notice: REVIEW_NOTICE_RESOLUTION,
    createNotice: REVIEW_NOTICE_CREATE
  }
}

// ================================================================ 页 3 · AI 修改候选

export const CANDIDATE_TARGET_LABELS: Record<string, string> = {
  directionCards: '故事方向卡',
  worldBible: '世界观',
  outline: '大纲',
  chapter: '正文章节',
  branch: '剧情分支'
}

export type RevisionCandidateRow = {
  id: string
  summary: string
  kind: string
  target: string
  targetLabel: string
  targetId?: string
  status: string
  createdAt: string
  baseRevision: number
  /** 候选生成时项目版本与当前版本之差；0 表示版本未变。 */
  revisionLag: number
  /** 项目在候选生成后已前进：应用前会先保存版本并要求确认。 */
  stale: boolean
  reviewId?: string
  /** 关联的审稿问题标题（联表成功时才有值）。 */
  linkedReviewTitle?: string
  qualityCount: number
  sceneQualityCount: number
  /** 结构调整候选的影响摘要（仅结构调整候选才有）。 */
  structureImpact?: string
  /** 候选负载的顶层字段名，用于让作者知道会改到哪些内容。 */
  candidateFields: string[]
  /** 给作者看的改动内容（中文），与 `candidateFields` 同源，未收录的键折成「其他内容」。 */
  candidateFieldLabels: string[]
}

export type RevisionCandidatesModel = {
  kind: 'candidates'
  hasProject: boolean
  rows: RevisionCandidateRow[]
  counts: {
    total: number
    pending: number
    applied: number
    rejected: number
    conflicted: number
    stale: number
    /** 关联了审稿问题的候选数量。 */
    linked: number
  }
  targetGroups: { target: string; label: string; count: number }[]
  notice: ReviewNotice
}

function candidateFieldNames(candidate: unknown): string[] {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
  return Object.keys(candidate as Record<string, unknown>).slice(0, 12)
}

/**
 * 候选载荷的字段名 → 作者看得懂的说法。
 * 只做翻译，不改数据：未收录的键统一折成「其他内容」，绝不把原始字段名漏到界面上。
 * 键名来自各候选的真实载荷（章正文 / 章纲 / 卷纲 / 总纲 / 世界观词条 / 故事方向 / 剧情分支 / 审校），
 * 宁可多留几个键，也不让常见键落进「其他内容」。
 */
export const CANDIDATE_FIELD_LABELS: Record<string, string> = {
  // 章正文候选（ChapterSchema）
  title: '章纲标题', blocks: '正文段落', chapterNumber: '章号', volumeNumber: '卷号', status: '状态',
  sourceDigest: '来源版本', updatedAt: '更新时间', handoffStatus: '交接状态', retro: '章节复盘',
  // 章纲候选（ChapterOutlineSchema）
  summary: '章节摘要', storyTime: '故事时间', narrativeMode: '叙述方式', pov: '叙事视角', objective: '章节目标',
  conflict: '冲突', turningPoint: '转折', reveal: '揭示', endingHook: '结尾钩子',
  characterIds: '出场角色', setupThreadIds: '埋设伏笔', payoffThreadIds: '回收伏笔', beats: '剧情步骤',
  beatStatus: '剧情步骤状态', beatFindings: '剧情步骤建议', lineAssignments: '事件线分配',
  // 卷纲 / 总纲候选（VolumeOutlineSchema / NovelOutlineSchema）
  volumes: '分卷结构', chapters: '章节', goal: '卷目标', climax: '卷高潮', resolution: '卷收束',
  synopsis: '总纲', themes: '主题', mainConflict: '主要冲突', endingDirection: '结局方向',
  rollingWindow: '近期章纲窗口',
  // 世界观词条 / 世界观候选（WorldEntrySchema / WorldBibleSchema）
  premise: '前提设定', rules: '规则', geography: '地理', historySummary: '历史概要', entries: '世界观词条',
  timeline: '时间线', name: '名称', aliases: '别名', tags: '标签', notes: '备注', locked: '锁定状态',
  aiVisibility: 'AI 可见性', relations: '关系', customFields: '自定义字段', type: '类型', details: '详细内容',
  // 故事方向候选（StoryDirectionCandidateSchema）
  cards: '方向卡', questions: '方向问答',
  // 剧情分支 / 审校候选
  description: '描述', baseChapterId: '分支起点章节', reviews: '审稿问题',
  // 项目级键（保守保留，避免常见键落进「其他内容」）
  storylines: '故事线', settings: '创作规格', worldBible: '世界观', outline: '大纲', memories: '记忆记录', plotThreads: '伏笔'
}

/**
 * 把候选字段名翻译成给作者看的中文标签，并去重。
 * 未收录的键折成「其他内容」，保证原始英文键名不会出现在界面上。
 */
export function candidateFieldLabels(fields: readonly string[]): string[] {
  const labels = fields.map((field) => CANDIDATE_FIELD_LABELS[field] ?? '其他内容')
  return [...new Set(labels)]
}

export function buildRevisionCandidates(
  revisions: readonly NovelRevisionProposal[],
  project: NovelProject | undefined
): RevisionCandidatesModel {
  if (!project) {
    return {
      kind: 'candidates',
      hasProject: false,
      rows: [],
      counts: { total: 0, pending: 0, applied: 0, rejected: 0, conflicted: 0, stale: 0, linked: 0 },
      targetGroups: [],
      notice: REVIEW_NOTICE_CANDIDATE_GATE
    }
  }

  const reviewById = new Map(project.reviews.map((review) => [review.id, review]))

  const rows: RevisionCandidateRow[] = revisions.map((proposal) => {
    const lag = project.revision - proposal.baseRevision
    const linkedReview = proposal.reviewId ? reviewById.get(proposal.reviewId) : undefined
    return {
      id: proposal.id,
      summary: proposal.summary,
      kind: proposal.kind,
      target: proposal.target,
      targetLabel: CANDIDATE_TARGET_LABELS[proposal.target] ?? proposal.target,
      targetId: proposal.targetId,
      status: proposal.status,
      createdAt: proposal.createdAt,
      baseRevision: proposal.baseRevision,
      revisionLag: Math.max(0, lag),
      stale: lag > 0,
      reviewId: proposal.reviewId,
      linkedReviewTitle: linkedReview?.title,
      qualityCount: proposal.qualityFindings?.length ?? 0,
      sceneQualityCount: proposal.sceneQualityFindings?.length ?? 0,
      structureImpact: proposal.structureImpact ? summarizeImpact(proposal.structureImpact) : undefined,
      candidateFields: candidateFieldNames(proposal.candidate),
      candidateFieldLabels: candidateFieldLabels(candidateFieldNames(proposal.candidate))
    }
  })

  const pending = rows.filter((row) => row.status === '待处理')
  const targets = Object.keys(CANDIDATE_TARGET_LABELS)

  return {
    kind: 'candidates',
    hasProject: true,
    rows,
    counts: {
      total: rows.length,
      pending: pending.length,
      applied: rows.filter((row) => row.status === '已应用').length,
      rejected: rows.filter((row) => row.status === '已拒绝').length,
      conflicted: rows.filter((row) => row.status === '已冲突').length,
      stale: pending.filter((row) => row.stale).length,
      linked: rows.filter((row) => Boolean(row.reviewId)).length
    },
    targetGroups: targets
      .map((target) => ({ target, label: CANDIDATE_TARGET_LABELS[target]!, count: rows.filter((row) => row.target === target).length }))
      .filter((group) => group.count > 0),
    notice: REVIEW_NOTICE_CANDIDATE_GATE
  }
}

/** 结构调整影响摘要：只拼接真实存在的字段，不补数字。 */
function summarizeImpact(impact: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(impact)) {
    if (typeof value === 'number') parts.push(`${key} ${value}`)
    else if (typeof value === 'string' && value) parts.push(`${key}：${value}`)
    else if (Array.isArray(value)) parts.push(`${key} ${value.length} 项`)
  }
  return parts.length ? parts.join(' · ') : '结构调整影响未记录明细'
}

// ================================================================ 页 4 · 剧情分支

export type StoryBranchChapterRow = { id: string; label: string; title: string; words: number }

export type StoryBranchRow = {
  id: string
  name: string
  description: string
  status: string
  baseChapterLabel: string
  baseChapterTitle: string
  /** 来源章节是否仍在项目里：缺失时如实说明，不拿第一版章节顶替。 */
  baseChapterFound: boolean
  chapterCount: number
  words: number
  chapters: StoryBranchChapterRow[]
  createdAt: string
  updatedAt: string
  baseRevision?: number
  /** 分支基线版本与当前版本之差；未记录时为 undefined。 */
  revisionLag?: number
  hasSourceDigest: boolean
  hasCurrentDigest: boolean
  freshness: BranchFreshnessState
  freshnessTone: 'ok' | 'amber' | 'danger'
  freshnessDetail: string
  adoptable: boolean
  adoptBlockedReason?: string
}

export type StoryBranchesModel = {
  kind: 'branches'
  hasProject: boolean
  rows: StoryBranchRow[]
  counts: {
    total: number
    drafting: number
    comparable: number
    adopted: number
    archived: number
    fresh: number
    stale: number
    missingSource: number
    /** 当前可以点「采用」的分支数量。 */
    adoptable: number
  }
  notice: ReviewNotice
  freshnessNotice: ReviewNotice
}

function branchFreshnessDetail(freshness: BranchFreshnessState): string {
  if (freshness === '最新') return '来源章节在生成分支后没有变化，可以按现在的正文比较。'
  if (freshness === '需要重新比较') return '来源章节的正文在分支生成之后已变化，比较结论可能不再成立。'
  return '缺少来源版本记录，无法判断分支是否仍然适用；请重新生成分支后再比较。'
}

function branchFreshnessTone(freshness: BranchFreshnessState): 'ok' | 'amber' | 'danger' {
  if (freshness === '最新') return 'ok'
  return freshness === '需要重新比较' ? 'amber' : 'danger'
}

export function buildStoryBranches(project: NovelProject | undefined): StoryBranchesModel {
  if (!project) {
    return {
      kind: 'branches',
      hasProject: false,
      rows: [],
      counts: { total: 0, drafting: 0, comparable: 0, adopted: 0, archived: 0, fresh: 0, stale: 0, missingSource: 0, adoptable: 0 },
      notice: REVIEW_NOTICE_BRANCH_ADOPT,
      freshnessNotice: REVIEW_NOTICE_BRANCH_FRESHNESS
    }
  }

  const chapterById = new Map(project.chapters.map((chapter) => [chapter.id, chapter]))

  const rows: StoryBranchRow[] = project.branches.map((branch) => {
    const baseChapter = chapterById.get(branch.baseChapterId)
    // 当前摘要取自「分支的来源章节」——分支正是基于这一章的正文生成的。
    const freshness = branchFreshness(branch, { revision: project.revision, sourceDigest: baseChapter?.sourceDigest })
    const chapters: StoryBranchChapterRow[] = [...branch.chapters]
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((chapter) => ({
        id: chapter.id,
        label: chapterLabel(chapter.chapterNumber),
        title: chapter.title || '未命名',
        words: chapterWordCount(chapter)
      }))
    const blocked = branchAdoptBlockedReason(branch, freshness)
    return {
      id: branch.id,
      name: branch.name,
      description: branch.description,
      status: branch.status,
      baseChapterLabel: baseChapter ? chapterLabel(baseChapter.chapterNumber) : '来源章节已不在项目中',
      baseChapterTitle: baseChapter?.title ?? '',
      baseChapterFound: Boolean(baseChapter),
      chapterCount: branch.chapters.length,
      words: chapters.reduce((sum, chapter) => sum + chapter.words, 0),
      chapters,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
      baseRevision: branch.baseRevision,
      revisionLag: branch.baseRevision === undefined ? undefined : Math.max(0, project.revision - branch.baseRevision),
      hasSourceDigest: Boolean(branch.sourceDigest),
      hasCurrentDigest: Boolean(baseChapter?.sourceDigest),
      freshness,
      freshnessTone: branchFreshnessTone(freshness),
      freshnessDetail: branchFreshnessDetail(freshness),
      adoptable: blocked === undefined,
      adoptBlockedReason: blocked
    }
  })

  return {
    kind: 'branches',
    hasProject: true,
    rows,
    counts: {
      total: rows.length,
      drafting: rows.filter((row) => row.status === '构思中').length,
      comparable: rows.filter((row) => row.status === '可比较').length,
      adopted: rows.filter((row) => row.status === '已采用').length,
      archived: rows.filter((row) => row.status === '已归档').length,
      fresh: rows.filter((row) => row.freshness === '最新').length,
      stale: rows.filter((row) => row.freshness === '需要重新比较').length,
      missingSource: rows.filter((row) => row.freshness === '来源缺失').length,
      adoptable: rows.filter((row) => row.adoptable).length
    },
    notice: REVIEW_NOTICE_BRANCH_ADOPT,
    freshnessNotice: REVIEW_NOTICE_BRANCH_FRESHNESS
  }
}

/**
 * 「采用」按钮的禁用理由。返回 undefined 表示可以点。
 * 三条理由都来自真实数据，不是风格偏好：
 *   - 已采用：这一分支已经生成过采用候选，重复点会产生重复候选；
 *   - 来源缺失：无法确定分支基于哪个正文版本，采用后的比较结论不可信。
 */
export function branchAdoptBlockedReason(branch: Pick<NovelBranch, 'status'> & Partial<Pick<NovelBranch, 'chapters'>>, freshness: BranchFreshnessState): string | undefined {
  if (branch.status === '已采用') return '该分支已采用，已经生成过采用候选；如需再改请直接处理那条候选。'
  if (branch.status === '已归档') return '分支已归档，不能继续采用。'
  if (branch.chapters && branch.chapters.length === 0) return '分支还没有备选正文，请先生成并确认候选。'
  if (freshness === '来源缺失') return '缺少来源版本记录，无法确认它基于哪一版正文；请重新生成分支后再比较。'
  return undefined
}

// ================================================================ 页 5 · 版本历史

/**
 * 差异预览的七个覆盖范围。与契约 `NovelVersionDiffScopeSchema` 完全一致
 * （测试里逐项比对 options，避免页面自行发明范围）。
 */
export const VERSION_DIFF_SCOPES = ['正文', '大纲', '世界观', '记忆', '伏笔', '审稿', '分支'] as const
export type VersionDiffScope = (typeof VERSION_DIFF_SCOPES)[number]

/** 作者没有填写检查点名称时使用的默认名称（store.createCheckpoint 内部同口径）。 */
export const CHECKPOINT_DEFAULT_REASON = '手动检查点'

export type VersionHistoryRow = {
  id: string
  revision: number
  /** 服务端写入的快照原因（reason），如「手动检查点」「应用候选前自动快照」。 */
  reason: string
  /** 服务端写入的快照来源（source）。 */
  source: string
  createdAt: string
  /** 该快照的版本号是否等于当前项目版本号。 */
  isCurrent: boolean
  /** 相对当前版本落后多少版；当前版本及更新的记录记为 0。 */
  revisionLag: number
}

export type VersionHistoryModel = {
  kind: 'history'
  hasProject: boolean
  /** ① 版本目录：真实 versions，按版本号降序（同版本号按时间降序）。 */
  rows: VersionHistoryRow[]
  counts: {
    total: number
    /** 与当前项目 revision 相同的快照数量（正常为 0 或 1）。 */
    atCurrent: number
    /** 目录里最老 / 最新的快照版本号；无快照时为 undefined。 */
    oldestRevision?: number
    newestRevision?: number
  }
  /**
   * ② 当前版本摘要：revision / 状态 / 时间 / 字数 / 章节数全部来自真实项目，
   * 快照元数据来自真实 versions。这里不给出任何变更条数 —— 那需要差异预览。
   */
  current: {
    revision: number
    status: string
    updatedAt: string
    words: number
    chapterCount: number
    /** 与当前 revision 相同的快照（有则展示其真实元数据）。 */
    snapshot?: VersionHistoryRow
    /** 目录中最新的快照，仅作参考。 */
    latest?: VersionHistoryRow
  }
  /**
   * ③ 差异预览：端点已真实接通（GET .../restore-preview）。`connected` 只表示
   * **能力已接通**，绝不等于「预览成功」——成功与否一律看 `status`。
   */
  diffPreview: {
    connected: boolean
    /** 未预览 / 正在加载 / 预览失败 / 预览有效 —— 四态互斥，界面据此区分显示。 */
    status: VersionPreviewStatus
    /** 仅当 status==='预览有效' 时存在，且内容已通过契约解析。 */
    summary?: {
      versionId: string
      targetRevision: number
      currentRevision: number
      totalDiffs: number
      scopes: Array<{ scope: string; changed: number; added: number; removed: number; sample: string[] }>
    }
    /** 仅当 status==='预览失败' 时存在；绝不显示任何差异内容。 */
    error?: string
    scopes: readonly VersionDiffScope[]
    notice: ReviewNotice
  }
  /** ④ 命名检查点：作者可以自己命名，留空时落到 store 的默认名。 */
  namedCheckpoint: {
    /** 自定义命名输入是否可用。store.createCheckpoint(reason?) 接收作者填写的名称 → true。 */
    customNameEnabled: true
    /** 作者留空时 store 使用的默认名称，如实展示给作者。 */
    defaultReason: string
    /** 是否可用：有项目即可，创建走 store 既有的 createCheckpoint。 */
    canCreate: boolean
    notice: ReviewNotice
  }
  /**
   * ⑤ 受控恢复：状态由契约 `versionRestoreState()` 判定，且预览必须属于
   * **当前选中的那条快照**才可能为「可恢复」。
   */
  restore: {
    state: ReturnType<typeof versionRestoreState>
    /** store 的真实保存状态；保存中与未保存一样不可恢复。 */
    saveState?: '已保存' | '正在保存' | '未保存' | '保存失败'
    /** 契约判定为「当前稿未保存」时，用真实的保存状态把原因说准。 */
    unsavedReason?: string
    /** 当前预览属于哪条快照（可能不是选中的那条）。 */
    previewVersionId?: string
    /** 预览存在但不属于选中快照 —— 界面据此提示重新预览。 */
    previewOnOtherSnapshot: boolean
    notice: ReviewNotice
  }
  /** ⑥ 删除版本：真实逐条删除（store.removeVersion），不支持批量。 */
  remove: {
    supported: true
    canRemove: boolean
    removableCount: number
    notice: ReviewNotice
  }
}

/** 预览的四态。'未预览' 与 '正在加载' 都不得显示任何差异内容。 */
export type VersionPreviewStatus = '未预览' | '正在加载' | '预览失败' | '预览有效'

/**
 * 交给模型校验的预览入参。这里**故意**放宽 `scope` 为 string：真实来源是 HTTP 响应，
 * 未经过前端校验，必须由 `NovelVersionRestorePreviewSchema.safeParse` 收口 ——
 * 不满足契约就报「预览失败」并禁用恢复，不用强转、不用默认值伪装成有效预览。
 */
export type VersionRestorePreviewInput = {
  projectId: string
  versionId: string
  targetRevision: number
  currentRevision: number
  previewDigest: string
  createdAt: string
  diffs: Array<{ scope: string; changed: number; added: number; removed: number; sample: string[] }>
}

export type VersionRestoreInput = {
  /** 页面当前选中的快照 id；预览必须属于它才可能放行恢复。 */
  selectedVersionId?: string
  /** store 里真实的预览；没预览过时为 undefined。 */
  preview?: VersionRestorePreviewInput
  /** store 侧的预览请求状态；省略视为空闲。 */
  previewState?: '空闲' | '正在加载' | '预览失败'
  /** store 给出的预览失败原因。 */
  previewError?: string
  /** store 的真实保存状态。**不传就不算「已保存」**，见下方 hasUnsavedDraft 推导。 */
  saveState?: '已保存' | '正在保存' | '未保存' | '保存失败'
}

export function buildVersionHistory(
  project: NovelProject | undefined,
  versions: readonly NovelVersionSummary[],
  restoreInput?: VersionRestoreInput
): VersionHistoryModel {
  const currentRevision = project?.revision
  const rows: VersionHistoryRow[] = [...versions]
    .sort((a, b) => b.revision - a.revision || b.createdAt.localeCompare(a.createdAt))
    .map((version) => ({
      id: version.id,
      revision: version.revision,
      reason: version.reason,
      source: version.source,
      createdAt: version.createdAt,
      isCurrent: currentRevision !== undefined && version.revision === currentRevision,
      revisionLag: currentRevision === undefined ? 0 : Math.max(0, currentRevision - version.revision)
    }))

  const remove = {
    supported: true,
    canRemove: rows.length > 0,
    removableCount: rows.length,
    notice: REVIEW_NOTICE_VERSION_REMOVE
  } as const

  // ------------------------------------------------ ③ 差异预览：四态，不是布尔
  // 预览来自 HTTP 响应，必须先过契约。失败时**不保留任何差异内容**，也不用默认值兜底。
  const parsedPreview = restoreInput?.preview
    ? NovelVersionRestorePreviewSchema.safeParse(restoreInput.preview)
    : undefined
  const previewRejected = parsedPreview !== undefined && !parsedPreview.success
  const contractPreview = parsedPreview?.success ? parsedPreview.data : undefined

  const previewStatus: VersionPreviewStatus =
    previewRejected || restoreInput?.previewState === '预览失败'
      ? '预览失败'
      : restoreInput?.previewState === '正在加载'
        ? '正在加载'
        : contractPreview
          ? '预览有效'
          : '未预览'

  const diffPreview: VersionHistoryModel['diffPreview'] = {
    connected: true,
    status: previewStatus,
    // '预览有效' 才带摘要；失败时连条数都不给。
    summary:
      previewStatus === '预览有效' && contractPreview
        ? {
            versionId: contractPreview.versionId,
            targetRevision: contractPreview.targetRevision,
            currentRevision: contractPreview.currentRevision,
            totalDiffs: contractPreview.diffs.length,
            scopes: contractPreview.diffs.map((diff) => ({
              scope: diff.scope as string,
              changed: diff.changed,
              added: diff.added,
              removed: diff.removed,
              sample: [...diff.sample]
            }))
          }
        : undefined,
    error:
      previewStatus === '预览失败'
        ? previewRejected
          ? '预览数据格式不正确，已拒绝使用：本次不显示任何差异内容，也不允许恢复。请重新预览。'
          : (restoreInput?.previewError ?? '预览请求失败，未取得差异内容。')
        : undefined,
    scopes: VERSION_DIFF_SCOPES,
    notice: REVIEW_NOTICE_DIFF_PREVIEW
  }

  // ------------------------------------------------ ⑤ 受控恢复：预览必须属于选中快照
  // 预览存在但不属于当前选中的快照 → 视为「没有可用于这条快照的预览」。
  const selectedVersionId = restoreInput?.selectedVersionId
  const previewForSelection =
    contractPreview && selectedVersionId !== undefined && contractPreview.versionId === selectedVersionId
      ? contractPreview
      : undefined

  /**
   * 保存状态未知时按「不安全」处理：不传 saveState 绝不被当成已保存。
   * 「正在保存」与「未保存」都算未保存草稿 —— 保存中恢复会丢掉还没落库的输入。
   */
  const hasUnsavedDraft = restoreInput?.saveState !== '已保存'
  const unsavedReason =
    restoreInput?.saveState === '正在保存'
      ? '当前修改正在保存，等保存完成后再恢复，否则会丢掉还没落库的内容。'
      // 保存失败也落在「未保存草稿」这一类：改动没落库，恢复同样会丢输入，
      // 沿用同一句既有文案，不新增第二种说法。
      : restoreInput?.saveState === '未保存' || restoreInput?.saveState === '保存失败'
        ? '当前稿还有未保存的修改，保存成功后才能恢复。'
        : restoreInput?.saveState === undefined && restoreInput?.preview !== undefined
          ? '无法确认当前稿是否已保存，因此不允许恢复。'
          : undefined

  const restoreState = versionRestoreState(
    previewForSelection,
    previewForSelection
      ? { currentRevision: previewForSelection.currentRevision, previewDigest: previewForSelection.previewDigest }
      : undefined,
    { revision: currentRevision ?? 0, hasUnsavedDraft }
  )

  const restore: VersionHistoryModel['restore'] = {
    state: restoreState,
    saveState: restoreInput?.saveState,
    unsavedReason: restoreState === '当前稿未保存' ? unsavedReason : undefined,
    previewVersionId: contractPreview?.versionId,
    previewOnOtherSnapshot: Boolean(
      contractPreview && (selectedVersionId === undefined || contractPreview.versionId !== selectedVersionId)
    ),
    notice: REVIEW_NOTICE_CONTROLLED_RESTORE
  }

  if (!project) {
    return {
      kind: 'history',
      hasProject: false,
      // 没有项目时不展示任何快照行：无法确认这些快照属于哪个项目。
      rows: [],
      counts: { total: 0, atCurrent: 0 },
      current: { revision: 0, status: '', updatedAt: '', words: 0, chapterCount: 0 },
      diffPreview,
      namedCheckpoint: {
        customNameEnabled: true,
        defaultReason: CHECKPOINT_DEFAULT_REASON,
        canCreate: false,
        notice: REVIEW_NOTICE_NAMED_CHECKPOINT
      },
      restore,
      remove: { ...remove, canRemove: false, removableCount: 0 }
    }
  }

  const revisionNumbers = rows.map((row) => row.revision)

  return {
    kind: 'history',
    hasProject: true,
    rows,
    counts: {
      total: rows.length,
      atCurrent: rows.filter((row) => row.isCurrent).length,
      oldestRevision: revisionNumbers.length ? Math.min(...revisionNumbers) : undefined,
      newestRevision: revisionNumbers.length ? Math.max(...revisionNumbers) : undefined
    },
    current: {
      revision: project.revision,
      status: project.status,
      updatedAt: project.updatedAt,
      words: project.chapters.reduce((sum, chapter) => sum + chapterWordCount(chapter), 0),
      chapterCount: project.chapters.length,
      snapshot: rows.find((row) => row.isCurrent),
      latest: rows[0]
    },
    diffPreview,
    namedCheckpoint: {
      customNameEnabled: true,
      defaultReason: CHECKPOINT_DEFAULT_REASON,
      canCreate: true,
      notice: REVIEW_NOTICE_NAMED_CHECKPOINT
    },
    restore,
    remove
  }
}
