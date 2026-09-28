import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'
import { ChapterPlanningModule } from './ChapterPlanningModule'
import { CreationStartModule } from './CreationStartModule'
import { OutlineVolumesModule, type OutlineRefineScope } from './OutlineVolumesModule'
import { StorylinesModule } from './StorylinesModule'
import { resolveIntegratedOutlineTarget } from './outlineIntegrationModel'
import { resolveOutlineWorkbenchVisual } from './outlineWorkbenchModel'
import './outline-workbench.css'

/**
 * 小说大纲 · 四模块整合版中央区。
 *
 * 本组件是「十个旧入口 → 四个正式模块」的唯一落点：
 *   1. 只做映射与分派：入口翻译全部交给纯函数 `resolveIntegratedOutlineTarget`，
 *      这里不读 store、不写项目、不访问 DOM；
 *   2. `focusId` 只用来给模块内的折叠区一个初始展开状态（子模块用 React 局部
 *      state 初始化），点击入口不等于任何写入；
 *   3. 用 `key` 绑定「模块 + 页内定位」，入口变化时模块重新挂载、初始定位生效，
 *      而模块内部的选中态与折叠态在同一个入口下保持不变。
 *
 * 四个模块只展示传入 `NovelProject` 的真实数据，能力缺口一律显式禁用并写明原因。
 */
export type OutlineIntegratedViewProps = {
  project: NovelProject
  stageId: 'idea' | 'outline'
  subnavId: string
  /** 项目内搜索的精确定位 id（如事件线 id）；没有则不精确选中。 */
  focusId?: string
  selectedChapterId?: string
  outlineChapterId?: string
  /** 「总纲与卷纲」里作者圈定的分批细化范围（卷级 / 卷内某章）。 */
  refineScope?: OutlineRefineScope
  onSelectRefineScope: (scope?: OutlineRefineScope) => void
  onNavigate: (target: WorkspaceNavigationTarget) => void
  onOpenChapterOutline: (cardId: string) => void
  /**
   * 进入正文的唯一入口（可选）。只有「章节规划」模块会渲染它，
   * 且必须走既有正文导航；选中章纲本身不会自动跳正文。
   */
  onOpenChapter?: (chapterId: string) => void
  /**
   * 「开始写作」：为章纲建立唯一正文（已有同类正文时只导航）。
   * 同样只在「章节规划」模块渲染。
   */
  onStartWriting?: (cardId: string) => void
}

export function OutlineIntegratedView({
  project,
  stageId,
  subnavId,
  focusId,
  selectedChapterId,
  outlineChapterId,
  refineScope,
  onSelectRefineScope,
  onNavigate,
  onOpenChapterOutline,
  onOpenChapter,
  onStartWriting
}: OutlineIntegratedViewProps): React.JSX.Element {
  const target = resolveIntegratedOutlineTarget(stageId, subnavId)
  const moduleKey = `${target.moduleId}:${target.focusId}`
  const visual = resolveOutlineWorkbenchVisual(target.moduleId)

  const renderModule = (): React.JSX.Element => {
    switch (target.moduleId) {
      case 'outline-volumes':
        return (
          <OutlineVolumesModule
            key={moduleKey}
            project={project}
            selectedChapterId={selectedChapterId}
            onNavigate={onNavigate}
            refineScope={refineScope}
            onSelectRefineScope={onSelectRefineScope}
          />
        )
      case 'chapter-planning':
        return (
          <ChapterPlanningModule
            key={moduleKey}
            project={project}
            focusId={target.focusId}
            selectedChapterId={selectedChapterId}
            outlineChapterId={outlineChapterId}
            onOpenChapterOutline={onOpenChapterOutline}
            onOpenChapter={onOpenChapter}
            onStartWriting={onStartWriting}
            onNavigate={onNavigate}
          />
        )
      case 'storylines':
        return <StorylinesModule key={moduleKey} project={project} focusId={focusId} />
      default:
        return <CreationStartModule key={moduleKey} project={project} focusId={target.focusId} onNavigate={onNavigate} />
    }
  }

  return (
    <div
      className="mjp-outline-workbench"
      data-testid="outline-workbench"
      data-module={target.moduleId}
      data-ink-background={visual.background}
      data-state="ready"
    >
      <div className="mjp-outline-workbench-body">{renderModule()}</div>
    </div>
  )
}
