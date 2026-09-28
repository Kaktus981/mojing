import { describe, expect, it } from 'vitest'
import { ASSISTANT_DISPLAY_SECTIONS, getStageChatAssistantProfile } from './stageChatGuidance'

describe('栏目专属 AI 助手模式', () => {
  it('五个显示级栏目都有完整且独立的助手模式', () => {
    expect(ASSISTANT_DISPLAY_SECTIONS).toEqual(['小说大纲', '世界观', '正文创作', '记忆 / 伏笔', '审稿 / 导出'])

    const stages = ['outline', 'world', 'writing', 'memory', 'delivery'] as const
    const profiles = stages.map((stage) => getStageChatAssistantProfile(stage, '星纹古钟'))

    expect(profiles.map((profile) => profile.name)).toEqual([
      '大纲架构师', '世界观构建助手', '写作陪伴助手', '连贯性助手', '审稿与出版助手'
    ])
    for (const profile of profiles) {
      expect(profile.welcome).not.toContain('我是《')
      expect(profile.welcome).not.toContain('星纹古钟')
      expect(profile.contextSources.length).toBeGreaterThanOrEqual(3)
      expect(profile.quickActions.length).toBeGreaterThanOrEqual(3)
      expect(profile.quickActions.every((action) => action.label && action.prompt)).toBe(true)
      expect(profile.resultPresentation).not.toBe('')
      expect(profile.proposalTypes.length).toBeGreaterThanOrEqual(2)
    }
    expect(new Set(profiles.map((profile) => profile.welcome)).size).toBe(5)
    expect(new Set(profiles.map((profile) => profile.resultPresentation)).size).toBe(5)
  })

  it('idea 阶段兼容映射到小说大纲助手，不会产生第六套模式', () => {
    const idea = getStageChatAssistantProfile('idea', '星纹古钟')
    const outline = getStageChatAssistantProfile('outline', '星纹古钟')

    expect(idea).toEqual(outline)
    expect(idea.displaySection).toBe('小说大纲')
    expect(idea.contextSources.join('、')).toContain('故事种子')
    expect(idea.proposalTypes.every((type) => type.includes('候选') || type.includes('提案'))).toBe(true)
  })
})
