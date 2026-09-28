import { describe, expect, it } from 'vitest'
import { makeNovel } from './novelTestFactory'
import { buildNovelOrchestrationPlan } from './novelOrchestrator'

describe('墨境本地创作编排预演', () => {
  it('章节创作按节拍、正文、记忆和连续性分解，并保持人工门禁', () => {
    const project = makeNovel(1)
    const plan = buildNovelOrchestrationPlan(project, { intent: '章节创作', chapterId: project.chapters[0]!.id, maxParallel: 2 })
    expect(plan.localOnly).toBe(true)
    expect(plan.policy.autoApply).toBe(false)
    expect(plan.steps.map((step) => step.kind)).toEqual(['scene-beats', 'chapter', 'memory-extraction', 'continuity-audit'])
    expect(plan.steps[1]?.status).toBe('等待前置')
    expect(plan.steps[2]?.dependsOn).toEqual(['step-2'])
  })

  it('长篇复核把互不写同一正文的检查步骤标为可执行', () => {
    const plan = buildNovelOrchestrationPlan(makeNovel(3), { intent: '长篇复核', maxParallel: 3 })
    expect(plan.steps.map((step) => step.kind)).toEqual(['memory-rebuild', 'continuity-audit', 'foreshadow-review'])
    expect(plan.steps.every((step) => step.status === '可执行')).toBe(true)
    expect(plan.policy.maxParallel).toBe(3)
  })
})
