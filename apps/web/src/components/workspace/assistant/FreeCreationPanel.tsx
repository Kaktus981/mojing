import { Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  assistantScopeKey,
  ASSISTANT_TARGET_FALLBACK_LABEL,
  type AssistantSkillLoadReceipt,
  type AssistantAdoptPreview, type AssistantChange, type AssistantDraft,
  type AssistantRunPreview, type AssistantTarget, type AssistantTaskType,
  type CreativeChatMessage, type CreativeChatStage
} from '../../../../../../packages/contracts/src'
import { mojingClient } from '../../../api/mojingClient'
import { useNovelStore } from '../../../novelStore'
import { CandidatePanel } from './CandidatePanel'
import { ReviseScopePanel } from './ReviseScopePanel'
import type { StageChatAssistantProfile } from '../../stageChatGuidance'
import { dockErrorMessage } from './assistantDockModel'

export type FreeCreationPanelProps = {
  /**
   * 是否处于自由创作模式。
   *
   * 面板在两种模式下都**保持挂载**（切换模式只是让它返回 `null`），组件状态不会被重建。
   * 未发送的**输入**由上层持有，因此切回自由创作时原样显示、不会丢字。
   * 注意：会话与草稿的读取 effect 依赖 `active`，切回时会按当前作用域重新拉取；
   * 滚动容器在 `return null` 期间被卸载、滚动位置回到新的底部，
   * 因此「切模式不丢会话 / 滚动位置」并不成立，只有未发送的输入会被保留。
   */
  active: boolean
  stage: CreativeChatStage
  projectId: string
  profile: StageChatAssistantProfile
  /** 当前精确作用域；缺省时按原阶段级上下文工作（旧行为不变）。 */
  target?: AssistantTarget
  /** 本次任务类型；缺省按自由讨论处理。 */
  taskType?: AssistantTaskType
  /** 服务端回传的只读配置，供发送门禁和候选链路使用。 */
  preview?: AssistantRunPreview
  /** 服务端预览已明确不可用时，保留输入但不重复发送同一失败请求。 */
  blockedReason?: string
  /** 发送成功后把服务端回传的实际配置交回上层。 */
  onRunPreviewChange?: (preview: AssistantRunPreview, receipt?: AssistantSkillLoadReceipt) => void
  /** 作者还没发送的输入：由上层持有，切换模式时不得丢失。 */
  input: string
  onInputChange: (value: string) => void
}

/**
 * 自由创作（360px 第三栏里的聊天式协作）。
 *
 * 这是从 `WorkspaceDock` 原样迁入的聊天链路：发送仍走 `mojingClient.creativeChat`，
 * 会话与草稿加载、精确作用域、迟到响应隔离、候选的差异预览与采用门禁、
 * 局部修改、快捷指令和滚动到底行为全部保持不变。
 */
export function FreeCreationPanel({
  active,
  stage,
  projectId,
  profile,
  target,
  taskType,
  preview,
  blockedReason,
  onRunPreviewChange,
  input,
  onInputChange
}: FreeCreationPanelProps): React.JSX.Element | null {
  const project = useNovelStore((state) => state.project)

  const [messages, setMessages] = useState<CreativeChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string>()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [loading, setLoading] = useState(true)
  /** 当前作用域的工作草稿（D3）：刷新不丢，采用前必须重新预览。 */
  const [draft, setDraft] = useState<AssistantDraft>()
  const [adoptPreview, setAdoptPreview] = useState<AssistantAdoptPreview>()
  const [draftError, setDraftError] = useState<string>()
  /** 草稿保存中：期间禁止再次保存/采用，避免半途互相覆盖。 */
  const [draftSaving, setDraftSaving] = useState(false)
  /** 采用执行中：防重复点击造成二次写入。 */
  const [adopting, setAdopting] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scopeKey = target ? assistantScopeKey(target) : undefined
  /**
   * 请求作用域令牌（P01）：`项目 + 作用域` 一变，令牌就变。
   * 每个异步请求发出前后都比对这个令牌 —— 迟到的旧响应不得写进当前会话：
   * 不替换当前草稿、不清空当前输入、不把旧项目的差异预览挂到新目标上。
   */
  const scopeToken = `${projectId}::${scopeKey ?? ''}`
  const scopeTokenRef = useRef(scopeToken)
  scopeTokenRef.current = scopeToken
  /** 该响应是否仍属于当前 `项目 + 作用域`；不是就整段丢弃。 */
  const stillCurrent = (token: string): boolean => scopeTokenRef.current === token

  // 切栏目 = 切席位，也切会话：按阶段取最近一条真实会话及其消息。
  useEffect(() => {
    if (!active) return undefined
    const token = `${projectId}::${scopeKey ?? ''}`
    setLoading(true)
    setFailure(undefined)
    setMessages([])
    setConversationId(undefined)
    setAdoptPreview(undefined)
    setDraftError(undefined)
    void (async () => {
      try {
        if (!scopeKey) { setDraft(undefined) } else {
          const items = await mojingClient.assistantDrafts.list(projectId, scopeKey)
          // 迟到的旧作用域响应直接丢弃：它描述的不是作者现在看的目标。
          if (!stillCurrent(token)) return
          setDraft(items[0])
        }
      } catch { if (stillCurrent(token)) setDraft(undefined) }
      try {
        const conversations = await mojingClient.creativeChat.list(projectId, stage)
        if (!stillCurrent(token)) return
        // 作用域变了就换会话：旧讨论继续绑定旧目标，不能串到新目标上（D1）。
        const latest = scopeKey
          ? conversations.find((item) => item.targetId === scopeKey)
          : conversations[0]
        if (!latest) { setLoading(false); return }
        const history = await mojingClient.creativeChat.messages(projectId, latest.id)
        if (!stillCurrent(token)) return
        setConversationId(latest.id)
        setMessages(history)
      } catch {
        // 读取历史失败不阻塞使用：仍可发起新对话。
      } finally {
        if (stillCurrent(token)) setLoading(false)
      }
    })()
    return () => { /* 令牌比对已在每个 await 之后完成 */ }
  }, [active, projectId, stage, scopeKey])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, sending])

  // 别处（如大纲引导生成初纲）建好草稿后，这里要能立刻取到，不要求作者刷新页面。
  useEffect(() => {
    if (!active || !scopeKey) return undefined
    const token = `${projectId}::${scopeKey}`
    const reload = (): void => {
      void mojingClient.assistantDrafts.list(projectId, scopeKey)
        .then((items) => { if (stillCurrent(token)) setDraft(items[0]) })
        .catch(() => { /* 读不到就保持原状 */ })
    }
    window.addEventListener('mojing:assistant-draft-changed', reload)
    return () => window.removeEventListener('mojing:assistant-draft-changed', reload)
  }, [active, projectId, scopeKey])

  async function send(): Promise<void> {
    const content = input.trim()
    if (!content || sending || blockedReason) return
    /**
     * 记下本次发送所属的 `项目 + 作用域`。作者在等待期间切了目标时，
     * 旧响应一律不落到新会话上，也不去动新作用域的输入框。
     */
    const token = scopeToken
    setFailure(undefined)
    onInputChange('')
    setSending(true)
    const optimistic: CreativeChatMessage = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? '',
      role: 'user',
      content,
      mode: '综合协作',
      references: [],
      actions: [],
      projectRevision: project?.revision ?? 0,
      createdAt: new Date().toISOString()
    }
    setMessages((prev) => [...prev, optimistic])
    try {
      const response = await mojingClient.creativeChat.send(projectId, {
        conversationId,
        stage,
        mode: '综合协作',
        content,
        target,
        taskType
      })
      if (!stillCurrent(token)) return
      setConversationId(response.conversation.id)
      setMessages((prev) => [...prev.filter((item) => item.id !== optimistic.id), ...response.messages])
      if (response.context && response.effective) onRunPreviewChange?.({ context: response.context, effective: response.effective }, response.skillLoadReceipt)
      if (scopeKey) {
        const items = await mojingClient.assistantDrafts.list(projectId, scopeKey)
        if (stillCurrent(token)) setDraft(items[0])
      }
    } catch (error) {
      if (!stillCurrent(token)) return
      setMessages((prev) => prev.filter((item) => item.id !== optimistic.id))
      onInputChange(content)
      setFailure(dockErrorMessage(error))
    } finally {
      if (stillCurrent(token)) setSending(false)
    }
  }

  async function loadAdoptPreview(): Promise<void> {
    if (!draft) return
    const token = scopeToken
    setDraftError(undefined)
    try {
      const next = await mojingClient.assistantDrafts.preview(projectId, draft.id)
      if (!stillCurrent(token)) return
      setAdoptPreview(next)
    } catch (error) {
      if (stillCurrent(token)) setDraftError(dockErrorMessage(error))
    }
  }

  /**
   * 保存草稿（P03/P05）：只改工作草稿，正式项目内容一律不动。
   * 返回错误文案时面板保留作者输入（含刚写的内容），不静默丢弃。
   */
  async function saveDraft(changes: { version: number; changes: AssistantChange[]; summary: string }): Promise<string | undefined> {
    if (!draft) return '没有正在编辑的工作草稿。'
    const token = scopeToken
    setDraftSaving(true)
    try {
      const updated = await mojingClient.assistantDrafts.update(projectId, draft.id, {
        version: changes.version, changes: changes.changes, summary: changes.summary
      })
      if (!stillCurrent(token)) return undefined
      setDraft(updated)
      // 草稿改了，之前那份差异预览就不再代表当前内容：立刻作废，重看后才能采用。
      setAdoptPreview(undefined)
      return undefined
    } catch (error) {
      return dockErrorMessage(error)
    } finally {
      if (stillCurrent(token)) setDraftSaving(false)
    }
  }

  /**
   * 采用（P03）：作者确认的是**面板上此刻展示的**那一份预览。
   * 这里把「草稿版本 + 预览摘要」原样交给服务端校验，不重新算预览、不偷偷应用别的版本。
   * 成功才移除面板；失败保留草稿、预览与错误提示。
   */
  async function adoptDraft(): Promise<void> {
    if (!draft || !adoptPreview || adopting) return
    const token = scopeToken
    setDraftError(undefined)
    setAdopting(true)
    try {
      const applied = await useNovelStore.getState().applyAssistantDraft(draft.id, {
        version: adoptPreview.version, previewDigest: adoptPreview.previewDigest
      })
      if (!stillCurrent(token)) return
      if (!applied) {
        // 保存失败/冲突/采用失败：面板、预览、提示全部留在原地。
        setDraftError(useNovelStore.getState().error ?? '采用没有成功，草稿与差异预览都还在。')
        return
      }
      setDraft(undefined)
      setAdoptPreview(undefined)
    } finally {
      if (stillCurrent(token)) setAdopting(false)
    }
  }

  async function discardDraft(): Promise<void> {
    if (!draft) return
    const token = scopeToken
    setDraftError(undefined)
    try {
      await mojingClient.assistantDrafts.discard(projectId, draft.id)
      if (!stillCurrent(token)) return
      setDraft(undefined)
      setAdoptPreview(undefined)
    } catch (error) {
      if (stillCurrent(token)) setDraftError(dockErrorMessage(error))
    }
  }

  // 引导态 / 首次选择态下自由创作内容完全不渲染；面板本身继续挂载，状态不丢。
  if (!active) return null

  return (
    <>
      {target && taskType === '局部修改' && (
        <ReviseScopePanel
          projectId={projectId}
          target={target}
          targetLabel={preview?.context.targetLabel ?? ASSISTANT_TARGET_FALLBACK_LABEL[target.kind]}
        />
      )}

      {draft && draft.status !== '已采用' && draft.status !== '已放弃' && (
        <div className="mjp-dock-candidate-wrap">
          <CandidatePanel
            draft={draft}
            preview={adoptPreview}
            busy={sending}
            saving={draftSaving}
            adopting={adopting}
            onRefreshPreview={() => void loadAdoptPreview()}
            onSaveDraft={saveDraft}
            onAdopt={() => void adoptDraft()}
            onDiscard={() => void discardDraft()}
          />
          {draftError && <div className="mjp-dock-usage-row is-error" role="alert">{draftError}</div>}
        </div>
      )}

      <div className="mjp-dock-quick">
        {profile.quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.prompt}
            disabled={sending}
            onClick={() => {
              onInputChange(action.prompt)
              inputRef.current?.focus()
            }}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="mjp-dock-scroll mjp-scroll" ref={scrollRef}>
        {loading ? (
          <div className="mjp-col" style={{ gap: 10 }}>
            <div className="mjp-skeleton" style={{ height: 54 }} />
            <div className="mjp-skeleton" style={{ height: 78 }} />
          </div>
        ) : messages.length === 0 ? (
          <div className="mjp-msg ai">
            <div className="bubble">{profile.welcome}</div>
          </div>
        ) : (
          <div className="mjp-msgs">
            {messages.map((message) => (
              <div key={message.id} className={`mjp-msg ${message.role === 'user' ? 'user' : 'ai'}`}>
                <div className="bubble">{message.content}</div>
                {message.references.length > 0 && (
                  <div className="meta">
                    {message.references.slice(0, 3).map((reference) => (
                      <span key={reference.title}>上下文 · {reference.title}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {sending && (
          <div className="mjp-msg ai" style={{ marginTop: 10 }}>
            <div className="bubble"><span className="mjp-spin" aria-hidden="true">◌</span> 正在请求模型…</div>
          </div>
        )}

        {failure && (
          <div className="mjp-msg ai is-error" style={{ marginTop: 10 }} role="alert">
            <div className="bubble">{failure}</div>
            <div className="meta">
              <span>输入内容已保留；确认范围后可再次发送。</span>
              <button
                type="button"
                className="mjp-dock-retry"
                data-testid="assistant-retry"
                onClick={() => void send()}
                disabled={sending || Boolean(blockedReason)}
              >
                再次发送
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mjp-dock-ft">
        <div className="mjp-dock-input">
          <textarea
            id="mojing-dock-input"
            ref={inputRef}
            value={input}
            disabled={sending}
            rows={1}
            aria-label={`向${profile.name}提问`}
            onChange={(event) => {
              if (failure) setFailure(undefined)
              onInputChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <button
            type="button"
            className="mjp-dock-send"
            onClick={() => void send()}
            disabled={sending || !input.trim() || Boolean(blockedReason)}
            aria-label="发送"
            title={blockedReason}
          >
            <Send size={15} strokeWidth={1.9} />
          </button>
        </div>
        <div className="mjp-dock-keys">
          <span><span className="mjp-kbd">⏎</span> 发送</span>
          <span><span className="mjp-kbd">⇧⏎</span> 换行</span>
        </div>
      </div>
    </>
  )
}
