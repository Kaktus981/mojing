import { Waypoints } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, EmptyState, Tag } from '../../../ui/Primitives'
import { clearScopedDraft, loadScopedDraft, saveScopedDraft, type ScopedDraftSnapshot } from '../../draftCache'
import { checkWorldFinalize, WORLD_REQUIRED_FIELDS } from './worldCanonRules'
import {
  applyWorldOverviewEdit,
  applyWorldOverviewFinalize,
  applyWorldOverviewThemesEdit,
  type WorldOverviewTextField,
  type WriteResult
} from './worldWriting'
import { WORLD_ENTRY_TYPES, type WorldOverviewModel } from './worldModel'

/** 总览里可编辑的字段：四个正文片段 + 主题列表（列表按顿号 / 逗号 / 换行录入）。 */
type WorldOverviewEditableField = WorldOverviewTextField | 'themes'

/** 字段 key → 输入框 testid 后缀（历史概览对应 -history）。 */
const INPUT_TESTID_SUFFIX: Record<WorldOverviewEditableField, string> = {
  summary: 'summary',
  premise: 'premise',
  themes: 'themes',
  geography: 'geography',
  historySummary: 'history'
}

type WorldOverviewDraftPayload = Partial<Record<WorldOverviewEditableField, string>>

/** 主题列表的录入/回显口径，与规则与边界、词条别名保持同一套分隔符。 */
const splitThemes = (value: string): string[] => value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean)

/** 未失焦就刷新/离页时的兜底写入间隔；保存确认后这条缓存会被清理。 */
const OVERVIEW_STASH_DELAY = 400

/** 作用域键自带项目 ID，保证不同项目的总览草稿互不覆盖。 */
export function worldOverviewDraftKey(projectId: string): string {
  return `world-overview:${projectId}`
}

/** 判断本地草稿与当前已保存内容是否真的不同；相同就不提示，避免噪音。 */
export function overviewDraftDiffers(
  payload: WorldOverviewDraftPayload,
  server: WorldOverviewDraftPayload
): boolean {
  return (Object.keys(INPUT_TESTID_SUFFIX) as WorldOverviewEditableField[])
    .some((field) => (payload[field] ?? '') !== (server[field] ?? ''))
}

/**
 * 页面 1/5 · 世界总览。
 *
 * 数据源：project.worldBible（summary / premise / themes / geography / historySummary /
 * status / updatedAt / rules / timeline / entries）+ worldConstraints、worldQualityFindings、
 * worldExpansionProposals 的真实计数。
 *
 * 四个总览正文片段（摘要 / 前提 / 地理 / 历史概览）可就地编辑；缺字段会显示「未填写」并列出缺失项。
 * 「定稿」是独立持久化操作：直接走 updateProject + applyWorldOverviewFinalize，不复用 editWorld，
 * 否则 status 会被立刻改回「草稿」，定稿永远存不下来；落盘仍走既有的 persistNow（900ms 防抖）。
 */
export function WorldOverviewPage({ model, onGoTo }: {
  model: WorldOverviewModel
  onGoTo: (subnavId: 'rules-boundaries' | 'world-entries' | 'world-timeline' | 'world-expansion') => void
}): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const project = useNovelStore((state) => state.project)
  const saveState = useNovelStore((state) => state.saveState)

  const [editing, setEditing] = useState(false)
  const [draftValues, setDraftValues] = useState<WorldOverviewDraftPayload>({})
  const [fieldMessage, setFieldMessage] = useState<{ field: WorldOverviewEditableField; text: string } | null>(null)
  const [finalizeError, setFinalizeError] = useState<string>()
  const [finalizeNotice, setFinalizeNotice] = useState(false)
  const [stashed, setStashed] = useState<ScopedDraftSnapshot<WorldOverviewDraftPayload>>()

  const draftScopeKey = project?.id ? worldOverviewDraftKey(project.id) : ''
  const stashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 编辑序号 + 已确认序号：阻止「保存已确认后才迟到的」本地写入把缓存又写回来。
  const editSequence = useRef(0)
  const confirmedSequence = useRef(0)
  /**
   * 最近一次「保存开始」时已经存在的编辑序号。
   *
   * 服务端确认只能代表**这次保存发出时**已经敲进去的内容，不能代表保存期间新敲的字。
   * 若确认时直接用当时的 `editSequence` 当界限，就会出现真实的丢字窗口：
   *   敲 A → 失焦开始保存 → 保存途中又敲 B → A 的确认回来 → 把 B 的缓存一起当成「已确认」清掉
   * 此时若作者刷新，B 就再也找不回来了。所以界限必须锁在保存开始那一刻。
   */
  const savingSequence = useRef(0)
  const sawUnsaved = useRef(false)
  /**
   * 本页是否真的写过容灾缓存。
   *
   * 「保存已确认就清缓存」必须只对本页自己写出来的草稿生效。否则会出现可复现的误删：
   * 作者带着上次会话留下的待恢复草稿进入本页 → 别处的改动（如助手采用候选）让 store
   * 走一次「未保存 → 已保存」→ 确认回调把这份**还没被作者处理**的草稿一起删掉。
   */
  const wroteStash = useRef(false)

  // 与当前已保存内容对应的片段，用于判断本地草稿是否真的不同。
  const serverValues: WorldOverviewDraftPayload = {
    summary: model.summary,
    premise: model.premise,
    themes: model.themes.join('、'),
    geography: model.geography,
    historySummary: model.historySummary
  }

  // 进入本页时读取容灾缓存：只读到「与已保存内容确实不同」的草稿才提示。
  useEffect(() => {
    let cancelled = false
    setStashed(undefined)
    if (!draftScopeKey) return undefined
    void loadScopedDraft<WorldOverviewDraftPayload>(draftScopeKey).then((snapshot) => {
      if (cancelled || !snapshot) return
      if (!overviewDraftDiffers(snapshot.payload, serverValues)) return
      setStashed(snapshot)
    })
    return () => { cancelled = true }
    // 只在切换项目时检查一次；serverValues 每渲染都会变，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScopeKey])

  // 服务端确认保存成功后清理容灾缓存。只在「本页有过未保存 → 已保存」的转换后清理，
  // 否则挂载时 store 本来就是「已保存」，会把上一次会话留下的待恢复草稿直接抹掉。
  useEffect(() => {
    if (saveState !== '已保存') {
      // 刚进入「有未保存改动」：记下此刻的编辑序号，作为这次保存覆盖到的界限。
      if (!sawUnsaved.current) savingSequence.current = editSequence.current
      sawUnsaved.current = true
      return
    }
    if (!sawUnsaved.current) return
    sawUnsaved.current = false
    // 这次确认只覆盖到「保存开始那一刻」的输入；之后新敲的字还没落盘，缓存必须留着。
    confirmedSequence.current = Math.max(confirmedSequence.current, savingSequence.current)
    if (!wroteStash.current) return
    if (editSequence.current > savingSequence.current) return
    if (stashTimer.current) clearTimeout(stashTimer.current)
    if (draftScopeKey) void clearScopedDraft(draftScopeKey)
    wroteStash.current = false
    setStashed(undefined)
  }, [saveState, draftScopeKey])

  useEffect(() => () => { if (stashTimer.current) clearTimeout(stashTimer.current) }, [])

  /** 输入即写本地容灾缓存（防抖）：还没失焦、还没发 PUT 时刷新也有据可依。 */
  function stashDraft(next: WorldOverviewDraftPayload): void {
    if (!draftScopeKey) return
    wroteStash.current = true
    editSequence.current += 1
    const sequence = editSequence.current
    const baseRevision = project?.revision ?? 0
    if (stashTimer.current) clearTimeout(stashTimer.current)
    stashTimer.current = setTimeout(() => {
      // 已经收到服务端保存确认的输入不再回写，避免把刚清掉的缓存又写回来。
      if (sequence <= confirmedSequence.current) return
      void saveScopedDraft<WorldOverviewDraftPayload>({
        key: draftScopeKey, projectId: project?.id ?? '', baseRevision,
        savedAt: new Date().toISOString(), payload: next
      })
    }, OVERVIEW_STASH_DELAY)
  }

  function restoreStash(): void {
    if (!stashed) return
    for (const field of Object.keys(INPUT_TESTID_SUFFIX) as WorldOverviewEditableField[]) {
      const value = stashed.payload[field]
      if (value === undefined) continue
      updateProject((draft) => {
        if (field === 'themes') {
          applyWorldOverviewThemesEdit(draft, splitThemes(value), new Date().toISOString())
          return
        }
        applyWorldOverviewEdit(draft, field, value, new Date().toISOString())
      })
    }
    setDraftValues({})
    setEditing(false)
    setFieldMessage(null)
    setStashed(undefined)
    wroteStash.current = false
    if (draftScopeKey) void clearScopedDraft(draftScopeKey)
  }

  function discardStash(): void {
    if (stashTimer.current) clearTimeout(stashTimer.current)
    confirmedSequence.current = editSequence.current
    if (draftScopeKey) void clearScopedDraft(draftScopeKey)
    wroteStash.current = false
    setStashed(undefined)
  }

  // 定稿门槛只用 checkWorldFinalize 这一份判定，不另写一份（验收点①）。
  const finalizeCheck = checkWorldFinalize(
    model.hasWorld
      ? { summary: model.summary, premise: model.premise, geography: model.geography, historySummary: model.historySummary }
      : undefined
  )

  function startEdit(): void {
    setEditing(true)
    setFieldMessage(null)
    setDraftValues({
      summary: model.summary,
      premise: model.premise,
      themes: model.themes.join('、'),
      geography: model.geography,
      historySummary: model.historySummary
    })
  }

  function cancelEdit(): void {
    setEditing(false)
    setDraftValues({})
    setFieldMessage(null)
  }

  function saveField(field: WorldOverviewEditableField): void {
    const value = draftValues[field] ?? ''
    let result: WriteResult | undefined
    // 每个字段 onBlur 才提交一次，避免每敲一个字都写一遍。
    updateProject((draft) => {
      result = field === 'themes'
        ? applyWorldOverviewThemesEdit(draft, splitThemes(value), new Date().toISOString())
        : applyWorldOverviewEdit(draft, field, value, new Date().toISOString())
    })
    // 这里只完成了「写入本地并排队保存」，还没完成保存，不能显示成已保存。
    const text = result?.ok
      ? '已写入本机草稿，正在保存…'
      : (result?.message ?? '保存失败。')
    setFieldMessage({ field, text })
  }

  async function finalizeWorld(): Promise<void> {
    let result: WriteResult | undefined
    updateProject((draft) => {
      result = applyWorldOverviewFinalize(draft, new Date().toISOString())
    })
    // 保存失败不得谎报成功（验收点④）：result 不 ok 就只显示错误信息，不显示成功提示。
    if (!result?.ok) {
      setFinalizeNotice(false)
      setFinalizeError(result?.message ?? '定稿失败。')
      return
    }
    const saved = await useNovelStore.getState().persistNow()
    if (saved) {
      setFinalizeError(undefined)
      setFinalizeNotice(true)
    } else {
      // 落盘失败：如实提示，且不回滚本地草稿（草稿本来就不会被 persistNow 清掉，必须保留）。
      setFinalizeNotice(false)
      setFinalizeError('定稿信息已写入本地草稿，但未能保存，请稍后重试。')
    }
  }

  if (!model.hasWorld) {
    return (
      <EmptyState
        icon={Waypoints}
        title="世界观尚未建立"
        description="项目里还没有世界观内容，因此没有可展示的摘要、规则或时间线。下面这个按钮会建立一个空白世界。"
        action={
          <Btn
            variant="primary"
            onClick={() =>
              updateProject((draft) => {
                draft.worldBible = {
                  status: '草稿', summary: '', premise: '', themes: [], rules: [],
                  geography: '', historySummary: '', entries: [], timeline: [],
                  updatedAt: new Date().toISOString()
                }
              })
            }
          >
            从空白世界开始
          </Btn>
        }
      />
    )
  }

  const coveredTypes = model.coverage.filter((item) => item.count > 0)

  return (
    <>
      <div className="mjp-overview">
        <div className="mjp-ov">
          <div className="l">定稿状态</div>
          <div className="v">{model.status || '未知'}</div>
          <div className="sub"><Tag tone={model.status === '定稿' ? 'ok' : 'amber'} dot>{model.updatedAt ? `更新于 ${model.updatedAt.slice(0, 10)}` : '无更新时间'}</Tag></div>
        </div>
        <div className="mjp-ov">
          <div className="l">词条</div>
          <div className="v">{model.entryCount}</div>
          <div className="sub">{coveredTypes.length} / {WORLD_ENTRY_TYPES.length} 类有词条 · {model.lockedEntryCount} 条已锁</div>
        </div>
        <div className="mjp-ov">
          <div className="l">规则</div>
          <div className="v">{model.ruleCount}</div>
          <div className="sub">{model.constraints.待确认 ? `${model.constraints.待确认} 条术语待确认` : '术语边界无待确认项'}</div>
        </div>
        <div className="mjp-ov">
          <div className="l">时间线</div>
          <div className="v">{model.timelineCount}</div>
          <div className="sub">{model.pendingQualityFindings} 条审校待处理</div>
        </div>
      </div>

      {model.missingFields.length > 0 && (
        <Banner tone="warn" title={`世界基础缺少${model.missingFields.join('、')}`}>
          补齐上述内容后即可定稿。
        </Banner>
      )}

      {finalizeError && (
        <Banner tone="warn" title="暂时无法定稿">
          {finalizeError}
        </Banner>
      )}

      {finalizeNotice && (
        <Banner tone="info" title="已定稿" data-testid="world-finalize-notice">
          已定稿并保存。
        </Banner>
      )}

      {stashed && (
        <Banner
          tone="warn"
          title={`检测到未保存的本机草稿（${new Date(stashed.savedAt).toLocaleString('zh-CN')}）`}
          data-testid="world-overview-stash"
          action={
            <span className="mjp-row" style={{ gap: 8 }}>
              <Btn size="sm" variant="primary" data-testid="world-overview-stash-restore" onClick={restoreStash}>恢复草稿</Btn>
              <Btn size="sm" variant="ghost" data-testid="world-overview-stash-discard" onClick={discardStash}>放弃草稿</Btn>
            </span>
          }
        >
          这份草稿来自还没有确认保存的输入，写入时对应的是已保存版本 v{stashed.baseRevision}
          （当前 v{project?.revision ?? 0}）。「恢复草稿」会把草稿写回本页真实字段并走统一保存通道，
          「放弃草稿」只删掉这条本机缓存，不影响已保存内容。
        </Banner>
      )}

      <div className="mjp-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        {editing && (
          <span
            className={`mjp-muted${saveState === '已保存' ? '' : ' is-warn'}`}
            data-testid="world-overview-save-state"
          >
            {saveState === '已保存'
              ? '已保存'
              : saveState === '正在保存'
                ? '正在保存…'
                : '改动还在本机，尚未保存'}
          </span>
        )}
        {!editing && (
          <Btn size="sm" data-testid="world-overview-edit" onClick={startEdit}>编辑总览</Btn>
        )}
        {editing && (
          <Btn size="sm" onClick={cancelEdit}>收起编辑</Btn>
        )}
        <Btn
          size="sm"
          variant="primary"
          data-testid="world-overview-finalize"
          disabled={!finalizeCheck.canFinalize || model.status === '定稿'}
          onClick={() => void finalizeWorld()}
        >
          {model.status === '定稿' ? '已定稿' : '把世界观标记为定稿'}
        </Btn>
      </div>

      {!finalizeCheck.canFinalize && (
        <div className="mjp-muted" data-testid="world-finalize-missing">
          还不能定稿，请先补全：{finalizeCheck.missing.join('、')}
        </div>
      )}

      <div className="mjp-grid-2">
        {WORLD_REQUIRED_FIELDS.map(({ key, label }) => {
          const field = key as WorldOverviewTextField
          return (
            <div className="mjp-card" key={key}>
              <div className="mjp-card-hd"><div className="ti">{label}</div></div>
              <div className="mjp-card-bd mjp-synopsis">
                {editing ? (
                  <textarea
                    className="mjp-textarea"
                    data-testid={`world-overview-input-${INPUT_TESTID_SUFFIX[field]}`}
                    value={draftValues[field] ?? ''}
                    onChange={(event) => {
                      const next = { ...draftValues, [field]: event.target.value }
                      setDraftValues(next)
                      stashDraft(next)
                    }}
                    onBlur={() => saveField(field)}
                  />
                ) : (
                  (model[field] ?? '').trim() || '未填写'
                )}
                {editing && fieldMessage?.field === field && (
                  <div className="mjp-muted" style={{ fontSize: 12, marginTop: 4 }}>{fieldMessage.text}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 主题：契约里一直有这份数据，此前只是没有看得见、改得了的出口。
          它不是定稿必填项，所以不参与定稿门槛，也不影响四项必填的判定。 */}
      <div className="mjp-card" style={{ marginTop: 12 }}>
        <div className="mjp-card-hd"><div className="ti">主题</div></div>
        <div className="mjp-card-bd mjp-synopsis">
          {editing ? (
            <textarea
              className="mjp-textarea"
              data-testid={`world-overview-input-${INPUT_TESTID_SUFFIX.themes}`}
              aria-label="主题"
              value={draftValues.themes ?? ''}
              onChange={(event) => {
                const next = { ...draftValues, themes: event.target.value }
                setDraftValues(next)
                stashDraft(next)
              }}
              onBlur={() => saveField('themes')}
            />
          ) : (
            model.themes.length ? model.themes.join('、') : '未填写'
          )}
          {editing && (
            <div className="mjp-muted" style={{ fontSize: 12, marginTop: 4 }}>
              用顿号、逗号或换行分隔；主题不是定稿必填项，留空也可以先定稿。
            </div>
          )}
          {editing && fieldMessage?.field === 'themes' && (
            <div className="mjp-muted" style={{ fontSize: 12, marginTop: 4 }}>{fieldMessage.text}</div>
          )}
        </div>
      </div>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        类型覆盖
        <span className="idx">{coveredTypes.length} / {WORLD_ENTRY_TYPES.length} 类已建立</span>
      </div>
      <div className="mjp-coverage">
        {model.coverage.map((item) => (
          <div key={item.type} className={`mjp-cov${item.count ? '' : ' is-empty'}`}>
            <span className="nm">{item.type}</span>
            <span className="ct">{item.count}</span>
            {item.count > 0 && (
              <button type="button" className="mjp-link-btn" onClick={() => onGoTo('world-entries')}>查看</button>
            )}
          </div>
        ))}
      </div>

      {(model.brokenRelationCount > 0 || model.constraints.待确认 > 0 || model.pendingQualityFindings > 0 || model.expansionProposalCount > 0) && (
        <>
          <div className="mjp-sec-h" style={{ marginTop: 18 }}>
            需要你去处理的真实问题
          </div>
          <div className="mjp-jump-list">
            {model.brokenRelationCount > 0 && (
              <button type="button" className="mjp-jump" onClick={() => onGoTo('world-entries')}>
                <span className="t">{model.brokenRelationCount} 条实体关系指向已不存在的词条</span>
                <span className="d">去词条页核对关系</span>
              </button>
            )}
            {model.constraints.待确认 > 0 && (
              <button type="button" className="mjp-jump" onClick={() => onGoTo('rules-boundaries')}>
                <span className="t">{model.constraints.待确认} 条术语边界仍是「待确认」</span>
                <span className="d">确认前不会成为正式约束</span>
              </button>
            )}
            {model.pendingQualityFindings > 0 && (
              <button type="button" className="mjp-jump" onClick={() => onGoTo('rules-boundaries')}>
                <span className="t">{model.pendingQualityFindings} 条世界观审校待处理</span>
                <span className="d">查看证据与解释</span>
              </button>
            )}
            {model.expansionProposalCount > 0 && (
              <button type="button" className="mjp-jump" onClick={() => onGoTo('world-expansion')}>
                <span className="t">{model.expansionProposalCount} 个世界扩展候选</span>
                <span className="d">候选不会自动进入正式设定</span>
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}
