import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { NovelProject } from '../../../../../packages/contracts/src'
import { useNovelStore } from '../../novelStore'
import { Banner, Btn, EmptyState } from '../ui/Primitives'
import { saveStateTone } from './workspaceHeader'
import { ProseEditor } from './ProseEditor'
import { clearDraft, loadDraft, saveDraft, type DraftSnapshot } from './draftCache'
import { countChapterWords, type ProseBlock } from './paragraphModel'

/** 草稿容灾写入防抖：比正式保存（900ms）更短，尽量贴近最后一次输入。 */
const DRAFT_STASH_DELAY = 400

function differs(a: readonly ProseBlock[], b: readonly ProseBlock[]): boolean {
  if (a.length !== b.length) return true
  return a.some((block, index) => block.text !== b[index]!.text)
}

/**
 * 正文创作：章节标题 + 单列衬线正文 + 真实保存状态。
 *
 * 编辑策略（M1）：
 *   1. 段落级输入**立即**进入 store 草稿，再走统一的 `updateProject → 900ms 防抖 → persistNow`
 *      通道；不再依赖 onBlur，因此保持焦点连续输入也会真实保存；
 *   2. 保存期间继续输入时，store 只把响应里的 revision 合并回最新草稿，不覆盖新输入；
 *   3. 失败时如实显示「未保存」+ 错误 + 重试，不显示假成功；
 *   4. 未确认保存的草稿写入 IndexedDB 容灾缓存（按项目隔离），服务端确认后清理；
 *      刷新后如发现缓存与当前内容不一致，提示恢复 / 对比差异 / 放弃；
 *   5. 仍有未保存改动时关闭页面会触发浏览器原生提醒（异步 unload 请求不能保证落盘）。
 * 保存与候选安全逻辑保持原样，未新增第二条保存通道。
 */
export function WritingPane({
  project,
  chapterId,
  focus = false
}: {
  project: NovelProject
  chapterId?: string
  /** 专注模式只改变侧栏与保存状态测试标记，不改变正文保存通道。 */
  focus?: boolean
}): React.JSX.Element {
  const updateProject = useNovelStore((state) => state.updateProject)
  const persistNow = useNovelStore((state) => state.persistNow)
  const selectChapter = useNovelStore((state) => state.selectChapter)
  const saveState = useNovelStore((state) => state.saveState)
  const saveError = useNovelStore((state) => state.saveError)
  const chapter = project.chapters.find((item) => item.id === chapterId) ?? project.chapters[0]

  const [stashed, setStashed] = useState<DraftSnapshot>()
  const [showDiff, setShowDiff] = useState(false)
  const stashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const editSequence = useRef(0)
  const sawUnsaved = useRef(false)

  const chapterIdForDraft = chapter?.id
  const serverBlocks = chapter?.blocks ?? []

  // 进入章节时读取容灾缓存；只有内容确实不同才提示，避免噪音
  useEffect(() => {
    let cancelled = false
    setStashed(undefined)
    setShowDiff(false)
    if (!chapterIdForDraft) return undefined
    void loadDraft(project.id).then((snapshot) => {
      if (cancelled || !snapshot) return
      if (snapshot.chapterId !== chapterIdForDraft) return
      if (!differs(snapshot.blocks, serverBlocks)) return
      setStashed(snapshot)
    })
    return () => {
      cancelled = true
    }
    // 只在切换项目 / 章节时检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, chapterIdForDraft])

  // 服务端确认保存成功后清理容灾缓存。
  // 只在「本次进入编辑 → 未保存 → 已保存」的转换后清理：挂载时 store 本来就是「已保存」，
  // 若那时也清理，就会把上一次会话留下的待恢复草稿直接抹掉。
  useEffect(() => {
    if (saveState !== '已保存') {
      sawUnsaved.current = true
      return
    }
    if (!sawUnsaved.current) return
    sawUnsaved.current = false
    void clearDraft(project.id)
  }, [saveState, project.id])

  // 仍有未保存改动时，关闭页面给出浏览器原生提醒
  useEffect(() => {
    if (saveState === '已保存') return undefined
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveState])

  useEffect(() => () => {
    if (stashTimer.current) clearTimeout(stashTimer.current)
  }, [])

  const diffRows = useMemo(() => {
    if (!stashed) return []
    const rows: Array<{ index: number; server: string; draft: string }> = []
    const max = Math.max(stashed.blocks.length, serverBlocks.length)
    for (let index = 0; index < max; index += 1) {
      const server = serverBlocks[index]?.text ?? ''
      const draft = stashed.blocks[index]?.text ?? ''
      if (server !== draft) rows.push({ index, server, draft })
    }
    return rows
  }, [stashed, serverBlocks])

  if (!chapter) {
    return (
      <EmptyState
        title="还没有章节"
        description="先在「小说大纲 · 章节规划」里建立章纲，再回到这里写正文。"
        action={<Btn variant="primary" onClick={() => selectChapter(project.chapters[0]?.id ?? '')} disabled={project.chapters.length === 0}>新建第一章</Btn>}
      />
    )
  }

  function commitBlocks(blocks: ProseBlock[]): void {
    editSequence.current += 1
    const sequence = editSequence.current
    const baseRevision = project.revision
    const target = chapter!
    updateProject((draft) => {
      const found = draft.chapters.find((item) => item.id === target.id)
      if (found) found.blocks = blocks.map((block) => ({ ...block }))
    }, target.id)

    if (stashTimer.current) clearTimeout(stashTimer.current)
    stashTimer.current = setTimeout(() => {
      void saveDraft({
        projectId: project.id,
        baseRevision,
        editSequence: sequence,
        chapterId: target.id,
        blocks: blocks.map((block) => ({ ...block })),
        savedAt: new Date().toISOString()
      })
    }, DRAFT_STASH_DELAY)
  }

  function restoreStash(): void {
    if (!stashed) return
    commitBlocks(stashed.blocks)
    setStashed(undefined)
    setShowDiff(false)
  }

  function discardStash(): void {
    void clearDraft(project.id)
    setStashed(undefined)
    setShowDiff(false)
  }

  return (
    <div className="mjp-editor">
      <div className="mjp-editor-bar">
        <div className="mjp-editor-title">
          <span className="mjp-editor-chapter-no">第{chapter.chapterNumber}章</span>
          <input
            className="ch-title"
            value={chapter.title}
            onChange={(event) => {
              const next = event.target.value
              updateProject((draft) => {
                const target = draft.chapters.find((item) => item.id === chapter.id)
                if (target) target.title = next
              })
            }}
          />
        </div>
        <span
          className={`mjp-save-state is-${saveStateTone(saveState)}`}
          data-testid={focus ? 'writing-focus-save-state' : 'writing-save-state'}
          title={`保存状态：${saveState ?? '已保存'}`}
          aria-live={saveState === '正在保存' ? 'polite' : 'off'}
        >
          <i className="dot" />
          {saveState ?? '已保存'}
        </span>
      </div>

      {saveState === '保存失败' && saveError && (
        <Banner
          tone="danger"
          state="error"
          data-testid="save-error-banner"
          title="保存失败，改动仍在本机草稿里"
          action={<Btn size="sm" icon={RefreshCw} onClick={() => void persistNow()}>重试保存</Btn>}
        >
          {saveError}
        </Banner>
      )}

      {stashed && (
        <Banner
          tone="warn"
          title={`检测到未保存的本地草稿（${countChapterWords(stashed.blocks)} 字，${new Date(stashed.savedAt).toLocaleString('zh-CN')}）`}
          action={
            <span className="mjp-row" style={{ gap: 8 }}>
              <Btn size="sm" variant="primary" onClick={restoreStash}>恢复草稿</Btn>
              <Btn size="sm" onClick={() => setShowDiff((value) => !value)}>{showDiff ? '收起差异' : '对比差异'}</Btn>
              <Btn size="sm" variant="ghost" onClick={discardStash}>放弃草稿</Btn>
            </span>
          }
        >
          这份草稿来自最后一次未确认保存的输入，对应的已保存版本是 v{stashed.baseRevision}（当前 v{project.revision}）。
          选择「恢复草稿」会把草稿写回本章并走统一保存通道；「放弃草稿」只删除这条本地缓存，不影响已保存内容。
        </Banner>
      )}

      {stashed && showDiff && (
        <div className="mjp-card">
          <div className="mjp-card-hd"><div className="ti">与已保存内容的差异<span className="desc">共 {diffRows.length} 段不一致</span></div></div>
          <div className="mjp-card-bd">
            {diffRows.length === 0 ? (
              <p className="mjp-muted">没有差异。</p>
            ) : (
              diffRows.map((row) => (
                <div key={row.index} className="mjp-oi-term">
                  <div className="mjp-oi-term-h"><b>第 {row.index + 1} 段</b></div>
                  <p className="mjp-oi-term-b">已保存内容：{row.server || '（空）'}</p>
                  <p className="mjp-oi-term-b">本地草稿：{row.draft || '（空）'}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div
        className="mjp-editor-scroll"
        onClick={(event) => {
          if (event.target !== event.currentTarget && event.target !== event.currentTarget.querySelector('.mjp-prose')) return
          event.currentTarget.querySelector<HTMLElement>('.mjp-prose .para:last-child')?.focus()
        }}
      >
        <ProseEditor blocks={chapter.blocks} onCommit={commitBlocks} />
      </div>
    </div>
  )
}
