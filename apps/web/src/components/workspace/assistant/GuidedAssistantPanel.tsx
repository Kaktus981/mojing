import { LoaderCircle, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { AssistantGuideDomain, AssistantTarget } from '../../../../../../packages/contracts/src'
import { FREE_CREATION_MODE, type AssistantGuideUiMode } from './assistantModePreference'
import { buildGuidedAssistantViewModel, guidedPhaseLabel, type GuidedPhase } from './guidedAssistantViewModel'
import type { AsyncState } from '../../ui/asyncState'
import { GuideQuestionPanel } from './GuideQuestionPanel'
import { GuideResultPanel } from './GuideResultPanel'
import { useAssistantGuide, type AssistantGuideStateClient } from './useAssistantGuide'
import type { WorkspaceNavigationTarget } from '../workspaceNavigation'

/**
 * 引导构建面板。
 *
 * 请求**只**由 Task 6 的 `useAssistantGuide` 承担：这里不写任何请求状态机，也不自己发请求。
 * 面板只渲染真实阶段：读取中 / 等待开始 / 分析中 / 生成中 / 需要复核 / 提问 / 可生成 / 结果 / 已结束 / 失败。
 * 不出现伪造的进度百分比，也不出现普通聊天、快捷提示、准备度面板、历史候选或通用输入框。
 */
/**
 * 引导阶段 → 异步语义阶段的**纯投影**。
 *
 * P3 第一阶段只加这一层表达：状态机（`useAssistantGuide`）、服务端协议、
 * phase 判定与各分支的 DOM 结构一律不动。
 *
 * - `checking / analyzing / generating`：确实有请求在途 → `busy`
 * - `error`：失败 → `error`
 * - `result`：已经有结果落点 → `success`
 * - `ended`：引导结束且没有结果落点 → `empty`（如实说「没有产出」，不说「成功」）
 * - 其余（等待开始 / 需要复核 / 提问 / 可生成）：没有请求在途 → `idle`
 */
export function guidedPhaseState(phase: GuidedPhase, hasResult: boolean): AsyncState {
  if (phase === 'error') return 'error'
  if (phase === 'checking' || phase === 'analyzing' || phase === 'generating') return 'busy'
  if (phase === 'result') return hasResult ? 'success' : 'empty'
  if (phase === 'ended') return 'empty'
  return 'idle'
}

export function GuidedAssistantPanel({
  client,
  projectId,
  domain,
  target,
  scopeKey,
  onSwitchMode,
  onNavigate
}: {
  client: AssistantGuideStateClient
  projectId: string
  domain: AssistantGuideDomain
  target: AssistantTarget
  scopeKey: string
  onSwitchMode: (mode: AssistantGuideUiMode) => void
  onNavigate?: (target: WorkspaceNavigationTarget) => void
}): React.JSX.Element {
  const guide = useAssistantGuide({ projectId, domain, target, scopeKey }, client)
  const view = buildGuidedAssistantViewModel({
    session: guide.session,
    pendingAction: guide.pendingAction,
    error: guide.error,
    customAnswer: guide.customAnswer,
    currentLookupSettled: guide.currentLookupSettled
  })

  const questionId = view.question?.id
  const [selection, setSelection] = useState<{ questionId: string; optionId: string } | null>(null)
  const selectedOptionId = questionId && selection?.questionId === questionId ? selection.optionId : null

  return (
    <section
      className="mjp-guide"
      data-testid="guided-assistant-panel"
      aria-label="引导构建"
      data-state={guidedPhaseState(view.phase, view.resultRef !== undefined)}
      data-phase={view.phase}
    >
      <header className="mjp-guide-hd">
        <span className="mjp-guide-state" data-testid="guide-state-label">{guidedPhaseLabel(view.phase)}</span>
        <span className="mjp-guide-progress" data-testid="guide-progress">已确认 {view.completedCount} 个回答</span>
      </header>

      {view.error && (
        <div className="mjp-guide-error" role="alert" data-testid="guide-error">
          <p className="mjp-guide-error-text">{view.error.message}</p>
          {view.retry.available && (
            <button
              type="button"
              className="mjp-guide-secondary"
              data-testid="guide-retry"
              disabled={view.busy}
              onClick={() => void guide.retry()}
            >
              <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
              {view.retry.label}
            </button>
          )}
        </div>
      )}

      {view.phase === 'checking' && (
        <p className="mjp-guide-note" data-testid="guide-checking">
          <LoaderCircle size={13} strokeWidth={1.9} className="mjp-guide-spin" aria-hidden="true" />
          正在读取这段引导当前的进度…
        </p>
      )}

      {view.phase === 'waiting' && (
        <GuideWaitingPanel
          hasError={view.error !== undefined}
          busy={view.busy}
          onStart={() => void guide.start()}
        />
      )}

      {view.phase === 'analyzing' && (
        <GuideBusyPanel
          phase="analyzing"
          retry={view.retry}
          busy={view.busy}
          onRetry={() => void guide.retry()}
        />
      )}

      {view.phase === 'generating' && (
        <GuideBusyPanel
          phase="generating"
          retry={view.retry}
          busy={view.busy}
          onRetry={() => void guide.retry()}
        />
      )}

      {view.phase === 'needs-review' && (
        <GuideNeedsReviewPanel busy={view.busy} onReanalyze={() => void guide.reanalyze()} />
      )}

      {view.phase === 'question' && view.question && (
        <GuideQuestionPanel
          focus={view.focus}
          analysis={view.analysis}
          question={view.question}
          completedCount={view.completedCount}
          customAnswer={view.customAnswer}
          busy={view.busy}
          selectedOptionId={selectedOptionId}
          onSelectOption={(optionId) => {
            if (questionId) setSelection({ questionId, optionId })
          }}
          onCustomAnswerChange={guide.setCustomAnswer}
          onSubmitOption={() => {
            if (selectedOptionId) void guide.answerOption(selectedOptionId)
          }}
          onSubmitCustom={() => void guide.answerCustom()}
          onSkip={() => void guide.skip()}
        />
      )}

      {view.phase === 'ready' && (
        <div className="mjp-guide-block" data-testid="guide-ready">
          <p className="mjp-guide-note">关键问题已经问完，可以生成结果了。结果只会是候选、提案或任务。</p>
          <div className="mjp-guide-actions">
            <button
              type="button"
              className="mjp-guide-primary"
              data-testid="guide-complete"
              disabled={view.busy}
              onClick={() => void guide.complete()}
            >
              生成结果
            </button>
          </div>
        </div>
      )}

      {view.phase === 'result' && view.resultRef && (
        <GuideResultPanel
          resultRef={view.resultRef}
          completedCount={view.completedCount}
          onNavigate={onNavigate}
          onSwitchToFree={() => onSwitchMode(FREE_CREATION_MODE)}
        />
      )}

      {view.phase === 'ended' && (
        <div className="mjp-guide-block" data-testid="guide-ended">
          <p className="mjp-guide-note">这段引导已经结束。已经产生的候选与任务都还在原来的界面里。</p>
          <div className="mjp-guide-actions">
            <button
              type="button"
              className="mjp-guide-secondary"
              data-testid="guide-restart"
              disabled={view.busy}
              onClick={() => void guide.restart()}
            >
              重新开始一段引导
            </button>
          </div>
        </div>
      )}

      {view.phase === 'error' && !view.error && (
        <p className="mjp-guide-note" data-testid="guide-failed">
          这段引导没有完成，可以重新分析后再试。
        </p>
      )}
    </section>
  )
}

/**
 * 「还没有开始」这一屏。
 *
 * `current` 读取失败时界面同样落到等待态，此时再说「这段引导还没有开始」会和上面的红色
 * 错误块互相矛盾，因此改成如实说明「还没有读到这段引导的进度」，并把「开始引导」保留给作者
 * （已经确认过的回答不会丢）。这里**不**新增「重新读取」入口 —— `loadCurrent` 何时做成
 * 显式入口留 Task 10 裁定。
 */
export function GuideWaitingPanel({
  hasError,
  busy,
  onStart
}: {
  hasError: boolean
  busy: boolean
  onStart: () => void
}): React.JSX.Element {
  return (
    <div className="mjp-guide-block" data-testid="guide-waiting">
      <p className="mjp-guide-note">
        {hasError
          ? '还没有读到这段引导的进度。可以直接开始引导；已经确认过的回答不会丢。'
          : '这段引导还没有开始。点下面的按钮后，先读取当前项目，再回答第一个关键问题。'}
      </p>
      <div className="mjp-guide-actions">
        <button
          type="button"
          className="mjp-guide-primary"
          data-testid="guide-start"
          disabled={busy}
          onClick={onStart}
        >
          开始引导
        </button>
      </div>
    </div>
  )
}

/**
 * 「需要复核」这一屏。
 *
 * 服务端判定复核的真实原因有三种：项目被引用的内容变了、引导上下文的投影规则变了
 * （作者什么都没改也会被判需要复核）、适配器形状或版本变了。因此文案不能只说
 * 「项目内容变过了」这种确定因果，只能如实说「项目内容或引导规则已变化」。
 * 已经确认过的回答不会丢，必须始终写明白。这里**不**引入任何内部术语（digest / 版本号 / 契约等）。
 */
export function GuideNeedsReviewPanel({
  busy,
  onReanalyze
}: {
  busy: boolean
  onReanalyze: () => void
}): React.JSX.Element {
  return (
    <div className="mjp-guide-block" data-testid="guide-needs-review">
      <p className="mjp-guide-note">项目内容或引导规则已变化，需要重新分析后继续。已经确认的回答会保留。</p>
      <div className="mjp-guide-actions">
        <button
          type="button"
          className="mjp-guide-primary"
          data-testid="guide-reanalyze"
          disabled={busy}
          onClick={onReanalyze}
        >
          重新分析
        </button>
      </div>
    </div>
  )
}

/**
 * 「分析中 / 生成中」的进度与恢复入口。
 *
 * 这两态可能来自**存量会话**（进程中断后仍停在 `分析中 / 生成中`），此时不是真在途请求，
 * `view.retry.available` 为真，必须给出「重试分析 / 重试生成」入口，**不能永久转圈**。
 * 真正在途时 `pendingAction` 非空会让可用性为假，按钮不渲染，避免重复提交。
 */
export function GuideBusyPanel({
  phase,
  retry,
  busy,
  onRetry
}: {
  phase: 'analyzing' | 'generating'
  retry: { available: boolean; label: string }
  busy: boolean
  onRetry: () => void
}): React.JSX.Element {
  const analyzing = phase === 'analyzing'
  return (
    <div className="mjp-guide-block" data-testid={analyzing ? 'guide-analyzing' : 'guide-generating'}>
      <p className="mjp-guide-note">
        <LoaderCircle size={13} strokeWidth={1.9} className="mjp-guide-spin" aria-hidden="true" />
        {analyzing ? '正在分析你的项目…' : '正在整理这次引导的结果…'}
      </p>
      {retry.available && (
        <div className="mjp-guide-actions">
          <button
            type="button"
            className="mjp-guide-secondary"
            data-testid="guide-retry-busy"
            disabled={busy}
            onClick={onRetry}
          >
            <RotateCcw size={13} strokeWidth={1.9} aria-hidden="true" />
            {retry.label}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 当前页面没有可引导的具体目标时显示的说明。
 *
 * 这里**不**凭空造一个目标：只如实说明，并给出既有的导航落点，不发起任何模型请求。
 */
export function GuideNoTargetNotice({
  onSwitchToFree,
  onNavigate
}: {
  onSwitchToFree: () => void
  onNavigate?: (target: WorkspaceNavigationTarget) => void
}): React.JSX.Element {
  return (
    <section className="mjp-guide" data-testid="guide-no-target" aria-label="引导构建">
      <p className="mjp-guide-note">
        当前页面没有可以引导的具体目标。先选定一个章节或模块，再回来继续引导；不会自动替你选中第一章。
      </p>
      <div className="mjp-guide-actions">
        <button
          type="button"
          className="mjp-guide-secondary"
          data-testid="guide-open-outline"
          onClick={() => onNavigate?.({ stageId: 'outline', subnavId: 'chapter-directory' })}
        >
          去章节规划
        </button>
        <button
          type="button"
          className="mjp-guide-secondary"
          data-testid="guide-switch-free"
          onClick={onSwitchToFree}
        >
          切到自由创作
        </button>
      </div>
    </section>
  )
}
