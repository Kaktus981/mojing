import { describe, expect, it } from 'vitest'
import type {
  AssistantGuideResultRef,
  AssistantGuideSession,
  AssistantTarget
} from '../../../../../../packages/contracts/src'
import {
  buildGuidedAssistantViewModel,
  guideResultReferenceLabel,
  guideResultSurface,
  guidedPhaseLabel
} from './guidedAssistantViewModel'

const target: AssistantTarget = { kind: 'chapter', projectId: 'project-a', objectId: 'chapter-1' }

function session(patch: Partial<AssistantGuideSession> & { id: string }): AssistantGuideSession {
  return {
    id: patch.id,
    projectId: patch.projectId ?? 'project-a',
    domain: patch.domain ?? 'outline',
    scopeKey: patch.scopeKey ?? 'outline:project-a:chapter:chapter-1',
    target: patch.target ?? target,
    baseProjectRevision: patch.baseProjectRevision ?? 7,
    contextDigest: patch.contextDigest ?? 'digest-1',
    adapterVersion: patch.adapterVersion ?? 1,
    version: patch.version ?? 1,
    status: patch.status ?? '提问中',
    turn: patch.turn === undefined
      ? {
          analysisSummary: '项目里已经有故事种子和三卷结构。',
          strengths: [{ title: '主角目标明确', evidenceRefs: ['project.seed'] }],
          gaps: [{ key: 'conflict', title: '核心冲突还不具体', impact: '中段推进会缺少抓手', evidenceRefs: ['project.outline'] }],
          focus: '第一幕的冲突落点',
          question: {
            id: 'question-1',
            text: '主角最先失去的是什么？',
            whyNow: '这决定第一幕的冲突强度。',
            options: [
              { id: 'a', label: '一段记忆', reason: '直接对应已有的记忆设定' },
              { id: 'b', label: '一个同伴', reason: '更快建立情感张力' },
              { id: 'c', label: '一份身份', reason: '可以牵出后续追查线' }
            ],
            allowCustom: true,
            allowSkip: true
          },
          readyToComplete: false
        }
      : patch.turn,
    confirmedAnswers: patch.confirmedAnswers ?? [],
    resultRef: patch.resultRef ?? null,
    error: patch.error ?? null,
    createdAt: patch.createdAt ?? '2026-09-17T00:00:00.000Z',
    updatedAt: patch.updatedAt ?? '2026-09-17T00:00:00.000Z'
  }
}

const idle = {
  session: null,
  pendingAction: null,
  error: null,
  customAnswer: '',
  currentLookupSettled: false
} as const

describe('buildGuidedAssistantViewModel —— 只报告真实状态', () => {
  it('四个核心阶段都有清晰的作者可读标签', () => {
    expect(guidedPhaseLabel('analyzing')).toBe('分析中')
    expect(guidedPhaseLabel('question')).toBe('问题中')
    expect(guidedPhaseLabel('result')).toBe('候选待确认')
    expect(guidedPhaseLabel('error')).toBe('失败，可重试')
  })

  it('还没读到时是「正在读取当前进度」，不是分析中', () => {
    expect(buildGuidedAssistantViewModel({ ...idle }).phase).toBe('checking')
  })

  it('读取结束且没有会话时是「等待开始」，不是伪造的进度', () => {
    const view = buildGuidedAssistantViewModel({ ...idle, currentLookupSettled: true })
    expect(view.phase).toBe('waiting')
    expect(view.hasSession).toBe(false)
    expect(view.completedCount).toBe(0)
  })

  it('点击开始之后才是「正在分析你的项目…」', () => {
    const view = buildGuidedAssistantViewModel({ ...idle, currentLookupSettled: true, pendingAction: 'start' })
    expect(view.phase).toBe('analyzing')
    expect(view.busy).toBe(true)
  })

  it('已有会话直接恢复到当前问题，不重新分析', () => {
    const view = buildGuidedAssistantViewModel({ ...idle, currentLookupSettled: true, session: session({ id: 's1' }) })
    expect(view.phase).toBe('question')
    expect(view.question?.id).toBe('question-1')
    expect(view.question?.options).toHaveLength(3)
    expect(view.analysis?.summary).toContain('故事种子')
    expect(view.focus).toBe('第一幕的冲突落点')
  })

  it('已完成题数是真实回答条数，不是估算的问题总数', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({
        id: 's1',
        version: 3,
        confirmedAnswers: [
          { questionId: 'q1', selectedOptionId: 'a' },
          { questionId: 'q2', customText: '作者自己的回答' },
          { questionId: 'q3', skip: true }
        ]
      })
    })
    expect(view.completedCount).toBe(3)
  })

  it('「需要复核」是独立状态，不是可继续答题', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '需要复核' })
    })
    expect(view.phase).toBe('needs-review')
  })

  it('有答案但已经问不出下一题时，如实要求重新分析，而不是永久转圈', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({
        id: 's1',
        turn: {
          analysisSummary: '旧会话迁入',
          strengths: [],
          gaps: [],
          focus: '继续',
          question: null,
          readyToComplete: false
        },
        confirmedAnswers: [{ questionId: 'q1', customText: '旧答案' }]
      })
    })
    expect(view.phase).toBe('needs-review')
    expect(view.completedCount).toBe(1)
  })

  it('可以生成时给出生成入口，生成中给出真实忙碌态', () => {
    const ready = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '可生成' })
    })
    expect(ready.phase).toBe('ready')

    const generating = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '生成中' })
    })
    expect(generating.phase).toBe('generating')
  })

  it('存量「分析中 / 生成中」会话给出可用的重试入口，不永久转圈', () => {
    const analyzing = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '分析中', turn: null })
    })
    expect(analyzing.phase).toBe('analyzing')
    expect(analyzing.retry.available).toBe(true)
    expect(analyzing.retry.label).toBe('重试分析')

    const generating = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '生成中', turn: null })
    })
    expect(generating.phase).toBe('generating')
    expect(generating.retry.available).toBe(true)
    expect(generating.retry.label).toBe('重试生成')
  })

  it('真实请求在途（pendingAction 非空）时不给重试入口，避免重复提交', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '分析中', turn: null }),
      pendingAction: 'start'
    })
    expect(view.busy).toBe(true)
    expect(view.retry.available).toBe(false)
  })

  it('出错时保留可重试信息与作者已输入的自定义回答', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '失败', error: '模型暂时不可用。' }),
      customAnswer: '作者打了一半的字',
      error: { code: 'REQUEST_FAILED', message: '模型暂时不可用。', retryable: true }
    })
    expect(view.error?.message).toBe('模型暂时不可用。')
    expect(view.retry).toEqual({ available: true, label: '重试分析' })
    expect(view.customAnswer).toBe('作者打了一半的字')
  })

  it('没有可重试的会话状态时重试入口不可用，不会假装能重试', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '提问中' })
    })
    expect(view.retry).toEqual({ available: false, label: '' })
  })

  it('会话失败时如实报告失败原因，不伪装成提问中', () => {
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '失败', error: '结构化输出不符合要求。', turn: null })
    })
    expect(view.phase).toBe('error')
    expect(view.error?.message).toBe('结构化输出不符合要求。')
  })

  it('已有结果引用时进入结果态，且引用不等于已经采用', () => {
    const resultRef: AssistantGuideResultRef = { kind: 'assistant-draft', draftId: 'draft-1' }
    const view = buildGuidedAssistantViewModel({
      ...idle,
      currentLookupSettled: true,
      session: session({ id: 's1', status: '已生成', resultRef })
    })
    expect(view.phase).toBe('result')
    expect(view.resultRef).toEqual(resultRef)
    expect(guideResultSurface(resultRef).detail).toContain('确认')
  })
})

describe('guideResultSurface —— 只导航到既有界面，不新建第二套采用', () => {
  it('每类结果都指向既有的一级/二级页面', () => {
    expect(guideResultSurface({ kind: 'world-setting-proposal', proposalId: 'p1' })).toMatchObject({
      kind: 'navigate',
      target: { stageId: 'world', subnavId: 'world-expansion' }
    })
    expect(guideResultSurface({ kind: 'revision-proposal', proposalId: 'p1' })).toMatchObject({
      kind: 'navigate',
      target: { stageId: 'delivery', subnavId: 'revision-candidates' }
    })
    expect(guideResultSurface({ kind: 'chapter-analysis', taskId: 't1' })).toMatchObject({
      kind: 'navigate',
      target: { stageId: 'memory', subnavId: 'memory-proposals' }
    })
    expect(guideResultSurface({ kind: 'export-precheck', projectRevision: 3, format: 'txt' })).toMatchObject({
      kind: 'navigate',
      target: { stageId: 'delivery', subnavId: 'export-manuscript' }
    })
  })

  it('助手草稿的既有落点是自由创作里的候选面板，不是第三个采用入口', () => {
    const surface = guideResultSurface({ kind: 'assistant-draft', draftId: 'draft-1' })
    expect(surface.kind).toBe('free')
  })

  it('结果引用的人类可读标签来自结果本身，不伪造采用状态', () => {
    const label = guideResultReferenceLabel({ kind: 'assistant-draft', draftId: 'draft-1234567890' })
    expect(label).toContain('草稿')
    expect(label).not.toContain('已采用')
  })
})
