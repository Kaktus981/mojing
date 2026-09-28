import { AlertCircle, Archive, ArrowRight, BookOpen, CheckCircle2, ChevronDown, Ellipsis, FileDown, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NovelProjectSummary } from '../../../../../packages/contracts/src'
import { useNovelStore } from '../../novelStore'
import { AppShell } from '../shell/AppShell'
import type { MojingTheme } from '../shell/useTheme'
import { Btn } from '../ui/Primitives'
import { useDelayedFlag } from '../ui/asyncState'
import { NOVEL_BACKUP_ACCEPT, NOVEL_MANUSCRIPT_ACCEPT, validateNovelImportFile } from './importValidation'
import { NewProjectDialog } from './NewProjectDialog'

const defaultSettings = {
  genreTemplate: '通用' as const, targetWords: 300000, plannedVolumes: 3, plannedChapters: 60,
  pointOfView: '第三人称限知' as const, tense: '过去时' as const, audience: '成年读者',
  style: '克制、具体，以动作和对白推进', contentLimits: '不涉及政治与真实人物',
  rhetoricIntensity: 1, writingGenerationMode: '协作生成' as const
}
const RAIL_ITEMS = [{ id: 'hall', label: '项目大厅', icon: BookOpen }]
type HallPageProps = { theme: MojingTheme; onToggleTheme: () => void; onOpenProject: (id: string) => Promise<void> }

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`
}

/** 卡片只展示一段完整的短简介；原始简介仍保留在项目数据中。 */
function conciseDescription(value?: string): string | undefined {
  const text = value?.trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  const firstSentence = text.match(/^.*?[。！？]/)?.[0]
  if (firstSentence && Array.from(firstSentence).length <= 54) return firstSentence
  return Array.from(text).slice(0, 48).join('').replace(/[，、；：]$/, '')
}

function BookCover({ summary }: { summary: NovelProjectSummary }): React.JSX.Element {
  const kind = ['悬疑', '历史架空'].includes(summary.genreTemplate) ? 'harbor' : ['都市', '科幻'].includes(summary.genreTemplate) ? 'city' : 'mountain'
  return <div className={`mjp-book-cover is-${kind}`} aria-hidden="true"><b>{Array.from(summary.title)[0]}</b><span>{summary.title}</span></div>
}

function Progress({ value }: { value: number }): React.JSX.Element {
  return <div className="mjp-hall-progress" role="progressbar" aria-label="正文进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${value}%` }} /></div>
}

function HallStateArt({ variant }: { variant: 'loading' | 'search' | 'active' | 'archived' }): React.JSX.Element {
  return <div className={`mjp-hall-state-art is-${variant}`} aria-hidden="true" />
}

/** 下拉操作用原生按钮保留 Tab 顺序；关闭时将焦点交回触发按钮。 */
function useDisclosure() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return { open, setOpen, root, trigger }
}

export function HallPage({ theme, onToggleTheme, onOpenProject }: HallPageProps): React.JSX.Element {
  const summaries = useNovelStore((state) => state.summaries)
  const summariesState = useNovelStore((state) => state.summariesState)
  const summariesErrorKind = useNovelStore((state) => state.summariesErrorKind)
  const hallFeedback = useNovelStore((state) => state.hallFeedback)
  const hallImportError = useNovelStore((state) => state.hallImportError)
  const hallCreateError = useNovelStore((state) => state.hallCreateError)
  const hallDeleteError = useNovelStore((state) => state.hallDeleteError)
  const hallActionError = useNovelStore((state) => state.hallActionError)
  const initialize = useNovelStore((state) => state.initialize)
  const dismiss = useNovelStore((state) => state.dismiss)
  const createProject = useNovelStore((state) => state.createProject)
  const importProject = useNovelStore((state) => state.importProject)
  const removeProject = useNovelStore((state) => state.removeProject)
  const archiveProject = useNovelStore((state) => state.archiveProject)
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('全部')
  const [sort, setSort] = useState<'recent' | 'title'>('recent')
  const [showArchived, setShowArchived] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string }>()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [localImportError, setLocalImportError] = useState<string>()
  const [pending, setPending] = useState<string>()
  const pendingRef = useRef(false)
  const deleteRestoreRef = useRef<HTMLButtonElement | null>(null)
  const showWait = useDelayedFlag(!!pending)
  const createMenu = useDisclosure()
  const createTrigger = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const manuscriptInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const [importKind, setImportKind] = useState<'manuscript' | 'backup'>('manuscript')
  const archiveViewTrigger = useRef<HTMLButtonElement>(null)
  const active = summaries.filter((item) => !item.archived)
  const lastEdited = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const genres = Array.from(new Set(summaries.map((item) => item.genreTemplate)))
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return summaries.filter((item) => !!item.archived === showArchived)
      .filter((item) => genre === '全部' || item.genreTemplate === genre)
      .filter((item) => !needle || `${item.title} ${item.genreTemplate} ${item.status}`.toLocaleLowerCase('zh-CN').includes(needle))
      .sort((a, b) => sort === 'recent' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title, 'zh-CN'))
  }, [summaries, showArchived, genre, query, sort])

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(label)
    try { await action() } finally { pendingRef.current = false; setPending(undefined) }
  }
  const openProject = (id: string): void => { void runAction('正在打开项目…', () => onOpenProject(id)) }
  const startCreate = (): void => { createMenu.setOpen(false); createTrigger.current?.focus(); dismiss('hallCreateError'); setDialogOpen(true) }
  const closeCreate = (): void => { setDialogOpen(false); dismiss('hallCreateError') }
  const clearFilters = (): void => { setQuery(''); setGenre('全部'); searchInput.current?.focus() }
  const startImport = (kind: 'manuscript' | 'backup'): void => {
    if (pendingRef.current) return
    createMenu.setOpen(false)
    setImportKind(kind)
    ;(kind === 'backup' ? backupInput : manuscriptInput).current?.click()
  }
  const selectImportFile = (file: File | undefined, kind: 'manuscript' | 'backup'): void => {
    if (!file || pendingRef.current) return
    dismiss('hallImportError')
    const validationError = validateNovelImportFile(file, kind)
    if (validationError) { setLocalImportError(validationError); return }
    setLocalImportError(undefined)
    void runAction(kind === 'backup' ? '正在恢复备份…' : '正在导入文稿…', () => importProject(file))
  }
  async function submitCreate(input: { title: string; seed: string }): Promise<void> {
    setDialogBusy(true)
    try { await createProject({ ...input, settings: defaultSettings }) } finally { setDialogBusy(false) }
  }
  const requestRemove = (id: string, title: string): void => {
    dismiss('hallDeleteError')
    deleteRestoreRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setDeleteTarget({ id, title })
  }
  const closeDelete = (restoreFocus = true): void => {
    dismiss('hallDeleteError')
    setDeleteTarget(undefined)
    const trigger = deleteRestoreRef.current
    deleteRestoreRef.current = null
    if (restoreFocus) queueMicrotask(() => trigger?.focus())
  }
  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleteBusy) return
    const target = deleteTarget
    setDeleteBusy(true)
    try {
      let succeeded = false
      await runAction('正在删除…', async () => { succeeded = await removeProject(target.id, target.title, true) })
      if (succeeded) closeDelete(false)
    } finally {
      setDeleteBusy(false)
    }
  }
  async function changeArchive(id: string, archived: boolean): Promise<boolean> {
    let succeeded = false
    await runAction(archived ? '正在归档…' : '正在恢复…', async () => { succeeded = await archiveProject(id, archived) })
    if (succeeded) queueMicrotask(() => archiveViewTrigger.current?.focus())
    return succeeded
  }
  const ready = summariesState === 'ready'
  const hasProjects = summaries.length > 0
  const hasList = ready || hasProjects

  return <AppShell railItems={RAIL_ITEMS} activeRailId="hall" onSelectRail={() => {}} brand={<span className="mjp-hall-mark" aria-hidden="true">墨</span>}
    theme={theme} onToggleTheme={onToggleTheme} showTopBar={false} embedded>
    <main className="mjp-hall">
      <header className="mjp-page-head">
        <div><h1>项目大厅</h1><p>在文字里，构建属于你的世界。</p></div>
        <div className="actions">
          {hasProjects ? <label className="mjp-hall-search"><Search size={19} aria-hidden="true" /><span className="mjp-sr-only">搜索项目</span><input ref={searchInput} type="search" aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }} />{query ? <button type="button" aria-label="清空搜索" onClick={() => { setQuery(''); searchInput.current?.focus() }}><X size={15} /></button> : null}</label> : null}
          <div className="mjp-hall-create" ref={createMenu.root}>
            <div className="mjp-hall-create-group"><button ref={createTrigger} type="button" disabled={!!pending} onClick={startCreate}>新建项目</button><button ref={createMenu.trigger} type="button" aria-label="新建项目选项" aria-expanded={createMenu.open} disabled={!!pending} onClick={() => createMenu.setOpen(!createMenu.open)}><ChevronDown size={18} /></button></div>
            {createMenu.open ? <div className="mjp-hall-menu"><button type="button" onClick={startCreate}><Plus size={16} />新建小说</button><button type="button" onClick={() => startImport('manuscript')}><FileDown size={16} />导入文稿</button><button type="button" onClick={() => startImport('backup')}><RotateCcw size={16} />恢复墨境备份</button><p className="mjp-hall-import-hint">文稿支持 TXT、Markdown、DOCX；备份使用墨境 JSON。<span>最大 20 MB</span></p></div> : null}
          </div>
          <input ref={manuscriptInput} type="file" accept={NOVEL_MANUSCRIPT_ACCEPT} aria-label="选择导入文稿" style={{ display: 'none' }} onChange={(event) => { selectImportFile(event.target.files?.[0], 'manuscript'); event.target.value = '' }} />
          <input ref={backupInput} type="file" accept={NOVEL_BACKUP_ACCEPT} aria-label="选择墨境备份" style={{ display: 'none' }} onChange={(event) => { selectImportFile(event.target.files?.[0], 'backup'); event.target.value = '' }} />
        </div>
      </header>
      {showWait ? <p className="mjp-hall-feedback" role="status">{pending}</p> : null}
      {hallFeedback && summariesErrorKind !== 'refresh' ? <section className="mjp-hall-result" role="status" aria-label="大厅操作结果"><CheckCircle2 size={20} aria-hidden="true" /><p>{hallFeedback}</p><button type="button" aria-label="关闭操作结果" onClick={() => dismiss('hallFeedback')}><X size={16} /></button></section> : null}
      {localImportError || hallImportError ? <section className="mjp-hall-import-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>{importKind === 'backup' ? '无法恢复这份备份' : '无法导入这个文件'}</strong><p>{localImportError ?? hallImportError}</p></div><Btn onClick={() => startImport(importKind)}>重新选择</Btn><button type="button" aria-label="关闭导入错误" onClick={() => { setLocalImportError(undefined); dismiss('hallImportError') }}><X size={16} /></button></section> : null}
      {hallActionError ? <section className="mjp-hall-action-error" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>{hallActionError.action === 'archive' ? '无法归档项目' : '无法恢复项目'}</strong><p>{hallActionError.message}</p></div><button type="button" aria-label="关闭项目操作错误" onClick={() => dismiss('hallActionError')}><X size={16} /></button></section> : null}
      {summariesState === 'idle' || summariesState === 'loading' ? <div className={`mjp-hall-loading${hasProjects ? ' is-inline' : ' is-illustrated'}`} role="status">{hasProjects ? <span>正在读取项目…</span> : <><HallStateArt variant="loading" /><div><strong>正在读取项目…</strong><span>让墨色先把故事铺开。</span></div></>}</div> : null}
      {summariesState === 'error' ? <section className={`mjp-hall-load-error${hasProjects ? ' is-inline' : ''}${summariesErrorKind === 'refresh' ? ' is-refresh' : ''}`} role="alert"><h2>{summariesErrorKind === 'refresh' ? '操作已完成，列表尚未同步' : '暂时无法读取项目'}</h2><p>{summariesErrorKind === 'refresh' ? <>当前变更已经保存。{hallFeedback ? ` ${hallFeedback}` : ''} 重新同步后可核对完整项目列表。</> : '项目列表未能加载，请重试。'}</p><Btn onClick={() => void initialize()}>{summariesErrorKind === 'refresh' ? '重新同步' : '重新加载'}</Btn></section> : null}
      {hasList ? <>
        {lastEdited ? <section className="mjp-hall-continue" aria-label="继续创作" aria-busy={!!pending}>
          <BookCover summary={lastEdited} />
          <div className="mjp-hall-feature-copy"><h2 title={lastEdited.title}>{lastEdited.title}</h2><span className="mjp-hall-feature-genre">{lastEdited.genreTemplate}</span><div className="mjp-hall-feature-meta"><p>最近编辑 · {relativeTime(lastEdited.updatedAt)}</p><p>{lastEdited.wordCount.toLocaleString()} 字 · {lastEdited.chapterCount} 章</p></div></div>
          <div className="mjp-hall-feature-progress"><span>正文进度 <b>{lastEdited.writingProgress}%</b></span><Progress value={lastEdited.writingProgress} /></div>
          <div className="mjp-hall-continue-actions"><Btn variant="primary" disabled={!!pending} onClick={() => openProject(lastEdited.id)}>继续创作<ArrowRight size={19} aria-hidden="true" /></Btn></div>
        </section> : !hasProjects ? <section className="mjp-hall-welcome"><div><h2>还没有小说项目</h2><p>新建一本小说，或导入已有文稿。</p><div className="mjp-hall-welcome-actions"><Btn variant="primary" disabled={!!pending} onClick={startCreate}>新建小说</Btn><Btn disabled={!!pending} onClick={() => startImport('manuscript')}>导入文稿</Btn></div></div></section> : null}
        {hasProjects ? <>
          <div className="mjp-hall-tools" aria-label="项目工具条">
            <div className="mjp-hall-library-title"><h2>{showArchived ? '已归档' : '我的项目'} <span>{filtered.length}</span></h2><p>执笔三千梦，山河皆可写。</p></div>
            <div className="mjp-hall-filters"><label className="is-active">类型：<select aria-label="类型筛选" value={genre} onChange={(event) => setGenre(event.target.value)}><option value="全部">全部</option>{genres.map((item) => <option key={item}>{item}</option>)}</select></label><label className="is-active"><span className="mjp-sr-only">项目排序</span><select aria-label="项目排序" value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'title')}><option value="recent">最近编辑</option><option value="title">项目名</option></select></label><button ref={archiveViewTrigger} type="button" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}>{showArchived ? '返回在写' : '已归档'}</button></div>
          </div>
          <section className="mjp-hall-grid" aria-label={showArchived ? '已归档项目' : '全部项目'} aria-busy={!!pending}>{filtered.length ? filtered.map((item) => <ProjectCard key={item.id} summary={item} disabled={!!pending} onOpen={openProject} onArchive={changeArchive} onRemove={requestRemove} />) : <div className={`mjp-hall-grid-empty ${query || genre !== '全部' ? 'is-search' : showArchived ? 'is-archived' : 'is-active'}`}><HallStateArt variant={query || genre !== '全部' ? 'search' : showArchived ? 'archived' : 'active'} /><div className="mjp-hall-empty-copy"><h3>{query || genre !== '全部' ? '没有匹配的项目' : showArchived ? '还没有归档项目' : '没有在写的项目'}</h3><p>{query || genre !== '全部' ? '换个词，或者把筛选收回来。' : showArchived ? '归档后的小说会在这里安静保存。' : '下一条故事，可以从一条山径开始。'}</p>{query || genre !== '全部' ? <button type="button" className="mjp-btn" onClick={clearFilters}>清除搜索和筛选</button> : null}</div></div>}</section>
        </> : null}
      </> : null}
      <footer className="mjp-hall-footer"><span aria-hidden="true" />写下的，就是生活的另一种可能。</footer>
    </main>
    <NewProjectDialog open={dialogOpen} busy={dialogBusy} error={hallCreateError} onDismissError={() => dismiss('hallCreateError')} onClose={closeCreate} onSubmit={submitCreate} />
    <DeleteProjectDialog target={deleteTarget} busy={deleteBusy} error={hallDeleteError} onClose={() => { if (!deleteBusy) closeDelete() }} onConfirm={confirmDelete} />
  </AppShell>
}

function DeleteProjectDialog({ target, busy, error, onClose, onConfirm }: { target?: { id: string; title: string }; busy: boolean; error?: string; onClose: () => void; onConfirm: () => Promise<void> }): React.JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (target) cancelRef.current?.focus() }, [target])
  useEffect(() => { if (target && error && !busy) confirmRef.current?.focus() }, [busy, error, target])
  if (!target) return null
  return <div className="mjp-mask mjp-hall-delete-mask" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="mjp-modal mjp-hall-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mjp-delete-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header className="mjp-modal-hd"><div className="ti"><p className="eyebrow">永久操作</p><h3 id="mjp-delete-title">确认永久删除？</h3></div><Btn variant="ghost" aria-label="关闭删除确认" onClick={onClose} disabled={busy}>×</Btn></header>
      <div className="mjp-modal-bd mjp-hall-delete-body"><p>「{target.title}」及其正文、章节和工作记录将被永久删除。</p><p className="mjp-hall-delete-warning">此操作无法撤销。</p>{error ? <div className="mjp-hall-delete-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><div><strong>项目未删除</strong><p>{error}</p></div></div> : null}</div>
      <footer className="mjp-modal-ft"><button ref={cancelRef} type="button" className="mjp-btn" onClick={onClose} disabled={busy}>暂不删除</button><button ref={confirmRef} type="button" className={`mjp-btn danger${busy ? ' is-loading' : ''}`} disabled={busy} onClick={() => void onConfirm()}>{busy ? <span className="mjp-spin" aria-hidden="true">◌</span> : null}永久删除</button></footer>
    </section>
  </div>
}

function ProjectCard({ summary, onOpen, onArchive, onRemove, disabled }: { summary: NovelProjectSummary; onOpen: (id: string) => void; onArchive: (id: string, archived: boolean) => Promise<boolean>; onRemove: (id: string, title: string) => void; disabled: boolean }): React.JSX.Element {
  const menu = useDisclosure()
  const [restoreMenuFocus, setRestoreMenuFocus] = useState(false)
  const description = conciseDescription(summary.description)
  useEffect(() => {
    if (!disabled && restoreMenuFocus) {
      menu.trigger.current?.focus()
      setRestoreMenuFocus(false)
    }
  }, [disabled, menu.trigger, restoreMenuFocus])
  function openFromCard(event: React.MouseEvent<HTMLElement>): void {
    const target = event.target
    if (target instanceof Element && target.closest('button, a, input, textarea, select, [role="menu"]')) return
    if (!disabled) onOpen(summary.id)
  }
  function openFromKeyboard(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.target !== event.currentTarget || disabled) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen(summary.id)
  }
  return <article className="mjp-hall-project" aria-label={summary.title} tabIndex={disabled ? -1 : 0} onClick={openFromCard} onKeyDown={openFromKeyboard}>
    <BookCover summary={summary} />
    <div className="mjp-hall-card-menu" ref={menu.root}>
      <button ref={menu.trigger} type="button" className="more" disabled={disabled} aria-label={`更多操作：${summary.title}`} aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}><Ellipsis size={20} /></button>
      {menu.open ? <div className="mjp-hall-menu"><button type="button" onClick={() => { menu.setOpen(false); void onArchive(summary.id, !summary.archived).then((succeeded) => { if (!succeeded) setRestoreMenuFocus(true) }) }}><Archive size={16} />{summary.archived ? '恢复' : '归档'}</button><button type="button" className="danger" onClick={() => { menu.setOpen(false); menu.trigger.current?.focus(); onRemove(summary.id, summary.title) }}><Trash2 size={16} />删除</button></div> : null}
    </div>
    <div className="mjp-hall-card-copy"><h3><button type="button" className="mjp-hall-project-title" disabled={disabled} title={summary.title} aria-label={`打开：${summary.title}`} onClick={() => onOpen(summary.id)}>{summary.title}</button></h3><p className="mjp-hall-card-genre">{summary.genreTemplate}</p>{description ? <p className="mjp-hall-description" title={description}>{description}</p> : null}<p className="mjp-hall-card-time">最近编辑 · {relativeTime(summary.updatedAt)}</p></div>
    <div className="mjp-hall-card-progress"><div><span>{summary.wordCount.toLocaleString()} 字 · {summary.chapterCount} 章</span><span>正文进度 <b>{summary.writingProgress}%</b></span></div><Progress value={summary.writingProgress} /></div>
  </article>
}
