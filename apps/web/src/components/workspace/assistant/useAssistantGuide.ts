import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type {
  AnswerAssistantGuide,
  AssistantGuideDomain,
  AssistantGuideSession,
  AssistantTarget,
  StartAssistantGuide
} from '../../../../../../packages/contracts/src'
import { assistantGuideScopeKey } from '../../../../../../packages/contracts/src'
import { clearScopedDraft, clearScopedDraftIf, loadScopedDraft, saveScopedDraft } from '../draftCache'
import {
  FREE_CREATION_MODE,
  GUIDE_CREATION_MODE,
  assistantModePreferenceKey,
  createAssistantModePreferenceStore,
  type AssistantGuideUiMode
} from './assistantModePreference'

export type AssistantGuideContext = {
  projectId: string
  domain: AssistantGuideDomain
  target: AssistantTarget
  scopeKey?: string
}

type ResolvedContext = Required<AssistantGuideContext>

export type AssistantGuideDraftPayload = {
  text: string
  editSequence: number
  savedAt: string
}

export type AssistantGuideDraftStore = {
  load(key: string): Promise<AssistantGuideDraftPayload | undefined>
  save(key: string, payload: AssistantGuideDraftPayload, session: AssistantGuideSession): Promise<void>
  clear(key: string, expectedEditSequence?: number): Promise<void>
}

export type AssistantGuideStateClient = {
  current(projectId: string, domain: AssistantGuideDomain, scopeKey: string): Promise<AssistantGuideSession | null>
  start(projectId: string, input: StartAssistantGuide): Promise<AssistantGuideSession>
  answer(projectId: string, sessionId: string, input: AnswerAssistantGuide): Promise<AssistantGuideSession>
  reanalyze(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession>
  complete(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession>
  restart(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession>
}

type PendingAction = null | 'load' | 'start' | 'answer' | 'reanalyze' | 'complete' | 'restart'

type GuideError = {
  code: string
  message: string
  retryable: boolean
  status?: number
}

export type AssistantGuideState = {
  mode: AssistantGuideUiMode
  context: ResolvedContext | null
  session: AssistantGuideSession | null
  pendingAction: PendingAction
  error: GuideError | null
  customAnswer: string
  recoveredDraft: AssistantGuideDraftPayload | null
  retry: { available: boolean; label: string }
  currentLookupSettled: boolean
}

type RequestToken = {
  ordinal: number
  context: ResolvedContext
  sessionId?: string
  expectedVersion?: number
  questionId?: string
  editSequence?: number
}

type PreferenceStore = ReturnType<typeof createAssistantModePreferenceStore>
type AnswerInput =
  | { questionId: string; selectedOptionId: string }
  | { questionId: string; customText: string }
  | { questionId: string; skip: true }

const RETRYABLE_STATUSES = new Set<AssistantGuideSession['status']>(['分析中', '生成中', '失败', '需要复核'])
const missingClient: AssistantGuideStateClient = {
  current: async () => { throw new Error('assistant guide client is not configured') },
  start: async () => { throw new Error('assistant guide client is not configured') },
  answer: async () => { throw new Error('assistant guide client is not configured') },
  reanalyze: async () => { throw new Error('assistant guide client is not configured') },
  complete: async () => { throw new Error('assistant guide client is not configured') },
  restart: async () => { throw new Error('assistant guide client is not configured') }
}

export function buildAssistantGuideDraftKey(input: {
  projectId: string
  domain: AssistantGuideDomain
  scopeKey: string
  sessionId: string
  version: number
  questionId: string
}): string {
  return [
    'assistant-guide-answer',
    input.projectId,
    input.domain,
    input.scopeKey,
    input.sessionId,
    `v${input.version}`,
    input.questionId
  ].join(':')
}

function defaultDraftStore(): AssistantGuideDraftStore {
  return {
    async load(key) {
      const snapshot = await loadScopedDraft<AssistantGuideDraftPayload>(key)
      return snapshot?.payload
    },
    async save(key, payload, session) {
      await saveScopedDraft<AssistantGuideDraftPayload>({
        key,
        projectId: session.projectId,
        baseRevision: session.baseProjectRevision,
        savedAt: payload.savedAt,
        payload
      })
    },
    async clear(key, expectedEditSequence) {
      if (expectedEditSequence !== undefined) {
        await clearScopedDraftIf<AssistantGuideDraftPayload>(key, (payload) => payload.editSequence === expectedEditSequence)
        return
      }
      await clearScopedDraft(key)
    }
  }
}

function resolveContext(context: AssistantGuideContext): ResolvedContext {
  const scopeKey = context.scopeKey ?? assistantGuideScopeKey(context.domain, context.target)
  return { ...context, scopeKey }
}

function contextsEqual(a: ResolvedContext | null, b: ResolvedContext): boolean {
  return !!a && a.projectId === b.projectId && a.domain === b.domain && a.scopeKey === b.scopeKey
}

function sessionMatchesContext(session: AssistantGuideSession, context: ResolvedContext): boolean {
  return session.projectId === context.projectId && session.domain === context.domain && session.scopeKey === context.scopeKey
}

function guideError(error: unknown): GuideError {
  if (error && typeof error === 'object') {
    const item = error as { code?: unknown; message?: unknown; retryable?: unknown; status?: unknown }
    return {
      code: typeof item.code === 'string' ? item.code : 'REQUEST_FAILED',
      message: typeof item.message === 'string' ? item.message : '引导请求失败。',
      retryable: typeof item.retryable === 'boolean' ? item.retryable : true,
      status: typeof item.status === 'number' ? item.status : undefined
    }
  }
  return { code: 'REQUEST_FAILED', message: String(error || '引导请求失败。'), retryable: true }
}

function responseConfirmsAnswer(response: AssistantGuideSession, submitted: AnswerAssistantGuide): boolean {
  return response.confirmedAnswers.some((answer) => {
    if (answer.questionId !== submitted.questionId) return false
    if ('customText' in submitted) return 'customText' in answer && answer.customText === submitted.customText
    if ('selectedOptionId' in submitted) return 'selectedOptionId' in answer && answer.selectedOptionId === submitted.selectedOptionId
    return 'skip' in answer && answer.skip === true
  })
}

function retryState(session: AssistantGuideSession | null, pendingAction: PendingAction): AssistantGuideState['retry'] {
  if (!session || pendingAction) return { available: false, label: '' }
  if (!RETRYABLE_STATUSES.has(session.status)) return { available: false, label: '' }
  return { available: true, label: session.status === '生成中' ? '重试生成' : '重试分析' }
}

export function createAssistantGuideController(options: {
  client?: AssistantGuideStateClient
  draftStore?: AssistantGuideDraftStore
  preferenceStore?: PreferenceStore
} = {}) {
  const client = options.client ?? missingClient
  const draftStore = options.draftStore ?? defaultDraftStore()
  const preferenceStore = options.preferenceStore ?? createAssistantModePreferenceStore()
  const listeners = new Set<() => void>()
  const inFlight = new Map<string, Promise<void>>()
  let requestOrdinal = 0
  let editSequence = 0
  let state: AssistantGuideState = {
    mode: FREE_CREATION_MODE,
    context: null,
    session: null,
    pendingAction: null,
    error: null,
    customAnswer: '',
    recoveredDraft: null,
    retry: { available: false, label: '' },
    currentLookupSettled: false
  }

  function emit(): void {
    state = { ...state, retry: retryState(state.session, state.pendingAction) }
    for (const listener of listeners) listener()
  }

  function setState(patch: Partial<AssistantGuideState>): void {
    state = { ...state, ...patch }
    emit()
  }

  function begin(context: ResolvedContext, action: Exclude<PendingAction, null>, session?: AssistantGuideSession): RequestToken {
    const token: RequestToken = {
      ordinal: ++requestOrdinal,
      context,
      sessionId: session?.id,
      expectedVersion: session?.version,
      questionId: session?.turn?.question?.id
    }
    setState({ pendingAction: action, error: null })
    return token
  }

  function canCommit(token: RequestToken, response?: AssistantGuideSession, allowReplacement = false): boolean {
    if (token.ordinal !== requestOrdinal) return false
    if (!contextsEqual(state.context, token.context)) return false
    if (token.sessionId || token.expectedVersion) {
      const current = state.session
      if (!current || current.id !== token.sessionId || current.version !== token.expectedVersion) return false
    }
    if (!response) return true
    if (!sessionMatchesContext(response, token.context)) return false
    if (!allowReplacement && token.sessionId && response.id !== token.sessionId) return false
    return true
  }

  function finish(token: RequestToken, patch: Partial<AssistantGuideState>): void {
    if (token.ordinal !== requestOrdinal) return
    setState({ ...patch, pendingAction: null })
  }

  async function recoverDraft(session: AssistantGuideSession, token: RequestToken): Promise<void> {
    const questionId = session.turn?.question?.id
    if (!questionId) {
      if (canCommit(token, session)) setState({ customAnswer: '', recoveredDraft: null })
      return
    }
    const startedAtSequence = editSequence
    const key = buildAssistantGuideDraftKey({
      projectId: session.projectId,
      domain: session.domain,
      scopeKey: session.scopeKey,
      sessionId: session.id,
      version: session.version,
      questionId
    })
    const payload = await draftStore.load(key)
    if (!canCommit(token, session)) return
    if (!payload) {
      setState({ recoveredDraft: null })
      return
    }
    if (editSequence !== startedAtSequence || state.customAnswer.trim()) return
    setState({ customAnswer: payload.text, recoveredDraft: payload })
  }

  function operationKey(action: Exclude<PendingAction, null>, context: ResolvedContext, session?: AssistantGuideSession): string {
    return [
      action,
      context.projectId,
      context.domain,
      context.scopeKey,
      session?.id ?? '',
      session?.version ?? ''
    ].join('|')
  }

  async function runOnce(key: string, work: () => Promise<void>): Promise<void> {
    const existing = inFlight.get(key)
    if (existing) return existing
    const running = work().finally(() => { inFlight.delete(key) })
    inFlight.set(key, running)
    return running
  }

  function activeSession(): AssistantGuideSession | undefined {
    return state.session ?? undefined
  }

  function activeContext(): ResolvedContext | undefined {
    return state.context ?? undefined
  }

  async function commitSession(response: AssistantGuideSession, token: RequestToken, allowReplacement = false): Promise<boolean> {
    if (!canCommit(token, response, allowReplacement)) return false
    setState({ session: response, pendingAction: null, error: null })
    await recoverDraft(response, token)
    return true
  }

  function answerInput(input: AnswerInput): Promise<void> {
    const session = activeSession()
    const context = activeContext()
    if (!session || !context) return Promise.resolve()
    const submitted: AnswerAssistantGuide = 'customText' in input
      ? { expectedVersion: session.version, questionId: input.questionId, customText: input.customText }
      : 'selectedOptionId' in input
        ? { expectedVersion: session.version, questionId: input.questionId, selectedOptionId: input.selectedOptionId }
        : { expectedVersion: session.version, questionId: input.questionId, skip: true }
    const submittedText = 'customText' in submitted ? submitted.customText : ''
    const submittedSequence = editSequence
    const questionId = submitted.questionId
    const key = buildAssistantGuideDraftKey({
      projectId: session.projectId,
      domain: session.domain,
      scopeKey: session.scopeKey,
      sessionId: session.id,
      version: session.version,
      questionId
    })
    return runOnce(operationKey('answer', context, session), async () => {
      const token = begin(context, 'answer', session)
      token.editSequence = submittedSequence
      try {
        const response = await client.answer(context.projectId, session.id, submitted)
        if (!canCommit(token, response)) return
        const confirmed = responseConfirmsAnswer(response, submitted)
        setState({
          session: response,
          pendingAction: null,
          error: null,
          customAnswer: confirmed && editSequence === submittedSequence ? '' : state.customAnswer
        })
        if (confirmed && submittedText) await draftStore.clear(key, submittedSequence)
        if (confirmed) await recoverDraft(response, token)
      } catch (error) {
        finish(token, { error: guideError(error) })
      }
    })
  }

  const api = {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setContext(context: AssistantGuideContext) {
      const resolved = resolveContext(context)
      const key = assistantModePreferenceKey(resolved)
      if (contextsEqual(state.context, resolved)) {
        setState({ context: resolved, mode: preferenceStore.load(key) })
        return
      }
      requestOrdinal += 1
      setState({
        context: resolved,
        mode: preferenceStore.load(key),
        session: contextsEqual(state.context, resolved) ? state.session : null,
        pendingAction: null,
        error: null,
        customAnswer: '',
        recoveredDraft: null,
        currentLookupSettled: false
      })
    },
    setMode(mode: AssistantGuideUiMode) {
      const context = activeContext()
      if (context) preferenceStore.save(assistantModePreferenceKey(context), mode)
      setState({ mode })
    },
    loadCurrent(): Promise<void> {
      const context = activeContext()
      if (!context) return Promise.resolve()
      return (async () => {
        const token = begin(context, 'load')
        try {
          const response = await client.current(context.projectId, context.domain, context.scopeKey)
          if (response && !sessionMatchesContext(response, context)) return finish(token, { session: null })
          if (!canCommit(token, response ?? undefined, true)) return
          setState({ session: response, pendingAction: null, error: null, customAnswer: '', recoveredDraft: null, currentLookupSettled: true })
          if (response) await recoverDraft(response, token)
        } catch (error) {
          finish(token, { error: guideError(error), currentLookupSettled: true })
        }
      })()
    },
    start(): Promise<void> {
      const context = activeContext()
      if (!context) return Promise.resolve()
      return runOnce(operationKey('start', context), async () => {
        const token = begin(context, 'start')
        try {
          const response = await client.start(context.projectId, { domain: context.domain, target: context.target })
          await commitSession(response, token, true)
        } catch (error) {
          finish(token, { error: guideError(error) })
        }
      })
    },
    setCustomAnswer(text: string) {
      editSequence += 1
      setState({ customAnswer: text, recoveredDraft: null })
      const session = activeSession()
      const questionId = session?.turn?.question?.id
      if (!session || !questionId || !text.trim()) return
      const payload: AssistantGuideDraftPayload = { text, editSequence, savedAt: new Date().toISOString() }
      const key = buildAssistantGuideDraftKey({
        projectId: session.projectId,
        domain: session.domain,
        scopeKey: session.scopeKey,
        sessionId: session.id,
        version: session.version,
        questionId
      })
      void draftStore.save(key, payload, session)
    },
    answerCustom(): Promise<void> {
      const session = activeSession()
      const questionId = session?.turn?.question?.id
      const customText = state.customAnswer.trim()
      if (!questionId || !customText) return Promise.resolve()
      return answerInput({ questionId, customText })
    },
    answerOption(selectedOptionId: string): Promise<void> {
      const questionId = activeSession()?.turn?.question?.id
      if (!questionId) return Promise.resolve()
      return answerInput({ questionId, selectedOptionId })
    },
    skip(): Promise<void> {
      const questionId = activeSession()?.turn?.question?.id
      if (!questionId) return Promise.resolve()
      return answerInput({ questionId, skip: true })
    },
    reanalyze(): Promise<void> {
      const session = activeSession()
      const context = activeContext()
      if (!session || !context) return Promise.resolve()
      return runOnce(operationKey('reanalyze', context, session), async () => {
        const token = begin(context, 'reanalyze', session)
        try {
          const response = await client.reanalyze(context.projectId, session.id, session.version)
          await commitSession(response, token)
        } catch (error) {
          finish(token, { error: guideError(error) })
        }
      })
    },
    complete(): Promise<void> {
      const session = activeSession()
      const context = activeContext()
      if (!session || !context) return Promise.resolve()
      return runOnce(operationKey('complete', context, session), async () => {
        const token = begin(context, 'complete', session)
        try {
          const response = await client.complete(context.projectId, session.id, session.version)
          await commitSession(response, token)
        } catch (error) {
          finish(token, { error: guideError(error) })
        }
      })
    },
    restart(): Promise<void> {
      const session = activeSession()
      const context = activeContext()
      if (!session || !context) return Promise.resolve()
      return runOnce(operationKey('restart', context, session), async () => {
        const token = begin(context, 'restart', session)
        try {
          const response = await client.restart(context.projectId, session.id, session.version)
          await commitSession(response, token, true)
        } catch (error) {
          finish(token, { error: guideError(error) })
        }
      })
    },
    retry(): Promise<void> {
      const session = activeSession()
      if (!session) return Promise.resolve()
      return session.status === '生成中' ? api.complete() : api.reanalyze()
    }
  }
  return api
}

export type AssistantGuideController = ReturnType<typeof createAssistantGuideController>

export function driveAssistantGuideLifecycle(controller: AssistantGuideController): Promise<void> | undefined {
  const state = controller.getState()
  if (state.mode !== GUIDE_CREATION_MODE) return undefined
  if (state.session || state.pendingAction || state.currentLookupSettled) return undefined
  return controller.loadCurrent()
}

export function useAssistantGuide(context: AssistantGuideContext, client: AssistantGuideStateClient) {
  const controller = useMemo(() => createAssistantGuideController({ client }), [client])
  useEffect(() => { controller.setContext(context) }, [controller, context.projectId, context.domain, context.scopeKey, context.target])
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => {
    void driveAssistantGuideLifecycle(controller)
  }, [controller, state.mode, state.session, state.pendingAction, state.currentLookupSettled])
  return {
    ...state,
    selectMode: controller.setMode,
    loadCurrent: controller.loadCurrent,
    start: controller.start,
    setCustomAnswer: controller.setCustomAnswer,
    answerCustom: controller.answerCustom,
    answerOption: controller.answerOption,
    skip: controller.skip,
    reanalyze: controller.reanalyze,
    complete: controller.complete,
    restart: controller.restart,
    retry: controller.retry
  }
}

export { FREE_CREATION_MODE, GUIDE_CREATION_MODE }
