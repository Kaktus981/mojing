import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'

export type TaskCenterNextStep = {
  label: string
  detail: string
  target: WorkspaceNavigationTarget
}

/** 任务中心只按创作依赖顺序给出一个下一步：大纲 → 世界观 → 正文。 */
export function getTaskCenterNextStep(project: NovelProject): TaskCenterNextStep {
  if (!project.outline) {
    return {
      label: '先建立小说大纲',
      detail: '先确定总纲、卷章结构，再补充世界观并进入正文创作。',
      target: { stageId: 'outline', subnavId: 'outline-foundation' }
    }
  }

  if (!project.worldBible) {
    return {
      label: '先建立世界观',
      detail: '小说大纲已经建立，下一步补齐世界规则与设定。',
      target: { stageId: 'world', subnavId: 'world-overview' }
    }
  }

  if (project.chapters.length === 0) {
    return {
      label: '先规划第一章',
      detail: '大纲与世界观已经具备，从章节规划开始进入正文创作。',
      target: { stageId: 'outline', subnavId: 'chapter-directory' }
    }
  }

  return {
    label: '继续推进当前章节',
    detail: `目前有 ${project.chapters.length} 章正文，可在正文创作里继续。`,
    target: { stageId: 'writing', subnavId: 'prose-editor' }
  }
}
