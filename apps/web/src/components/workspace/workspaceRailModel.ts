import { Library, Settings, Workflow, type LucideIcon } from 'lucide-react'
import {
  WORKSPACE_DISPLAY_SECTIONS,
  type WorkspaceDisplaySectionId
} from './workspaceNavigation'

export const WORKSPACE_RAIL_HOVER_DELAY = 2000

export type WorkspaceRailItemId = 'hall' | 'settings' | WorkspaceDisplaySectionId | 'project-tools'
export type WorkspaceRailItemKind = 'hall' | 'section' | 'tools'

export type WorkspaceRailContext = 'hall' | 'project' | 'settings'

export type WorkspaceRailItem = {
  id: WorkspaceRailItemId
  label: string
  icon: LucideIcon
  kind: WorkspaceRailItemKind
}

export const HALL_RAIL_ITEMS: readonly WorkspaceRailItem[] = [
  { id: 'hall', label: '项目大厅', icon: Library, kind: 'hall' }
]

export const SETTINGS_RAIL_ITEMS: readonly WorkspaceRailItem[] = [
  { id: 'hall', label: '项目大厅', icon: Library, kind: 'hall' },
  { id: 'settings', label: '设置', icon: Settings, kind: 'tools' }
]

const WORKSPACE_RAIL_CONTEXT_ORDER: readonly WorkspaceRailContext[] = ['hall', 'project', 'settings']

export type WorkspaceRailTransitionDirection = 'forward' | 'backward'

export type WorkspaceRailTransitionMode =
  | 'horizontal-forward'
  | 'horizontal-backward'
  | 'vertical-forward'
  | 'vertical-backward'

export function workspaceRailTransitionDirection(from: WorkspaceRailContext, to: WorkspaceRailContext): WorkspaceRailTransitionDirection {
  return WORKSPACE_RAIL_CONTEXT_ORDER.indexOf(to) >= WORKSPACE_RAIL_CONTEXT_ORDER.indexOf(from) ? 'forward' : 'backward'
}

export function workspaceRailTransitionMode(from: WorkspaceRailContext, to: WorkspaceRailContext): WorkspaceRailTransitionMode {
  const direction = workspaceRailTransitionDirection(from, to)
  const axis = from === 'settings' || to === 'settings' ? 'vertical' : 'horizontal'
  return `${axis}-${direction}` as WorkspaceRailTransitionMode
}

export function resolveWorkspaceRailExpanded(expandedLocked: boolean, expanded: boolean): boolean {
  return expandedLocked || expanded
}

export const WORKSPACE_RAIL_ITEMS: readonly WorkspaceRailItem[] = [
  { id: 'hall', label: '项目大厅', icon: Library, kind: 'hall' },
  ...WORKSPACE_DISPLAY_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    icon: section.icon,
    kind: 'section' as const
  })),
  { id: 'project-tools', label: '项目工具', icon: Workflow, kind: 'tools' }
]

/**
 * 悬停两秒后展开的完整项目面板：只列一级入口。
 * 二级页面由常驻的 232px 项目导航承载，避免在浮层里复制一套导航树。
 */
export const WORKSPACE_RAIL_PANEL_ITEMS: readonly WorkspaceRailItem[] = WORKSPACE_RAIL_ITEMS.filter((item) => item.kind !== 'hall')

export type WorkspaceRailGroup = {
  id: 'workspace' | 'tools'
  label: '工作区' | '工具'
  items: readonly WorkspaceRailItem[]
}

/** 展开态只展示一级入口，并保留清楚的阅读分组；品牌区负责返回大厅。 */
export const WORKSPACE_RAIL_GROUPS: readonly WorkspaceRailGroup[] = [
  {
    id: 'workspace',
    label: '工作区',
    items: WORKSPACE_RAIL_PANEL_ITEMS.filter((item) => item.kind === 'section')
  },
  {
    id: 'tools',
    label: '工具',
    items: WORKSPACE_RAIL_PANEL_ITEMS.filter((item) => item.kind === 'tools')
  }
]

export type WorkspaceRailKeyAction = 'open' | 'close'

export function workspaceRailKeyAction(key: string): WorkspaceRailKeyAction | undefined {
  if (key === 'Enter' || key === ' ') return 'open'
  if (key === 'Escape') return 'close'
  return undefined
}

export function createWorkspaceRailHoverDisclosure(
  onOpen: (itemId: WorkspaceRailItemId) => void,
  delay = WORKSPACE_RAIL_HOVER_DELAY
): { enter: (itemId: WorkspaceRailItemId) => void; leave: (itemId: WorkspaceRailItemId) => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let hoveredId: WorkspaceRailItemId | undefined

  function clear(): void {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  return {
    enter(itemId) {
      clear()
      hoveredId = itemId
      timer = setTimeout(() => {
        if (hoveredId === itemId) onOpen(itemId)
      }, delay)
    },
    leave(itemId) {
      if (hoveredId !== itemId) return
      hoveredId = undefined
      clear()
    },
    dispose() {
      hoveredId = undefined
      clear()
    }
  }
}
