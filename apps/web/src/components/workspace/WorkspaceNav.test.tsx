import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readWritingDirectoryOpen, rememberWritingDirectoryOpen, WorkspaceNav } from './WorkspaceNav'

const writing = { stageId: 'writing', subnavId: 'prose-editor' } as const

function renderDirectory(open: boolean): string {
  return renderToStaticMarkup(
    <WorkspaceNav
      active={writing}
      chapterTree={<div data-testid="chapter-tree">章节列表</div>}
      directoryOpen={open}
      onToggleDirectory={() => undefined}
      onNavigate={() => undefined}
      onOpenTool={() => undefined}
    />
  )
}

describe('正文二级侧栏', () => {
  it('固定显示写作导航，并在下方展开独立的章节目录', () => {
    const html = renderDirectory(true)

    expect(html).toContain('正文编辑')
    expect(html).toContain('写作控制')
    expect(html).toContain('data-testid="chapter-tree"')
    expect(html).toContain('aria-expanded="true"')
    expect(html.indexOf('正文编辑')).toBeLessThan(html.indexOf('data-testid="chapter-tree"'))
    expect(html).toContain('mjp-snav-directory-scroll')
  })

  it('收起时保留写作导航和可再次展开的目录入口', () => {
    const html = renderDirectory(false)

    expect(html).toContain('正文编辑')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('展开正文目录')
    expect(html).not.toContain('data-testid="chapter-tree"')
  })

  it('记住收起状态，重新打开工作区仍保持收起', () => {
    let stored: string | null = null
    const host = globalThis as unknown as { window?: { localStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void } } }
    const previousWindow = host.window
    host.window = {
      localStorage: {
        getItem: () => stored,
        setItem: (_key, value) => { stored = value }
      }
    }

    try {
      expect(readWritingDirectoryOpen()).toBe(true)
      rememberWritingDirectoryOpen(false)
      expect(readWritingDirectoryOpen()).toBe(false)
      rememberWritingDirectoryOpen(true)
      expect(readWritingDirectoryOpen()).toBe(true)
    } finally {
      host.window = previousWindow
    }
  })
})
