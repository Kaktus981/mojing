import {
  getProjectToolsAssistantProfile,
  getStageChatAssistantProfile,
  type StageChatAssistantProfile
} from '../stageChatGuidance'
import type { CreativeChatStage } from '../../../../../packages/contracts/src'

/**
 * 工作区只按一级栏目选择助手身份；二级页面和当前对象交给作用域层处理。
 * `idea` 与 `outline` 共用小说大纲助手，项目工具使用独立的项目级档案。
 */
export function getWorkspaceAssistantProfile(stage: CreativeChatStage | string, projectTitle: string, projectTools = false): StageChatAssistantProfile {
  if (projectTools) return getProjectToolsAssistantProfile(projectTitle)
  const sectionStage = stage === 'idea' ? 'outline' : stage
  if (!['outline', 'world', 'writing', 'memory', 'delivery'].includes(sectionStage)) return getStageChatAssistantProfile('outline', projectTitle)
  return getStageChatAssistantProfile(sectionStage as Exclude<CreativeChatStage, 'idea'>, projectTitle)
}
