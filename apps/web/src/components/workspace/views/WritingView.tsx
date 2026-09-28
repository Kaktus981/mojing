import { FileText, Plus } from 'lucide-react'
import { useEffect } from 'react'
import type { NovelProject } from '../../../../../../packages/contracts/src'
import { Btn, EmptyState } from '../../ui/Primitives'
import { WritingPane } from '../WritingPane'
import { ChapterHandoffPage, RewriteSearchPage, WritingControlsPage } from './writing/WritingSubPages'
import { resolveWritingWorkbenchVisual } from './writing/writingWorkbenchModel'
import './writing/writing-workbench.css'

/**
 * 视图 3/5 · 正文创作（对应原型 `data-pane="write"`）。
 * 原型的章节树在左侧导航、编辑区在中间；P2-C 之前这里把章节树做进视图内，
 * 因为左侧导航已被五个一级栏目占用。
 *
 * 四个写作子页都共用 232px 二级侧栏下方的正文目录；本视图不再重复占列。
 * 编辑能力沿用 WritingPane（走 updateProject 的防抖自动保存 + baseRevision 乐观并发）。
 */
export function WritingView({
  project,
  chapterId,
  subnavId,
  onCreateChapter,
  focus = false,
  onToggleFocus
}: {
  project: NovelProject
  chapterId?: string
  /** 当前二级页面 id：正文编辑 / 写作控制 / 章后交接 / 改写与查找。 */
  subnavId: string
  onCreateChapter: () => void
  /** 专注模式状态由外壳持有：它需要同时决定 232px 目录列的收起。 */
  focus?: boolean
  onToggleFocus?: () => void
}): React.JSX.Element {
  const current = project.chapters.find((chapter) => chapter.id === chapterId) ?? project.chapters[0]

  /**
   * 专注模式快捷键：正文编辑页「68 + 232 目录 + 稿纸 + 360 助手」→「68 + 稿纸 + 360 助手」。
   * 状态不在这里（外壳要据此收起 232px 那一列），这里只负责把按键转成回调。
   * 中文输入法组合期间不触发（与正文编辑的既有约定一致）。
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (subnavId !== 'prose-editor') return
      if (event.isComposing) return
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        onToggleFocus?.()
        return
      }
      if (event.key === 'Escape' && focus) onToggleFocus?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focus, onToggleFocus, subnavId])

  if (project.chapters.length === 0) {
    return (
      <div className="mjp-writing-workbench" data-testid="writing-workbench" data-state="empty" data-ink-background="paper">
        <EmptyState
          icon={FileText}
          title="还没有章节"
          description="先建立章节，再回到这里写正文。AI 产出只会作为候选出现，不会覆盖你写的内容。"
          action={<Btn variant="primary" icon={Plus} onClick={onCreateChapter}>新建第一章</Btn>}
        />
      </div>
    )
  }

  return (
    <div className="mjp-writing-workbench" data-testid="writing-workbench" data-state="ready" data-ink-background={resolveWritingWorkbenchVisual(subnavId).background}>
      <div className={`mjp-write is-single${focus ? ' is-focus' : ''}`}>
        {/*
          四个二级页面是不同的工作面，不只是换标题：
          正文编辑＝写作；写作控制＝本章写作口径与状态；章后交接＝复盘与交接；
          改写与查找＝查找与批量替换。卷章目录统一由 232px 二级侧栏渲染。
        */}
        {subnavId === 'writing-controls' && <WritingControlsPage project={project} chapterId={current?.id} />}
        {subnavId === 'writing-handoff' && <ChapterHandoffPage project={project} chapterId={current?.id} />}
        {subnavId === 'rewrite-search' && <RewriteSearchPage project={project} chapterId={current?.id} />}
        {subnavId !== 'writing-controls' && subnavId !== 'writing-handoff' && subnavId !== 'rewrite-search' && (
          <WritingPane
            project={project}
            chapterId={current?.id}
            focus={focus}
          />
        )}
      </div>
    </div>
  )
}
