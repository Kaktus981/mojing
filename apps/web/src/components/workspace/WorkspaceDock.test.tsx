import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let dock: typeof import('./WorkspaceDock')

beforeAll(async () => {
  vi.stubGlobal('window', { location: { hash: '' } })
  dock = await import('./WorkspaceDock')
})

describe('创作助手默认显示', () => {
  it('没有可用模型时默认收起；本机模型即使无需密钥也可展开', () => {
    expect(dock.hasUsableModel([])).toBe(false)
    expect(dock.hasUsableModel([{ baseUrl: 'https://api.example.com/v1', hasApiKey: false }])).toBe(false)
    expect(dock.hasUsableModel([{ baseUrl: 'http://localhost:11434/v1', hasApiKey: false }])).toBe(true)
    expect(dock.hasUsableModel([{ baseUrl: 'https://api.example.com/v1', hasApiKey: true }])).toBe(true)
  })

  it('收起时保留可键盘操作的展开入口，不渲染助手内容', () => {
    const html = renderToStaticMarkup(
      <dock.WorkspaceDock stage="outline" projectId="project-1" projectTitle="测试小说" expanded={false} onToggle={() => undefined} />
    )

    expect(html).toContain('aria-label="展开创作助手"')
    expect(html).not.toContain('mjp-dock-hd')
  })
})
