import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NovelProject } from '../../../../../packages/contracts/src'

const holder = globalThis as unknown as { window?: { location: { hash: string } } }
holder.window = holder.window ?? { location: { hash: '' } }

const store = vi.hoisted(() => ({
  state: {
    saveState: '已保存' as '已保存' | '保存失败',
    saveError: undefined as string | undefined,
    busy: false,
    updateProject: () => undefined,
    persistNow: async () => undefined,
    selectChapter: () => undefined
  }
}))

vi.mock('../../novelStore', () => ({
  useNovelStore: (selector: (state: typeof store.state) => unknown) => selector(store.state)
}))

const { WritingPane } = await import('./WritingPane')

function project(): NovelProject {
  return {
    id: 'novel-a', revision: 1, chapters: [{
      id: 'chapter-a', chapterNumber: 1, volumeNumber: 1, title: '潮声', status: '草稿', blocks: []
    }],
    settings: {}, memories: [], plotThreads: [], worldConstraints: [], reviews: []
  } as unknown as NovelProject
}

afterEach(() => {
  store.state.saveState = '已保存'
  store.state.saveError = undefined
})

describe('正文编辑板', () => {
  it('常态只显示章名、正文和简短保存状态', () => {
    store.state.saveState = '已保存'
    store.state.saveError = undefined
    const html = renderToStaticMarkup(<WritingPane project={project()} chapterId="chapter-a" />)

    expect(html).toContain('value="潮声"')
    expect(html).toContain('contentEditable="true"')
    expect(html).toContain('data-testid="writing-save-state"')
    expect(html).not.toContain('data-testid="writing-style-summary"')
    expect(html).not.toContain('写作依据')
    expect(html).not.toContain('这一章还没有正文')
    expect(html).not.toContain('900ms')
    expect(html).not.toContain('与助手讨论续写')
    expect(html).not.toContain('进入专注模式')
  })

  it('保存失败仍在编辑处显示重试入口', () => {
    store.state.saveState = '保存失败'
    store.state.saveError = '连接中断'
    const html = renderToStaticMarkup(<WritingPane project={project()} chapterId="chapter-a" />)

    expect(html).toContain('保存失败')
    expect(html).toContain('重试保存')
    expect(html).toContain('连接中断')
  })
})
