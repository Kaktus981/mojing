import { useMemo } from 'react'
import type { NovelProject } from '../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../novelStore'
import { SettingProposalHint } from './SettingProposalHint'
import { ForeshadowingPage } from './memory/ForeshadowingPage'
import { MemoryLedgerPage } from './memory/MemoryLedgerPage'
import { MemoryProposalsPage } from './memory/MemoryProposalsPage'
import { MemoryRecallPage } from './memory/MemoryRecallPage'
import { MemoryWorkbenchPage } from './memory/MemoryWorkbenchPage'
import {
  buildForeshadowing,
  buildMemoryLedger,
  buildMemoryProposals,
  buildMemoryRecall,
  buildMemoryWorkbench,
  memoryPageKind,
  resolveTargetChapter,
  type MemoryPageId
} from './memory/memoryModel'

/**
 * 记忆与伏笔栏目（含 5 个二级页面）。
 *
 * 旧实现把 5 个二级入口都指向同一份「提案卡 + 伏笔表格」，而且那张表格会**直接写回**
 * `project.plotThreads`。新版按 `subnavId` 分成真正不同的页面：
 *   记忆工作台 / 长篇记忆召回 / 记忆变更提案 / 伏笔中心 / 正式章节记忆
 *
 * 数据全部来自真实来源：`NovelProject`（memories / plotThreads）、store 的
 * `memoryProposals` 与 `memoryHealth`、以及 store 的 `selectedChapterId`。
 *
 * 写入边界（本栏目最硬的一条）：
 *   - 唯一可用写入是**逐条**接受 / 拒绝记忆提案，走 store 既有的 `resolveMemory`
 *     （内部就是 `mojingClient.memory.resolve`），本文件不新增任何第二条保存通道；
 *   - 伏笔与正式章节记忆是**只读**的：本栏目不再直接 `updateProject` 改状态，
 *     也不渲染任何删除入口，未接通的能力一律以禁用态 + 原因呈现。
 */
export function MemoryView({
  project,
  subnavId,
  selectedChapterId,
  onNavigate,
  onOpenSettingProposals
}: {
  project: NovelProject
  /** 当前二级页面 id（WorkspaceNavigationTarget.subnavId）。 */
  subnavId: string
  /** store 里真实选中的章节；没有选中时由模型退回「章号最大」并如实标注来源。 */
  selectedChapterId?: string
  onNavigate: (page: MemoryPageId) => void
  /** 跨栏目跳到唯一的设定提案管理界面（世界观 · 扩展世界观）。 */
  onOpenSettingProposals: () => void
}): React.JSX.Element {
  const proposals = useNovelStore((state) => state.memoryProposals)
  const health = useNovelStore((state) => state.memoryHealth)
  const busy = useNovelStore((state) => state.busy)
  const resolveMemory = useNovelStore((state) => state.resolveMemory)
  const resolveMemoryBatch = useNovelStore((state) => state.resolveMemoryBatch)
  const kind = memoryPageKind(subnavId)

  const model = useMemo(() => {
    switch (kind) {
      case 'recall': {
        const resolution = resolveTargetChapter(project, selectedChapterId)
        return buildMemoryRecall(project, resolution.chapter?.chapterNumber, resolution.source)
      }
      case 'proposals':
        return buildMemoryProposals({ project, proposals })
      case 'foreshadowing':
        return buildForeshadowing(project)
      case 'ledger':
        return buildMemoryLedger(project)
      default:
        return buildMemoryWorkbench({ project, proposals, health, targetChapterId: selectedChapterId })
    }
  }, [kind, project, proposals, health, selectedChapterId])

  switch (model.kind) {
    case 'recall':
      return <MemoryRecallPage model={model} onGoTo={onNavigate} />
    case 'proposals':
      return (
        <MemoryProposalsPage
          model={model}
          busy={busy}
          onResolve={(id, status) => void resolveMemory(id, status)}
          onBatchResolve={(ids, status) => void resolveMemoryBatch(ids.map((proposalId) => ({ proposalId, status })))}
          onOpenLedger={() => onNavigate('memory-ledger')}
        />
      )
    case 'foreshadowing':
      return (
        <>
          <SettingProposalHint scope="伏笔的埋设与回收" onOpen={onOpenSettingProposals} />
          <ForeshadowingPage model={model} project={project} chapterId={selectedChapterId} />
        </>
      )
    case 'ledger':
      return <MemoryLedgerPage model={model} project={project} chapterId={selectedChapterId} />
    default:
      return (
        <>
          <SettingProposalHint scope="章节记忆与提案" onOpen={onOpenSettingProposals} />
          <MemoryWorkbenchPage model={model} onGoTo={onNavigate} />
        </>
      )
  }
}
