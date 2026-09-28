import { useMemo, useState } from 'react'
import type { NovelProject } from '../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../novelStore'
import { SettingProposalHint } from './SettingProposalHint'
import { ExportManuscriptPage } from './review/ExportManuscriptPage'
import { ReviewIssuesPage } from './review/ReviewIssuesPage'
import { RevisionCandidatesPage } from './review/RevisionCandidatesPage'
import { StoryBranchesPage } from './review/StoryBranchesPage'
import { VersionHistoryPage } from './review/VersionHistoryPage'
import {
  buildExportManifest,
  buildReviewIssues,
  buildRevisionCandidates,
  buildStoryBranches,
  buildVersionHistory,
  reviewPageKind,
  type ReviewPageId
} from './review/reviewModel'
import { applyAddReviewIssue, applyReopenReviewIssue, applyReviewResolution, type WriteResult } from './review/reviewWriting'
import { applyArchiveStoryBranch, applyCreateStoryBranch } from './review/branchWriting'

/**
 * 审稿与导出栏目（含 5 个二级页面）。
 *
 * 旧实现是一个 203 行的单视图：连续性报告、修改候选、导出与版本历史全挤在一屏里，
 * 二级入口指向的是**同一份内容**。新版按 `subnavId` 分成真正不同的页面：
 *   导出成稿 / 审稿问题 / AI 修改候选 / 剧情分支 / 版本历史
 *
 * 数据全部来自真实来源：`NovelProject`（chapters / reviews / branches）、store 的
 * `revisions` 与 `versions`，以及契约里的 `branchFreshness()` / `reviewResolutionState()`
 * / `versionRestoreState()`。
 *
 * 写入边界（本栏目最硬的一条）：
 *   - 写入都**逐一复用 store 既有动作**，本文件不新增任何第二条保存通道：
 *     导出与检查点走 `exportProject` / `createCheckpoint`，改问题状态走 `updateProject`
 *     （旧视图已经这么用），候选与分支走 `applyRevision` / `rejectRevision` / `adoptBranch`，
 *     删除快照走 `removeVersion`（真实 DELETE /versions/:id，逐条）；
 *   - **恢复只走受控通道**：版本历史页只用 store 的 `previewVersionRestore` +
 *     `restoreVersion`（先预览差异、再带 currentRevision / previewDigest 提交），
 *     并把真实选中快照与 `saveState` 一起交给模型判定 —— 换选中、改正文、保存中、
 *     预览过期都会让按钮立刻不可用；旧的直接恢复通道不接入本页。
 *   - 分支创建、归档和批量候选处理沿用同一项目保存与候选确认边界。
 */
export function ReviewView({
  project,
  subnavId,
  onNavigate,
  onOpenSettingProposals
}: {
  project: NovelProject
  /** 当前二级页面 id（WorkspaceNavigationTarget.subnavId）。 */
  subnavId: string
  onNavigate: (page: ReviewPageId) => void
  /** 跨栏目跳到唯一的设定提案管理界面（世界观 · 扩展世界观）。 */
  onOpenSettingProposals: () => void
}): React.JSX.Element {
  const revisions = useNovelStore((state) => state.revisions)
  const versions = useNovelStore((state) => state.versions)
  const busy = useNovelStore((state) => state.busy)
  const applyRevision = useNovelStore((state) => state.applyRevision)
  const rejectRevision = useNovelStore((state) => state.rejectRevision)
  const resolveRevisionBatch = useNovelStore((state) => state.resolveRevisionBatch)
  const adoptBranch = useNovelStore((state) => state.adoptBranch)
  const exportProject = useNovelStore((state) => state.exportProject)
  const createCheckpoint = useNovelStore((state) => state.createCheckpoint)
  const removeVersion = useNovelStore((state) => state.removeVersion)
  const restorePreview = useNovelStore((state) => state.restorePreview)
  const restorePreviewState = useNovelStore((state) => state.restorePreviewState)
  const restorePreviewError = useNovelStore((state) => state.restorePreviewError)
  const previewVersionRestore = useNovelStore((state) => state.previewVersionRestore)
  const restoreVersion = useNovelStore((state) => state.restoreVersion)
  const saveState = useNovelStore((state) => state.saveState)
  const updateProject = useNovelStore((state) => state.updateProject)
  const kind = reviewPageKind(subnavId)

  /**
   * 版本历史里当前选中的快照。提到这里是因为「能不能恢复」必须同时看
   * 预览属于哪条快照 —— 选中变了而预览还停在旧快照上时，恢复必须立刻不可用。
   */
  const [selectedVersionId, setSelectedVersionId] = useState<string>()

  /**
   * 审稿问题的写入统一走同一条保存通道：先在草稿上跑纯 mutator，
   * 失败就不写库并把原因交回页面就地提示，成功才交给 `updateProject` 落库。
   */
  function reportWrite(mutate: (draft: NovelProject) => WriteResult): string | undefined {
    const probe = structuredClone(project)
    const result = mutate(probe)
    if (!result.ok) return result.message ?? '这次操作没有生效。'
    updateProject((draft) => {
      mutate(draft)
    })
    return undefined
  }

  const model = useMemo(() => {
    switch (kind) {
      case 'issues':
        return buildReviewIssues(project)
      case 'candidates':
        return buildRevisionCandidates(revisions, project)
      case 'branches':
        return buildStoryBranches(project)
      case 'history':
        return buildVersionHistory(project, versions, {
          selectedVersionId,
          preview: restorePreview,
          previewState: restorePreviewState,
          previewError: restorePreviewError,
          saveState
        })
      default:
        return buildExportManifest(project, versions)
    }
  }, [kind, project, revisions, versions, selectedVersionId, restorePreview, restorePreviewState, restorePreviewError, saveState])

  switch (model.kind) {
    case 'issues':
      return (
        <>
          <SettingProposalHint scope="审稿问题与修改候选" onOpen={onOpenSettingProposals} />
          <ReviewIssuesPage
            model={model}
            project={project}
            busy={busy}
            onGoTo={onNavigate}
            onCreate={(input) => reportWrite((draft) => applyAddReviewIssue(draft, { ...input, id: `review-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}` }, new Date().toISOString()))}
            onResolve={(id, input) => reportWrite((draft) => applyReviewResolution(draft, id, input, new Date().toISOString()))}
            onReopen={(id) => reportWrite((draft) => applyReopenReviewIssue(draft, id))}
          />
        </>
      )
    case 'candidates':
      return (
        <RevisionCandidatesPage
          model={model}
          busy={busy}
          onGoTo={onNavigate}
          onApply={(id) => void applyRevision(id)}
          onReject={(id) => void rejectRevision(id)}
          onBatchResolve={(ids, action) => void resolveRevisionBatch(ids, action)}
        />
      )
    case 'branches':
      return (
        <StoryBranchesPage
          model={model}
          project={project}
          busy={busy}
          onGoTo={onNavigate}
          onAdopt={(branchId) => void adoptBranch(branchId)}
          onCreate={(name, baseChapterId) => {
            const input = { id: crypto.randomUUID(), name, baseChapterId, now: new Date().toISOString() }
            return reportWrite((draft) => applyCreateStoryBranch(draft, input))
          }}
          onGenerate={(branchId) => void useNovelStore.getState().generate({ kind: 'branch', branchId })}
          onArchive={(branchId) => {
            const now = new Date().toISOString()
            return reportWrite((draft) => applyArchiveStoryBranch(draft, branchId, now))
          }}
        />
      )
    case 'history':
      return (
        <VersionHistoryPage
          model={model}
          busy={busy}
          onGoTo={onNavigate}
          onCreateCheckpoint={(reason) => void createCheckpoint(reason)}
          onRemoveVersion={(versionId) => void removeVersion(versionId)}
          selectedVersionId={selectedVersionId}
          onSelectVersion={setSelectedVersionId}
          restorePreview={restorePreview}
          onPreviewRestore={(versionId) => void previewVersionRestore(versionId)}
          onRestore={(versionId) => void restoreVersion(versionId)}
        />
      )
    default:
      return (
        <ExportManuscriptPage
          model={model}
          project={project}
          busy={busy}
          onGoTo={onNavigate}
          onExport={(format) => exportProject(format)}
        />
      )
  }
}
