import { ArrowRight, BookOpen, FileText, ListTree, PenLine, Waypoints } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'
import { buildProjectWorkbenchModel, workbenchCoverKind } from './projectWorkbenchModel'
import './project-workbench.css'

type ProjectWorkbenchPageProps = {
  project: NovelProject
  selectedChapterId?: string
  onNavigate: (target: WorkspaceNavigationTarget) => void
  onOpenChapter: (chapterId: string) => void
}

function formatWords(value: number): string {
  return value.toLocaleString('zh-CN')
}

function ProgressBar({ value, label }: { value?: number; label: string }): React.JSX.Element {
  if (value === undefined) {
    return <div className="mjp-project-workbench-progress-empty" aria-label={`${label}暂无目标`}>尚未设置目标</div>
  }
  return <div className="mjp-project-workbench-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${value}%` }} /></div>
}

export function ProjectWorkbenchPage({ project, selectedChapterId, onNavigate, onOpenChapter }: ProjectWorkbenchPageProps): React.JSX.Element {
  const model = buildProjectWorkbenchModel(project, selectedChapterId)
  const cover = workbenchCoverKind(project.settings.genreTemplate)
  const openAction = (action: typeof model.primaryAction): void => {
    if (action.id === 'continue-writing' && model.currentChapter) {
      onOpenChapter(model.currentChapter.id)
      return
    }
    if (action.target) onNavigate(action.target)
  }

  const actionIcon = (actionId: typeof model.primaryAction.id): typeof FileText => {
    if (actionId === 'continue-writing') return FileText
    if (actionId === 'world') return Waypoints
    return ListTree
  }

  return (
    <main className="mjp-project-workbench" data-testid="project-workbench">
      <div className="mjp-project-workbench-landscape" aria-hidden="true" />
      <section className="mjp-project-workbench-intro" aria-labelledby="project-workbench-title">
        <div className={`mjp-project-workbench-cover is-${cover}`} aria-label={`${model.title}书封`} role="img">
          <span>{Array.from(model.title)[0] ?? '书'}</span>
          <b>{model.title}</b>
        </div>
        <div className="mjp-project-workbench-identity">
          <h2 id="project-workbench-title">{model.title}</h2>
          <p className={`mjp-project-workbench-description${model.missing.description ? ' is-empty' : ''}`}>
            {model.description ?? '还没有项目简介。可以从故事种子或小说大纲开始记录。'}
          </p>
          <div className="mjp-project-workbench-meta" aria-label="项目属性">
            <span>{model.genre}</span><i aria-hidden="true">·</i><span>{model.status}</span>
          </div>
        </div>
        <div className="mjp-project-workbench-summary" aria-label="项目摘要">
          <div className="mjp-project-workbench-stat"><span>正文</span><b>{formatWords(model.wordCount)}</b><small>字</small></div>
          <div className="mjp-project-workbench-stat"><span>章节</span><b>{model.chapterCount}</b><small>/ {model.plannedChapters || '未设置'}</small></div>
        </div>
      </section>

      <section className="mjp-project-workbench-desk" aria-label="当前创作状态">
        <div className="mjp-project-workbench-sheet mjp-project-workbench-chapter mjp-project-workbench-primary">
          <div className="mjp-project-workbench-sheet-heading">
            <div><span className="mjp-project-workbench-label">当前章节</span><h3>{model.currentChapter ? `第${model.currentChapter.number}章  ${model.currentChapter.title}` : '还没有正文章节'}</h3></div>
            {model.currentChapter ? <span className="mjp-project-workbench-status">{model.currentChapter.status}</span> : null}
          </div>
          {model.currentChapter ? (
            <>
              <p className="mjp-project-workbench-preview">{model.currentChapter.preview || '这一章还没有正文。进入编辑器后，可以从第一段开始。'}</p>
              <div className="mjp-project-workbench-sheet-footer">
                <span>{model.currentChapterSource} · {formatWords(model.currentChapter.wordCount)} 字</span>
                <button type="button" className="mjp-project-workbench-primary-button" onClick={() => openAction(model.primaryAction)}><FileText size={16} aria-hidden="true" />继续写作 <ArrowRight size={16} aria-hidden="true" /></button>
              </div>
            </>
          ) : (
            <div className="mjp-project-workbench-empty-copy">
              <PenLine size={20} aria-hidden="true" />
              <div><p>项目里还没有可预览的章节，先从大纲建立一章。</p><button type="button" className="mjp-project-workbench-primary-button" onClick={() => openAction(model.primaryAction)}><ListTree size={16} aria-hidden="true" />{model.primaryAction.label}<ArrowRight size={16} aria-hidden="true" /></button></div>
            </div>
          )}
        </div>

        <aside className="mjp-project-workbench-progress" aria-label="项目进度">
          <div className="mjp-project-workbench-sheet-heading"><div><span className="mjp-project-workbench-label">项目进度</span><h3>{model.chapterProgress === undefined ? '章节目标未设置' : `${model.chapterProgress}%`}</h3></div><BookOpen size={21} aria-hidden="true" /></div>
          <ProgressBar value={model.chapterProgress} label="章节进度" />
          <dl className="mjp-project-workbench-progress-list">
            <div><dt>当前章节</dt><dd>{model.chapterCount || '—'}</dd></div>
            <div><dt>计划章节</dt><dd>{model.plannedChapters || '未设置'}</dd></div>
            <div><dt>目标字数</dt><dd>{model.targetWords > 0 ? `${formatWords(model.targetWords)} 字` : '未设置'}</dd></div>
          </dl>
          {model.missing.outline || model.missing.world ? <p className="mjp-project-workbench-note">项目资料还不完整，进度只按已经保存的内容计算。</p> : null}
        </aside>
      </section>

      <section className="mjp-project-workbench-index" aria-labelledby="project-workbench-index-title">
        <div className="mjp-project-workbench-index-heading"><div><span className="mjp-project-workbench-label">创作索引</span><h3 id="project-workbench-index-title">需要查看哪一处</h3></div><span className="mjp-project-workbench-index-rule" aria-hidden="true" /></div>
        <nav className="mjp-project-workbench-index-list" aria-label="项目创作索引">
          {model.indexActions.map((action) => {
            const Icon = actionIcon(action.id)
            return <button key={`${action.id}-${action.label}`} type="button" className="mjp-project-workbench-index-link" onClick={() => openAction(action)}><span className="mjp-project-workbench-index-icon"><Icon size={16} aria-hidden="true" /></span><span><b>{action.label}</b><small>{action.detail}</small></span><ArrowRight size={15} aria-hidden="true" /></button>
          })}
        </nav>
      </section>

      <footer className="mjp-project-workbench-quote"><span aria-hidden="true" />写下的，就是生活的另一种可能。</footer>
    </main>
  )
}
