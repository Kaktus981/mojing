import {
  BookOpen,
  BookOpenCheck,
  Brain,
  CheckCircle2,
  FileText,
  Lightbulb,
  ListTree,
  Network,
  Palette,
  Waypoints,
  Workflow
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  INTEGRATED_OUTLINE_CANONICAL_TARGETS,
  INTEGRATED_OUTLINE_MODULES,
  INTEGRATED_OUTLINE_MODULE_IDS,
  resolveIntegratedOutlineTarget,
  resolveLegacySectionRedirect
} from './views/outline-integrated/outlineIntegrationModel'
export type WorkspaceStageId = 'idea' | 'world' | 'outline' | 'writing' | 'memory' | 'delivery'
export type WorkspaceRouteStageId = WorkspaceStageId | 'overview'
/**
 * 项目工具的稳定 id。
 * `creative-seats`（自动流程）已经收口：正式导航里**没有**它的按钮，
 * 视图也已并入任务中心。类型里仍保留它，是为了兼容已保存的旧目标
 * （见 `resolveProjectToolId`），不是允许再放第二个入口。
 */
export type WorkspaceProjectToolId = 'ai-workbench' | 'creative-seats' | 'assistant-skills' | 'style-library' | 'history'
export type WorkspaceDestinationId = WorkspaceRouteStageId | WorkspaceProjectToolId
/** Stable identifiers for project sub-navigation. Keep these ids when labels or
 * ordering change so saved layout preferences remain readable. */
export type WorkspaceSubnavId =
  | 'project-overview' | 'story-seed' | 'direction-cards' | 'terms-boundaries' | 'writing-specs'
  | 'world-overview' | 'rules-boundaries' | 'world-entries' | 'world-timeline' | 'world-expansion'
  | 'outline-foundation' | 'chapter-directory' | 'rolling-outline' | 'chapter-beats' | 'storylines' | 'outline-structure'
  | 'prose-editor' | 'writing-controls' | 'writing-handoff' | 'rewrite-search'
  | 'memory-workbench' | 'memory-recall' | 'memory-proposals' | 'foreshadowing' | 'memory-ledger'
  | 'export-manuscript' | 'review-issues' | 'revision-candidates' | 'story-branches' | 'version-history'

export type WorkspaceSubnavItem = {
  id: WorkspaceSubnavId
  label: string
  description: string
  objectPaneLabel?: string
  /** Optional existing content route used while a view is split into clearer sub-projects. */
  contentId?: WorkspaceSubnavId
}

export type WorkspaceStageDefinition = {
  id: WorkspaceRouteStageId
  label: string
  description: string
  icon: LucideIcon
  defaultSubnavId: WorkspaceSubnavId
  subnav: readonly WorkspaceSubnavItem[]
}

/** User-facing top-level sections. Internal stages remain stable for routing and saved data. */
export type WorkspaceDisplaySectionId = 'overview' | 'outline' | 'world' | 'writing' | 'memory' | 'delivery'
export type WorkspaceStageNavigationTarget = { stageId: WorkspaceStageId; subnavId: WorkspaceSubnavId; /** 精确定位的原对象 id；没有选中机制的页面忽略它，只跳到所属页。 */ focusId?: string }
export type WorkspaceNavigationTarget = WorkspaceStageNavigationTarget | { stageId: 'overview'; subnavId: 'project-overview' }
export type WorkspaceDisplaySubnavItem = WorkspaceSubnavItem & {
  stageId: WorkspaceRouteStageId
  groupLabel: string
}
export type WorkspaceDisplaySectionDefinition = {
  id: WorkspaceDisplaySectionId
  label: string
  description: string
  icon: LucideIcon
  stageIds: readonly WorkspaceRouteStageId[]
  defaultTarget: WorkspaceNavigationTarget
  subnav: readonly WorkspaceDisplaySubnavItem[]
}

export type WorkspaceProjectToolDefinition = {
  id: WorkspaceProjectToolId
  label: string
  description: string
  icon: LucideIcon
}

export const WORKSPACE_STAGES: readonly WorkspaceStageDefinition[] = [
  {
    id: 'overview',
    label: '项目概览',
    description: '查看项目状态、当前章节与创作入口',
    icon: BookOpen,
    defaultSubnavId: 'project-overview',
    subnav: [{ id: 'project-overview', label: '项目概览', description: '查看当前小说项目的完整概览' }]
  },
  {
    id: 'idea',
    label: '灵感与规格',
    description: '确定故事方向与创作边界',
    icon: Lightbulb,
    defaultSubnavId: 'story-seed',
    subnav: [
      { id: 'story-seed', label: '故事种子', description: '记录小说最初的核心想法' },
      { id: 'direction-cards', label: '故事方向卡', description: '比较并确定故事发展方向' },
      { id: 'terms-boundaries', label: '术语与边界', description: '明确专有名词与不可擅自推断的设定', objectPaneLabel: '术语目录' },
      { id: 'writing-specs', label: '创作规格', description: '设置篇幅、视角、文风和内容边界' }
    ]
  },
  {
    id: 'world',
    label: '世界观',
    description: '管理世界规则与设定资料',
    icon: Waypoints,
    defaultSubnavId: 'world-overview',
    subnav: [
      { id: 'world-overview', label: '世界总览', description: '查看世界摘要与待补充内容' },
      { id: 'rules-boundaries', label: '规则与边界', description: '管理世界规则、术语边界与审校依据', objectPaneLabel: '设定边界目录' },
      { id: 'world-entries', label: '世界词条', description: '编辑人物、地点、势力和其他设定', objectPaneLabel: '世界词条目录' },
      { id: 'world-timeline', label: '世界时间线', description: '按故事时间管理历史事件', objectPaneLabel: '时间事件列表' },
      { id: 'world-expansion', label: '扩展世界观', description: '在写作中安全增加新设定' }
    ]
  },
  {
    id: 'outline',
    label: '小说大纲',
    description: '规划全书、卷章与剧情步骤',
    icon: ListTree,
    defaultSubnavId: 'outline-foundation',
    subnav: [
      { id: 'outline-foundation', label: '总纲与卷纲', description: '确定全书方向与各卷结构', objectPaneLabel: '卷纲目录' },
      { id: 'chapter-directory', label: '章节目录', description: '按卷查看和定位章节', objectPaneLabel: '章节目录', contentId: 'chapter-beats' },
      { id: 'rolling-outline', label: '近期详细规划', description: '细化近期需要创作的章节' },
      { id: 'chapter-beats', label: '剧情步骤', description: '编辑每章具体剧情步骤', objectPaneLabel: '剧情步骤目录' },
      { id: 'storylines', label: '重要事件线', description: '跟踪跨章节的重要事件', objectPaneLabel: '重要事件线列表' },
      { id: 'outline-structure', label: '结构调整', description: '安全新增、调序、跨卷或删除章节' }
    ]
  },
  {
    id: 'writing',
    label: '正文创作',
    description: '编写章节正文并与 AI 协作',
    icon: FileText,
    defaultSubnavId: 'prose-editor',
    subnav: [
      { id: 'prose-editor', label: '正文编辑', description: '阅读和编辑当前章节正文', objectPaneLabel: '正文卷章目录' },
      { id: 'writing-controls', label: '写作控制', description: '调整章节生成与写作提示', objectPaneLabel: '正文卷章目录' },
      { id: 'writing-handoff', label: '章后交接', description: '记录复盘结果并交接下一章', objectPaneLabel: '正文卷章目录', contentId: 'writing-controls' },
      { id: 'rewrite-search', label: '改写与查找', description: '查找正文并处理局部改写候选', objectPaneLabel: '正文卷章目录' }
    ]
  },
  {
    id: 'memory',
    label: '记忆与伏笔',
    description: '核对长篇记忆与伏笔证据',
    icon: Brain,
    defaultSubnavId: 'memory-workbench',
    subnav: [
      { id: 'memory-workbench', label: '记忆工作台', description: '核对目标章节的记忆状态与待处理事项' },
      { id: 'memory-recall', label: '长篇记忆召回', description: '查看本章会记住什么以及召回原因' },
      { id: 'memory-proposals', label: '记忆变更提案', description: '确认、修正或拒绝新的记忆提案', objectPaneLabel: '待确认记忆提案' },
      { id: 'foreshadowing', label: '伏笔中心', description: '管理伏笔的埋设、推进与回收', objectPaneLabel: '伏笔列表' },
      { id: 'memory-ledger', label: '正式章节记忆', description: '核对已经确认的章节事实与角色状态', objectPaneLabel: '章节记忆目录' }
    ]
  },
  {
    id: 'delivery',
    label: '审稿与导出',
    description: '处理问题、候选并导出成稿',
    icon: CheckCircle2,
    defaultSubnavId: 'export-manuscript',
    subnav: [
      { id: 'export-manuscript', label: '导出成稿', description: '导出 Word、纯文本、Markdown 或完整备份' },
      { id: 'review-issues', label: '审稿问题', description: '查看连续性问题、证据和修改建议', objectPaneLabel: '审稿问题列表' },
      { id: 'revision-candidates', label: 'AI 修改候选', description: '对照并处理所有待确认修改', objectPaneLabel: 'AI 修改候选列表' },
      { id: 'story-branches', label: '剧情分支', description: '比较不影响正式正文的备选走向', objectPaneLabel: '剧情分支列表' },
      { id: 'version-history', label: '版本历史', description: '查看版本快照、差异预览与受控恢复状态', objectPaneLabel: '版本快照目录' }
    ]
  }
] as const

const stageForDisplay = (stageId: WorkspaceRouteStageId): WorkspaceStageDefinition => WORKSPACE_STAGES.find((stage) => stage.id === stageId)!
const displaySubnav = (stageId: WorkspaceRouteStageId, groupLabel: string): WorkspaceDisplaySubnavItem[] => stageForDisplay(stageId).subnav.map((item) => ({ ...item, stageId, groupLabel }))

/**
 * 小说大纲的四个正式显示项。
 *
 * 内部十个入口（`WORKSPACE_STAGES` 的 idea 4 + outline 6）保持不变：保存过的布局偏好和
 * 旧深层链接仍然用它们。但这一栏只显示四个模块 —— id 取该模块的 canonical subnavId，
 * 标题与说明直接取自 `outlineIntegrationModel` 的四模块元数据，不在这里另写一份文案。
 */
const INTEGRATED_OUTLINE_DISPLAY_SUBNAV: readonly WorkspaceDisplaySubnavItem[] =
  INTEGRATED_OUTLINE_MODULE_IDS.map((moduleId) => {
    const target = INTEGRATED_OUTLINE_CANONICAL_TARGETS[moduleId]
    const module = INTEGRATED_OUTLINE_MODULES[moduleId]
    return {
      id: target.subnavId,
      label: module.label,
      description: module.description,
      stageId: target.stageId,
      groupLabel: '小说大纲'
    }
  })

/**
 * Project overview plus five visible creative sections. The legacy idea stage is
 * intentionally nested in the outline section so existing routes and persisted
 * preferences keep working.
 */
export const WORKSPACE_DISPLAY_SECTIONS: readonly WorkspaceDisplaySectionDefinition[] = [
  {
    id: 'overview',
    label: '项目概览',
    description: '查看项目状态、当前章节与创作入口',
    icon: BookOpen,
    stageIds: ['overview'],
    defaultTarget: { stageId: 'overview', subnavId: 'project-overview' },
    subnav: [{ id: 'project-overview', label: '项目概览', description: '查看当前小说项目的完整概览', stageId: 'overview', groupLabel: '项目概览' }]
  },
  {
    id: 'outline',
    label: '小说大纲',
    description: '从故事种子到卷章结构，规划全书走向',
    icon: ListTree,
    stageIds: ['idea', 'outline'],
    defaultTarget: { stageId: 'idea', subnavId: 'story-seed' },
    subnav: INTEGRATED_OUTLINE_DISPLAY_SUBNAV
  },
  {
    id: 'world',
    label: '世界观',
    description: '管理世界规则与设定资料',
    icon: Waypoints,
    stageIds: ['world'],
    defaultTarget: { stageId: 'world', subnavId: 'world-overview' },
    subnav: displaySubnav('world', '世界设定')
  },
  {
    id: 'writing',
    label: '正文创作',
    description: '编写章节正文并与 AI 协作',
    icon: FileText,
    stageIds: ['writing'],
    defaultTarget: { stageId: 'writing', subnavId: 'prose-editor' },
    subnav: displaySubnav('writing', '正文工作')
  },
  {
    id: 'memory',
    label: '记忆与伏笔',
    description: '核对长篇记忆与伏笔证据',
    icon: Brain,
    stageIds: ['memory'],
    defaultTarget: { stageId: 'memory', subnavId: 'memory-workbench' },
    subnav: displaySubnav('memory', '连贯性')
  },
  {
    id: 'delivery',
    label: '审稿与导出',
    description: '处理问题、候选并导出成稿',
    icon: CheckCircle2,
    stageIds: ['delivery'],
    defaultTarget: { stageId: 'delivery', subnavId: 'export-manuscript' },
    subnav: displaySubnav('delivery', '交付检查')
  }
] as const

export const WORKSPACE_PROJECT_TOOLS: readonly WorkspaceProjectToolDefinition[] = [
  { id: 'ai-workbench', label: '任务中心', description: '待办总览、连续任务启动、分析任务状态与结果归属跳转', icon: Workflow },
  { id: 'assistant-skills', label: '助手与技能', description: '配置项目助手、模型选择与创作技能', icon: Network },
  { id: 'style-library', label: '文笔工坊', description: '样文选段、画像编辑与绑定快照', icon: Palette }
] as const

/**
 * 已收口的旧项目工具入口：仍然可识别，但一律改派到唯一的正式入口。
 * 「自动流程」原来和「任务中心」是同一页面的两个按钮，重复入口已移除（P11）。
 */
export const LEGACY_PROJECT_TOOL_REDIRECTS: Readonly<Record<string, WorkspaceProjectToolId>> = {
  'creative-seats': 'ai-workbench',
  history: 'history'
}

/**
 * 旧入口改派后要落到目标页里的哪个区域。
 * 「自动流程」必须落在任务中心的连续任务启动区（`#creative-seats-region`），
 * 而不是停在页首的待办总览。
 */
export const PROJECT_TOOL_ENTRY_REGION_IDS: Readonly<Record<string, string>> = {
  'creative-seats': 'creative-seats-region'
}

/**
 * 把任意工具目标归一成正式入口 id。
 * 正式 id 原样返回；已收口的旧 id 返回改派后的 id；不认识的目标返回 undefined。
 */
export function resolveProjectToolId(toolId: string): WorkspaceProjectToolId | undefined {
  const direct = WORKSPACE_PROJECT_TOOLS.find((tool) => tool.id === toolId)
  if (direct) return direct.id
  return LEGACY_PROJECT_TOOL_REDIRECTS[toolId]
}

export const PROJECT_HALL_ITEM = {
  id: 'project-hall',
  label: '返回项目大厅',
  description: '保存当前内容并返回项目列表',
  icon: BookOpenCheck
} as const

export function getWorkspaceStage(stageId: WorkspaceRouteStageId): WorkspaceStageDefinition {
  return WORKSPACE_STAGES.find((stage) => stage.id === stageId) ?? WORKSPACE_STAGES[0]!
}

export function getWorkspaceDisplaySection(sectionId: string): WorkspaceDisplaySectionDefinition {
  return WORKSPACE_DISPLAY_SECTIONS.find((section) => section.id === sectionId)
    ?? WORKSPACE_DISPLAY_SECTIONS.find((section) => section.id === 'outline')!
}

export function getWorkspaceDisplaySectionForStage(stageId: WorkspaceRouteStageId): WorkspaceDisplaySectionDefinition {
  return WORKSPACE_DISPLAY_SECTIONS.find((section) => section.stageIds.includes(stageId))
    ?? WORKSPACE_DISPLAY_SECTIONS.find((section) => section.id === 'outline')!
}

export function getWorkspaceDisplaySubnavItems(sectionId: string): readonly WorkspaceDisplaySubnavItem[] {
  return getWorkspaceDisplaySection(sectionId).subnav
}

export function getWorkspaceDisplayDefault(sectionId: string): WorkspaceNavigationTarget {
  return getWorkspaceDisplaySection(sectionId).defaultTarget
}

export function getWorkspaceDisplaySubnav(stageId: WorkspaceRouteStageId, subnavId?: string): WorkspaceDisplaySubnavItem {
  // 去重改派的旧入口（如 idea/terms-boundaries → world/rules-boundaries）：
  // 导航高亮、标题与助手席位都必须落在改派后的栏目，而不是原栏目。
  const redirect = resolveLegacySectionRedirect(stageId, subnavId)
  if (redirect) {
    const redirectSection = getWorkspaceDisplaySectionForStage(redirect.stageId)
    const redirected = redirectSection.subnav.find(
      (item) => item.stageId === redirect.stageId && item.id === redirect.subnavId
    )
    if (redirected) return redirected
  }

  const section = getWorkspaceDisplaySectionForStage(stageId)

  // 小说大纲：其余旧入口先做兼容映射，再返回对应的模块显示项。
  // 少走这一步，`outline-structure`、`writing-specs` 这类旧入口就会错误回落到栏目默认页，
  // 标题也跟着串台（它们的落点分别是「总纲与卷纲」和「创作起点」）。
  if (stageId === 'idea' || stageId === 'outline') {
    const { moduleId } = resolveIntegratedOutlineTarget(stageId, subnavId)
    const canonical = INTEGRATED_OUTLINE_CANONICAL_TARGETS[moduleId]
    const mapped = section.subnav.find(
      (item) => item.stageId === canonical.stageId && item.id === canonical.subnavId
    )
    if (mapped) return mapped
  }

  return section.subnav.find((item) => item.stageId === stageId && item.id === subnavId)
    ?? section.subnav.find((item) => item.stageId === stageId && item.id === getWorkspaceStage(stageId).defaultSubnavId)
    ?? section.subnav[0]!
}

export function getWorkspaceSubnav(stageId: WorkspaceRouteStageId, subnavId?: string): WorkspaceSubnavItem {
  const stage = getWorkspaceStage(stageId)
  return stage.subnav.find((item) => item.id === subnavId) ?? stage.subnav.find((item) => item.id === stage.defaultSubnavId) ?? stage.subnav[0]!
}

export function getWorkspaceSubnavItems(stageId: WorkspaceRouteStageId): readonly WorkspaceSubnavItem[] {
  return getWorkspaceStage(stageId).subnav
}

export function isWorkspaceStageId(value: string): value is WorkspaceRouteStageId {
  return WORKSPACE_STAGES.some((stage) => stage.id === value)
}

export function isWorkspaceSubnavId(stageId: WorkspaceRouteStageId, value: string): boolean {
  return getWorkspaceStage(stageId).subnav.some((item) => item.id === value)
}
