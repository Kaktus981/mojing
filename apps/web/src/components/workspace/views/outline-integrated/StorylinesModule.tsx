import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, Link2, Plus, Trash2 } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Field, KV, Tag } from '../../../ui/Primitives'
import { buildStorylines } from '../outline/outlineModel'
import {
  PAUSE_SCOPE_OPTIONS,
  STORYLINE_NODE_STATUS_OPTIONS,
  STORYLINE_RETURN_POSITION_OPTIONS,
  STORYLINE_STATUS_OPTIONS,
  applyAddStoryline,
  applyAddStorylineChapterPlan,
  applyAddStorylineNode,
  applyRemoveStoryline,
  applyRemoveStorylineChapterPlan,
  applyRemoveStorylineNode,
  applyStorylineChapterPlanFieldEdit,
  applyStorylineChapterRangeEdit,
  applyStorylineEntryLinkEdit,
  applyStorylineFieldEdit,
  applyStorylineNodeFieldEdit,
  applyStorylineNodeStatusEdit,
  applyStorylinePauseEdit,
  applyStorylineStatusEdit,
  storylinePauseReady,
  storylineReferenceReport,
  type StorylineTextField,
  type StorylineWritingDraft,
  type WriteResult
} from './storylineWriting'

/** 事件线真实状态 → 语义色；不认识的值保持中性，不擅自归类。 */
function storylineTone(status: string): 'ok' | 'amber' | 'accent' | 'danger' | 'default' {
  if (status === '已完成') return 'ok'
  if (status === '推进中') return 'accent'
  if (status === '计划暂停' || status === '等待条件') return 'amber'
  if (status === '长期悬置') return 'danger'
  return 'default'
}

const TEXT_FIELDS: Array<{ field: StorylineTextField; label: string; hint: string; rows: number }> = [
  { field: 'type', label: '类型', hint: '如：主线 / 感情线 / 悬疑线；留空即未标注。', rows: 0 },
  { field: 'whyNecessary', label: '为什么需要这条线', hint: '它对全书的作用。', rows: 3 },
  { field: 'openingState', label: '开篇状态', hint: '这条线开始时处在什么状态。', rows: 3 },
  { field: 'finalGoal', label: '最终目标', hint: '这条线要走到哪里。', rows: 3 },
  { field: 'endCondition', label: '结束条件', hint: '满足什么才算收束。', rows: 3 },
  { field: 'nextAction', label: '下一步动作', hint: '作者自己定的下一步，不自动推算。', rows: 2 },
  { field: 'costPaid', label: '已付出的代价', hint: '推进这条线付出的代价。', rows: 2 }
]

/** 删除前的关联汇总：只读展示 storylineReferenceReport 的真实结果，不编造计数。 */
function DeleteReferences({ line, project, testid }: {
  line: NonNullable<NovelProject['storylines']>[number]
  project: NovelProject
  testid: string
}): React.JSX.Element {
  const draft: StorylineWritingDraft = {
    storylines: project.storylines,
    worldBible: project.worldBible ? { entries: project.worldBible.entries } : undefined,
    plotThreads: project.plotThreads
  }
  const report = storylineReferenceReport(draft, line.id)
  return (
    <div data-testid={testid} className="mjp-window" style={{ marginTop: 10 }}>
      <KV label="关联章节" value={`${report.chapterCount} 章`} mono />
      <KV label="关键节点" value={`${report.nodeCount} 个`} mono />
      <KV label="章节计划" value={`${report.chapterPlanCount} 条`} mono />
      <KV label="关联伏笔" value={report.plotThreadTitles.length ? report.plotThreadTitles.join('、') : '无'} mono />
      <KV label="关联词条" value={report.entryNames.length ? report.entryNames.join('、') : '无'} mono />
      <KV label="关联角色" value={report.characterIds.length ? report.characterIds.length + ' 个' : '无'} mono />
    </div>
  )
}

/**
 * 模块 4/4 · 事件线。
 *
 * M5 起本模块是 `project.storylines` 的**唯一手写位置**，全部经纯 mutator 落到同一个
 * 保存通道（`updateProject → 900ms 防抖 → persistNow`）：
 *   - 新建（必须先有名称）、改名、类型、开篇状态、最终目标、结束条件、下一步、代价；
 *   - 起始章与预计收束章（结束章不得早于开始章）；
 *   - 关键节点：新增（必须有名称）、改名与描述、状态、删除；
 *   - 章节关联：绑定真实章纲、写子目标与下一步触发、解绑；章纲结构变化后章号由服务端按身份校准；
 *   - 状态与暂停：改成「计划暂停」前必须已写暂停原因与返回条件，否则拒绝写入。
 *
 * 本模块**不**按已完成章节数推算推进百分比，也**不**与伏笔（plotThreads）混排：
 * 伏笔只在这里给出真实计数做交叉引用。
 */
export function StorylinesModule({ project, focusId }: { project: NovelProject; /** 项目内搜索的精确定位 id；传入且存在时自动选中。 */ focusId?: string }): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  /** 关联世界词条时只读 id / 名称 / 类型；不复制词条内容。 */
  const worldEntries = project.worldBible?.entries ?? []

  const model = useMemo(() => buildStorylines(project), [project])
  const lines = project.storylines ?? []
  const [selectedLineId, setSelectedLineId] = useState(lines[0]?.id ?? '')
  const [newLineTitle, setNewLineTitle] = useState('')
  const [newNodeTitle, setNewNodeTitle] = useState('')
  const [chapterToLink, setChapterToLink] = useState('')
  const [entryToLink, setEntryToLink] = useState('')
  const [message, setMessage] = useState<string>()
  const [rangeDraft, setRangeDraft] = useState<{ start: string; end: string }>()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()

  const active = lines.find((line) => line.id === selectedLineId) ?? lines[0]

  /** 项目内搜索的精确定位：focusId 存在且对应某条事件线时自动选中它。 */
  useEffect(() => {
    if (focusId && lines.some((line) => line.id === focusId)) {
      setSelectedLineId(focusId)
      setConfirmingDelete(false)
    }
  }, [focusId])
  const outlineChapters = (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
  const unlinkedChapters = outlineChapters.filter((chapter) => !active?.chapterPlans.some((plan) => plan.chapterId === chapter.id))

  function report(result: WriteResult): void {
    setMessage(result.ok ? undefined : result.message)
  }

  function createLine(): void {
    const id = `line-${Date.now().toString(36)}`
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyAddStoryline(draft, newLineTitle, new Date().toISOString(), id)
    })
    if (result.ok) {
      setNewLineTitle('')
      setSelectedLineId(id)
    }
    report(result)
  }

  function editText(field: StorylineTextField, value: string): void {
    if (!active) return
    updateProject((draft) => {
      applyStorylineFieldEdit(draft, active.id, field, value, new Date().toISOString())
    })
    setMessage(undefined)
  }

  function commitRange(): void {
    if (!active || !rangeDraft) return
    const start = rangeDraft.start.trim() ? Number(rangeDraft.start) : undefined
    const end = rangeDraft.end.trim() ? Number(rangeDraft.end) : undefined
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyStorylineChapterRangeEdit(draft, active.id, { startChapterNumber: start, expectedEndChapterNumber: end }, new Date().toISOString())
    })
    // 越界或倒序一律不写：输入框回显真实存值
    setRangeDraft(undefined)
    report(result)
  }

  function changeStatus(status: string): void {
    if (!active) return
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyStorylineStatusEdit(draft, active.id, status, new Date().toISOString())
    })
    report(result)
  }

  function editPause(patch: Parameters<typeof applyStorylinePauseEdit>[2]): void {
    if (!active) return
    updateProject((draft) => {
      applyStorylinePauseEdit(draft, active.id, patch, new Date().toISOString())
    })
    setMessage(undefined)
  }

  function addNode(): void {
    if (!active) return
    const id = `node-${Date.now().toString(36)}`
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyAddStorylineNode(draft, active.id, newNodeTitle, new Date().toISOString(), id)
    })
    if (result.ok) setNewNodeTitle('')
    report(result)
  }

  function linkChapter(chapterId: string): void {
    if (!active) return
    const chapter = outlineChapters.find((item) => item.id === chapterId)
    if (!chapter) return
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyAddStorylineChapterPlan(draft, active.id, { id: chapter.id, chapterNumber: chapter.chapterNumber }, new Date().toISOString())
    })
    if (result.ok) setChapterToLink('')
    report(result)
  }

  /** 删除整条事件线：先显式建检查点（常规保存不产生快照），再应用 applyRemoveStoryline。 */
  async function deleteLine(): Promise<void> {
    if (!active) return
    const remaining = lines.filter((line) => line.id !== active.id)
    setDeleting(true)
    setDeleteError(undefined)
    try {
      await mojingClient.versions.checkpoint(project.id, '删除事件线前：' + active.title)
      let result: WriteResult = { ok: false, message: '没有项目。' }
      updateProject((draft) => {
        result = applyRemoveStoryline(draft, active.id)
      })
      if (result.ok) {
        setConfirmingDelete(false)
        setSelectedLineId(remaining[0]?.id ?? '')
        setMessage(undefined)
      } else {
        // 被 externalRefs 阻止时展示真实拒绝原因，绝不执行删除
        setDeleteError(result.message)
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '建立检查点失败，删除未执行。')
    } finally {
      setDeleting(false)
    }
  }

  if (lines.length === 0) {
    return (
      <>
        <Banner tone="info" title={model.notice?.title ?? '项目里还没有剧情线记录'}>{model.notice?.detail}</Banner>
        <div className="mjp-card">
          <div className="mjp-card-hd">
            <div className="ti">
              新建事件线
              <div className="desc">名称由你填写；本模块不会替你编一个名字。其余字段建好后逐项补齐。</div>
            </div>
          </div>
          <div className="mjp-card-bd">
            <Field label="事件线名称" hint="例如「星纹古钟调查线」；必须填写才能建立。">
              <input
                className="mjp-input"
                type="text"
                maxLength={200}
                aria-label="事件线名称"
                value={newLineTitle}
                onChange={(event) => setNewLineTitle(event.target.value)}
              />
            </Field>
            <div className="mjp-row" style={{ marginTop: 12 }}>
              <Btn variant="primary" icon={Plus} onClick={createLine}>建立事件线</Btn>
            </div>
            {message && <p className="mjp-muted" style={{ marginTop: 8 }}>{message}</p>}
          </div>
        </div>
        <div className="mjp-notice is-inline">
          <div className="ic" aria-hidden="true"><GitBranch size={18} strokeWidth={1.8} /></div>
          <div>
            <b>可交叉核对的真实计数</b>
            <p>
              项目当前有 {model.relatedOpenThreadCount} 条未回收伏笔（属于「记忆与伏笔 · 伏笔中心」的资料，
              不是事件线）。伏笔不在这里混排。
            </p>
          </div>
        </div>
      </>
    )
  }

  const pauseReady = active ? storylinePauseReady(active) : false

  return (
    <>
      <div className="mjp-oi-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input
          className="mjp-input"
          type="text"
          maxLength={200}
          style={{ minWidth: 220 }}
          placeholder="新事件线名称"
          aria-label="新事件线名称"
          value={newLineTitle}
          onChange={(event) => setNewLineTitle(event.target.value)}
        />
        <Btn size="sm" icon={Plus} onClick={createLine}>新建事件线</Btn>
      </div>

      {message && <Banner tone="warn" title="这一步没有写入">{message}</Banner>}

      <div className="mjp-oi-lines">
        <div className="mjp-oi-line-list">
          {lines.map((line) => (
            <button
              key={line.id}
              type="button"
              className={`mjp-oi-item is-line${line.id === active?.id ? ' is-active' : ''}`}
              title={`查看「${line.title}」的详情（只切换本页选中，不修改任何字段）`}
              onClick={() => {
                setSelectedLineId(line.id)
                setMessage(undefined)
                setRangeDraft(undefined)
              }}
            >
              <span className="ti">
                <span className="nm">{line.title}</span>
                <span className="sub">{line.type || '未标注类型'}</span>
              </span>
              <span className="tags">
                <Tag tone={storylineTone(line.status)} dot>{line.status}</Tag>
              </span>
            </button>
          ))}
        </div>

        {active && (
          <section className="mjp-oi-plan-detail">
            <div className="mjp-card">
              <div className="mjp-card-hd">
                <div className="ti">
                  事件线详情
                </div>
                <div className="right">
                  <Tag tone={storylineTone(active.status)} dot>{active.status}</Tag>
                  <Btn size="sm" variant="danger" icon={Trash2} data-testid="storyline-delete" onClick={() => { setConfirmingDelete(true); setDeleteError(undefined) }}>删除事件线</Btn>
                </div>
              </div>
              {confirmingDelete && (
                <div className="mjp-card-bd" style={{ borderTop: '1px solid var(--mjp-line, #e5e7eb)' }}>
                  <Banner tone="warn" title={`确认删除「${active.title}」？`}>
                    只删除这条事件线本身；不会删除正文、章纲、世界词条、记忆或伏笔。删除前会先建立一个可恢复的检查点。
                  </Banner>
                  <DeleteReferences line={active} project={project} testid="storyline-delete-references" />
                  {deleteError && <p className="mjp-muted" style={{ marginTop: 8 }}>{deleteError}</p>}
                  <div className="mjp-row" style={{ gap: 8, marginTop: 10 }}>
                    <Btn size="sm" variant="danger" icon={Trash2} data-testid="storyline-delete-confirm" disabled={deleting} onClick={() => void deleteLine()}>
                      {deleting ? '正在删除…' : '确认删除'}
                    </Btn>
                    <Btn size="sm" onClick={() => { setConfirmingDelete(false); setDeleteError(undefined) }}>取消</Btn>
                  </div>
                </div>
              )}
              <div className="mjp-card-bd">
                <div className="mjp-grid-2">
                  <Field label="名称" hint="必填，不能清空。">
                    <input
                      className="mjp-input"
                      type="text"
                      maxLength={200}
                      aria-label="事件线详情名称"
                      value={active.title}
                      onChange={(event) => editText('title', event.target.value)}
                    />
                  </Field>
                  <Field label="状态" hint="改成「计划暂停」前必须先写暂停原因与返回条件。">
                    <select
                      className="mjp-select"
                      aria-label="事件线状态"
                      value={active.status}
                      onChange={(event) => changeStatus(event.target.value)}
                    >
                      {STORYLINE_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="mjp-grid-2" style={{ marginTop: 12 }}>
                  <Field label="起始章" hint="留空即未记录；必须是正整数。">
                    <input
                      className="mjp-input"
                      type="number"
                      min={1}
                      aria-label="起始章"
                      value={rangeDraft ? rangeDraft.start : active.startChapterNumber ?? ''}
                      onChange={(event) => setRangeDraft({ start: event.target.value, end: rangeDraft?.end ?? String(active.expectedEndChapterNumber ?? '') })}
                      onBlur={commitRange}
                    />
                  </Field>
                  <Field label="预计收束章" hint="不能早于起始章；倒序或非法值不会写入。">
                    <input
                      className="mjp-input"
                      type="number"
                      min={1}
                      aria-label="预计收束章"
                      value={rangeDraft ? rangeDraft.end : active.expectedEndChapterNumber ?? ''}
                      onChange={(event) => setRangeDraft({ start: rangeDraft?.start ?? String(active.startChapterNumber ?? ''), end: event.target.value })}
                      onBlur={commitRange}
                    />
                  </Field>
                </div>

                {TEXT_FIELDS.map((item) => (
                  <div key={item.field} style={{ marginTop: 12 }}>
                    <Field label={item.label} hint={item.hint}>
                      {item.rows === 0 ? (
                        <input
                          className="mjp-input"
                          type="text"
                          maxLength={80}
                          aria-label={item.label}
                          value={active[item.field]}
                          onChange={(event) => editText(item.field, event.target.value)}
                        />
                      ) : (
                        <textarea
                          className="mjp-textarea"
                          rows={item.rows}
                          maxLength={2_000}
                          aria-label={item.label}
                          value={active[item.field]}
                          onChange={(event) => editText(item.field, event.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                ))}

                <div className="mjp-window" style={{ marginTop: 14 }}>
                  <KV label="关键节点" value={`${active.keyNodes.length} 个`} mono />
                  <KV label="章节关联" value={`${active.chapterPlans.length} 条`} mono />
                  <KV label="证据链" value={`${active.evidenceChain.length} 条`} mono />
                  <KV label="未决问题" value={`${active.unresolvedQuestions.length} 条`} mono />
                </div>

                {/*
                  关联世界词条：只维护 entryIds 这一份引用，不复制词条资料。
                  反过来，词条被事件线引用时不能直接删除——必须先在这里解绑。
                */}
                <div className="mjp-window" style={{ marginTop: 14 }}>
                  <KV label="关联世界词条" value={`${active.entryIds.length} 条`} mono />
                  {active.entryIds.length === 0 && (
                    <p className="mjp-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>还没有关联任何世界词条。</p>
                  )}
                  {active.entryIds.map((entryId) => {
                    const entry = worldEntries.find((item) => item.id === entryId)
                    return (
                      <div key={entryId} className="mjp-row" style={{ gap: 8, fontSize: 12, marginTop: 6, alignItems: 'center' }}>
                        <Tag tone={entry ? 'outline' : 'amber'}>{entry ? entry.name : `已失效引用（${entryId}）`}</Tag>
                        <Btn
                          size="sm"
                          variant="ghost"
                          aria-label={`解绑词条${entry?.name ?? entryId}`}
                          onClick={() => {
                            let result: WriteResult = { ok: false, message: '没有项目。' }
                            updateProject((draft) => {
                              result = applyStorylineEntryLinkEdit(draft, active.id, entryId, false, new Date().toISOString())
                            })
                            report(result)
                          }}
                        >
                          解绑
                        </Btn>
                      </div>
                    )
                  })}
                  <div className="mjp-row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <select
                      className="mjp-select"
                      style={{ maxWidth: 220 }}
                      aria-label="要关联的世界词条"
                      value={entryToLink}
                      onChange={(event) => setEntryToLink(event.target.value)}
                      disabled={worldEntries.length === 0}
                    >
                      <option value="">{worldEntries.length === 0 ? '世界观里还没有词条' : '选择世界词条'}</option>
                      {worldEntries.filter((entry) => !active.entryIds.includes(entry.id)).map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.name}（{entry.type}）</option>
                      ))}
                    </select>
                    <Btn
                      size="sm"
                      disabled={!entryToLink}
                      onClick={() => {
                        const entryId = entryToLink
                        let result: WriteResult = { ok: false, message: '没有项目。' }
                        updateProject((draft) => {
                          result = applyStorylineEntryLinkEdit(draft, active.id, entryId, true, new Date().toISOString())
                        })
                        if (result.ok) setEntryToLink('')
                        report(result)
                      }}
                    >
                      关联
                    </Btn>
                  </div>
                </div>
              </div>
            </div>

            <div className="mjp-card" style={{ marginTop: 14 }}>
              <div className="mjp-card-hd">
                <div className="ti">暂停信息<div className="desc">只在状态为「计划暂停」时是必要条件；平时也可以先写下来。</div></div>
              </div>
              <div className="mjp-card-bd">
                {active.status === '计划暂停' && (
                  <Banner tone="warn" title="这条事件线处于「计划暂停」">
                    {pauseReady ? '暂停原因与返回条件都已记录。' : '缺少暂停原因或返回条件，请补齐。'}
                  </Banner>
                )}
                <div className="mjp-grid-2" style={{ marginTop: 8 }}>
                  <Field label="暂停原因" hint="为什么现在停下。">
                    <textarea
                      className="mjp-textarea"
                      rows={2}
                      maxLength={2_000}
                      aria-label="暂停原因"
                      value={active.pause?.reason ?? ''}
                      onChange={(event) => editPause({ reason: event.target.value })}
                    />
                  </Field>
                  <Field label="返回条件" hint="满足什么才恢复这条线。">
                    <textarea
                      className="mjp-textarea"
                      rows={2}
                      maxLength={2_000}
                      aria-label="返回条件"
                      value={active.pause?.returnCondition ?? ''}
                      onChange={(event) => editPause({ returnCondition: event.target.value })}
                    />
                  </Field>
                  <Field label="暂停范围" hint="暂停覆盖到哪一段。">
                    <select
                      className="mjp-select"
                      aria-label="暂停范围"
                      value={active.pause?.scope ?? '下一章'}
                      onChange={(event) => editPause({ scope: event.target.value })}
                    >
                      {PAUSE_SCOPE_OPTIONS.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                    </select>
                  </Field>
                  <Field label="预计返回位置" hint="恢复时从哪里接回。">
                    <select
                      className="mjp-select"
                      aria-label="预计返回位置"
                      value={active.pause?.expectedReturnPosition ?? '下一章开头'}
                      onChange={(event) => editPause({ expectedReturnPosition: event.target.value })}
                    >
                      {STORYLINE_RETURN_POSITION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </Field>
                  <Field label="暂停时状态" hint="停下时这条线走到哪。">
                    <textarea
                      className="mjp-textarea"
                      rows={2}
                      maxLength={2_000}
                      aria-label="暂停时状态"
                      value={active.pause?.currentState ?? ''}
                      onChange={(event) => editPause({ currentState: event.target.value })}
                    />
                  </Field>
                  <Field label="幕后变化" hint="暂停期间世界或人物发生的变化。">
                    <textarea
                      className="mjp-textarea"
                      rows={2}
                      maxLength={2_000}
                      aria-label="幕后变化"
                      value={active.pause?.behindTheScenesChange ?? ''}
                      onChange={(event) => editPause({ behindTheScenesChange: event.target.value })}
                    />
                  </Field>
                </div>
                {!pauseReady && (
                  <p className="mjp-muted" style={{ marginTop: 8, fontSize: 12 }}>
                    <AlertTriangle size={13} strokeWidth={1.8} aria-hidden="true" /> 暂停原因与返回条件都填写后，才可以把状态改成「计划暂停」。
                  </p>
                )}
              </div>
            </div>

            <div className="mjp-card" style={{ marginTop: 14 }}>
              <div className="mjp-card-hd">
                <div className="ti">关键节点<span className="idx">{active.keyNodes.length} 个</span></div>
              </div>
              <div className="mjp-card-bd">
                {active.keyNodes.length === 0 && <p className="mjp-muted">还没有关键节点。节点名称由你写；本模块不会自动生成节点。</p>}
                {active.keyNodes.map((node) => (
                  <div key={node.id} className="mjp-oi-item is-line" style={{ cursor: 'default' }}>
                    <span className="ti" style={{ flex: 1 }}>
                      <input
                        className="mjp-input"
                        type="text"
                        maxLength={200}
                        aria-label={`节点名称 ${node.id}`}
                        value={node.title}
                        onChange={(event) => updateProject((draft) => {
                          applyStorylineNodeFieldEdit(draft, active.id, node.id, 'title', event.target.value, new Date().toISOString())
                        })}
                      />
                      <textarea
                        className="mjp-textarea"
                        rows={2}
                        maxLength={2_000}
                        style={{ marginTop: 6 }}
                        aria-label={`节点描述 ${node.id}`}
                        value={node.description}
                        onChange={(event) => updateProject((draft) => {
                          applyStorylineNodeFieldEdit(draft, active.id, node.id, 'description', event.target.value, new Date().toISOString())
                        })}
                      />
                    </span>
                    <span className="tags">
                      <select
                        className="mjp-select"
                        aria-label={`节点状态 ${node.id}`}
                        value={node.status}
                        onChange={(event) => updateProject((draft) => {
                          applyStorylineNodeStatusEdit(draft, active.id, node.id, event.target.value, new Date().toISOString())
                        })}
                      >
                        {STORYLINE_NODE_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                      <Btn
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        aria-label={`删除节点 ${node.id}`}
                        onClick={() => updateProject((draft) => {
                          applyRemoveStorylineNode(draft, active.id, node.id, new Date().toISOString())
                        })}
                      />
                    </span>
                  </div>
                ))}
                <div className="mjp-row" style={{ marginTop: 10, gap: 8 }}>
                  <input
                    className="mjp-input"
                    type="text"
                    maxLength={200}
                    placeholder="新节点名称"
                    aria-label="新节点名称"
                    value={newNodeTitle}
                    onChange={(event) => setNewNodeTitle(event.target.value)}
                  />
                  <Btn size="sm" icon={Plus} onClick={addNode}>新增节点</Btn>
                </div>
              </div>
            </div>

            <div className="mjp-card" style={{ marginTop: 14 }}>
              <div className="mjp-card-hd">
                <div className="ti">章节关联<span className="idx">{active.chapterPlans.length} 条</span></div>
              </div>
              <div className="mjp-card-bd">
                {active.chapterPlans.length === 0 && (
                  <p className="mjp-muted">还没有绑定章节。事件线通过绑定真实章纲来推进，不会按章数自动计算进度。</p>
                )}
                {active.chapterPlans.map((plan) => (
                  <div key={plan.chapterId} className="mjp-beat">
                    <div className="ord" aria-hidden="true">{plan.chapterNumber}</div>
                    <div className="bd">
                      <div className="mjp-grid-2">
                        <Field label="子目标" hint="这一章对这条线要推进什么。">
                          <textarea
                            className="mjp-textarea"
                            rows={2}
                            maxLength={2_000}
                            aria-label={`第${plan.chapterNumber}章 子目标`}
                            value={plan.subGoal}
                            onChange={(event) => updateProject((draft) => {
                              applyStorylineChapterPlanFieldEdit(draft, active.id, plan.chapterId, 'subGoal', event.target.value, new Date().toISOString())
                            })}
                          />
                        </Field>
                        <Field label="下一步触发" hint="这一章结束时引出什么。">
                          <textarea
                            className="mjp-textarea"
                            rows={2}
                            maxLength={2_000}
                            aria-label={`第${plan.chapterNumber}章 下一步触发`}
                            value={plan.nextTrigger}
                            onChange={(event) => updateProject((draft) => {
                              applyStorylineChapterPlanFieldEdit(draft, active.id, plan.chapterId, 'nextTrigger', event.target.value, new Date().toISOString())
                            })}
                          />
                        </Field>
                      </div>
                      <div className="mjp-row" style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
                        <Tag tone={plan.status === '已完成' ? 'ok' : plan.status === '待复核' ? 'amber' : 'default'}>{plan.status}</Tag>
                        <Btn
                          size="sm"
                          variant="danger"
                          icon={Trash2}
                          aria-label={`解绑第 ${plan.chapterNumber} 章`}
                          onClick={() => updateProject((draft) => {
                            applyRemoveStorylineChapterPlan(draft, active.id, plan.chapterId, new Date().toISOString())
                          })}
                        >
                          解绑
                        </Btn>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="mjp-row" style={{ marginTop: 10, gap: 8, alignItems: 'center' }}>
                  <select
                    className="mjp-select"
                    aria-label="绑定章节"
                    value={chapterToLink}
                    onChange={(event) => {
                      setChapterToLink(event.target.value)
                      if (event.target.value) linkChapter(event.target.value)
                    }}
                  >
                    <option value="">选择要绑定的章节</option>
                    {unlinkedChapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>第{chapter.chapterNumber}章 · {chapter.title || '未命名'}</option>
                    ))}
                  </select>
                  <span className="mjp-muted" style={{ fontSize: 12 }}>
                    <Link2 size={13} strokeWidth={1.8} aria-hidden="true" /> 绑定的是真实章纲；章纲结构变化后章号会自动跟着校准。
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <p className="mjp-tbl-foot">
        共 {lines.length} 条事件线，全部来自这个项目自己的故事线记录。
        {' '}另有 {model.relatedOpenThreadCount} 条未回收伏笔属于伏笔中心，不在此模块混排。
      </p>
    </>
  )
}
