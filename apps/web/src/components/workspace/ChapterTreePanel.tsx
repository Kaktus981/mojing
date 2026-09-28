import { FileText, Plus } from 'lucide-react'
import type { NovelProject } from '../../../../../packages/contracts/src'
import { useNovelStore } from '../../novelStore'
import { countChapterWords } from './paragraphModel'

/**
 * 正文卷章目录：卷分组 + 章节列表 + 当前章选中态 + 新建章节入口。
 *
 * P2-C 之前这段 JSX 只存在于 `WritingView` 内部的 `<aside>`；现在提取为可复用子组件，
 * 由「画布内的写作子页」和「232px 导航的正文目录模式」共用同一份实现。
 *
 * 唯一数据源与唯一回调契约（不复制章节数据、不新建第二套选中逻辑）：
 *   - 章节数据：`project.chapters`（store 里的一份，按 `volumeNumber` 现算卷分组）；
 *   - 章节选中：`useNovelStore.selectChapter`，与剧情规划等其他入口完全一致；
 *   - 新建章节：由外壳传入的 `onCreateChapter`（工作区统一入口，正文侧唯一实现）。
 */
export function ChapterTreePanel({
  project,
  currentId,
  onCreateChapter,
  createAriaLabel = '新建章节'
}: {
  project: NovelProject
  /** 当前正在编辑的章节 id；缺省时列表不高亮任何一章。 */
  currentId?: string
  onCreateChapter: () => void
  /**
   * 新建按钮的可访问名。
   * 画布内的用法沿用「新建章节」；232px 目录里改用「新建一章（正文目录）」，
   * 避免与 52px 顶栏的同名按钮在按可访问名定位时产生歧义（两者都是真实按钮）。
   */
  createAriaLabel?: string
}): React.JSX.Element {
  const selectChapter = useNovelStore((state) => state.selectChapter)
  const memoryProposals = useNovelStore((state) => state.memoryProposals)

  const byVolume = new Map<number, NovelProject['chapters']>()
  project.chapters.forEach((chapter) => {
    const list = byVolume.get(chapter.volumeNumber) ?? []
    list.push(chapter)
    byVolume.set(chapter.volumeNumber, list)
  })
  const volumes = [...byVolume.entries()].sort((a, b) => a[0] - b[0])

  return (
    <nav className="mjp-chapter-tree" aria-label="正文目录">
      <div className="hd">
        <FileText size={15} strokeWidth={1.8} />
        <b>正文目录</b>
        <small>{project.chapters.length} 章</small>
        <button type="button" className="mjp-btn ghost sm mjp-right" onClick={onCreateChapter} aria-label={createAriaLabel}>
          <Plus size={15} strokeWidth={1.9} />
        </button>
      </div>
      <div className="tree-scroll mjp-scroll">
        {volumes.map(([volumeNumber, chapters]) => (
          <div key={volumeNumber}>
            <div className="mjp-tree-vol-row">
              第 {volumeNumber} 卷<span className="n">{chapters.length}</span>
            </div>
            {chapters.map((chapter) => {
              const pendingMemory = memoryProposals.some(
                (proposal) => proposal.chapterId === chapter.id && proposal.status === '待确认'
              )
              return (
                <button
                  key={chapter.id}
                  type="button"
                  className={`mjp-tree-ch${chapter.id === currentId ? ' is-active' : ''}`}
                  onClick={() => selectChapter(chapter.id)}
                >
                  <span className="no">{chapter.chapterNumber}</span>
                  <span className="t">
                    <b>{chapter.title}</b>
                    <small>{countChapterWords(chapter.blocks).toLocaleString()} 字 · {chapter.status}</small>
                  </span>
                  {pendingMemory && <span className="flag" title="有未确认的记忆提案" />}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
