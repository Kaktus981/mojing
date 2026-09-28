import {
  getWorkspaceDisplaySectionForStage,
  WORKSPACE_PROJECT_TOOLS,
  type WorkspaceDisplaySubnavItem,
  type WorkspaceDisplaySectionDefinition,
  type WorkspaceNavigationTarget,
  type WorkspaceProjectToolId
} from './workspaceNavigation'

export type WorkspaceSecondaryNav =
  | { kind: 'none' }
  | {
      kind: 'section'
      id: string
      label: string
      description: string
      icon: WorkspaceDisplaySectionDefinition['icon']
      items: readonly WorkspaceDisplaySubnavItem[]
    }
  | {
      kind: 'tools'
      label: '项目工具'
      items: typeof WORKSPACE_PROJECT_TOOLS
    }

/**
 * 右侧项目导航只承载当前一级栏目的下属入口。
 * 项目概览虽然只有一个同名目标，也要保持常驻，确保打开项目后层级不跳变。
 */
export function resolveWorkspaceSecondaryNav(
  active?: WorkspaceNavigationTarget,
  activeTool?: WorkspaceProjectToolId
): WorkspaceSecondaryNav {
  if (activeTool) {
    return { kind: 'tools', label: '项目工具', items: WORKSPACE_PROJECT_TOOLS }
  }
  if (!active) return { kind: 'none' }

  const section = getWorkspaceDisplaySectionForStage(active.stageId)
  if (section.subnav.length === 0 || (active.stageId !== 'overview' && section.subnav.every((item) => item.label === section.label))) {
    return { kind: 'none' }
  }
  return {
    kind: 'section',
    id: section.id,
    label: section.label,
    description: section.description,
    icon: section.icon,
    items: section.subnav
  }
}
