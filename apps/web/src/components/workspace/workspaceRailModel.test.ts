import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_RAIL_HOVER_DELAY,
  createWorkspaceRailHoverDisclosure,
  workspaceRailKeyAction,
  WORKSPACE_RAIL_ITEMS,
  WORKSPACE_RAIL_PANEL_ITEMS,
  WORKSPACE_RAIL_GROUPS,
  HALL_RAIL_ITEMS,
  SETTINGS_RAIL_ITEMS,
  workspaceRailTransitionMode,
  workspaceRailTransitionDirection,
  resolveWorkspaceRailExpanded
} from './workspaceRailModel'

describe('项目一级图标导航模型', () => {
  it('大厅复用同一 rail 结构并以项目大厅作为当前入口', () => {
    expect(HALL_RAIL_ITEMS.map((item) => item.label)).toEqual(['项目大厅'])
    expect(HALL_RAIL_ITEMS[0]?.kind).toBe('hall')
  })

  it('设置入口使用同一 rail 结构，只部署大厅和设置两个入口', () => {
    expect(SETTINGS_RAIL_ITEMS.map((item) => item.label)).toEqual(['项目大厅', '设置'])
  })

  it('栏目集合切换时为新入口选择明确的横向方向', () => {
    expect(workspaceRailTransitionDirection('hall', 'project')).toBe('forward')
    expect(workspaceRailTransitionDirection('project', 'settings')).toBe('forward')
    expect(workspaceRailTransitionDirection('settings', 'project')).toBe('backward')
    expect(workspaceRailTransitionDirection('project', 'hall')).toBe('backward')
  })

  it('设置作为全局同级入口使用竖向过渡，工作区切换保持横向过渡', () => {
    expect(workspaceRailTransitionMode('hall', 'project')).toBe('horizontal-forward')
    expect(workspaceRailTransitionMode('project', 'hall')).toBe('horizontal-backward')
    expect(workspaceRailTransitionMode('project', 'settings')).toBe('vertical-forward')
    expect(workspaceRailTransitionMode('settings', 'project')).toBe('vertical-backward')
    expect(workspaceRailTransitionMode('hall', 'settings')).toBe('vertical-forward')
    expect(workspaceRailTransitionMode('settings', 'hall')).toBe('vertical-backward')
  })

  it('项目概况锁定展开，其他页面仍由悬停状态决定', () => {
    expect(resolveWorkspaceRailExpanded(true, false)).toBe(true)
    expect(resolveWorkspaceRailExpanded(true, true)).toBe(true)
    expect(resolveWorkspaceRailExpanded(false, false)).toBe(false)
    expect(resolveWorkspaceRailExpanded(false, true)).toBe(true)
  })

  it('按固定顺序提供大厅、项目概览、正式栏目与项目工具', () => {
    expect(WORKSPACE_RAIL_ITEMS.map((item) => item.label)).toEqual([
      '项目大厅', '项目概览', '小说大纲', '世界观', '正文创作', '记忆与伏笔', '审稿与导出', '项目工具'
    ])
  })

  it('悬停面板展示完整一级项目清单，而不是当前栏目的二级导航', () => {
    expect(WORKSPACE_RAIL_PANEL_ITEMS.map((item) => item.label)).toEqual([
      '项目概览', '小说大纲', '世界观', '正文创作', '记忆与伏笔', '审稿与导出', '项目工具'
    ])
    expect(WORKSPACE_RAIL_PANEL_ITEMS.every((item) => item.kind !== 'hall')).toBe(true)
  })

  it('展开后的一级清单保留工作区与项目工具分组，品牌区单独承担返回大厅', () => {
    expect(WORKSPACE_RAIL_GROUPS.map((group) => group.label)).toEqual(['工作区', '工具'])
    expect(WORKSPACE_RAIL_GROUPS[0]?.items.map((item) => item.label)).toEqual([
      '项目概览', '小说大纲', '世界观', '正文创作', '记忆与伏笔', '审稿与导出'
    ])
    expect(WORKSPACE_RAIL_GROUPS[1]?.items.map((item) => item.label)).toEqual(['项目工具'])
  })

  it('悬停必须完整持续两秒才展开，离开入口会取消展开', () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    const disclosure = createWorkspaceRailHoverDisclosure(onOpen)

    disclosure.enter('outline')
    vi.advanceTimersByTime(WORKSPACE_RAIL_HOVER_DELAY - 1)
    expect(onOpen).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onOpen).toHaveBeenCalledWith('outline')

    disclosure.enter('world')
    disclosure.leave('world')
    vi.advanceTimersByTime(WORKSPACE_RAIL_HOVER_DELAY)
    expect(onOpen).toHaveBeenCalledTimes(1)

    disclosure.dispose()
    vi.useRealTimers()
  })

  it('键盘动作与悬停浮层等价，并可用 Esc 收起', () => {
    expect(workspaceRailKeyAction('Enter')).toBe('open')
    expect(workspaceRailKeyAction(' ')).toBe('open')
    expect(workspaceRailKeyAction('Escape')).toBe('close')
    expect(workspaceRailKeyAction('Tab')).toBeUndefined()
  })
})
