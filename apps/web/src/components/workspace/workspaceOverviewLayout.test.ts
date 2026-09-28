import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspacePage = readFileSync(resolve(__dirname, 'WorkspacePage.tsx'), 'utf8')
const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
const settingsPage = readFileSync(resolve(__dirname, '../settings/SettingsPage.tsx'), 'utf8')
const workspaceRail = readFileSync(resolve(__dirname, 'WorkspaceRail.tsx'), 'utf8')
const workspaceShell = readFileSync(resolve(__dirname, '../../styles/97-workspace-views.css'), 'utf8')
const paperShell = readFileSync(resolve(__dirname, '../../styles/96-paper-shell.css'), 'utf8')
const projectWorkbench = readFileSync(resolve(__dirname, 'views/project-workbench/project-workbench.css'), 'utf8')

describe('项目概览首屏布局', () => {
  it('项目概览常驻展开墨境现有一级工作区侧边栏', () => {
    expect(appSource).toContain("expandedLocked={railVariant === 'project' && workspaceTarget.stageId === 'overview' && !workspaceTool}")
    expect(workspacePage).not.toContain("import { WorkspaceRail }")
  })

  it('大厅、项目工作区和设置共用同一个一级侧栏实例', () => {
    expect(appSource.match(/<WorkspaceRail\b/g)?.length).toBe(1)
    expect(appSource).toContain("const railVariant = project ? 'project' : 'hall'")
    expect(appSource).toContain('settingsActive={settingsOpen}')
    expect(workspaceRail).toContain("if (settingsActive && context !== 'settings') return false")
    expect(appSource).toContain('embedded')
  })

  it('项目工作区承载层会填满主区域，避免三栏按内容高度缩小', () => {
    expect(appSource).toContain('<div className="mjp-page-layer" hidden={settingsOpen} inert={settingsOpen}>')
    expect(paperShell).toMatch(/\.mjp-app\s*>\s*\.mjp-page-layer\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*0;/s)
    expect(paperShell).toMatch(/\.mjp-app\s*>\s*\.mjp-page-layer\s*>\s*\.mjp-main\s*\{[^}]*flex:\s*1\s+1\s+auto;/s)
  })

  it('打开设置后保留工作区状态，但不把隐藏的工作区显示成页面底部第二行', () => {
    expect(appSource).toContain('hidden={settingsOpen} inert={settingsOpen}')
    expect(paperShell).toMatch(/\.mjp-app\s*>\s*\.mjp-page-layer\[hidden\]\s*\{[^}]*display:\s*none;/s)
  })

  it('一级侧栏入口切换使用横向面板过渡并让入口竖向进入', () => {
    expect(workspaceRail).toContain('mjp-rail-panels')
    expect(workspaceRail).toContain('workspaceRailTransitionMode')
    expect(paperShell).toMatch(/\.mjp-rail-panel\.is-current\[data-direction='horizontal-forward'\][\s\S]*?animation:\s*mjp-rail-panel-in-horizontal-forward\s+480ms/s)
    expect(paperShell).toMatch(/\.mjp-rail-panel\.is-current\[data-direction='vertical-forward'\][\s\S]*?animation:\s*mjp-rail-panel-in-vertical-forward\s+480ms/s)
    expect(paperShell).toMatch(/\.mjp-rail-panel\.is-current\s+\.mjp-rail-entry[\s\S]*?animation:\s*mjp-rail-entry-rise\s+360ms/s)
    expect(paperShell).toMatch(/\.mjp-rail-item\.is-settings-active\s*\{[^}]*animation:\s*mjp-rail-settings-toggle\s+360ms/s)
  })

  it('项目概览隐藏项目内二级侧栏，并使用无侧栏栅格', () => {
    expect(workspacePage).toMatch(/secondaryNav\.kind\s*!==\s*'none'\s*&&\s*!projectOverview/)
    expect(workspacePage).toMatch(/secondaryNav\.kind\s*===\s*'none'\s*\|\|\s*projectOverview/)
    expect(workspaceShell).toMatch(/\.mjp-body\.is-docked\.is-no-snav\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--w-dock\);/s)
  })

  it('设置页不重复提供返回项目大厅按钮，一级侧栏负责大厅跳转', () => {
    expect(settingsPage).not.toContain('mjp-snav-foot')
    expect(settingsPage).not.toContain('返回项目大厅')
    expect(settingsPage).toContain('railItems={[]}')
  })

  it('项目概览主内容使用唯一的纵向滚动容器', () => {
    expect(workspaceShell).toMatch(/\.mjp-canvas-scroll\.is-workbench\s*\{[^}]*overflow:\s*auto;/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench\s*\{[^}]*min-height:\s*100%;[^}]*overflow:\s*visible;/s)
  })

  it('项目概览不显示创作助手，并让中央画布使用单列', () => {
    expect(workspacePage).toMatch(/!activeTool\s*&&\s*!projectOverview\s*&&\s*\(/)
    expect(workspacePage).toMatch(/projectOverview\s*\?\s*' is-no-dock'/)
    expect(workspaceShell).toMatch(/\.mjp-body\.is-docked\.is-no-dock\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s)
  })

  it('窄桌面首屏收紧项目概览的三段内容，避免索引被裁切', () => {
    expect(projectWorkbench).toMatch(/@media\s*\(max-width:\s*1400px\)[\s\S]*?\.mjp-project-workbench-intro\s*\{[^}]*grid-template-columns:\s*84px\s+minmax\(0,\s*1fr\)/s)
    expect(projectWorkbench).toMatch(/@media\s*\(max-width:\s*1400px\)[\s\S]*?\.mjp-project-workbench-desk\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(150px,\s*\.8fr\)/s)
  })

  it('项目概况卡片区域使用更宽的内容轨道', () => {
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-intro\s*\{[^}]*max-width:\s*1320px;/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-desk\s*\{[^}]*max-width:\s*1320px;/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-index\s*\{[^}]*max-width:\s*1320px;/s)
  })

  it('项目概况按气泡状卡片划分主要信息区域', () => {
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-intro\s*\{[^}]*border-radius:\s*24px;[^}]*box-shadow:/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-desk\s*\{[^}]*border-radius:\s*24px;[^}]*box-shadow:/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-index\s*\{[^}]*border-radius:\s*24px;[^}]*box-shadow:/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-index-list\s*\{[^}]*gap:\s*12px;/s)
    expect(projectWorkbench).toMatch(/\.mjp-project-workbench-index-link\s*\{[^}]*border-radius:\s*16px;/s)
  })
})
