import type { AssistantGuideResultRef } from '../../../../../../packages/contracts/src'
import { guideResultReferenceLabel, guideResultSurface } from './guidedAssistantViewModel'
import type { WorkspaceNavigationTarget } from '../workspaceNavigation'

/**
 * 引导结果。
 *
 * 只做两件事：展示结果引用，并把作者送到**已有**的草稿、提案、任务或本地预检界面。
 * 这里不重新实现采用：结果只是候选或任务引用，不代表已经采用，也不等于允许导出。
 */
export function GuideResultPanel({
  resultRef,
  completedCount,
  onNavigate,
  onSwitchToFree
}: {
  resultRef: AssistantGuideResultRef
  completedCount: number
  onNavigate?: (target: WorkspaceNavigationTarget) => void
  onSwitchToFree: () => void
}): React.JSX.Element {
  const surface = guideResultSurface(resultRef)
  return (
    <section className="mjp-guide-block" data-testid="guide-result" aria-label="引导结果">
      <p className="mjp-guide-progress" data-testid="guide-progress-body">已确认 {completedCount} 个回答</p>
      <div className="mjp-guide-result">
        <span className="k">结果引用</span>
        <span className="v" data-testid="guide-result-ref">{guideResultReferenceLabel(resultRef)}</span>
      </div>
      <p className="mjp-guide-hint">{surface.detail}</p>
      <p className="mjp-guide-hint">结果只是候选或任务引用，不代表已经采用，也不等于允许导出。</p>
      <div className="mjp-guide-actions">
        <button
          type="button"
          className="mjp-guide-primary"
          data-testid="guide-result-navigate"
          onClick={() => {
            if (surface.kind === 'navigate') onNavigate?.(surface.target)
            else onSwitchToFree()
          }}
        >
          {surface.label}
        </button>
      </div>
    </section>
  )
}
