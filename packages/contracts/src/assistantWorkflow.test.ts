import { describe, expect, it } from 'vitest'
import {
  AssistantRunPreviewRequestSchema, AssistantSelectionSchema, AssistantTargetSchema, assistantScopeKey
} from './assistantWorkflow'
import { CreativeChatSendSchema } from './creativeChat'

const target = (overrides: Record<string, unknown> = {}) => AssistantTargetSchema.parse({ kind: 'chapter', projectId: 'p1', objectId: 'ch-1', ...overrides })

describe('助手工作流契约', () => {
  it('卷目标必须带对象 id，缺字段直接拒绝', () => {
    expect(() => AssistantTargetSchema.parse({ kind: 'volume', projectId: 'p1' })).toThrow()
    expect(() => AssistantTargetSchema.parse({ kind: 'volume' })).toThrow()
    expect(AssistantTargetSchema.safeParse({ kind: 'story-core', projectId: 'p1' }).success).toBe(true)
  })

  it('步骤目标同时锁定章 id 与步骤 id', () => {
    const parsed = target({ kind: 'beat', beatId: 'beat-2' })
    expect(parsed).toMatchObject({ kind: 'beat', objectId: 'ch-1', beatId: 'beat-2' })
    expect(() => AssistantTargetSchema.parse({ kind: 'beat', projectId: 'p1', objectId: 'ch-1' })).toThrow()
  })

  it('作用域键用稳定身份，不用章号', () => {
    expect(assistantScopeKey(target())).toBe('chapter:ch-1')
    expect(assistantScopeKey(target({ kind: 'beat', beatId: 'b9' }))).toBe('beat:ch-1:b9')
    expect(assistantScopeKey(target({ kind: 'story-core', objectId: undefined }))).toBe('story-core:')
    // 章号重排不会改变同一个章的作用域键。
    expect(assistantScopeKey(target())).toBe(assistantScopeKey(target()))
  })

  it('选区结束不能早于开始', () => {
    expect(() => AssistantSelectionSchema.parse({ paragraphId: 'b1', start: 8, end: 3, sourceDigest: 'd' })).toThrow()
    expect(AssistantSelectionSchema.safeParse({ paragraphId: 'b1', start: 3, end: 8, sourceDigest: 'd' }).success).toBe(true)
  })

  it('旧请求不带精确作用域仍然合法，行为不变', () => {
    const legacy = CreativeChatSendSchema.parse({ stage: 'outline', mode: '灵感讨论', content: '帮我看看总纲' })
    expect(legacy.target).toBeUndefined()
    expect(legacy.taskType).toBeUndefined()
  })

  it('精确作用域与任务类型可随请求一起上报', () => {
    const parsed = CreativeChatSendSchema.parse({
      stage: 'outline', mode: '综合协作', content: '细化这一章',
      target: { kind: 'chapter', projectId: 'p1', objectId: 'ch-1' }, taskType: '局部修改'
    })
    expect(parsed.taskType).toBe('局部修改')
  })

  it('预览请求是严格对象，不接受未声明字段', () => {
    expect(() => AssistantRunPreviewRequestSchema.parse({
      stage: 'outline', target: target(), taskType: '局部修改', forceWrite: true
    })).toThrow()
  })
})
