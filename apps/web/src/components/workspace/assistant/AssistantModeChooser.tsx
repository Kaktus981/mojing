import { Compass, MessageSquareQuote } from 'lucide-react'
import { FREE_CREATION_MODE, GUIDE_CREATION_MODE, type AssistantGuideUiMode } from './assistantModePreference'

/**
 * 首次使用的模式选择。
 *
 * 只承担入口选择：两项纵向堆叠，每项最多一句短说明。
 * 这里不展开流程、范围或配置，也不复制任何外部产品的文案与素材。
 * 选择本身**不发起任何请求**：引导请求只在作者点「开始引导」之后才发生。
 */
export function AssistantModeChooser({
  onSelect,
  disabled = false
}: {
  onSelect: (mode: AssistantGuideUiMode) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="mjp-mode-choice" role="group" aria-label="选择助手模式" data-testid="assistant-mode-chooser">
      <p className="mjp-mode-choice-lead">先选一种方式开始，之后随时可以切换。</p>
      <div className="mjp-mode-choice-card">
        <button
          type="button"
          className="mjp-mode-choice-item"
          data-testid="assistant-mode-guide"
          disabled={disabled}
          onClick={() => onSelect(GUIDE_CREATION_MODE)}
        >
          <Compass size={16} strokeWidth={1.9} aria-hidden="true" />
          <span className="t">引导构建</span>
          <span className="d">一步一步问清关键问题，适合从零推进一个目标。</span>
        </button>
        <div className="mjp-mode-choice-divider" aria-hidden="true" />
        <button
          type="button"
          className="mjp-mode-choice-item"
          data-testid="assistant-mode-free"
          disabled={disabled}
          onClick={() => onSelect(FREE_CREATION_MODE)}
        >
          <MessageSquareQuote size={16} strokeWidth={1.9} aria-hidden="true" />
          <span className="t">自由对话</span>
          <span className="d">像聊天一样讨论与改写，适合边写边想。</span>
        </button>
      </div>
    </div>
  )
}
