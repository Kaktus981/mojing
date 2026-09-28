import type { IntegratedOutlineModuleId } from './outlineIntegrationModel'

export type OutlineWorkbenchVisual = {
  title: string
  eyebrow: string
  description: string
  background: 'mountain' | 'harbor' | 'city' | 'paper'
}

const VISUALS: Record<IntegratedOutlineModuleId, OutlineWorkbenchVisual> = {
  'creation-start': {
    title: '创作起点',
    eyebrow: '大纲工作台',
    description: '把故事种子收束成可继续确认的创作方向。',
    background: 'paper'
  },
  'outline-volumes': {
    title: '卷章目录',
    eyebrow: '大纲工作台',
    description: '从全书方向进入分卷与章节结构。',
    background: 'mountain'
  },
  'chapter-planning': {
    title: '章节脊柱',
    eyebrow: '大纲工作台',
    description: '按章节确认目标、冲突与剧情步骤。',
    background: 'harbor'
  },
  storylines: {
    title: '故事线',
    eyebrow: '大纲工作台',
    description: '追踪跨章事件、节点和收束条件。',
    background: 'city'
  }
}

export function resolveOutlineWorkbenchVisual(moduleId: string): OutlineWorkbenchVisual {
  return VISUALS[moduleId as IntegratedOutlineModuleId] ?? VISUALS['outline-volumes']
}
