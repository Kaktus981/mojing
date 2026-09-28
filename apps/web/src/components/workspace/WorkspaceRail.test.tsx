import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceRail } from './WorkspaceRail'

const baseProps = {
  variant: 'project' as const,
  active: { stageId: 'overview' as const, subnavId: 'project-overview' as const },
  projectTitle: '潮汐钟',
  theme: 'paper' as const,
  expandedLocked: true,
  onBackToHall: () => undefined,
  onNavigate: () => undefined,
  onOpenTool: () => undefined,
  onOpenSettings: () => undefined,
  onToggleTheme: () => undefined
}

describe('项目一级侧栏与设置切换', () => {
  it('项目概况常驻展开，打开设置时收为窄栏并保留设置入口', () => {
    const overview = renderToStaticMarkup(<WorkspaceRail {...baseProps} />)
    const settings = renderToStaticMarkup(<WorkspaceRail {...baseProps} settingsActive />)

    expect(overview).toMatch(/<aside class="mjp-rail mjp-workspace-rail is-expanded"/)
    expect(settings).toMatch(/<aside class="mjp-rail mjp-workspace-rail"/)
    expect(settings).not.toMatch(/<aside class="[^"]*is-expanded/)
    expect(settings).toContain('is-settings-active')
    expect(settings).toContain('aria-label="切换到夜墨"')
  })
})
