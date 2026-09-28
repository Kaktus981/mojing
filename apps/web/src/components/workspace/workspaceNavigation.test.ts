import { describe, expect, it } from 'vitest'
import {
  getWorkspaceDisplayDefault,
  getWorkspaceDisplaySection,
  getWorkspaceDisplaySectionForStage,
  getWorkspaceDisplaySubnav,
  getWorkspaceDisplaySubnavItems,
  PROJECT_TOOL_ENTRY_REGION_IDS,
  resolveProjectToolId,
  WORKSPACE_DISPLAY_SECTIONS,
  WORKSPACE_PROJECT_TOOLS,
  WORKSPACE_STAGES
} from './workspaceNavigation'
import {
  INTEGRATED_OUTLINE_CANONICAL_TARGETS,
  INTEGRATED_OUTLINE_MODULES,
  INTEGRATED_OUTLINE_MODULE_IDS
} from './views/outline-integrated/outlineIntegrationModel'

describe('工作区显示级导航模型', () => {
  it('呈现项目概览与五个稳定的一级栏目', () => {
    expect(WORKSPACE_DISPLAY_SECTIONS.map((item) => item.label)).toEqual([
      '项目概览', '小说大纲', '世界观', '正文创作', '记忆与伏笔', '审稿与导出'
    ])
  })

  it('项目概览拥有正式的一级与二级导航目标', () => {
    expect(getWorkspaceDisplayDefault('overview')).toEqual({ stageId: 'overview', subnavId: 'project-overview' })
    expect(getWorkspaceDisplaySubnavItems('overview').map((item) => item.id)).toEqual(['project-overview'])
    expect(getWorkspaceDisplaySectionForStage('overview').id).toBe('overview')
  })

  it('小说大纲只显示四个模块，且顺序固定', () => {
    const items = getWorkspaceDisplaySubnavItems('outline')

    expect(items.map((item) => item.label)).toEqual(['创作起点', '总纲与卷纲', '章节规划', '故事线'])
    expect(items.map((item) => item.id)).toEqual([
      'story-seed', 'outline-foundation', 'chapter-directory', 'storylines'
    ])
    expect(items.every((item) => item.description.length > 0)).toBe(true)
  })

  it('四个显示项的落点严格等于第 6 节的 canonicalTarget', () => {
    const items = getWorkspaceDisplaySubnavItems('outline')

    expect(items.map((item) => `${item.stageId}/${item.id}`)).toEqual(
      INTEGRATED_OUTLINE_MODULE_IDS.map((moduleId) => {
        const target = INTEGRATED_OUTLINE_CANONICAL_TARGETS[moduleId]
        return `${target.stageId}/${target.subnavId}`
      })
    )
  })

  it('将内部 idea stage 映射到小说大纲，且内部十个入口保持不变', () => {
    const section = getWorkspaceDisplaySectionForStage('idea')

    expect(section.id).toBe('outline')
    // 保存过的导航偏好与旧深层链接仍依赖这十个内部入口
    expect(WORKSPACE_STAGES.find((stage) => stage.id === 'idea')!.subnav).toHaveLength(4)
    expect(WORKSPACE_STAGES.find((stage) => stage.id === 'outline')!.subnav).toHaveLength(6)
  })

  it('十个旧入口经兼容映射后都取到四模块显示项，不会串到别的模块', () => {
    for (const moduleId of INTEGRATED_OUTLINE_MODULE_IDS) {
      const canonical = INTEGRATED_OUTLINE_CANONICAL_TARGETS[moduleId]
      const item = getWorkspaceDisplaySubnav(canonical.stageId, canonical.subnavId)

      expect(item.label).toBe(INTEGRATED_OUTLINE_MODULES[moduleId].label)
      expect(`${item.stageId}/${item.id}`).toBe(`${canonical.stageId}/${canonical.subnavId}`)
    }

    // idea 的三个旧入口 → 创作起点（术语与边界已改派到世界观，见下一条）
    for (const subnavId of ['story-seed', 'direction-cards', 'writing-specs']) {
      expect(getWorkspaceDisplaySubnav('idea', subnavId).label).toBe('创作起点')
    }
    // outline 的六个旧入口 → 各自的模块
    expect(getWorkspaceDisplaySubnav('outline', 'outline-foundation').label).toBe('总纲与卷纲')
    expect(getWorkspaceDisplaySubnav('outline', 'outline-structure').label).toBe('总纲与卷纲')
    expect(getWorkspaceDisplaySubnav('outline', 'chapter-directory').label).toBe('章节规划')
    expect(getWorkspaceDisplaySubnav('outline', 'rolling-outline').label).toBe('章节规划')
    expect(getWorkspaceDisplaySubnav('outline', 'chapter-beats').label).toBe('章节规划')
    expect(getWorkspaceDisplaySubnav('outline', 'storylines').label).toBe('故事线')
  })

  it('去重改派的旧入口：导航高亮与标题切到世界观「规则与边界」', () => {
    const item = getWorkspaceDisplaySubnav('idea', 'terms-boundaries')

    expect(`${item.stageId}/${item.id}`).toBe('world/rules-boundaries')
    expect(item.label).toBe('规则与边界')
    expect(item.groupLabel).toBe('世界设定')
    // 同一项必须就是世界观栏目自己那一项，不能是另造的一份
    expect(getWorkspaceDisplaySubnavItems('world').find((entry) => entry.id === 'rules-boundaries')).toEqual(item)
  })

  it('改派不改动世界观栏目自身的显示项', () => {
    expect(getWorkspaceDisplaySubnavItems('world').map((item) => item.id)).toEqual([
      'world-overview', 'rules-boundaries', 'world-entries', 'world-timeline', 'world-expansion'
    ])
  })

  it('未知入口按兼容映射的规则安全回落', () => {
    expect(getWorkspaceDisplaySubnav('idea', 'not-a-real-subnav').label).toBe('创作起点')
    expect(getWorkspaceDisplaySubnav('outline', 'not-a-real-subnav').label).toBe('总纲与卷纲')
    expect(getWorkspaceDisplaySubnav('outline').label).toBe('总纲与卷纲')
  })

  it('为每个显示栏目提供稳定的默认目标', () => {
    expect(getWorkspaceDisplayDefault('outline')).toEqual({ stageId: 'idea', subnavId: 'story-seed' })
    expect(getWorkspaceDisplayDefault('world')).toEqual({ stageId: 'world', subnavId: 'world-overview' })
    expect(getWorkspaceDisplaySection('missing')).toBe(getWorkspaceDisplaySection('outline'))
  })

  it('版本历史只在审稿与导出栏目出现，项目工具不再重复提供快照入口', () => {
    expect(WORKSPACE_PROJECT_TOOLS.map((item) => item.label)).toEqual([
      '任务中心', '助手与技能', '文笔工坊'
    ])
    expect(new Set(WORKSPACE_PROJECT_TOOLS.map((item) => item.label)).size).toBe(WORKSPACE_PROJECT_TOOLS.length)
    expect(WORKSPACE_PROJECT_TOOLS.some((item) => item.label === '项目概览')).toBe(false)
    expect(WORKSPACE_PROJECT_TOOLS.some((item) => item.id === 'assistant-skills')).toBe(true)
    expect(getWorkspaceDisplaySubnavItems('delivery').filter((item) => item.id === 'version-history')).toHaveLength(1)
  })

  it('旧自动流程入口仍改派到任务中心的创作席位区域', () => {
    expect(WORKSPACE_PROJECT_TOOLS.some((item) => item.id === 'creative-seats')).toBe(false)
    expect(resolveProjectToolId('creative-seats')).toBe('ai-workbench')
    expect(resolveProjectToolId('ai-workbench')).toBe('ai-workbench')
    expect(PROJECT_TOOL_ENTRY_REGION_IDS['creative-seats']).toBe('creative-seats-region')
  })
})
