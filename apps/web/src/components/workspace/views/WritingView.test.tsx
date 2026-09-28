import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NovelProject } from '../../../../../../packages/contracts/src'

const holder = globalThis as unknown as { window?: { location: { hash: string } } }
holder.window = holder.window ?? { location: { hash: '' } }

const { WritingView } = await import('./WritingView')

const project = {
  id: 'novel-a', revision: 1, title: '潮汐钟',
  chapters: [{ id: 'chapter-a', chapterNumber: 1, volumeNumber: 1, title: '潮声', status: '草稿', blocks: [] }],
  settings: {}, memories: [], plotThreads: [], worldConstraints: [], reviews: []
} as unknown as NovelProject

describe('正文创作视图', () => {
  it('正文编辑和写作子页都只在二级侧栏放章节目录', () => {
    for (const subnavId of ['prose-editor', 'writing-controls', 'writing-handoff', 'rewrite-search']) {
      const html = renderToStaticMarkup(
        <WritingView project={project} chapterId="chapter-a" subnavId={subnavId} onCreateChapter={() => undefined} />
      )
      expect(html, subnavId).not.toContain('class="mjp-chapter-tree"')
      expect(html, subnavId).toContain('mjp-write is-single')
    }
  })
})
