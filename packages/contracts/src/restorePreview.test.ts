import { describe, expect, it } from 'vitest'
import { branchFreshness, type NovelBranch } from './novel'
import { NovelVersionRestorePreviewSchema, NovelVersionRestoreRequestSchema, versionRestoreState } from './novelApi'

const createdAt = '2026-09-13T10:00:00.000Z'

function preview(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'novel', versionId: 'version-3', targetRevision: 5, currentRevision: 12,
    previewDigest: 'digest-preview-1', createdAt,
    diffs: [{ scope: '正文' as const, changed: 4, added: 1, removed: 0, sample: ['第 3 章第 2 段'] }],
    ...overrides
  }
}

describe('阶段 1.5 版本恢复预览与分支新鲜度契约', () => {
  it('恢复预览绑定当前 revision 与预览摘要，并给出分范围真实差异', () => {
    expect(NovelVersionRestorePreviewSchema.safeParse(preview()).success).toBe(true)
    const allScopes = NovelVersionRestorePreviewSchema.safeParse(preview({
      diffs: ['正文', '大纲', '世界观', '记忆', '伏笔', '审稿', '分支'].map((scope) => ({ scope, changed: 0, added: 0, removed: 0, sample: [] }))
    }))
    expect(allScopes.success).toBe(true)
    expect(NovelVersionRestorePreviewSchema.safeParse(preview({ diffs: [{ scope: '随便', changed: 0, added: 0, removed: 0, sample: [] }] })).success).toBe(false)
    expect(NovelVersionRestorePreviewSchema.safeParse({ ...preview(), previewDigest: undefined }).success).toBe(false)
  })

  it('恢复请求必须携带 currentRevision 与预览摘要', () => {
    expect(NovelVersionRestoreRequestSchema.safeParse({ currentRevision: 12, previewDigest: 'digest-preview-1' }).success).toBe(true)
    expect(NovelVersionRestoreRequestSchema.safeParse({ currentRevision: 12 }).success).toBe(false)
  })

  it('缺少预览时不允许恢复，必须先看真实差异', () => {
    expect(versionRestoreState(undefined, undefined, { revision: 12, hasUnsavedDraft: false })).toBe('预览缺失')
    expect(versionRestoreState(preview(), undefined, { revision: 12, hasUnsavedDraft: false })).toBe('预览缺失')
  })

  it('项目内容变化或预览摘要不匹配时预览过期，需要重新预览', () => {
    expect(versionRestoreState(preview(), { currentRevision: 13, previewDigest: 'digest-preview-1' }, { revision: 13, hasUnsavedDraft: false })).toBe('预览已过期')
    expect(versionRestoreState(preview(), { currentRevision: 12, previewDigest: 'digest-preview-2' }, { revision: 12, hasUnsavedDraft: false })).toBe('预览已过期')
  })

  it('当前稿存在未保存内容时先保存，不允许直接恢复', () => {
    expect(versionRestoreState(preview(), { currentRevision: 12, previewDigest: 'digest-preview-1' }, { revision: 12, hasUnsavedDraft: true })).toBe('当前稿未保存')
    expect(versionRestoreState(preview(), { currentRevision: 12, previewDigest: 'digest-preview-1' }, { revision: 12, hasUnsavedDraft: false })).toBe('可恢复')
  })

  it('剧情分支记录来源 revision 与来源正文摘要，正文变化后标记需要重新比较', () => {
    const branch: NovelBranch = {
      id: 'branch-1', name: '另一种走向', description: '', baseChapterId: 'chapter-3',
      chapters: [], status: '可比较', createdAt, updatedAt: createdAt,
      baseRevision: 6, sourceDigest: 'source-digest-1'
    }
    expect(branchFreshness(branch, { revision: 6, sourceDigest: 'source-digest-1' })).toBe('最新')
    expect(branchFreshness(branch, { revision: 7, sourceDigest: 'source-digest-2' })).toBe('需要重新比较')
    // 旧分支没有来源摘要时不猜“最新”，而是标记来源缺失。
    expect(branchFreshness({ ...branch, sourceDigest: undefined }, { revision: 6, sourceDigest: 'source-digest-1' })).toBe('来源缺失')
    expect(branchFreshness({ ...branch, sourceDigest: 'source-digest-1' }, { revision: 6, sourceDigest: undefined })).toBe('来源缺失')
  })
})
