import { describe, expect, it } from 'vitest'
import { resolveWorkspaceSecondaryNav } from './workspaceSecondaryNav'

describe('项目二级导航', () => {
  it('项目概览在打开项目后常驻显示同名二级入口', () => {
    const overview = resolveWorkspaceSecondaryNav({ stageId: 'overview', subnavId: 'project-overview' })
    expect(overview.kind).toBe('section')
    if (overview.kind !== 'section') return
    expect(overview.label).toBe('项目概览')
    expect(overview.items.map((item) => item.label)).toEqual(['项目概览'])
  })

  it('只提供当前一级栏目的二级入口', () => {
    const outline = resolveWorkspaceSecondaryNav({ stageId: 'idea', subnavId: 'story-seed' })
    expect(outline.kind).toBe('section')
    if (outline.kind !== 'section') return
    expect(outline.label).toBe('小说大纲')
    expect(outline.items.map((item) => item.label)).toEqual(['创作起点', '总纲与卷纲', '章节规划', '故事线'])
  })

  it('项目工具选中时只展示三个正式工具入口', () => {
    const tools = resolveWorkspaceSecondaryNav(undefined, 'ai-workbench')
    expect(tools.kind).toBe('tools')
    if (tools.kind !== 'tools') return
    expect(tools.items.map((item) => item.label)).toEqual(['任务中心', '助手与技能', '文笔工坊'])
    expect(tools.items.some((item) => item.id === 'assistant-skills')).toBe(true)
  })
})
