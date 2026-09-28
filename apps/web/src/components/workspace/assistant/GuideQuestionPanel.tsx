import type { GuidedAnalysisView, GuidedQuestionView } from './guidedAssistantViewModel'

/**
 * 单个引导问题的展示与作答。
 *
 * 只渲染引导态该有的内容：可核验的分析观察、当前焦点、一个问题、3–5 个带理由的选项、
 * 自定义回答与跳过。**不**混入普通聊天、快捷提示、准备度面板、历史候选或通用输入框。
 *
 * 组件是纯展示 + 受控输入：选中哪一项、自定义回答都来自上层状态，
 * 因此「请求在途时禁用重复提交」不会顺带清空作者已经写下的文字。
 */
export function GuideQuestionPanel({
  focus,
  analysis,
  question,
  completedCount,
  customAnswer,
  busy,
  selectedOptionId,
  onSelectOption,
  onCustomAnswerChange,
  onSubmitOption,
  onSubmitCustom,
  onSkip
}: {
  focus: string
  analysis?: GuidedAnalysisView
  question: GuidedQuestionView
  completedCount: number
  customAnswer: string
  busy: boolean
  selectedOptionId: string | null
  onSelectOption: (optionId: string) => void
  onCustomAnswerChange: (text: string) => void
  onSubmitOption: () => void
  onSubmitCustom: () => void
  onSkip: () => void
}): React.JSX.Element {
  const customInputId = `guide-custom-${question.id}`
  return (
    <section className="mjp-guide-block" data-testid="guide-question" aria-label="引导问题">
      <p className="mjp-guide-progress" data-testid="guide-progress-body">已确认 {completedCount} 个回答</p>

      {analysis && (
        <div className="mjp-guide-observations" data-testid="guide-analysis">
          <p className="mjp-guide-summary">{analysis.summary}</p>
          {analysis.strengths.length > 0 && (
            <>
              <h4 className="mjp-guide-sub">已经站得住的部分</h4>
              <ul className="mjp-guide-list">
                {analysis.strengths.map((item) => (
                  <li key={item.title}>{item.title}</li>
                ))}
              </ul>
            </>
          )}
          {analysis.gaps.length > 0 && (
            <>
              <h4 className="mjp-guide-sub">还缺的部分</h4>
              <ul className="mjp-guide-list">
                {analysis.gaps.map((item) => (
                  <li key={item.key}>
                    <b>{item.title}</b>
                    {item.impact}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mjp-guide-hint">以上都是根据项目现有内容整理的观察，可以逐条核对。</p>
        </div>
      )}

      {focus && (
        <div className="mjp-guide-focus" data-testid="guide-focus">
          <span className="k">当前焦点</span>
          <span className="v">{focus}</span>
        </div>
      )}

      <fieldset className="mjp-guide-question">
        <legend className="mjp-guide-question-text">{question.text}</legend>
        <p className="mjp-guide-why">{question.whyNow}</p>
        <div className="mjp-guide-options">
          {question.options.map((option) => (
            <label key={option.id} className="mjp-guide-option" data-testid="guide-option">
              <input
                type="radio"
                name={`guide-option-${question.id}`}
                value={option.id}
                checked={selectedOptionId === option.id}
                disabled={busy}
                onChange={() => onSelectOption(option.id)}
              />
              <span className="bd">
                <span className="t">{option.label}</span>
                <span className="d">{option.reason}</span>
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="mjp-guide-primary"
          data-testid="guide-submit-option"
          disabled={busy || selectedOptionId === null}
          onClick={onSubmitOption}
        >
          确认这个方向
        </button>
      </fieldset>

      <div className="mjp-guide-custom">
        <label className="mjp-guide-label" htmlFor={customInputId}>
          也可以自己写一个回答
        </label>
        <textarea
          id={customInputId}
          className="mjp-guide-textarea"
          data-testid="guide-custom-input"
          value={customAnswer}
          disabled={busy}
          onChange={(event) => onCustomAnswerChange(event.target.value)}
        />
        <div className="mjp-guide-actions">
          <button
            type="button"
            className="mjp-guide-primary"
            data-testid="guide-submit-custom"
            disabled={busy || customAnswer.trim().length === 0}
            onClick={onSubmitCustom}
          >
            用这段回答
          </button>
          <button
            type="button"
            className="mjp-guide-secondary"
            data-testid="guide-skip"
            disabled={busy}
            onClick={onSkip}
          >
            跳过这题
          </button>
        </div>
      </div>
    </section>
  )
}
