import {
  getWorkspaceDisplaySectionForStage,
  getWorkspaceDisplaySubnav,
  WORKSPACE_PROJECT_TOOLS,
  type WorkspaceNavigationTarget,
  type WorkspaceProjectToolId
} from './workspaceNavigation'
import { resolveLegacySectionRedirect } from './views/outline-integrated/outlineIntegrationModel'

export type WorkspaceHeaderModel = {
  /** 面包屑：项目名 / 一级栏目 / 当前页，与视觉基线 s3 的 .topbar .crumb 同构。 */
  crumb: readonly string[]
  title: string
  description: string
}

/**
 * 52px 中央上下文标题栏的数据模型。
 *
 * 抽成纯函数是为了能直接测：标题、面包屑、说明三者必须与导航模型同源，
 * 不允许页面自己拼一套文案（否则面包屑会和左侧 232px 导航对不上）。
 */
export function buildWorkspaceHeader(input: {
  projectTitle: string
  target: WorkspaceNavigationTarget
  activeTool?: WorkspaceProjectToolId
}): WorkspaceHeaderModel {
  if (input.activeTool) {
    const tool = WORKSPACE_PROJECT_TOOLS.find((item) => item.id === input.activeTool)
    return {
      crumb: [input.projectTitle, '项目工具'],
      title: tool?.label ?? '项目工具',
      description: tool?.description ?? ''
    }
  }

  // 去重改派的旧入口（如 idea/terms-boundaries → world/rules-boundaries）：
  // 面包屑所属栏目也必须跟着改派，否则会出现「面包屑=小说大纲 / 标题=规则与边界」这种串台。
  const target = resolveLegacySectionRedirect(input.target.stageId, input.target.subnavId) ?? input.target
  const section = getWorkspaceDisplaySectionForStage(target.stageId)
  const subnav = getWorkspaceDisplaySubnav(target.stageId, target.subnavId)
  return {
    crumb: [input.projectTitle, section.label],
    title: subnav.label,
    description: subnav.description
  }
}

export type SaveStateTone = 'ok' | 'busy' | 'dirty' | 'error'

/**
 * 保存状态的语义色。
 * 词表来自 novelStore 的真实取值，不新增第三种说法，避免出现「看起来已保存」的假状态。
 */
export function saveStateTone(saveState?: string): SaveStateTone {
  if (saveState === '正在保存') return 'busy'
  if (saveState === '保存失败') return 'error'
  if (saveState === '未保存') return 'dirty'
  return 'ok'
}
