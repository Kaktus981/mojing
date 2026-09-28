import { describe, expect, it } from 'vitest'
import { makeNovel } from './novelTestFactory'
import { buildProjectAssistants, projectAssistantId } from './projectAssistantCatalog'

describe('项目专属创作助手目录', () => {
  it('为每个小说构建六个互不混用的专职助手', () => {
    const first = makeNovel(1), second = makeNovel(1)
    first.title = '第一部小说'; second.title = '第二部小说'
    const firstAssistants = buildProjectAssistants(first, { world: 2 })
    const secondAssistants = buildProjectAssistants(second)

    expect(firstAssistants).toHaveLength(6)
    expect(new Set(firstAssistants.map((item) => item.name)).size).toBe(6)
    expect(firstAssistants.find((item) => item.stage === 'world')).toMatchObject({ name: '世界构筑顾问', conversationCount: 2 })
    expect(firstAssistants.find((item) => item.stage === 'outline')?.welcome).toContain('第一部小说')
    expect(firstAssistants.map((item) => item.id)).not.toEqual(secondAssistants.map((item) => item.id))
    expect(projectAssistantId(first.id, 'world')).not.toBe(projectAssistantId(second.id, 'world'))
  })

  it('每种助手只公开自己阶段可用的候选动作和快捷任务', () => {
    const assistants = buildProjectAssistants(makeNovel(1))
    const idea = assistants.find((item) => item.stage === 'idea')!
    const world = assistants.find((item) => item.stage === 'world')!
    const outline = assistants.find((item) => item.stage === 'outline')!
    expect(world.allowedGenerationKinds).toEqual(['world-section', 'world-foundation', 'world-audit'])
    expect(idea.allowedGenerationKinds).toContain('story-direction')
    expect(outline.allowedGenerationKinds).toEqual(['outline-foundation', 'outline-volume', 'scene-beats'])
    expect(world.modes.灵感讨论.prompts).not.toEqual(outline.modes.灵感讨论.prompts)
    expect(JSON.stringify(assistants)).not.toMatch(/万象谱|大纲架构师|构建师助手/)
  })
})
