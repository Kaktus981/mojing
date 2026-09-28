import { describe, expect, it } from 'vitest'
import { AssistantTargetSchema, type AssistantTarget } from './assistantWorkflow'
import {
  AnswerAssistantGuideSchema,
  AssistantGuideSessionSchema,
  AssistantGuideResultRefSchema,
  AssistantGuideTurnSchema,
  StartAssistantGuideSchema,
  assistantGuideScopeKey,
  type AnswerAssistantGuide
} from './assistantGuide'

const target = (value: Record<string, unknown>) => AssistantTargetSchema.parse({ projectId: 'project-a', ...value })

describe('通用引导助手契约', () => {
  it('接受五个栏目和精确目标', () => {
    for (const domain of ['outline', 'world', 'writing', 'memory', 'delivery']) {
      expect(StartAssistantGuideSchema.safeParse({ domain, target: target({ kind: 'outline' }) }).success).toBe(true)
    }
  })

  it('拒绝目标中未声明的路径字段', () => {
    const unsafeTarget = { kind: 'outline', projectId: 'project-a', path: 'project.outline' }
    expect(StartAssistantGuideSchema.safeParse({ domain: 'outline', target: unsafeTarget }).success).toBe(false)
    expect(AssistantGuideSessionSchema.safeParse({
      id: 'session-1', projectId: 'project-a', domain: 'outline', scopeKey: 'outline:project-a:outline:', target: unsafeTarget,
      baseProjectRevision: 0, contextDigest: 'digest', adapterVersion: 1, version: 1, status: '分析中', turn: null,
      confirmedAnswers: [], resultRef: null, error: null, createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z'
    }).success).toBe(false)
  })

  it('作用域键包含栏目、目标项目与稳定目标身份', () => {
    const chapterTarget = target({ kind: 'chapter', objectId: 'c1' })
    const targets: AssistantTarget[] = [
      target({ kind: 'story-core' }), target({ kind: 'outline' }), target({ kind: 'volume', objectId: 'v1' }),
      chapterTarget, target({ kind: 'beat', objectId: 'c1', beatId: 'b1' }),
      target({ kind: 'storyline', objectId: 's1' }), target({ kind: 'world' }), target({ kind: 'world-entry', objectId: 'w1' })
    ]
    expect(targets.map((item) => assistantGuideScopeKey('outline', item))).toEqual([
      'outline:project-a:story-core:', 'outline:project-a:outline:', 'outline:project-a:volume:v1',
      'outline:project-a:chapter:c1', 'outline:project-a:beat:c1:b1', 'outline:project-a:storyline:s1',
      'outline:project-a:world:', 'outline:project-a:world-entry:w1'
    ])
    expect(assistantGuideScopeKey('world', chapterTarget)).not.toBe(assistantGuideScopeKey('outline', chapterTarget))
    expect(assistantGuideScopeKey('outline', target({ kind: 'chapter', projectId: 'project-b', objectId: 'c1' }))).not.toBe(assistantGuideScopeKey('outline', chapterTarget))
  })

  it('问题选项只接受三到五项，且证据引用不能留空', () => {
    const question = { id: 'q1', text: '下一步？', whyNow: '补齐缺口', allowCustom: true, allowSkip: true }
    const option = (id: string) => ({ id, label: id, reason: '理由' })
    const turn = { analysisSummary: '摘要', strengths: [{ title: '优点', evidenceRefs: ['seed'] }], gaps: [{ key: 'gap', title: '缺口', impact: '影响', evidenceRefs: ['outline'] }], focus: '焦点', readyToComplete: false }
    expect(AssistantGuideTurnSchema.safeParse({ ...turn, question: { ...question, options: [option('1'), option('2'), option('3')] } }).success).toBe(true)
    expect(AssistantGuideTurnSchema.safeParse({ ...turn, question: { ...question, options: [option('1'), option('2'), option('3'), option('4'), option('5')] } }).success).toBe(true)
    expect(AssistantGuideTurnSchema.safeParse({ ...turn, question: { ...question, options: [option('1'), option('2')] } }).success).toBe(false)
    expect(AssistantGuideTurnSchema.safeParse({ ...turn, question: { ...question, options: [option('1'), option('2'), option('3'), option('4'), option('5'), option('6')] } }).success).toBe(false)
    expect(AssistantGuideTurnSchema.safeParse({ ...turn, strengths: [{ title: '优点', evidenceRefs: [''] }], question: null }).success).toBe(false)
  })

  it('回答严格互斥，且文本受限', () => {
    const common = { expectedVersion: 1, questionId: 'q1' }
    expect(AnswerAssistantGuideSchema.safeParse({ ...common, selectedOptionId: 'o1' }).success).toBe(true)
    expect(AnswerAssistantGuideSchema.safeParse({ ...common, customText: '我的回答' }).success).toBe(true)
    expect(AnswerAssistantGuideSchema.safeParse({ ...common, skip: true }).success).toBe(true)
    expect(AnswerAssistantGuideSchema.safeParse(common).success).toBe(false)
    expect(AnswerAssistantGuideSchema.safeParse({ ...common, selectedOptionId: 'o1', skip: true }).success).toBe(false)
    expect(AnswerAssistantGuideSchema.safeParse({ ...common, customText: ' ', skip: true }).success).toBe(false)
    expect(AnswerAssistantGuideSchema.safeParse({ ...common, customText: 'x'.repeat(4_001) }).success).toBe(false)
  })

  it('会话可保存服务端解析的已选文字，但回答请求不能伪造该文字', () => {
    const session = {
      id: 'session-answers', projectId: 'project-a', domain: 'outline', scopeKey: 'outline:project-a:outline:',
      target: target({ kind: 'outline' }), baseProjectRevision: 0, contextDigest: 'digest', adapterVersion: 1,
      version: 2, status: '提问中', turn: null,
      confirmedAnswers: [{ questionId: 'q1', selectedOptionId: 'o1', selectedOptionLabel: '守住记忆' }],
      resultRef: null, error: null, createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z'
    }
    expect(AssistantGuideSessionSchema.safeParse(session).success).toBe(true)
    expect(AnswerAssistantGuideSchema.safeParse({ expectedVersion: 1, questionId: 'q1', selectedOptionId: 'o1', selectedOptionLabel: '伪造文字' }).success).toBe(false)

    const request: AnswerAssistantGuide = { expectedVersion: 1, questionId: 'q1', selectedOptionId: 'o1' }
    expect(request.selectedOptionId).toBe('o1')
    // @ts-expect-error selectedOptionLabel 是服务端按当前问题解析的持久化字段，不属于客户端请求。
    const unsafeRequest: AnswerAssistantGuide = { expectedVersion: 1, questionId: 'q1', selectedOptionId: 'o1', selectedOptionLabel: '伪造文字' }
    expect(unsafeRequest).toBeDefined()
  })

  it('结果引用只允许已知严格变体', () => {
    expect(AssistantGuideResultRefSchema.safeParse({ kind: 'unknown', resultId: 'x' }).success).toBe(false)
    expect(AssistantGuideResultRefSchema.safeParse({ kind: 'assistant-draft', draftId: 'd1', extra: true }).success).toBe(false)
    expect(AssistantGuideResultRefSchema.safeParse({ kind: 'export-precheck', projectRevision: 3, format: 'docx' }).success).toBe(true)
  })
})
