import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { WriteResult } from './reviewWriting'

/** 新分支只记录真实起点；正文必须由后续候选生成并经作者确认。 */
export function applyCreateStoryBranch(draft: NovelProject, input: { id: string; name: string; baseChapterId: string; now: string }): WriteResult {
  const name = input.name.trim()
  const source = draft.chapters.find((chapter) => chapter.id === input.baseChapterId)
  if (!name) return { ok: false, message: '请填写分支名称。' }
  if (!source) return { ok: false, message: '起点章节已不存在，请重新选择。' }
  if (draft.branches.some((branch) => branch.id === input.id)) return { ok: false, message: '分支已存在。' }
  draft.branches.push({ id: input.id, name, description: '', baseChapterId: source.id, chapters: [], status: '构思中', baseRevision: draft.revision, sourceDigest: source.sourceDigest, createdAt: input.now, updatedAt: input.now })
  return { ok: true }
}

/** 归档代替硬删除，已有候选、版本与来源证据仍可追溯。 */
export function applyArchiveStoryBranch(draft: NovelProject, branchId: string, now: string): WriteResult {
  const branch = draft.branches.find((item) => item.id === branchId)
  if (!branch) return { ok: false, message: '找不到分支。' }
  if (branch.status === '已归档') return { ok: false, message: '分支已经归档。' }
  branch.status = '已归档'
  branch.updatedAt = now
  return { ok: true }
}
