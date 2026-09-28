import { useMemo, useState } from 'react'
import { PenLine, Plus, ShieldAlert } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Field, Tag } from '../../../ui/Primitives'
import {
  MANUAL_EVIDENCE_PREFIX,
  PLOT_THREAD_STATUS_OPTIONS,
  applyAddChapterMemory,
  applyAddPlotThread,
  applyChapterMemoryEdit,
  applyPlotThreadPayoffPlan,
  applyPlotThreadProgress,
  applyPlotThreadResolution,
  applyPlotThreadSetup,
  applyPlotThreadStatusEdit,
  isAuthorWrittenMemory,
  type WriteResult
} from './memoryWriting'

type EvidenceMode = 'prose' | 'manual'

/**
 * 伏笔手写面板（M6）。
 *
 * 「埋设 / 推进 / 实际回收」都必须留下证据，且证据只有两种来源：
 *   1. **正文章段**：从当前项目真实存在的段落里挑一段，摘录直接取自该段文字；
 *   2. **作者手动说明**：摘录写成「作者手动说明：…」，明确它不是正文引用。
 * 因此数据里永远不会出现「凭空生成的引用」，也不会把作者的话伪装成正文证据。
 */
export function PlotThreadManualPanel({ project, chapterId }: { project: NovelProject; chapterId?: string }): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const [newTitle, setNewTitle] = useState('')
  const [threadId, setThreadId] = useState('')
  const [mode, setMode] = useState<EvidenceMode>('prose')
  const [evidenceChapterId, setEvidenceChapterId] = useState('')
  const [blockId, setBlockId] = useState('')
  const [note, setNote] = useState('')
  const [description, setDescription] = useState('')
  const [payoffChapter, setPayoffChapter] = useState('')
  const [message, setMessage] = useState<string>()

  const threads = project.plotThreads
  const thread = threads.find((item) => item.id === threadId) ?? threads.find((item) => item.id === chapterId) ?? threads[0]
  const evidenceChapter = project.chapters.find((chapter) => chapter.id === evidenceChapterId) ?? project.chapters[0]
  const blocks = evidenceChapter?.blocks ?? []
  const block = blocks.find((item) => item.id === blockId) ?? blocks[0]

  const evidence = useMemo(() => {
    if (!evidenceChapter || !thread) return undefined
    if (mode === 'manual') {
      const text = note.trim()
      if (!text) return undefined
      return { chapterId: evidenceChapter.id, blockId: block?.id, excerpt: `${MANUAL_EVIDENCE_PREFIX}${text}` }
    }
    if (!block || !block.text.trim()) return undefined
    // 摘录直接取自真实段落文字，不做任何改写
    return { chapterId: evidenceChapter.id, blockId: block.id, excerpt: block.text.slice(0, 200) }
  }, [block, evidenceChapter, mode, note, thread])

  function report(result: WriteResult): void {
    setMessage(result.ok ? undefined : result.message)
  }

  function createThread(): void {
    const id = `thread-${Date.now().toString(36)}`
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyAddPlotThread(draft, { title: newTitle }, new Date().toISOString(), id)
    })
    if (result.ok) {
      setNewTitle('')
      setThreadId(id)
    }
    report(result)
  }

  function record(kind: 'setup' | 'progress' | 'resolution'): void {
    if (!thread) return
    if (!evidence || !evidenceChapter) {
      setMessage(mode === 'manual' ? '请先写下作者说明。' : '请先选择一段真实正文作为证据。')
      return
    }
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      const now = new Date().toISOString()
      if (kind === 'setup') result = applyPlotThreadSetup(draft, thread.id, { chapterId: evidenceChapter.id, method: thread.setupMethod || '作者手写', evidence }, now)
      else if (kind === 'progress') {
        result = applyPlotThreadProgress(draft, thread.id, {
          chapterId: evidenceChapter.id,
          description: description.trim() || '推进',
          evidence,
          progressId: `progress-${Date.now().toString(36)}`
        }, now)
      } else result = applyPlotThreadResolution(draft, thread.id, { chapterId: evidenceChapter.id, method: thread.resolutionMethod || '作者手写', evidence }, now)
    })
    if (result.ok) setDescription('')
    report(result)
  }

  function changeStatus(status: string): void {
    if (!thread) return
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyPlotThreadStatusEdit(draft, thread.id, status, new Date().toISOString())
    })
    report(result)
  }

  function savePayoffChapter(): void {
    if (!thread) return
    const parsed = payoffChapter.trim() ? Number(payoffChapter) : undefined
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyPlotThreadPayoffPlan(draft, thread.id, parsed, new Date().toISOString())
    })
    report(result)
  }

  return (
    <div className="mjp-card">
      <div className="mjp-card-hd">
        <div className="ti">
          手写维护伏笔
          <div className="desc">
            埋设 / 推进 / 实际回收都要留下证据。证据要么取自真实段落，要么明确写成「作者手动说明」，不会伪造引用。
          </div>
        </div>
      </div>
      <div className="mjp-card-bd">
        {message && <Banner tone="warn" title="这一步没有写入">{message}</Banner>}

        <div className="mjp-oi-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input
            className="mjp-input"
            type="text"
            style={{ minWidth: 200 }}
            placeholder="新伏笔名称"
            aria-label="新伏笔名称"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <Btn size="sm" icon={Plus} onClick={createThread}>新建伏笔</Btn>
        </div>

        {threads.length === 0 ? (
          <p className="mjp-muted">还没有伏笔。名称由你填写，建立后状态是「计划」，需要证据才能进入已埋设。</p>
        ) : (
          <>
            <div className="mjp-grid-2" style={{ marginTop: 12 }}>
              <Field label="要维护的伏笔" hint="选择一条伏笔再记录证据。">
                <select className="mjp-select" aria-label="要维护的伏笔" value={thread?.id ?? ''} onChange={(event) => setThreadId(event.target.value)}>
                  {threads.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </Field>
              <Field label="伏笔状态" hint="已埋设 / 推进中 / 已回收都需要已有证据。">
                <select className="mjp-select" aria-label="伏笔状态" value={thread?.status ?? '计划'} onChange={(event) => changeStatus(event.target.value)}>
                  {PLOT_THREAD_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </Field>
              <Field label="证据来源" hint="正文章段＝真实摘录；作者手动说明＝明确标注不是正文引用。">
                <select className="mjp-select" aria-label="证据来源" value={mode} onChange={(event) => setMode(event.target.value as EvidenceMode)}>
                  <option value="prose">正文章段</option>
                  <option value="manual">作者手动说明</option>
                </select>
              </Field>
              <Field label="证据所在章" hint="必须从项目真实章节里选。">
                <select
                  className="mjp-select"
                  aria-label="证据所在章"
                  value={evidenceChapter?.id ?? ''}
                  onChange={(event) => { setEvidenceChapterId(event.target.value); setBlockId('') }}
                >
                  {project.chapters.map((item) => (
                    <option key={item.id} value={item.id}>第{item.chapterNumber}章 · {item.title || '未命名'}</option>
                  ))}
                </select>
              </Field>
              {mode === 'prose' ? (
                <Field label="证据段落" hint="摘录会原样取自这一段文字。">
                  <select className="mjp-select" aria-label="证据段落" value={block?.id ?? ''} onChange={(event) => setBlockId(event.target.value)}>
                    {blocks.map((item, index) => (
                      <option key={item.id} value={item.id}>第{index + 1}段 · {item.text.slice(0, 24) || '（空段）'}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="作者说明" hint="会以「作者手动说明：」开头保存，明确不是正文引用。">
                  <input
                    className="mjp-input"
                    type="text"
                    maxLength={500}
                    aria-label="作者说明"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </Field>
              )}
              <Field label="推进说明（可选）" hint="记录推进时写一句话。">
                <input
                  className="mjp-input"
                  type="text"
                  maxLength={500}
                  aria-label="推进说明"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </div>

            <div className="mjp-row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
              <Btn size="sm" icon={PenLine} disabled={!thread} onClick={() => record('setup')}>记录埋设</Btn>
              <Btn size="sm" disabled={!thread} onClick={() => record('progress')}>记录推进</Btn>
              <Btn size="sm" variant="primary" disabled={!thread} onClick={() => record('resolution')}>记录实际回收</Btn>
            </div>

            <div className="mjp-oi-toolbar" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Field label="计划回收章" hint="只写章号，不代表已经回收。">
                <input
                  className="mjp-input"
                  type="number"
                  min={1}
                  style={{ maxWidth: 160 }}
                  aria-label="计划回收章"
                  value={payoffChapter || (thread?.targetPayoffChapter ?? '')}
                  onChange={(event) => setPayoffChapter(event.target.value)}
                />
              </Field>
              <Btn size="sm" disabled={!thread} onClick={savePayoffChapter}>保存计划</Btn>
              {thread?.setupEvidence && <Tag tone="accent">已有埋设证据</Tag>}
              {thread?.resolutionEvidence && <Tag tone="ok">已有回收证据</Tag>}
              {thread && !thread.setupEvidence && <Tag tone="amber">尚无埋设证据</Tag>}
            </div>

            <p className="mjp-muted" style={{ marginTop: 10, fontSize: 12 }}>
              <ShieldAlert size={13} strokeWidth={1.8} aria-hidden="true" /> 本页仍然不提供硬删除：作废请用状态「已放弃」，它会保留全部证据与历史。
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 正式记忆手写面板（M6）。
 *
 * 作者手写的记忆摘录留空 ⇒ 台账会把它标成「作者手写」，不冒充正文已证实；
 * 分析结果生成的记忆（摘录非空）不能被就地改写，仍然只能走记忆变更提案。
 */
export function ChapterMemoryManualPanel({ project, chapterId }: { project: NovelProject; chapterId?: string }): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const createManualMemoryProposal = useNovelStore((state) => state.createManualMemoryProposal)
  const busy = useNovelStore((state) => state.busy)
  const [targetChapterId, setTargetChapterId] = useState(chapterId ?? project.chapters[0]?.id ?? '')
  const [summary, setSummary] = useState('')
  const [keyEvents, setKeyEvents] = useState('')
  const [message, setMessage] = useState<string>()
  const [proposalReason, setProposalReason] = useState('')
  const [proposalSaved, setProposalSaved] = useState(false)

  const chapter = project.chapters.find((item) => item.id === targetChapterId) ?? project.chapters[0]
  const memory = project.memories.find((item) => item.chapterId === chapter?.id)

  function report(result: WriteResult): void {
    setMessage(result.ok ? undefined : result.message)
  }

  function createMemory(): void {
    if (!chapter) return
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyAddChapterMemory(draft, chapter.id, {
        summary,
        keyEvents: keyEvents.split('\n').map((item) => item.trim()).filter(Boolean)
      }, new Date().toISOString(), `memory-${Date.now().toString(36)}`)
    })
    if (result.ok) {
      setSummary('')
      setKeyEvents('')
    }
    report(result)
  }

  function editMemory(): void {
    if (!memory) return
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyChapterMemoryEdit(draft, memory.id, {
        summary,
        keyEvents: keyEvents.split('\n').map((item) => item.trim()).filter(Boolean)
      }, new Date().toISOString())
    })
    if (result.ok) {
      setSummary('')
      setKeyEvents('')
    }
    report(result)
  }

  async function proposeSummaryRevision(): Promise<void> {
    if (!chapter || !summary.trim() || !proposalReason.trim()) return
    setProposalSaved(false)
    const saved = await createManualMemoryProposal(chapter.id, summary.trim(), proposalReason.trim())
    if (saved) {
      setSummary('')
      setProposalReason('')
      setProposalSaved(true)
    }
  }

  return (
    <div className="mjp-card">
      <div className="mjp-card-hd">
        <div className="ti">
          手写正式记忆
          <div className="desc">
            作者手写的记忆会标成「作者手写」，不会声称已由正文证实；分析结果生成的记忆只能走记忆提案。
          </div>
        </div>
      </div>
      <div className="mjp-card-bd">
        {message && <Banner tone="warn" title="这一步没有写入">{message}</Banner>}
        {proposalSaved && <Banner tone="info" title="摘要修订已提交">请到「记忆变更提案」核对并确认；正式记忆目前没有改变。</Banner>}
        <div className="mjp-grid-2">
          <Field label="章节" hint="一章只保留一份正式记忆，避免出现两套口径。">
            <select className="mjp-select" aria-label="记忆章节" value={chapter?.id ?? ''} onChange={(event) => setTargetChapterId(event.target.value)}>
              {project.chapters.map((item) => (
                <option key={item.id} value={item.id}>第{item.chapterNumber}章 · {item.title || '未命名'}</option>
              ))}
            </select>
          </Field>
          <Field label="当前状态" hint="已有记忆的类型与状态。">
            <input
              className="mjp-input"
              type="text"
              readOnly
              aria-label="当前记忆状态"
              value={memory ? `${memory.status}${isAuthorWrittenMemory(memory) ? ' · 作者手写' : ' · 分析结果'}` : '这一章还没有正式记忆'}
            />
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="记忆内容" hint="要沉淀成正式记忆的事实摘要。">
            <textarea
              className="mjp-textarea"
              rows={3}
              maxLength={2_000}
              aria-label="记忆内容"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
        </div>
        {(!memory || isAuthorWrittenMemory(memory)) && <div style={{ marginTop: 12 }}>
          <Field label="关键事件" hint="每行一条。">
            <textarea
              className="mjp-textarea"
              rows={2}
              maxLength={2_000}
              aria-label="关键事件"
              value={keyEvents}
              onChange={(event) => setKeyEvents(event.target.value)}
            />
          </Field>
        </div>}
        {memory && !isAuthorWrittenMemory(memory) && <div style={{ marginTop: 12 }}>
          <Field label="修订原因" hint="说明为什么需要调整分析生成的摘要。">
            <input className="mjp-input" value={proposalReason} maxLength={1_000} onChange={(event) => setProposalReason(event.target.value)} />
          </Field>
        </div>}
        <div className="mjp-row" style={{ marginTop: 12, gap: 8 }}>
          <Btn size="sm" variant="primary" icon={Plus} disabled={Boolean(memory)} onClick={createMemory}>新增手写记忆</Btn>
          <Btn size="sm" disabled={!memory || !isAuthorWrittenMemory(memory)} onClick={editMemory}>修订这条手写记忆</Btn>
          {memory && !isAuthorWrittenMemory(memory) && <Btn size="sm" variant="primary" disabled={busy || !summary.trim() || !proposalReason.trim() || summary.trim() === memory.summary} onClick={() => void proposeSummaryRevision()}>提交摘要修订提案</Btn>}
        </div>
        {memory?.editHistory?.length ? (
          <details style={{ marginTop: 12 }}>
            <summary>查看旧摘要（{memory.editHistory.length}）</summary>
            <ol>
              {memory.editHistory.map((entry, index) => <li key={`${entry.changedAt}-${index}`}>{entry.summary}</li>)}
            </ol>
          </details>
        ) : null}
        {memory && isAuthorWrittenMemory(memory) && memory.status === '需更新' && (
          <p className="mjp-muted" style={{ marginTop: 10, fontSize: 12 }}>
            状态「需更新」的含义：这条作者手写记忆没有与正文摘要绑定，系统因此不把它当作已由正文分析的结论；
            改写正文后请自行核对这条记忆。
          </p>
        )}
      </div>
    </div>
  )
}
