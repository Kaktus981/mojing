import { describe, expect, it } from 'vitest'
import { resolveOutlineWorkbenchVisual } from './outlineWorkbenchModel'

describe('大纲工作台视觉契约', () => {
  it('为四个模块提供稳定标题、脊柱标签与水墨背景', () => {
    expect(resolveOutlineWorkbenchVisual('outline-volumes')).toEqual({
      title: '卷章目录',
      eyebrow: '大纲工作台',
      description: '从全书方向进入分卷与章节结构。',
      background: 'mountain'
    })
    expect(resolveOutlineWorkbenchVisual('chapter-planning')).toEqual({
      title: '章节脊柱',
      eyebrow: '大纲工作台',
      description: '按章节确认目标、冲突与剧情步骤。',
      background: 'harbor'
    })
    expect(resolveOutlineWorkbenchVisual('storylines')).toEqual({
      title: '故事线',
      eyebrow: '大纲工作台',
      description: '追踪跨章事件、节点和收束条件。',
      background: 'city'
    })
  })

  it('未知模块安全回落到卷章目录', () => {
    expect(resolveOutlineWorkbenchVisual('unknown')).toEqual(resolveOutlineWorkbenchVisual('outline-volumes'))
  })
})
