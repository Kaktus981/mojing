import { describe, expect, it } from 'vitest'
import { getWorkspaceDisplaySubnav } from './workspaceNavigation'
import { IDEA_PAGE_IDS } from './views/idea/ideaModel'
import { MEMORY_PAGE_IDS } from './views/memory/memoryModel'
import { OUTLINE_PAGE_IDS } from './views/outline/outlineModel'
import { REVIEW_PAGE_IDS } from './views/review/reviewModel'
import {
  INTEGRATED_OUTLINE_MODULES,
  INTEGRATED_OUTLINE_MODULE_IDS,
  resolveIntegratedOutlineTarget
} from './views/outline-integrated/outlineIntegrationModel'
import { resolveLegacySectionRedirect } from './views/outline-integrated/outlineIntegrationModel'
import { getStageChatAssistantProfile } from '../stageChatGuidance'
import { buildWorkspaceHeader, saveStateTone } from './workspaceHeader'

describe('工作区 52px 中央上下文标题栏', () => {
  it('面包屑取自栏目、标题取自四模块元数据，且不重复同一个名字', () => {
    const header = buildWorkspaceHeader({
      projectTitle: '归墟纪事',
      target: { stageId: 'outline', subnavId: 'chapter-directory' }
    })
    expect(header.crumb).toEqual(['归墟纪事', '小说大纲'])
    // chapter-directory 是「章节规划」模块的旧入口，标题必须归一为模块名
    expect(header.title).toBe(INTEGRATED_OUTLINE_MODULES['chapter-planning'].label)
    expect(header.description.length).toBeGreaterThan(0)
  })

  it('正文创作栏目的标题来自正文二级栏目', () => {
    const header = buildWorkspaceHeader({
      projectTitle: '归墟纪事',
      target: { stageId: 'writing', subnavId: 'prose-editor' }
    })
    expect(header.crumb).toEqual(['归墟纪事', '正文创作'])
    expect(header.title).toBe('正文编辑')
  })

  it('二级 id 失效时回落到该栏目默认页，仍给出可用标题', () => {
    const header = buildWorkspaceHeader({
      projectTitle: '归墟纪事',
      target: { stageId: 'world', subnavId: 'memory-recall' as never }
    })
    expect(header.title).toBe('世界总览')
  })

  it('项目工具显示真实工具名与说明', () => {
    const header = buildWorkspaceHeader({ projectTitle: '归墟纪事', target: { stageId: 'outline', subnavId: 'outline-foundation' }, activeTool: 'ai-workbench' })
    expect(header.crumb).toEqual(['归墟纪事', '项目工具'])
    expect(header.title).toBe('任务中心')
    expect(header.description.length).toBeGreaterThan(0)
  })

  it('保存状态只映射 store 的真实三种取值', () => {
    expect(saveStateTone('已保存')).toBe('ok')
    expect(saveStateTone('正在保存')).toBe('busy')
    expect(saveStateTone('未保存')).toBe('dirty')
    expect(saveStateTone(undefined)).toBe('ok')
  })

  /** 「小说大纲」旧入口：idea 三个（术语与边界已改派到世界观）+ outline 六个。 */
  const LEGACY_OUTLINE_ENTRIES = [
    ...IDEA_PAGE_IDS.filter((subnavId) => subnavId !== 'terms-boundaries')
      .map((subnavId) => ({ stageId: 'idea' as const, subnavId })),
    ...OUTLINE_PAGE_IDS.map((subnavId) => ({ stageId: 'outline' as const, subnavId }))
  ]

  /** 因去重调整改派到世界观的旧入口：标题与面包屑必须跟着改派后的栏目。 */
  const REDIRECTED_LEGACY_ENTRY = { stageId: 'idea' as const, subnavId: 'terms-boundaries' as const }

  it('小说大纲九个旧入口的标题与说明归一为四个模块', () => {
    expect(LEGACY_OUTLINE_ENTRIES).toHaveLength(9)

    const rows = LEGACY_OUTLINE_ENTRIES.map(({ stageId, subnavId }) => {
      const header = buildWorkspaceHeader({ projectTitle: '归墟纪事', target: { stageId, subnavId } })
      const { moduleId } = resolveIntegratedOutlineTarget(stageId, subnavId)
      const module = INTEGRATED_OUTLINE_MODULES[moduleId]

      expect(header.crumb).toEqual(['归墟纪事', '小说大纲'])
      expect(header.title).toBe(module.label)
      expect(header.description).toBe(module.description)
      expect(header.description.length).toBeGreaterThan(0)

      return header.title
    })

    // 十个入口只产生四种标题，且恰好是四个模块的显示名
    expect([...new Set(rows)].sort()).toEqual(
      INTEGRATED_OUTLINE_MODULE_IDS.map((id) => INTEGRATED_OUTLINE_MODULES[id].label).sort()
    )
  })

  it('同一模块的旧入口标题完全一致，只改变页内定位', () => {
    const byModule = new Map<string, { title: string; focusIds: string[] }>()

    for (const { stageId, subnavId } of LEGACY_OUTLINE_ENTRIES) {
      const header = buildWorkspaceHeader({ projectTitle: '归墟纪事', target: { stageId, subnavId } })
      const { moduleId, focusId } = resolveIntegratedOutlineTarget(stageId, subnavId)
      const entry = byModule.get(moduleId) ?? { title: header.title, focusIds: [] }

      expect(entry.title).toBe(header.title)
      entry.focusIds.push(focusId)
      byModule.set(moduleId, entry)
    }

    expect([...byModule.keys()].sort()).toEqual([...INTEGRATED_OUTLINE_MODULE_IDS].sort())
    // 同一模块内的旧入口共享标题，页内定位互不相同
    expect(new Set(byModule.get('creation-start')!.focusIds).size).toBe(3)
    expect(new Set(byModule.get('outline-volumes')!.focusIds).size).toBe(2)
    expect(new Set(byModule.get('chapter-planning')!.focusIds).size).toBe(3)
    expect(new Set(byModule.get('storylines')!.focusIds).size).toBe(1)
  })

  it('改派到世界观的旧入口：面包屑、标题与助手都切到世界观', () => {
    const header = buildWorkspaceHeader({ projectTitle: '归墟纪事', target: REDIRECTED_LEGACY_ENTRY })

    expect(header.crumb).toEqual(['归墟纪事', '世界观'])
    expect(header.title).toBe(getWorkspaceDisplaySubnav('world', 'rules-boundaries').label)
    expect(header.title).toBe('规则与边界')
    expect(header.description.length).toBeGreaterThan(0)

    // 右侧助手：改派后栏目变成 world，四套大纲助手不再参与，由世界观的阶段档案接管
    const redirected = resolveLegacySectionRedirect(REDIRECTED_LEGACY_ENTRY.stageId, REDIRECTED_LEGACY_ENTRY.subnavId)!
    expect(redirected).toEqual({ stageId: 'world', subnavId: 'rules-boundaries' })
    expect(getStageChatAssistantProfile(redirected.stageId, '归墟纪事').displaySection).toBe('世界观')
  })

  it('记忆与伏笔五个二级入口的标题、说明与助手上下文各不相同', () => {
    const rows = MEMORY_PAGE_IDS.map((subnavId) => {
      const header = buildWorkspaceHeader({ projectTitle: '归墟纪事', target: { stageId: 'memory', subnavId } })
      const scopeLabel = getWorkspaceDisplaySubnav('memory', subnavId).label
      expect(header.crumb).toEqual(['归墟纪事', '记忆与伏笔'])
      expect(header.title).toBe(scopeLabel)
      expect(header.description.length).toBeGreaterThan(0)
      return { title: header.title, description: header.description }
    })
    expect(new Set(rows.map((item) => item.title)).size).toBe(5)
    expect(new Set(rows.map((item) => item.description)).size).toBe(5)
    expect(rows.map((item) => item.title)).toEqual([
      '记忆工作台', '长篇记忆召回', '记忆变更提案', '伏笔中心', '正式章节记忆'
    ])
  })

  it('审稿与导出五个二级入口的标题、说明与助手上下文各不相同', () => {
    const rows = REVIEW_PAGE_IDS.map((subnavId) => {
      const header = buildWorkspaceHeader({ projectTitle: '归墟纪事', target: { stageId: 'delivery', subnavId } })
      const scopeLabel = getWorkspaceDisplaySubnav('delivery', subnavId).label
      expect(header.crumb).toEqual(['归墟纪事', '审稿与导出'])
      expect(header.title).toBe(scopeLabel)
      expect(header.description.length).toBeGreaterThan(0)
      return { title: header.title, description: header.description }
    })
    expect(new Set(rows.map((item) => item.title)).size).toBe(5)
    expect(new Set(rows.map((item) => item.description)).size).toBe(5)
    expect(rows.map((item) => item.title)).toEqual([
      '导出成稿', '审稿问题', 'AI 修改候选', '剧情分支', '版本历史'
    ])
  })
})
