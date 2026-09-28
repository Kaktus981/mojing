import { useEffect, useMemo, useRef, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import {
  assistantGuideScopeKey,
  assistantScopeKey,
  type AssistantGuideDomain, type AssistantRunPreview, type AssistantTarget, type AssistantTaskType,
  type CreativeChatStage
} from '../../../../../packages/contracts/src'
import { mojingClient } from '../../api/mojingClient'
import { LOOPBACK } from '../settings/ProviderConfigForm'
import { getStageChatAssistantProfile, type StageChatAssistantProfile } from '../stageChatGuidance'
import { AssistantModeChooser } from './assistant/AssistantModeChooser'
import { FreeCreationPanel } from './assistant/FreeCreationPanel'
import { GuidedAssistantPanel, GuideNoTargetNotice } from './assistant/GuidedAssistantPanel'
import {
  assistantDockPreferenceKey,
  chooseDockMode,
  dockErrorMessage,
  guideDomainForStage,
  INITIAL_DOCK_STATE,
  readAssistantModePreference,
  resetDockModeForScope,
  resolveAssistantDockView,
  shouldResetDockModeForScope,
  writeDockInput
} from './assistant/assistantDockModel'
import {
  createAssistantModePreferenceStore,
  FREE_CREATION_MODE,
  type AssistantGuideUiMode
} from './assistant/assistantModePreference'
import { getWorkspaceAssistantModeToggle } from './workspaceAssistantPresentation'
import type { WorkspaceNavigationTarget } from './workspaceNavigation'
import { resolveWorkspaceInkBackground } from './workspaceInkBackground'

export function hasUsableModel(providers: readonly { baseUrl: string; hasApiKey: boolean }[]): boolean {
  return providers.some((provider) => provider.hasApiKey || LOOPBACK.test(provider.baseUrl))
}

/**
 * AI 创作助手（360px 第三栏，对应样例外壳的模块 C）。
 *
 * 未配置可用模型时默认收起；作者仍可在右侧展开。
 *
 * 右栏承担模式分派与聊天协作；精确作用域与只读配置仍留在请求链路中，
 * 不在聊天区重复渲染项目上下文。
 *
 * 引导模式的请求**只**由 `GuidedAssistantPanel` 里的 `useAssistantGuide` 承担；
 * 自由创作的状态与请求仍在原来的链路里（现已迁入 `FreeCreationPanel`）。
 *
 * `target` / `taskType` 只报告作者当前的作用域：进入页面、切换模块或更换选中对象
 * 都不会自动发请求，也不会自动换模型；实际读取范围、技能和文风由服务端重算后回传。
 */
export function WorkspaceDock({
  stage,
  projectId,
  projectTitle,
  assistantProfile,
  target,
  taskType,
  onNavigate,
  expanded = true,
  onToggle
}: {
  stage: CreativeChatStage
  projectId: string
  projectTitle: string
  /**
   * 二级页面专属档案。像「记忆与伏笔」这样拆成多个子页的栏目，助手的名称、
   * 上下文与快捷动作必须跟着子页走；提供时**只覆盖展示**，`
   * stage` 仍是会话所属阶段（会话读写仍按一级栏目进行）。
   */
  assistantProfile?: StageChatAssistantProfile
  /** 当前精确作用域；缺省时按原阶段级上下文工作（旧行为不变）。 */
  target?: AssistantTarget
  /** 本次任务类型；缺省按自由讨论处理。 */
  taskType?: AssistantTaskType
  /** 引导结果的导航交给工作区统一处理。 */
  onNavigate?: (target: WorkspaceNavigationTarget) => void
  expanded?: boolean
  onToggle?: () => void
}): React.JSX.Element {
  const profile = assistantProfile ?? getStageChatAssistantProfile(stage, projectTitle)
  /** 自由创作未指定细分任务时，服务端契约的默认任务就是「自由讨论」。 */
  const resolvedTaskType: AssistantTaskType = taskType ?? '自由讨论'
  /** 模式与未发送输入：切模式只换界面，作者的输入原样保留（见 `chooseDockMode`）。 */
  const [dockState, setDockState] = useState(INITIAL_DOCK_STATE)
  const [preview, setPreview] = useState<AssistantRunPreview>()
  const [usageError, setUsageError] = useState<string>()
  const [usageLoading, setUsageLoading] = useState(false)
  const modeStore = useMemo(() => createAssistantModePreferenceStore(), [])

  /** 右栏只选择共享工作区的构图，不参与助手上下文、请求或权限计算。 */
  const assistantInkBackground = resolveWorkspaceInkBackground(stage)

  /** 引导领域沿用工作区现有栏目映射；精确作用域来自页面给出的真实目标。 */
  const domain = guideDomainForStage(stage)
  const scopeKey = target ? assistantScopeKey(target) : undefined
  const guideScopeKey = target ? assistantGuideScopeKey(domain, target) : undefined
  const preferenceKey = guideScopeKey ? assistantDockPreferenceKey(projectId, domain, guideScopeKey) : undefined
  /** 该作用域**存过**的模式偏好；没存过是 `null`（据此显示首次使用的选择器）。 */
  const storedMode = useMemo(
    () => (preferenceKey ? readAssistantModePreference(preferenceKey) : null),
    [preferenceKey]
  )
  const view = resolveAssistantDockView({ stage, target, storedMode, sessionMode: dockState.chosenMode })
  const modeToggle = getWorkspaceAssistantModeToggle(view.kind)

  /**
   * 请求作用域令牌：`项目 + 作用域` 一变就作废在途的只读预览，
   * 免得旧作用域的配置读取把新目标卡在「正在读取本次配置…」上。
   */
  const scopeToken = `${projectId}::${scopeKey ?? ''}`
  const scopeTokenRef = useRef(scopeToken)
  scopeTokenRef.current = scopeToken
  const stillCurrent = (token: string): boolean => scopeTokenRef.current === token
  useEffect(() => {
    setPreview(undefined)
    setUsageError(undefined)
    setUsageLoading(false)
  }, [projectId, scopeKey])

  /**
   * 作用域变化时按**收紧过的**规则丢弃本会话的显式模式选择（见 `shouldResetDockModeForScope`）：
   * 换到另一个不同的精确作用域要重置，免得上一个作用域的选择泄漏过来；
   * 但「本页还没有精确目标 → 同一栏目里刚拿到目标」时保留，作者刚表达的意图不会被丢掉。
   * 未发送的自由创作输入由 `resetDockModeForScope` 原样保留。
   */
  const lastScopeRef = useRef<{ key: string | undefined; domain: AssistantGuideDomain } | undefined>(undefined)
  useEffect(() => {
    const previous = lastScopeRef.current
    lastScopeRef.current = { key: preferenceKey, domain }
    if (!previous) return
    if (shouldResetDockModeForScope({
      previousKey: previous.key,
      nextKey: preferenceKey,
      previousDomain: previous.domain,
      nextDomain: domain
    })) {
      setDockState((state) => resetDockModeForScope(state))
    }
  }, [preferenceKey, domain])

  async function loadUsage(): Promise<void> {
    if (!target) return
    const token = scopeToken
    setUsageLoading(true)
    setUsageError(undefined)
    try {
      const next = await mojingClient.assistantRuns.preview(projectId, { stage, target, taskType: resolvedTaskType })
      if (stillCurrent(token)) setPreview(next)
    } catch (error) {
      if (stillCurrent(token)) setUsageError(dockErrorMessage(error))
    } finally {
      if (stillCurrent(token)) setUsageLoading(false)
    }
  }

  /**
   * 自由创作真正出现时先做一次只读预览：模型缺密钥就先把发送置灰，
   * 不让作者用一条明知不会成功的请求去换错误提示；预览本身不调用模型。
   */
  useEffect(() => {
    if (view.kind !== 'free' || !target || preview || usageLoading || usageError) return
    void loadUsage()
  }, [view.kind, projectId, stage, scopeKey, resolvedTaskType, Boolean(preview), usageLoading, usageError])

  /**
   * 选择模式：只记偏好、切界面。**不**发送、不调用模型、不结束任何引导。
   * 偏好按「项目 + 栏目 + 精确作用域」保存，与 `useAssistantGuide` 读的是同一个键。
   */
  function chooseMode(mode: AssistantGuideUiMode): void {
    setDockState((state) => chooseDockMode(state, mode))
    if (preferenceKey) modeStore.save(preferenceKey, mode)
  }

  if (!expanded) {
    return <aside className="mjp-dock is-collapsed" aria-label={`${profile.displaySection}创作助手`}>
      <button type="button" className="mjp-dock-expand" aria-label="展开创作助手" title="展开创作助手" onClick={onToggle}>
        <PanelRightOpen size={20} strokeWidth={1.7} aria-hidden="true" />
        <span>助手</span>
      </button>
    </aside>
  }

  return (
    <aside className="mjp-dock" data-ink-background={assistantInkBackground} aria-label={`${profile.displaySection}创作助手`}>
      <div className="mjp-dock-hd">
        <div className="av" aria-hidden="true">{profile.name.slice(0, 1)}</div>
        <div className="meta">
          <b>{profile.name}</b>
        </div>
        {modeToggle && (
          <button
            type="button"
            className="mjp-mode-switch mjp-dock-mode-toggle"
            data-testid="assistant-mode-toggle"
            onClick={() => chooseMode(modeToggle.nextMode)}
          >
            {modeToggle.label}
          </button>
        )}
        {onToggle && <button type="button" className="mjp-btn ghost icon mjp-dock-collapse" aria-label="收起创作助手" title="收起创作助手" onClick={onToggle}><PanelRightClose size={18} strokeWidth={1.7} aria-hidden="true" /></button>}
      </div>

      {usageError && view.kind === 'free' && (
        <div className="mjp-dock-usage-row is-error" role="alert" data-testid="assistant-preview-error">{usageError}</div>
      )}

      {/* 首次进入：只做入口选择，两项，各一句短说明；选择本身不发任何请求。 */}
      {view.kind === 'chooser' && <AssistantModeChooser onSelect={chooseMode} />}

      {/*
        自由创作的面板**一直挂载**，切到引导时只是不再渲染它的内容：组件状态不会被重建。
        作者还没发送的**输入**由上层持有，切回来原样显示。
        注意：会话与草稿的读取 effect 依赖 `active`，切回时会按当前作用域重新拉取
        （内容不丢，但会重读一次）；滚动容器在 `return null` 期间被卸载，**滚动位置会丢**。
      */}
      <FreeCreationPanel
        active={view.kind === 'free'}
        stage={stage}
        projectId={projectId}
        profile={profile}
        target={target}
        taskType={resolvedTaskType}
        preview={preview}
        blockedReason={preview?.effective.unavailable?.message}
        onRunPreviewChange={(next) => {
          setPreview(next)
        }}
        input={dockState.freeInput}
        onInputChange={(value) => setDockState((state) => writeDockInput(state, value))}
      />

      {view.kind === 'guide' && (
        <GuidedAssistantPanel
          client={mojingClient.assistantGuides}
          projectId={projectId}
          domain={view.domain}
          target={view.target}
          scopeKey={view.scopeKey}
          onSwitchMode={chooseMode}
          onNavigate={onNavigate}
        />
      )}

      {view.kind === 'guide-no-target' && (
        <GuideNoTargetNotice onSwitchToFree={() => chooseMode(FREE_CREATION_MODE)} onNavigate={onNavigate} />
      )}
    </aside>
  )
}
