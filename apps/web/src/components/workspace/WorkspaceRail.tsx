import { Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MojingTheme } from '../shell/useTheme'
import { WORKSPACE_DISPLAY_SECTIONS, type WorkspaceNavigationTarget, type WorkspaceProjectToolId } from './workspaceNavigation'
import {
  createWorkspaceRailHoverDisclosure,
  HALL_RAIL_ITEMS,
  SETTINGS_RAIL_ITEMS,
  resolveWorkspaceRailExpanded,
  workspaceRailTransitionMode,
  workspaceRailKeyAction,
  WORKSPACE_RAIL_GROUPS,
  type WorkspaceRailContext,
  type WorkspaceRailItem,
  type WorkspaceRailItemId
} from './workspaceRailModel'

type WorkspaceRailProps = {
  variant?: WorkspaceRailContext
  active?: WorkspaceNavigationTarget
  activeTool?: WorkspaceProjectToolId
  projectTitle: string
  theme: MojingTheme
  settingsActive?: boolean
  expandedLocked?: boolean
  transitioning?: boolean
  onBackToHall: () => void
  onNavigate: (target: WorkspaceNavigationTarget) => void
  onOpenTool: (toolId: WorkspaceProjectToolId) => void
  onOpenSettings: () => void
  onToggleTheme: () => void
}

function HallReturnMark(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9.5 12 4l7 5.5" /><path d="M7 9.5v8.5h10V9.5" /><path d="M3.5 14H9" /><path d="m3.5 14 2.5-2.5M3.5 14 6 16.5" /></svg>
}

function HallBrandMark(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.6c1.8 2.2 3 3.8 3 5.4a3 3 0 0 1-6 0c0-1.6 1.2-3.2 3-5.4Z" /><path d="M4.5 15.5c2-1.4 4.2-1.4 7.5 0 3.3-1.4 5.5-1.4 7.5 0" /><path d="M6 19h12" /></svg>
}

export function WorkspaceRail({ variant = 'project', active, activeTool, projectTitle, theme, settingsActive = false, expandedLocked = false, transitioning = false, onBackToHall, onNavigate, onOpenTool, onOpenSettings, onToggleTheme }: WorkspaceRailProps): React.JSX.Element {
  const isProject = variant === 'project'
  const isHall = variant === 'hall'
  const [expanded, setExpanded] = useState(expandedLocked)
  const panelContext = useRef<WorkspaceRailContext>(variant)
  const [panelTransition, setPanelTransition] = useState<{ from: WorkspaceRailContext; mode: ReturnType<typeof workspaceRailTransitionMode> }>()
  const disclosure = useMemo(() => createWorkspaceRailHoverDisclosure(() => setExpanded(true)), [])

  useEffect(() => () => disclosure.dispose(), [disclosure])
  useEffect(() => {
    const from = panelContext.current
    if (from === variant) return undefined
    panelContext.current = variant
    setPanelTransition({ from, mode: workspaceRailTransitionMode(from, variant) })
    const timer = window.setTimeout(() => setPanelTransition(undefined), 480)
    return () => window.clearTimeout(timer)
  }, [disclosure, variant])
  useEffect(() => {
    setExpanded(expandedLocked)
    if (!expandedLocked) disclosure.dispose()
  }, [disclosure, expandedLocked])
  useEffect(() => {
    if (settingsActive) { setExpanded(false); disclosure.dispose() }
  }, [disclosure, settingsActive])

  function isActive(context: WorkspaceRailContext, itemId: WorkspaceRailItemId): boolean {
    if (settingsActive && context !== 'settings') return false
    if (context === 'hall') return itemId === 'hall'
    if (context === 'settings') return itemId === 'settings'
    if (itemId === 'project-tools') return Boolean(activeTool)
    if (itemId === 'hall') return false
    const section = WORKSPACE_DISPLAY_SECTIONS.find((candidate) => candidate.id === itemId)
    return Boolean(section && active && section.stageIds.includes(active.stageId))
  }

  function activate(context: WorkspaceRailContext, itemId: WorkspaceRailItemId): void {
    if (context === 'hall') { if (settingsActive && itemId === 'hall') onBackToHall(); return }
    if (context === 'settings') { if (itemId === 'hall') onBackToHall(); else if (itemId === 'settings') onOpenSettings(); return }
    if (itemId === 'hall') { onBackToHall(); return }
    if (itemId === 'project-tools') { onOpenTool(activeTool ?? 'ai-workbench'); return }
    const section = WORKSPACE_DISPLAY_SECTIONS.find((candidate) => candidate.id === itemId)
    if (!section) return
    const current = active && section.stageIds.includes(active.stageId) ? active : section.defaultTarget
    onNavigate(current)
  }

  function onRailKeyDown(event: React.KeyboardEvent, itemId: WorkspaceRailItemId): void {
    const action = workspaceRailKeyAction(event.key)
    if (!action) return
    event.preventDefault()
    if (action === 'close') { if (isProject && !expandedLocked) setExpanded(false); disclosure.leave('overview'); return }
    if (!isProject || settingsActive || itemId === 'hall' || itemId === 'settings') { activate(variant, itemId); return }
    setExpanded(true)
  }

  function handleMouseLeave(): void { disclosure.dispose(); if (isProject && !expandedLocked) setExpanded(false) }

  function renderItem(item: WorkspaceRailItem, context: WorkspaceRailContext, exiting = false): React.JSX.Element {
    const Icon = item.icon
    const activeItem = isActive(context, item.id)
    return <div key={item.id} className="mjp-rail-entry"><button type="button" className={`mjp-rail-item${activeItem ? ' is-active' : ''}`} title={item.label} aria-label={item.label} aria-current={activeItem ? 'page' : undefined} tabIndex={exiting ? -1 : undefined} onMouseEnter={() => { if (!exiting && !settingsActive && context === 'project') disclosure.enter(item.id) }} onFocus={() => { if (!exiting && !settingsActive && context === 'project' && !expanded) disclosure.enter(item.id) }} onKeyDown={(event) => onRailKeyDown(event, item.id)} onClick={() => { if (!exiting) activate(context, item.id) }}><Icon size={20} strokeWidth={1.7} /><span className="mjp-rail-label">{item.label}</span></button></div>
  }

  function renderPanel(context: WorkspaceRailContext, exiting = false): React.JSX.Element {
    const items = context === 'hall' ? HALL_RAIL_ITEMS : context === 'settings' ? SETTINGS_RAIL_ITEMS : undefined
    return <div className={`mjp-rail-panel${exiting ? ' is-exiting' : ' is-current'}`} data-context={context} data-direction={panelTransition?.mode} aria-hidden={exiting || undefined}><div className="mjp-rail-divider" />{items ? <div className={`mjp-rail-group is-${context}`}>{items.map((item) => renderItem(item, context, exiting))}</div> : WORKSPACE_RAIL_GROUPS.map((group, groupIndex) => <div key={group.id} className={`mjp-rail-group is-${group.id}`}><div className="mjp-rail-group-label">{group.label}</div>{group.items.map((item) => renderItem(item, context, exiting))}{groupIndex === 0 && <div className="mjp-rail-divider is-group-divider" />}</div>)}</div>
  }

  const isExpanded = isProject && !settingsActive && resolveWorkspaceRailExpanded(expandedLocked, expanded)
  const isTransitioning = transitioning || Boolean(panelTransition)
  return <aside className={`mjp-rail mjp-workspace-rail${isExpanded ? ' is-expanded' : ''}${isTransitioning ? ' is-enter-transition' : ''}${panelTransition ? ` is-panel-transition is-${panelTransition.mode}` : ''}`} aria-label={isHall ? '项目大厅导航' : variant === 'settings' ? '设置导航' : `${projectTitle}项目一级导航`} onMouseLeave={handleMouseLeave} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) handleMouseLeave() }}>
    {isProject ? <button type="button" className="mjp-rail-brand mjp-rail-brand-button" title="返回大厅" aria-label="返回项目大厅" onMouseEnter={() => { if (!settingsActive) disclosure.enter('hall') }} onFocus={() => { if (!settingsActive && !expanded) disclosure.enter('hall') }} onKeyDown={(event) => onRailKeyDown(event, 'hall')} onClick={onBackToHall}><span className="mjp-rail-brand-icon is-return"><HallReturnMark /></span><span className="mjp-rail-brand-icon is-brand"><HallBrandMark /></span><span className="mjp-rail-label">返回大厅</span></button> : <div className="mjp-rail-brand" aria-hidden="true"><span className="mjp-rail-brand-icon is-brand"><HallBrandMark /></span><span className="mjp-rail-label">{isHall ? '项目大厅' : '设置'}</span></div>}
    <nav className="mjp-rail-nav mjp-rail-panels" aria-label="项目入口">{panelTransition && renderPanel(panelTransition.from, true)}{renderPanel(variant)}</nav>
    <div className="mjp-rail-foot"><button type="button" className="mjp-rail-item" title={theme === 'paper' ? '切换到夜墨' : '切换到暖纸'} aria-label={theme === 'paper' ? '切换到夜墨' : '切换到暖纸'} onClick={onToggleTheme}>{theme === 'paper' ? <Moon size={20} strokeWidth={1.7} /> : <Sun size={20} strokeWidth={1.7} />}<span className="mjp-rail-label">{theme === 'paper' ? '夜墨' : '暖纸'}</span></button><button type="button" className={`mjp-rail-item${settingsActive ? ' is-active is-settings-active' : ''}`} title="设置" aria-label="设置" aria-current={settingsActive ? 'page' : undefined} onClick={onOpenSettings}><Settings size={20} strokeWidth={1.7} /><span className="mjp-rail-label">设置</span></button></div>
  </aside>
}
