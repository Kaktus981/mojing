import { describe, expect, it } from 'vitest'
import { CreativeChatReplySchema, CreativeChatSendSchema, ProjectCreativeAssistantSchema } from './creativeChat'

describe('创作对话契约', () => {
  it('限制为六个创作阶段和三种对话模式', () => {
    const parsed = CreativeChatSendSchema.safeParse({ stage: 'world', mode: '问题分析', content: '检查术语边界' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.retainFailedConversation).toBe(false)
    expect(CreativeChatSendSchema.safeParse({ stage: 'world', mode: '问题分析', content: '保留失败记录', retainFailedConversation: true }).success).toBe(true)
    const unified = CreativeChatSendSchema.safeParse({ stage: 'world', mode: '综合协作', content: '直接告诉助手我要做什么' })
    expect(unified.success).toBe(true)
    if (unified.success) expect(unified.data.allowCandidateActions).toBe(false)
    expect(CreativeChatSendSchema.safeParse({ stage: 'history', mode: '问题分析', content: '不属于创作流程' }).success).toBe(false)
    expect(CreativeChatSendSchema.safeParse({ stage: 'world', mode: '直接覆盖', content: '危险操作' }).success).toBe(false)
  })

  it('建议动作只能引用墨境现有候选生成类型', () => {
    expect(CreativeChatReplySchema.safeParse({ answer: '建议', references: [], actions: [{ label: '修改本章', instruction: '最小范围修改', kind: 'chapter-revision' }] }).success).toBe(true)
    expect(CreativeChatReplySchema.safeParse({ answer: '建议', references: [], actions: [{ label: '审校这个候选', instruction: '只审校指定问题', kind: 'world-audit', proposalId: 'proposal-1', findingId: 'finding-1' }] }).success).toBe(true)
    expect(CreativeChatReplySchema.safeParse({ answer: '建议', references: [], actions: [{ label: '直接写数据库', instruction: '越权', kind: 'execute-script' }] }).success).toBe(false)
  })

  it('项目助手必须绑定项目、阶段和三类专属对话内容', () => {
    expect(ProjectCreativeAssistantSchema.safeParse({
      id: 'assistant', projectId: 'project', stage: 'world', name: '世界构筑顾问', role: '规则与实体', welcome: '只服务当前小说。',
      focusAreas: ['规则'], modes: {
        灵感讨论: { title: '探索', description: '说明', prompts: ['问题'], placeholder: '输入' },
        问题分析: { title: '检查', description: '说明', prompts: ['问题'], placeholder: '输入' },
        生成准备: { title: '准备', description: '说明', prompts: ['问题'], placeholder: '输入' }
      }, allowedGenerationKinds: ['world-section'], conversationCount: 0
    }).success).toBe(true)
  })
})
