import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppTopBar } from './AppTopBar'

describe('应用顶栏', () => {
  it('不再提供重复的模型配置入口，保留主题切换', () => {
    const html = renderToStaticMarkup(<AppTopBar theme="paper" onToggleTheme={() => undefined} />)

    expect(html).not.toContain('aria-label="模型服务"')
    expect(html).toContain('aria-label="切换到夜墨"')
  })
})
