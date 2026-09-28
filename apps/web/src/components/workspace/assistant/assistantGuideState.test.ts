import { describe, expect, it } from 'vitest'
import type {
  AnswerAssistantGuide,
  AssistantGuideDomain,
  AssistantGuideSession,
  AssistantTarget,
  StartAssistantGuide
} from '../../../../../../packages/contracts/src'
import {
  buildAssistantGuideDraftKey,
  createAssistantGuideController,
  driveAssistantGuideLifecycle,
  type AssistantGuideDraftPayload,
  type AssistantGuideDraftStore,
  type AssistantGuideStateClient
} from './useAssistantGuide'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

const target = (projectId = 'project-a', objectId = 'chapter-1'): AssistantTarget => ({
  kind: 'chapter',
  projectId,
  objectId
})

function session(input: Partial<AssistantGuideSession> & {
  id: string
  projectId?: string
  domain?: AssistantGuideDomain
  scopeKey?: string
  version?: number
}): AssistantGuideSession {
  const projectId = input.projectId ?? 'project-a'
  const domain = input.domain ?? 'outline'
  const scopeKey = input.scopeKey ?? `${domain}:${projectId}:chapter:chapter-1`
  const version = input.version ?? 1
  return {
    id: input.id,
    projectId,
    domain,
    scopeKey,
    target: input.target ?? target(projectId),
    baseProjectRevision: input.baseProjectRevision ?? 7,
    contextDigest: input.contextDigest ?? `digest-${version}`,
    adapterVersion: input.adapterVersion ?? 1,
    version,
    status: input.status ?? '提问中',
    turn: input.turn ?? {
      analysisSummary: 'summary',
      strengths: [],
      gaps: [],
      focus: 'focus',
      question: {
        id: 'question-1',
        text: '下一步？',
        whyNow: '需要确认',
        options: [
          { id: 'a', label: '方向 A', reason: '稳妥' },
          { id: 'b', label: '方向 B', reason: '大胆' },
          { id: 'c', label: '方向 C', reason: '折中' }
        ],
        allowCustom: true,
        allowSkip: true
      },
      readyToComplete: false
    },
    confirmedAnswers: input.confirmedAnswers ?? [],
    resultRef: input.resultRef ?? null,
    error: input.error ?? null,
    createdAt: input.createdAt ?? '2026-09-17T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-09-17T00:00:00.000Z'
  }
}

function memoryDraftStore(): AssistantGuideDraftStore {
  const values = new Map<string, AssistantGuideDraftPayload>()
  return {
    async load(key) { return values.get(key) },
    async save(key, payload) { values.set(key, payload) },
    async clear(key, expectedEditSequence) {
      const current = values.get(key)
      if (expectedEditSequence === undefined || current?.editSequence === expectedEditSequence) values.delete(key)
    },
    peek: (key: string) => values.get(key)
  } as AssistantGuideDraftStore & { peek(key: string): AssistantGuideDraftPayload | undefined }
}

function fakeClient(): AssistantGuideStateClient & {
  calls: { current: unknown[]; start: unknown[]; answer: unknown[]; reanalyze: unknown[]; complete: unknown[]; restart: unknown[] }
  nextCurrent: Array<ReturnType<typeof deferred<AssistantGuideSession | null>>>
  nextStart: Array<ReturnType<typeof deferred<AssistantGuideSession>>>
  nextAnswer: Array<ReturnType<typeof deferred<AssistantGuideSession>>>
  nextReanalyze: Array<ReturnType<typeof deferred<AssistantGuideSession>>>
  nextComplete: Array<ReturnType<typeof deferred<AssistantGuideSession>>>
  nextRestart: Array<ReturnType<typeof deferred<AssistantGuideSession>>>
} {
  const client = {
    calls: {
      current: [] as unknown[],
      start: [] as unknown[],
      answer: [] as unknown[],
      reanalyze: [] as unknown[],
      complete: [] as unknown[],
      restart: [] as unknown[]
    },
    nextCurrent: [] as Array<ReturnType<typeof deferred<AssistantGuideSession | null>>>,
    nextStart: [] as Array<ReturnType<typeof deferred<AssistantGuideSession>>>,
    nextAnswer: [] as Array<ReturnType<typeof deferred<AssistantGuideSession>>>,
    nextReanalyze: [] as Array<ReturnType<typeof deferred<AssistantGuideSession>>>,
    nextComplete: [] as Array<ReturnType<typeof deferred<AssistantGuideSession>>>,
    nextRestart: [] as Array<ReturnType<typeof deferred<AssistantGuideSession>>>,
    current(projectId: string, domain: AssistantGuideDomain, scopeKey: string) {
      client.calls.current.push({ projectId, domain, scopeKey })
      return client.nextCurrent.shift()!.promise
    },
    start(projectId: string, input: StartAssistantGuide) {
      client.calls.start.push({ projectId, input })
      return client.nextStart.shift()!.promise
    },
    answer(projectId: string, sessionId: string, input: AnswerAssistantGuide) {
      client.calls.answer.push({ projectId, sessionId, input })
      return client.nextAnswer.shift()!.promise
    },
    reanalyze(projectId: string, sessionId: string, expectedVersion: number) {
      client.calls.reanalyze.push({ projectId, sessionId, expectedVersion })
      return client.nextReanalyze.shift()!.promise
    },
    complete(projectId: string, sessionId: string, expectedVersion: number) {
      client.calls.complete.push({ projectId, sessionId, expectedVersion })
      return client.nextComplete.shift()!.promise
    },
    restart(projectId: string, sessionId: string, expectedVersion: number) {
      client.calls.restart.push({ projectId, sessionId, expectedVersion })
      return client.nextRestart.shift()!.promise
    }
  }
  return client
}

describe('assistant guide state', () => {
  it('selecting guide mode switches UI preference without starting a guide session', () => {
    const client = fakeClient()
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })

    controller.setMode('引导构建')

    expect(controller.getState().mode).toBe('引导构建')
    expect(client.calls.start).toHaveLength(0)
  })

  it('guide lifecycle settles after one current lookup returns null and does not loop', async () => {
    const client = fakeClient()
    const current = deferred<AssistantGuideSession | null>()
    client.nextCurrent.push(current)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })
    controller.setMode('引导构建')

    const firstTick = driveAssistantGuideLifecycle(controller)
    current.resolve(null)
    await firstTick
    await driveAssistantGuideLifecycle(controller)

    expect(client.calls.current).toHaveLength(1)
    expect(controller.getState().session).toBeNull()
    expect(controller.getState().pendingAction).toBeNull()
    expect(controller.getState().currentLookupSettled).toBe(true)
  })

  it('loads current sessions by exact project, domain and scope, and ignores stale load responses', async () => {
    const client = fakeClient()
    const first = deferred<AssistantGuideSession | null>()
    const second = deferred<AssistantGuideSession | null>()
    client.nextCurrent.push(first, second)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })

    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a', 'chapter-1') })
    const firstLoad = controller.loadCurrent()
    controller.setContext({ projectId: 'project-b', domain: 'world', target: { kind: 'world', projectId: 'project-b' } })
    const secondLoad = controller.loadCurrent()
    second.resolve(session({ id: 'world-current', projectId: 'project-b', domain: 'world', scopeKey: 'world:project-b:world:' }))
    await secondLoad
    first.resolve(session({ id: 'stale-outline', projectId: 'project-a', domain: 'outline', scopeKey: 'outline:project-a:chapter:chapter-1' }))
    await firstLoad

    expect(controller.getState().session?.id).toBe('world-current')
    expect(client.calls.current).toEqual([
      { projectId: 'project-a', domain: 'outline', scopeKey: 'outline:project-a:chapter:chapter-1' },
      { projectId: 'project-b', domain: 'world', scopeKey: 'world:project-b:world:' }
    ])
  })

  it('lets start supersede an older load for the same scope', async () => {
    const client = fakeClient()
    const loading = deferred<AssistantGuideSession | null>()
    const starting = deferred<AssistantGuideSession>()
    client.nextCurrent.push(loading)
    client.nextStart.push(starting)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })

    const loadPromise = controller.loadCurrent()
    const startPromise = controller.start()
    starting.resolve(session({ id: 'started', version: 1 }))
    await startPromise
    loading.resolve(session({ id: 'old-current', version: 1 }))
    await loadPromise

    expect(controller.getState().session?.id).toBe('started')
  })

  it('guards duplicate start clicks while a start request is pending', async () => {
    const client = fakeClient()
    const starting = deferred<AssistantGuideSession>()
    client.nextStart.push(starting)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })

    const first = controller.start()
    const second = controller.start()
    starting.resolve(session({ id: 'started' }))
    await Promise.all([first, second])

    expect(client.calls.start).toHaveLength(1)
    expect(controller.getState().session?.id).toBe('started')
  })

  it('does not let an old scope start request block starting the newly selected scope', async () => {
    const client = fakeClient()
    const first = deferred<AssistantGuideSession>()
    const second = deferred<AssistantGuideSession>()
    client.nextStart.push(first, second)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })

    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a', 'chapter-1') })
    const firstStart = controller.start()
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a', 'chapter-2') })
    const secondStart = controller.start()
    second.resolve(session({ id: 'new-scope', scopeKey: 'outline:project-a:chapter:chapter-2', target: target('project-a', 'chapter-2') }))
    await secondStart
    first.resolve(session({ id: 'old-scope', scopeKey: 'outline:project-a:chapter:chapter-1', target: target('project-a', 'chapter-1') }))
    await firstStart

    expect(client.calls.start).toHaveLength(2)
    expect(controller.getState().session?.id).toBe('new-scope')
  })

  it('keeps unsent input when React passes an equivalent target object for the same semantic scope', async () => {
    const client = fakeClient()
    const initial = deferred<AssistantGuideSession | null>()
    client.nextCurrent.push(initial)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a', 'chapter-1') })
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await controller.loadCurrent()
    controller.setCustomAnswer('还没提交的输入')

    controller.setContext({ projectId: 'project-a', domain: 'outline', target: { ...target('project-a', 'chapter-1') } })

    expect(controller.getState().session?.id).toBe('session-a')
    expect(controller.getState().customAnswer).toBe('还没提交的输入')
  })

  it('keeps a newer refreshed session when an older answer response arrives late', async () => {
    const client = fakeClient()
    const initial = deferred<AssistantGuideSession | null>()
    const answering = deferred<AssistantGuideSession>()
    const refresh = deferred<AssistantGuideSession | null>()
    client.nextCurrent.push(initial, refresh)
    client.nextAnswer.push(answering)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })

    const load = controller.loadCurrent()
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await load
    controller.setCustomAnswer('旧回答')
    const answer = controller.answerCustom()
    const refreshPromise = controller.loadCurrent()
    refresh.resolve(session({ id: 'session-a', version: 2, status: '需要复核', error: '上下文已变化，请复核。' }))
    await refreshPromise
    answering.resolve(session({
      id: 'session-a',
      version: 2,
      confirmedAnswers: [{ questionId: 'question-1', customText: '旧回答' }]
    }))
    await answer

    expect(controller.getState().session?.status).toBe('需要复核')
    expect(controller.getState().session?.error).toBe('上下文已变化，请复核。')
  })

  it('clears only the submitted draft sequence after a confirmed answer', async () => {
    const client = fakeClient()
    const store = memoryDraftStore() as AssistantGuideDraftStore & { peek(key: string): AssistantGuideDraftPayload | undefined }
    const initial = deferred<AssistantGuideSession | null>()
    const answering = deferred<AssistantGuideSession>()
    client.nextCurrent.push(initial)
    client.nextAnswer.push(answering)
    const controller = createAssistantGuideController({ client, draftStore: store })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await controller.loadCurrent()

    controller.setCustomAnswer('提交时的文字')
    const key = buildAssistantGuideDraftKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:chapter:chapter-1',
      sessionId: 'session-a',
      version: 1,
      questionId: 'question-1'
    })
    const answer = controller.answerCustom()
    controller.setCustomAnswer('请求途中继续写的新文字')
    answering.resolve(session({
      id: 'session-a',
      version: 2,
      turn: { ...session({ id: 'session-a' }).turn!, question: { ...session({ id: 'session-a' }).turn!.question!, id: 'question-2' } },
      confirmedAnswers: [{ questionId: 'question-1', customText: '提交时的文字' }]
    }))
    await answer

    expect(store.peek(key)?.text).toBe('请求途中继续写的新文字')
  })

  it('clears recovered draft metadata when the author edits recovered text', async () => {
    const client = fakeClient()
    const store = memoryDraftStore()
    const initial = deferred<AssistantGuideSession | null>()
    client.nextCurrent.push(initial)
    const controller = createAssistantGuideController({ client, draftStore: store })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })
    const key = buildAssistantGuideDraftKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:chapter:chapter-1',
      sessionId: 'session-a',
      version: 1,
      questionId: 'question-1'
    })
    await store.save(key, { text: '缓存文本', editSequence: 1, savedAt: '2026-09-17T00:00:00.000Z' }, session({ id: 'session-a', version: 1 }))
    const load = controller.loadCurrent()
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await load

    expect(controller.getState().recoveredDraft?.text).toBe('缓存文本')
    controller.setCustomAnswer('作者改过的文本')

    expect(controller.getState().customAnswer).toBe('作者改过的文本')
    expect(controller.getState().recoveredDraft).toBeNull()
  })

  it('clears stale recovered draft metadata when a confirmed answer advances to a question without cache', async () => {
    const client = fakeClient()
    const store = memoryDraftStore()
    const initial = deferred<AssistantGuideSession | null>()
    const answering = deferred<AssistantGuideSession>()
    client.nextCurrent.push(initial)
    client.nextAnswer.push(answering)
    const controller = createAssistantGuideController({ client, draftStore: store })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })
    const key = buildAssistantGuideDraftKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:chapter:chapter-1',
      sessionId: 'session-a',
      version: 1,
      questionId: 'question-1'
    })
    await store.save(key, { text: '缓存文本', editSequence: 1, savedAt: '2026-09-17T00:00:00.000Z' }, session({ id: 'session-a', version: 1 }))
    const load = controller.loadCurrent()
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await load
    controller.setCustomAnswer('提交文本')
    const answer = controller.answerCustom()
    answering.resolve(session({
      id: 'session-a',
      version: 2,
      turn: { ...session({ id: 'session-a' }).turn!, question: { ...session({ id: 'session-a' }).turn!.question!, id: 'question-2' } },
      confirmedAnswers: [{ questionId: 'question-1', customText: '提交文本' }]
    }))
    await answer

    expect(controller.getState().session?.turn?.question?.id).toBe('question-2')
    expect(controller.getState().recoveredDraft).toBeNull()
  })

  it('preserves unsent input on network errors, version conflicts and review-only responses', async () => {
    const client = fakeClient()
    const store = memoryDraftStore() as AssistantGuideDraftStore & { peek(key: string): AssistantGuideDraftPayload | undefined }
    const initial = deferred<AssistantGuideSession | null>()
    const answering = deferred<AssistantGuideSession>()
    client.nextCurrent.push(initial)
    client.nextAnswer.push(answering)
    const controller = createAssistantGuideController({ client, draftStore: store })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await controller.loadCurrent()
    controller.setCustomAnswer('不要丢')
    const key = buildAssistantGuideDraftKey({
      projectId: 'project-a',
      domain: 'outline',
      scopeKey: 'outline:project-a:chapter:chapter-1',
      sessionId: 'session-a',
      version: 1,
      questionId: 'question-1'
    })

    const answer = controller.answerCustom()
    answering.resolve(session({ id: 'session-a', version: 2, status: '需要复核', error: '需要作者复核。', confirmedAnswers: [] }))
    await answer

    expect(controller.getState().customAnswer).toBe('不要丢')
    expect(store.peek(key)?.text).toBe('不要丢')
  })

  it('recovers an unsent answer after refresh but does not overwrite newer typing with late cache reads', async () => {
    const client = fakeClient()
    const store = memoryDraftStore()
    const initial = deferred<AssistantGuideSession | null>()
    const draft = deferred<AssistantGuideDraftPayload | undefined>()
    client.nextCurrent.push(initial)
    const draftStore: AssistantGuideDraftStore = {
      ...store,
      load: () => draft.promise
    }
    const controller = createAssistantGuideController({ client, draftStore })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })
    const load = controller.loadCurrent()
    initial.resolve(session({ id: 'session-a', version: 1 }))
    await Promise.resolve()
    controller.setCustomAnswer('刷新后新输入')
    draft.resolve({ text: '缓存里的旧输入', editSequence: 1, savedAt: '2026-09-17T00:00:00.000Z' })
    await load

    expect(controller.getState().customAnswer).toBe('刷新后新输入')
  })

  it('shows a retry path for persisted in-progress or failed sessions instead of pretending to keep spinning', async () => {
    const client = fakeClient()
    const current = deferred<AssistantGuideSession | null>()
    client.nextCurrent.push(current)
    const controller = createAssistantGuideController({ client, draftStore: memoryDraftStore() })
    controller.setContext({ projectId: 'project-a', domain: 'outline', target: target('project-a') })

    const load = controller.loadCurrent()
    current.resolve(session({ id: 'session-a', status: '分析中', version: 3 }))
    await load

    expect(controller.getState().pendingAction).toBeNull()
    expect(controller.getState().retry.available).toBe(true)
    expect(controller.getState().retry.label).toContain('重试')
  })
})
