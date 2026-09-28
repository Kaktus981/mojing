import { describe, expect, it } from 'vitest'
import {
  assistantScopeKey,
  assistantGuideScopeKey,
  type AssistantGuideResultKind,
  type AssistantGuideResultRef,
  type AssistantGuideTurn,
  type AssistantTarget,
  type NovelProject
} from '../../contracts/src'
import type { StructuredGenerationRequest } from './ai/provider'
import {
  AssistantGuideService,
  type AssistantGuideAdapter,
  type AssistantGuideAdapterRegistry,
  type AssistantGuideStructuredRunner
} from './assistantGuideService'
import { assistantGuideContextDigest, restartAssistantGuideSession } from './assistantGuide'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'

function questionTurn(questionId = 'question-1', text = '主角最想守住什么？'): AssistantGuideTurn {
  return {
    analysisSummary: '故事种子和古钟线索已经明确。',
    strengths: [{ title: '核心意象明确', evidenceRefs: ['project.seed'] }],
    gaps: [{ key: 'desire', title: '主角欲望', impact: '影响主线选择。', evidenceRefs: ['project.outline.mainConflict'] }],
    focus: '确认主角的核心欲望',
    question: {
      id: questionId,
      text,
      whyNow: '它会决定主线冲突。',
      options: [
        { id: 'memory', label: '守住记忆', reason: '呼应力量代价。' },
        { id: 'truth', label: '揭开真相', reason: '推动调查主线。' },
        { id: 'city', label: '保护旧城', reason: '建立外部目标。' }
      ],
      allowCustom: true,
      allowSkip: true
    },
    readyToComplete: false
  }
}

function readyTurn(): AssistantGuideTurn {
  return { ...questionTurn(), question: null, readyToComplete: true }
}

class FakeRunner implements AssistantGuideStructuredRunner {
  readonly calls: Array<StructuredGenerationRequest<unknown>> = []

  constructor(private readonly responses: Array<unknown | Error | ((request: StructuredGenerationRequest<unknown>) => unknown | Promise<unknown>)>) {}

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const captured = request as StructuredGenerationRequest<unknown>
    this.calls.push(captured)
    const queued = this.responses.shift()
    if (queued instanceof Error) throw queued
    return (typeof queued === 'function' ? queued(captured) : queued) as T
  }
}

class FakeAdapter implements AssistantGuideAdapter {
  readonly version = 3
  readonly resultKinds: readonly AssistantGuideResultKind[] = ['assistant-draft']
  contextRevision = 1
  completeCalls = 0

  readContext(project: NovelProject, target: AssistantTarget) {
    if (target.projectId !== project.id) throw Object.assign(new Error('目标不属于当前项目。'), { code: 'ASSISTANT_GUIDE_PROJECT_MISMATCH' })
    return {
      context: { revision: this.contextRevision, seed: project.seed, target },
      allowedEvidenceRefs: ['project.seed', 'project.outline.mainConflict'],
      completionContract: { assistantDraft: { payload: { targetId: 'server-owned target id', draftId: 'string' } } }
    }
  }

  constructor(private readonly database: NovelDatabaseService) {}

  complete(input: Parameters<AssistantGuideAdapter['complete']>[0]): AssistantGuideResultRef {
    this.completeCalls += 1
    const payload = input.payload as { targetId?: string; draftId?: string; throwAfterWrite?: boolean; invalidResultRef?: boolean }
    const expectedTargetId = 'objectId' in input.target ? input.target.objectId : input.project.id
    if (payload.targetId !== expectedTargetId) {
      throw Object.assign(new Error('完成结果指向了当前范围之外的对象。'), { code: 'ASSISTANT_GUIDE_RESULT_TARGET_INVALID' })
    }
    this.database.appendAssistantCandidateRecord({
      projectId: input.project.id,
      scopeKey: assistantScopeKey(input.target),
      taskType: '引导构建',
      version: this.completeCalls,
      baseRevision: input.project.revision,
      sourceDigest: 'fake-adapter',
      summary: `fake-result-${this.completeCalls}`,
      changes: [],
      dependencyGroups: [],
      status: '待确认'
    })
    if (payload.throwAfterWrite) throw Object.assign(new Error('适配器在写入后校验失败。'), { code: 'FAKE_ADAPTER_FAILURE' })
    if (payload.invalidResultRef) return { kind: 'assistant-draft', draftId: '' } as AssistantGuideResultRef
    return { kind: 'assistant-draft' as const, draftId: payload.draftId ?? 'draft-1' }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setup(responses: ConstructorParameters<typeof FakeRunner>[0], withProvider = true) {
  const database = new NovelDatabaseService(':memory:')
  const project = { ...makeNovel(1), id: 'guide-project' }
  database.createProject(project)
  if (withProvider) {
    database.saveProvider({
      id: 'guide-provider',
      name: '引导测试模型',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'guide-test',
      contextWindow: 8_000,
      supportsStreaming: false,
      supportsJsonSchema: true,
      hasApiKey: true
    })
  }
  const runner = new FakeRunner(responses)
  const adapter = new FakeAdapter(database)
  const registry: AssistantGuideAdapterRegistry = {
    get: (domain) => domain === 'outline' ? adapter : undefined
  }
  const service = new AssistantGuideService(database, runner, registry)
  const target = { kind: 'story-core' as const, projectId: project.id }
  return { database, project, runner, adapter, service, target }
}

describe('AssistantGuideService', () => {
  it('start 只调用一次结构化模型，并把校验后的首题持久化', async () => {
    const { database, project, runner, service, target } = setup([questionTurn()])

    const session = await service.start(project.id, { domain: 'outline', target })

    expect(runner.calls).toHaveLength(1)
    expect((runner.calls[0] as any).singleAttempt).toBe(true)
    expect(session).toMatchObject({ version: 2, status: '提问中', turn: { question: { id: 'question-1' } } })
    expect(database.getCurrentAssistantGuideSession(project.id, 'outline', assistantGuideScopeKey('outline', target)))
      .toEqual(session)
    database.close()
  })

  it('重复 start 直接恢复已提问会话，零额外模型调用', async () => {
    const { database, project, runner, service, target } = setup([questionTurn(), readyTurn()])
    const first = await service.start(project.id, { domain: 'outline', target })

    const restored = await service.start(project.id, { domain: 'outline', target })

    expect(restored).toEqual(first)
    expect(runner.calls).toHaveLength(1)
    database.close()
  })

  it('重复 start 直接恢复已生成会话，结果不变且零额外模型调用', async () => {
    const { database, project, runner, service, target } = setup([
      readyTurn(),
      { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'draft-generated' } },
      questionTurn('must-not-run')
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const completed = await service.complete(project.id, started.id, { expectedVersion: started.version })

    const restored = await service.start(project.id, { domain: 'outline', target })

    expect(restored).toEqual(completed)
    expect(restored.resultRef).toEqual({ kind: 'assistant-draft', draftId: 'draft-generated' })
    expect(runner.calls).toHaveLength(2)
    database.close()
  })

  it('初次分析失败后可通过 start 重试，不会永久卡在分析中', async () => {
    const failure = Object.assign(new Error('首次分析失败'), { code: 'MODEL_NETWORK_ERROR' })
    const { database, project, runner, service, target } = setup([failure, questionTurn()])

    await expect(service.start(project.id, { domain: 'outline', target })).rejects.toMatchObject({ code: 'MODEL_NETWORK_ERROR' })
    const retry = await service.start(project.id, { domain: 'outline', target })

    expect(retry).toMatchObject({ version: 2, status: '提问中', turn: { question: { id: 'question-1' } } })
    expect(runner.calls).toHaveLength(2)
    database.close()
  })

  it('answer 最多调用一次模型，且已确认回答进入下一题上下文', async () => {
    const answerText = '他最想守住妹妹对自己的记忆。'
    const { database, project, runner, service, target } = setup([
      questionTurn(),
      (request: StructuredGenerationRequest<unknown>) => {
        expect(request.user).toContain(answerText)
        expect(request.user).toContain('question-1')
        return questionTurn('question-2', '为了这段记忆，他愿意付出什么代价？')
      }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })

    const answered = await service.answer(project.id, started.id, {
      expectedVersion: started.version,
      questionId: 'question-1',
      customText: answerText
    })

    expect(runner.calls).toHaveLength(2)
    expect(answered.confirmedAnswers).toEqual([{ questionId: 'question-1', customText: answerText }])
    expect(answered.turn?.question?.text).toBe('为了这段记忆，他愿意付出什么代价？')
    expect(answered.version).toBe(started.version + 1)
    database.close()
  })

  it('连续选择两题后，下一题与 complete 上下文仍保留两个已选选项的真实文字', async () => {
    const assertConfirmedLabels = (request: StructuredGenerationRequest<unknown>) => {
      const body = JSON.parse(request.user) as { confirmedAnswers: Array<{ selectedOptionLabel?: string }> }
      expect(body.confirmedAnswers.map((answer) => answer.selectedOptionLabel)).toEqual(['守住记忆', '揭开真相'])
    }
    const { database, project, service, target } = setup([
      questionTurn('question-1'),
      questionTurn('question-2', '主角接下来如何追查？'),
      (request: StructuredGenerationRequest<unknown>) => {
        assertConfirmedLabels(request)
        return readyTurn()
      },
      (request: StructuredGenerationRequest<unknown>) => {
        assertConfirmedLabels(request)
        return { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'answer-context-draft' } }
      }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const first = await service.answer(project.id, started.id, {
      expectedVersion: started.version,
      questionId: 'question-1',
      selectedOptionId: 'memory'
    })
    const second = await service.answer(project.id, first.id, {
      expectedVersion: first.version,
      questionId: 'question-2',
      selectedOptionId: 'truth'
    })

    const completed = await service.complete(project.id, second.id, { expectedVersion: second.version })

    expect(completed.confirmedAnswers).toEqual([
      { questionId: 'question-1', selectedOptionId: 'memory', selectedOptionLabel: '守住记忆' },
      { questionId: 'question-2', selectedOptionId: 'truth', selectedOptionLabel: '揭开真相' }
    ])
    database.close()
  })

  it('模型失败时不确认回答、不推进版本，也不清空原分析', async () => {
    const failure = Object.assign(new Error('受控模型连接失败'), { code: 'MODEL_NETWORK_ERROR' })
    const { database, project, runner, service, target } = setup([questionTurn(), failure])
    const started = await service.start(project.id, { domain: 'outline', target })
    const before = database.getAssistantGuideSession(project.id, started.id)

    await expect(service.answer(project.id, started.id, {
      expectedVersion: started.version,
      questionId: 'question-1',
      selectedOptionId: 'memory'
    })).rejects.toMatchObject({ code: 'MODEL_NETWORK_ERROR' })

    expect(runner.calls).toHaveLength(2)
    expect(database.getAssistantGuideSession(project.id, started.id)).toEqual(before)
    expect(database.getAssistantGuideSession(project.id, started.id)?.confirmedAnswers).toEqual([])
    database.close()
  })

  it('拒绝不在服务端白名单内的 evidenceRefs，并保留初始持久版本', async () => {
    const invalid = questionTurn()
    invalid.strengths[0]!.evidenceRefs = ['other-project.secret']
    const { database, project, service, target } = setup([invalid])

    await expect(service.start(project.id, { domain: 'outline', target }))
      .rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_EVIDENCE_INVALID' })

    const stored = database.getCurrentAssistantGuideSession(project.id, 'outline', assistantGuideScopeKey('outline', target))
    expect(stored).toMatchObject({ version: 1, status: '分析中', turn: null, confirmedAnswers: [] })
    database.close()
  })

  it('拒绝非法 resultKind，不调用适配器也不改变会话', async () => {
    const { database, project, runner, adapter, service, target } = setup([
      readyTurn(),
      { turn: readyTurn(), resultKind: 'formal-project-patch', payload: { targetId: projectIdPlaceholder } }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const before = database.getAssistantGuideSession(project.id, started.id)

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version })).rejects.toThrow()

    expect(runner.calls).toHaveLength(2)
    expect(adapter.completeCalls).toBe(0)
    expect(database.getAssistantGuideSession(project.id, started.id)).toEqual(before)
    database.close()
  })

  it('把完成 payload 交给适配器校验，对象 ID 越界时不落会话结果', async () => {
    const { database, project, runner, adapter, service, target } = setup([
      readyTurn(),
      { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'another-project', draftId: 'bad-draft' } }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const before = database.getAssistantGuideSession(project.id, started.id)

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_RESULT_TARGET_INVALID' })

    expect(runner.calls).toHaveLength(2)
    expect(adapter.completeCalls).toBe(1)
    expect(database.getAssistantGuideSession(project.id, started.id)).toEqual(before)
    database.close()
  })

  it('complete 只通过适配器产生结果引用，服务不直接改正式项目', async () => {
    const { database, project, runner, adapter, service, target } = setup([
      readyTurn(),
      { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'draft-safe' } }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const projectBefore = database.getProject(project.id)

    const completed = await service.complete(project.id, started.id, { expectedVersion: started.version })

    expect(runner.calls).toHaveLength(2)
    expect(adapter.completeCalls).toBe(1)
    expect(completed).toMatchObject({ status: '已生成', resultRef: { kind: 'assistant-draft', draftId: 'draft-safe' } })
    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(1)
    expect(database.getProject(project.id)).toEqual(projectBefore)
    database.close()
  })

  it('complete 请求会携带适配器声明的 completionContract，真实模型不依赖 unknown payload 猜字段', async () => {
    const { database, project, runner, service, target } = setup([
      readyTurn(),
      (request: StructuredGenerationRequest<unknown>) => {
        const body = JSON.parse(request.user) as { completionContract?: unknown }
        expect(body.completionContract).toEqual({ assistantDraft: { payload: { targetId: 'server-owned target id', draftId: 'string' } } })
        return { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'contract-draft' } }
      }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })

    const completed = await service.complete(project.id, started.id, { expectedVersion: started.version })

    expect(runner.calls).toHaveLength(2)
    expect(completed.resultRef).toEqual({ kind: 'assistant-draft', draftId: 'contract-draft' })
    database.close()
  })

  it('两个同版本 complete 即使模型返回交错，也至多持久化一个结果', async () => {
    const firstModel = deferred<unknown>()
    const secondModel = deferred<unknown>()
    const completion = { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'draft-race' } }
    const { database, project, runner, adapter, service, target } = setup([
      readyTurn(),
      () => firstModel.promise,
      () => secondModel.promise
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const first = service.complete(project.id, started.id, { expectedVersion: started.version })
    const second = service.complete(project.id, started.id, { expectedVersion: started.version })
    expect(runner.calls).toHaveLength(3)

    firstModel.resolve(completion)
    const persisted = await first
    secondModel.resolve(completion)

    await expect(second).rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_VERSION_CONFLICT' })
    expect(persisted.resultRef).toEqual({ kind: 'assistant-draft', draftId: 'draft-race' })
    expect(adapter.completeCalls).toBe(1)
    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(1)
    database.close()
  })

  it('适配器写入后抛错时，候选和会话结果在同一事务中回滚', async () => {
    const { database, project, service, target } = setup([
      readyTurn(),
      { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', throwAfterWrite: true } }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const before = database.getAssistantGuideSession(project.id, started.id)

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version }))
      .rejects.toMatchObject({ code: 'FAKE_ADAPTER_FAILURE' })

    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(0)
    expect(database.getAssistantGuideSession(project.id, started.id)).toEqual(before)
    database.close()
  })

  it('适配器返回非法结果引用时，已写候选和会话一并回滚', async () => {
    const { database, project, service, target } = setup([
      readyTurn(),
      { turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', invalidResultRef: true } }
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const before = database.getAssistantGuideSession(project.id, started.id)

    await expect(service.complete(project.id, started.id, { expectedVersion: started.version })).rejects.toThrow()

    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(0)
    expect(database.getAssistantGuideSession(project.id, started.id)).toEqual(before)
    database.close()
  })

  it('模型返回前相关项目上下文变化时，不写旧结果并转入需要复核', async () => {
    const pendingModel = deferred<unknown>()
    const { database, project, service, target } = setup([readyTurn(), () => pendingModel.promise])
    const started = await service.start(project.id, { domain: 'outline', target })
    const completing = service.complete(project.id, started.id, { expectedVersion: started.version })
    const currentProject = database.getProject(project.id)
    database.saveProject({ ...currentProject, seed: '模型调用期间修改后的故事种子' }, currentProject.revision)

    pendingModel.resolve({ turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'stale-draft' } })
    const reviewed = await completing

    expect(reviewed).toMatchObject({ version: started.version + 1, status: '需要复核', resultRef: null })
    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(0)
    database.close()
  })

  it('模型返回前会话被重启时，迟到 complete 不写孤儿结果', async () => {
    const pendingModel = deferred<unknown>()
    const { database, project, service, adapter, target } = setup([readyTurn(), () => pendingModel.promise])
    const started = await service.start(project.id, { domain: 'outline', target })
    const completing = service.complete(project.id, started.id, { expectedVersion: started.version })
    restartAssistantGuideSession({
      database,
      project: database.getProject(project.id),
      sessionId: started.id,
      expectedVersion: started.version,
      contextDigest: assistantGuideContextDigest(adapter.readContext(database.getProject(project.id), target).context),
      adapterVersion: adapter.version
    })

    pendingModel.resolve({ turn: readyTurn(), resultKind: 'assistant-draft', payload: { targetId: 'guide-project', draftId: 'late-draft' } })

    await expect(completing).rejects.toMatchObject({ code: 'ASSISTANT_GUIDE_VERSION_CONFLICT' })
    expect(database.listAssistantCandidateRecords(project.id)).toHaveLength(0)
    database.close()
  })

  it('reanalyze 保留已确认回答，更新服务端摘要指纹且只调用一次模型', async () => {
    const { database, project, runner, adapter, service, target } = setup([
      questionTurn(),
      readyTurn(),
      questionTurn('question-after-review')
    ])
    const started = await service.start(project.id, { domain: 'outline', target })
    const answered = await service.answer(project.id, started.id, {
      expectedVersion: started.version,
      questionId: 'question-1',
      selectedOptionId: 'memory'
    })
    const oldDigest = answered.contextDigest
    adapter.contextRevision = 2

    const reviewed = await service.reanalyze(project.id, answered.id, answered.version)

    expect(runner.calls).toHaveLength(3)
    expect(reviewed.confirmedAnswers).toEqual(answered.confirmedAnswers)
    expect(reviewed.contextDigest).not.toBe(oldDigest)
    expect(reviewed.turn?.question?.id).toBe('question-after-review')
    database.close()
  })

  it('未配置模型时沿用 EffectiveRunConfig 的真实原因，不触发 runner', async () => {
    const { database, project, runner, service, target } = setup([questionTurn()], false)

    await expect(service.start(project.id, { domain: 'outline', target })).rejects.toMatchObject({
      code: 'MODEL_NOT_CONFIGURED',
      message: '还没有可用的模型服务，请先在全局设置里配置模型服务与密钥。'
    })
    expect(runner.calls).toHaveLength(0)
    database.close()
  })
})

const projectIdPlaceholder = 'guide-project'
