import { Check, FileDiff, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AssistantAdoptPreview, AssistantChange, AssistantDraft } from '../../../../../../packages/contracts/src'

/**
 * 就地候选面板（D3）。
 *
 * 它不是第二个「草稿中心」：只在当前作用域上显示**这一份**工作草稿，
 * 作者可以直接在这里按领域字段（卷目标、章目标与冲突、步骤标题……）改写，
 * 不需要看、也不需要编辑任何原始 JSON。
 *
 * 三条硬约束：
 *   1. 面板里的编辑只改**工作草稿**（走 `assistantDrafts.update`），正式项目内容一律不动；
 *   2. 采用按钮只在「当前展示的预览与当前草稿版本 / 当前项目版本完全对得上」时可用，
 *      不会在点击之后另算一份预览再偷偷应用；
 *   3. 保存被拒（版本过期）时**保留作者当前输入**，不把它冲掉。
 */

/** 变更里作者真正关心的领域字段；只列文本字段，不暴露内部结构。 */
type FieldSpec = { key: string; label: string; multiline?: boolean; placeholder?: string }

const FIELD_SPECS: Record<AssistantChange['kind'], FieldSpec[]> = {
  'story-core': [
    { key: 'seed', label: '故事核心', multiline: true },
    { key: 'direction', label: '方向说明', multiline: true }
  ],
  outline: [
    { key: 'synopsis', label: '总纲', multiline: true },
    { key: 'mainConflict', label: '主要冲突', multiline: true },
    { key: 'endingDirection', label: '结局走向', multiline: true }
  ],
  volume: [
    { key: 'title', label: '卷名' },
    { key: 'goal', label: '本卷目标', multiline: true },
    { key: 'climax', label: '本卷高潮', multiline: true },
    { key: 'resolution', label: '本卷收束', multiline: true }
  ],
  chapter: [
    { key: 'title', label: '章名' },
    { key: 'pov', label: '视角' },
    { key: 'objective', label: '本章目标', multiline: true },
    { key: 'conflict', label: '本章冲突', multiline: true },
    { key: 'turningPoint', label: '转折', multiline: true },
    { key: 'reveal', label: '揭示', multiline: true },
    { key: 'endingHook', label: '章末钩子', multiline: true }
  ],
  beat: [
    { key: 'title', label: '步骤标题' },
    { key: 'purpose', label: '作用', multiline: true },
    { key: 'conflict', label: '冲突', multiline: true },
    { key: 'outcome', label: '结果', multiline: true },
    { key: 'location', label: '地点' },
    { key: 'timeframe', label: '时间' },
    { key: 'reveal', label: '揭示', multiline: true }
  ],
  storyline: [
    { key: 'title', label: '故事线名' },
    { key: 'type', label: '类型' },
    { key: 'whyNecessary', label: '为什么需要', multiline: true },
    { key: 'openingState', label: '起始状态', multiline: true },
    { key: 'finalGoal', label: '最终目标', multiline: true },
    { key: 'endCondition', label: '收束条件', multiline: true }
  ]
}

/** 取出这个变更里承载字段的那一层对象（卷/章/步骤/故事线各自嵌一层）。 */
function fieldHost(change: AssistantChange): Record<string, unknown> {
  if (change.kind === 'volume') return change.volume as unknown as Record<string, unknown>
  if (change.kind === 'chapter') return change.chapter as unknown as Record<string, unknown>
  if (change.kind === 'beat') return change.beat as unknown as Record<string, unknown>
  if (change.kind === 'storyline') return change.storyline as unknown as Record<string, unknown>
  return change as unknown as Record<string, unknown>
}

/** 只替换被编辑的那一个字段，其余结构原样保留（卷/章/步骤的其它字段不能被编辑动作抹掉）。 */
function withField(change: AssistantChange, key: string, value: string): AssistantChange {
  if (change.kind === 'volume') return { ...change, volume: { ...change.volume, [key]: value } }
  if (change.kind === 'chapter') return { ...change, chapter: { ...change.chapter, [key]: value } }
  if (change.kind === 'beat') return { ...change, beat: { ...change.beat, [key]: value } }
  if (change.kind === 'storyline') return { ...change, storyline: { ...change.storyline, [key]: value } }
  return { ...change, [key]: value } as AssistantChange
}

/** 把一条变更的完整新内容摊平成可读文本，供「查看完整修改内容」展开。 */
function fullChangeText(change: AssistantChange | undefined): string {
  if (!change) return ''
  const host = fieldHost(change)
  return FIELD_SPECS[change.kind]
    .map((spec) => {
      const raw = host[spec.key]
      const value = typeof raw === 'string' ? raw : ''
      return value.trim() ? `${spec.label}：${value}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

export function CandidatePanel({
  draft,
  preview,
  busy,
  saving,
  adopting,
  onRefreshPreview,
  onSaveDraft,
  onAdopt,
  onDiscard
}: {
  draft: AssistantDraft
  preview?: AssistantAdoptPreview
  /** 助手对话或另一次生成正在跑：此时禁止保存/采用，避免半途覆盖。 */
  busy: boolean
  saving: boolean
  adopting: boolean
  onRefreshPreview: () => void
  /** 返回错误文案（保存失败）或 undefined（保存成功）。失败时面板保留作者输入。 */
  onSaveDraft: (input: { version: number; changes: AssistantChange[]; summary: string }) => Promise<string | undefined>
  onAdopt: () => void
  onDiscard: () => void
}): React.JSX.Element {
  const [edits, setEdits] = useState<AssistantChange[]>(draft.changes)
  const [summary, setSummary] = useState(draft.summary)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [savedHint, setSavedHint] = useState<string>()
  const [openIndex, setOpenIndex] = useState<number>()
  const lastVersion = useRef(draft.version)

  /**
   * 只有服务端草稿**确实换代**时才用服务端内容重置本地编辑。
   * 保存被拒（版本过期）不会让它换代，所以作者输入原样保留。
   */
  useEffect(() => {
    if (lastVersion.current === draft.version) return
    lastVersion.current = draft.version
    setEdits(draft.changes)
    setSummary(draft.summary)
    setDirty(false)
    if (draft.authorEdited) setSavedHint(`已保存到这份工作草稿（v${draft.version}）。AI 的新结果不会覆盖你的改动，会另存为新的候选。`)
    else setSavedHint(`已保存到这份工作草稿（v${draft.version}）。`)
  }, [draft.version, draft.changes, draft.summary, draft.authorEdited])

  /** 预览必须对得上「当前草稿版本 + 当前项目版本」才允许采用。 */
  const previewStale = Boolean(preview) && preview!.version !== draft.version
  const canAdopt = Boolean(preview) && !previewStale && preview!.blockers.length === 0 && !busy && !saving && !adopting && !dirty

  function patch(index: number, key: string, value: string): void {
    setEdits((prev) => prev.map((item, at) => (at === index ? withField(item, key, value) : item)))
    setDirty(true)
    setSavedHint(undefined)
    setSaveError(undefined)
  }

  async function save(): Promise<void> {
    setSaveError(undefined)
    setSavedHint(undefined)
    const error = await onSaveDraft({ version: draft.version, changes: edits, summary })
    if (error) setSaveError(error)
  }

  return (
    <div className="mjp-dock-candidate" data-testid="candidate-panel">
      <div className="mjp-dock-candidate-hd">
        <span className="mjp-row" style={{ gap: 4 }}><FileDiff size={13} strokeWidth={1.9} />工作草稿</span>
        <span className="mjp-dock-candidate-summary" title={draft.summary}>{draft.summary}</span>
      </div>

      <div className="mjp-dock-candidate-note">
        这份草稿还没写进正式内容。下面直接改字段即可，不用碰任何原始数据；采用才会改动「{preview?.targetLabel ?? '当前目标'}」。
      </div>

      {preview ? (
        <>
          {preview.items.map((item) => (
            <div key={item.changeIndex} className="mjp-candidate-item">
              <div className="hd">
                <b>{item.label}</b>
                <span className={`mjp-candidate-action is-${item.action === '新增' ? 'add' : item.action === '修改' ? 'mod' : 'same'}`}>{item.action}</span>
              </div>
              {item.before && <div className="row"><span className="k">原</span><span className="v">{item.before}</span></div>}
              {item.after && <div className="row"><span className="k">新</span><span className="v">{item.after}</span></div>}
              {item.groupId && (
                <div className="row is-dim">
                  <span className="k">组</span>
                  <span className="v">{preview.groups.find((group) => group.id === item.groupId)?.label ?? item.groupId}（同组一起采用）</span>
                </div>
              )}
              <details className="mjp-candidate-full">
                <summary>查看完整修改内容</summary>
                <pre className="mjp-candidate-fulltext">{fullChangeText(edits[item.changeIndex] ?? draft.changes[item.changeIndex]) || '（这条没有可读的文本字段）'}</pre>
              </details>
            </div>
          ))}

          {preview.downstream.length > 0 && (
            <div className="mjp-candidate-down" data-testid="candidate-downstream">
              <b>会影响这些已有内容（只提示，不会自动改写）</b>
              {preview.downstream.map((item) => <div key={item.label}>· {item.label}：{item.reason}</div>)}
            </div>
          )}

          {preview.blockers.length > 0 && (
            <div className="mjp-candidate-block" role="alert" data-testid="candidate-blockers">
              <b>现在不能采用</b>
              {preview.blockers.map((item) => <div key={item}>· {item}</div>)}
            </div>
          )}

          {previewStale && (
            <div className="mjp-candidate-block" role="alert" data-testid="candidate-stale-preview">
              <b>差异预览已过期</b>
              <div>· 草稿或项目在你查看之后变化了，请重新「查看差异」，确认更新后的内容再采用。</div>
            </div>
          )}
        </>
      ) : (
        <div className="mjp-dock-candidate-empty">没有有效差异预览时不能采用。先点「查看差异」，看清实际改了哪些内容。</div>
      )}

      <div className="mjp-candidate-edit" data-testid="candidate-editor">
        <div className="mjp-candidate-edit-hd">改这份草稿（只影响草稿）</div>
        {edits.map((change, index) => (
          <div key={`${change.kind}-${index}`} className="mjp-candidate-edit-item">
            <button
              type="button"
              className="mjp-candidate-edit-toggle"
              aria-expanded={openIndex === index}
              onClick={() => setOpenIndex((prev) => (prev === index ? undefined : index))}
              data-testid={`candidate-edit-toggle-${index}`}
            >
              {openIndex === index ? '收起' : '编辑'}·{change.kind === 'story-core' ? '故事核心' : change.kind === 'outline' ? '总纲' : change.kind === 'volume' ? '卷' : change.kind === 'chapter' ? '章纲' : change.kind === 'beat' ? '剧情步骤' : '故事线'}
            </button>
            {openIndex === index && (
              <div className="mjp-candidate-edit-fields">
                {FIELD_SPECS[change.kind].map((spec) => {
                  const host = fieldHost(change)
                  const value = typeof host[spec.key] === 'string' ? (host[spec.key] as string) : ''
                  return (
                    <label key={spec.key} className="mjp-candidate-edit-field">
                      <span className="k">{spec.label}</span>
                      {spec.multiline ? (
                        <textarea
                          rows={3}
                          value={value}
                          disabled={busy || saving}
                          data-testid={`candidate-field-${index}-${spec.key}`}
                          onChange={(event) => patch(index, spec.key, event.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          value={value}
                          disabled={busy || saving}
                          data-testid={`candidate-field-${index}-${spec.key}`}
                          onChange={(event) => patch(index, spec.key, event.target.value)}
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        <label className="mjp-candidate-edit-field">
          <span className="k">草稿摘要</span>
          <input
            type="text"
            value={summary}
            disabled={busy || saving}
            data-testid="candidate-summary-input"
            onChange={(event) => { setSummary(event.target.value); setDirty(true); setSavedHint(undefined) }}
          />
        </label>
        <div className="mjp-candidate-edit-ft">
          <button type="button" disabled={busy || saving || !dirty} onClick={() => void save()} data-testid="candidate-save">
            <Save size={13} strokeWidth={1.9} /> {saving ? '正在保存…' : '保存草稿'}
          </button>
          {dirty && <span className="mjp-muted">有未保存的修改；保存后才可继续采用。</span>}
          {!dirty && savedHint && <span className="mjp-muted">{savedHint}</span>}
        </div>
        {saveError && <div className="mjp-dock-usage-row is-error" role="alert" data-testid="candidate-save-error">{saveError}</div>}
      </div>

      <div className="mjp-dock-candidate-ft">
        <button type="button" disabled={busy || saving || adopting} onClick={onRefreshPreview} data-testid="candidate-preview">
          查看差异
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={!canAdopt}
          onClick={onAdopt}
          data-testid="candidate-adopt"
        >
          <Check size={13} strokeWidth={2} /> {adopting ? '正在采用…' : '采用'}
        </button>
        <button type="button" disabled={busy || saving || adopting} onClick={onDiscard} data-testid="candidate-discard">
          <X size={13} strokeWidth={2} /> 放弃
        </button>
      </div>
      {!preview && <div className="mjp-dock-usage-row is-dim">未预览不可采用：差异预览与草稿版本绑定，过期会自动要求重新预览。</div>}
      {preview && !canAdopt && !previewStale && preview.blockers.length === 0 && dirty && (
        <div className="mjp-dock-usage-row is-dim">改过草稿后请先保存，再确认差异。</div>
      )}
    </div>
  )
}
