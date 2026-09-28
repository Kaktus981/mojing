import type { NovelProject } from '../../../../../../../packages/contracts/src'
import {
  ExportPrecheckSchema,
  exportPrecheckAllowsExport,
  exportPrecheckState
} from '../../../../../../../packages/contracts/src'

/** 与 NovelExportFormatSchema 一致；这里只做入参标注，取值仍由契约校验。 */
export type NovelExportFormat = 'json' | 'docx' | 'txt' | 'md'

/**
 * M7 · 导出前的**本地确定性预检**。
 *
 * 它只读项目数据与当前保存状态，不依赖任何 AI，也不修改内容：
 *   - 阻断（blockers）：保存没成功、结构损坏、引用悬空、没有任何可导出正文；
 *   - 提醒（warnings）：空章、草稿章、待处理审稿问题、过期记忆、逾期伏笔、未应用候选。
 * 预检结果绑定 `projectRevision` 与目标格式，内容或格式一变立刻算「已过期」，
 * 界面不得继续显示「已就绪」。
 */
export type ExportPrecheckContext = {
  /** store 的保存状态：只有「已保存」才允许导出。 */
  saveState: string
  /** 尚未应用的候选数量（来自 store，不在项目文档里）。 */
  pendingProposalCount: number
  now: string
}

export function buildExportPrecheck(
  project: NovelProject,
  format: NovelExportFormat,
  context: ExportPrecheckContext
): ReturnType<typeof ExportPrecheckSchema.parse> {
  const blockers: Array<{ code: string; message: string }> = []
  const warnings: Array<{ code: string; message: string; targetId?: string }> = []

  if (context.saveState !== '已保存') {
    blockers.push({
      code: '保存失败',
      message: `当前保存状态是「${context.saveState}」，还有改动没有落库。先保存成功再导出，避免导出旧稿。`
    })
  }

  const numbers = project.chapters.map((chapter) => chapter.chapterNumber)
  const duplicated = [...new Set(numbers.filter((number, index) => numbers.indexOf(number) !== index))]
  if (duplicated.length) {
    blockers.push({ code: '项目结构损坏', message: `有章节共用同一个章号（${duplicated.join('、')}），请先在章节规划里修正。` })
  }

  const chapterIds = new Set(project.chapters.map((chapter) => chapter.id))
  const blockIds = new Set(project.chapters.flatMap((chapter) => chapter.blocks.map((block) => block.id)))
  const missing: string[] = []
  for (const memory of project.memories) {
    if (!chapterIds.has(memory.chapterId)) missing.push(`章节记忆「${(memory.summary ?? '').slice(0, 12) || memory.id}」`)
  }
  for (const thread of project.plotThreads) {
    if (thread.setupChapterId && !chapterIds.has(thread.setupChapterId)) missing.push(`伏笔「${thread.title}」的埋设章节`)
    if (thread.resolutionChapterId && !chapterIds.has(thread.resolutionChapterId)) missing.push(`伏笔「${thread.title}」的回收章节`)
    for (const evidence of thread.evidencePool ?? []) {
      if (!chapterIds.has(evidence.chapterId) || (evidence.blockId && !blockIds.has(evidence.blockId))) {
        missing.push(`伏笔「${thread.title}」的证据位置`)
      }
    }
  }
  for (const review of project.reviews) {
    for (const evidence of review.evidence) {
      if (!chapterIds.has(evidence.chapterId) || (evidence.blockId && !blockIds.has(evidence.blockId))) {
        missing.push(`审稿问题「${review.title}」的证据位置`)
      }
    }
  }
  /**
   * JSON 完整备份是「原样导出」，内容层面的问题（引用悬空、没有正文）不影响它安全序列化，
   * 因此这些只阻断面向读者的成稿格式；备份本身只受「保存没成功」影响。
   */
  if (format !== 'json' && missing.length) {
    blockers.push({
      code: '存在缺失引用',
      message: `${missing.length} 处引用指向已不存在的章节或段落（${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}），请先修复再导出。`
    })
  }

  const written = project.chapters.filter((chapter) => chapter.blocks.some((block) => block.text.trim()))
  if (format !== 'json' && written.length === 0) {
    blockers.push({ code: '无可导出正文', message: '还没有任何正文内容。JSON 完整备份仍然可以导出。' })
  }

  const emptyChapters = project.chapters.filter((chapter) => !chapter.blocks.some((block) => block.text.trim()))
  if (format !== 'json' && emptyChapters.length > 0) {
    warnings.push({ code: '空章节', message: `有 ${emptyChapters.length} 章没有任何正文，导出后是空章。` })
  }
  const draftChapters = project.chapters.filter((chapter) => chapter.status === '草稿')
  if (draftChapters.length > 0) {
    warnings.push({ code: '草稿章节', message: `有 ${draftChapters.length} 章仍是草稿状态。` })
  }
  const severe = project.reviews.filter((review) => review.status === '待处理' && review.severity === '高')
  if (severe.length > 0) {
    warnings.push({ code: '高风险审稿问题', message: `有 ${severe.length} 条高风险审稿问题还没有处理。`, targetId: severe[0]!.id })
  }
  const pendingReviews = project.reviews.filter((review) => review.status === '待处理' && review.severity !== '高')
  if (pendingReviews.length > 0) {
    warnings.push({ code: '未处理审稿问题', message: `还有 ${pendingReviews.length} 条待处理的审稿问题。`, targetId: pendingReviews[0]!.id })
  }
  const stale = project.memories.filter((memory) => memory.status === '需更新')
  if (stale.length > 0) {
    warnings.push({ code: '过期记忆', message: `有 ${stale.length} 条章节记忆需要复核后再定稿。` })
  }
  const overdue = project.plotThreads.filter((thread) => thread.status === '逾期')
  if (overdue.length > 0) {
    warnings.push({ code: '逾期伏笔', message: `有 ${overdue.length} 条伏笔已逾期未回收。`, targetId: overdue[0]!.id })
  }
  if (context.pendingProposalCount > 0) {
    warnings.push({ code: '未应用候选', message: `还有 ${context.pendingProposalCount} 条修改候选没有处理。` })
  }

  return ExportPrecheckSchema.parse({
    projectId: project.id,
    projectRevision: project.revision,
    format,
    checkedAt: context.now,
    source: '本地预检',
    blockers,
    warnings
  })
}

export { exportPrecheckState, exportPrecheckAllowsExport }
