import { z } from 'zod'
import {
  AnswerAssistantGuideSchema,
  assistantGuideScopeKey,
  AssistantGuideResultKindSchema,
  AssistantGuideResultRefSchema,
  AssistantGuideTurnSchema,
  CompleteAssistantGuideSchema,
  StartAssistantGuideSchema,
  type AnswerAssistantGuide,
  type AssistantGuideAnswer,
  type AssistantGuideDomain,
  type AssistantGuideResultKind,
  type AssistantGuideResultRef,
  type AssistantGuideSession,
  type AssistantGuideTurn,
  type AssistantTarget,
  type CompleteAssistantGuide,
  type CreativeAssistantSkillStage,
  type NovelProject,
  type StartAssistantGuide
} from '../../contracts/src'
import type { StructuredGenerationRequest } from './ai/provider'
import { assistantGuideContextDigest, getCurrentAssistantGuide, markAssistantGuideForReview, restartAssistantGuideSession, saveAssistantGuideAnswer, startAssistantGuideSession } from './assistantGuide'
import { resolveEffectiveRunConfig } from './assistantWorkflow'
import { AssistantGuideVersionConflictError, NovelDatabaseService } from './novelDatabase'

const GuideCompletionSchema = z.object({
  turn: AssistantGuideTurnSchema,
  resultKind: AssistantGuideResultKindSchema,
  payload: z.unknown()
}).strict()

type GuideCompletion = z.infer<typeof GuideCompletionSchema>

const DOMAIN_STAGE: Record<AssistantGuideDomain, CreativeAssistantSkillStage> = {
  outline: 'outline',
  world: 'world',
  writing: 'writing',
  memory: 'memory',
  delivery: 'delivery'
}

const SYSTEM = `你是“墨境”的逐题创作引导助手。
只能依据服务端提供的当前项目与精确目标上下文。
只返回契约字段，不返回隐藏推理过程，不把未确认的建议写成作者事实。
每轮最多一个问题；引用只能从服务端允许的 evidenceRefs 中选择。
不得输出项目 ID、目标路径、对象归属或会话版本的替代值。`

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export interface AssistantGuideStructuredRunner {
  generate<T>(request: StructuredGenerationRequest<T>): Promise<T>
}

export type AssistantGuideAdapterContext = {
  context: unknown
  allowedEvidenceRefs: readonly string[]
  completionContract?: unknown
  allowedResultKinds?: readonly AssistantGuideResultKind[]
}

export interface AssistantGuideAdapter {
  readonly version: number
  readonly resultKinds: readonly AssistantGuideResultKind[]
  readContext(project: NovelProject, target: AssistantTarget): AssistantGuideAdapterContext
  complete(input: {
    project: NovelProject
    target: AssistantTarget
    session: AssistantGuideSession
    context: unknown
    resultKind: AssistantGuideResultKind
    payload: unknown
  }): AssistantGuideResultRef
}

export interface AssistantGuideAdapterRegistry {
  get(domain: AssistantGuideDomain): AssistantGuideAdapter | undefined
}

type PreparedGuide = {
  project: NovelProject
  adapter: AssistantGuideAdapter
  adapterContext: AssistantGuideAdapterContext
  contextDigest: string
  providerId: string
  skillPrompt: string
  markLoaded?: () => void
}

function statusForTurn(turn: AssistantGuideTurn): AssistantGuideSession['status'] {
  return turn.readyToComplete ? '可生成' : '提问中'
}

function validateTurn(raw: unknown, allowedEvidenceRefs: readonly string[]): AssistantGuideTurn {
  const turn = AssistantGuideTurnSchema.parse(raw)
  if (turn.readyToComplete !== (turn.question === null)) {
    throw fail('ASSISTANT_GUIDE_TURN_INVALID', '引导准备状态与当前问题不一致。')
  }
  const allowed = new Set(allowedEvidenceRefs)
  for (const ref of [...turn.strengths, ...turn.gaps].flatMap((item) => item.evidenceRefs)) {
    if (!allowed.has(ref)) {
      throw fail('ASSISTANT_GUIDE_EVIDENCE_INVALID', `模型返回了当前上下文之外的证据引用：${ref}`)
    }
  }
  return turn
}

function confirmedAnswer(session: AssistantGuideSession, input: AnswerAssistantGuide): AssistantGuideAnswer {
  const question = session.turn?.question
  if (!question || question.id !== input.questionId) {
    throw fail('ASSISTANT_GUIDE_QUESTION_MISMATCH', '提交的回答不属于当前问题。')
  }
  if ('selectedOptionId' in input) {
    const selected = question.options.find((option) => option.id === input.selectedOptionId)
    if (!selected) throw fail('ASSISTANT_GUIDE_OPTION_INVALID', '提交的选项不属于当前问题。')
    return { questionId: input.questionId, selectedOptionId: input.selectedOptionId, selectedOptionLabel: selected.label }
  }
  if ('customText' in input) return { questionId: input.questionId, customText: input.customText }
  return { questionId: input.questionId, skip: true }
}

export class AssistantGuideService {
  constructor(
    private readonly database: NovelDatabaseService,
    private readonly runner: AssistantGuideStructuredRunner,
    private readonly adapters: AssistantGuideAdapterRegistry
  ) {}

  async start(projectId: string, raw: StartAssistantGuide): Promise<AssistantGuideSession> {
    const input = StartAssistantGuideSchema.parse(raw)
    if (input.target.projectId !== projectId) throw fail('ASSISTANT_GUIDE_PROJECT_MISMATCH', '引导目标不属于当前项目。')
    const existing = getCurrentAssistantGuide(
      this.database,
      projectId,
      input.domain,
      assistantGuideScopeKey(input.domain, input.target)
    )
    if (existing && (existing.status !== '分析中' || existing.turn !== null)) return existing
    const prepared = this.prepare(projectId, input.domain, input.target)
    const initial = startAssistantGuideSession({
      database: this.database,
      project: prepared.project,
      domain: input.domain,
      target: input.target,
      contextDigest: prepared.contextDigest,
      adapterVersion: prepared.adapter.version
    })
    const turn = await this.generateTurn('start', prepared, initial, initial.confirmedAnswers)
    return this.database.saveAssistantGuideSession({
      ...initial,
      version: initial.version + 1,
      status: statusForTurn(turn),
      turn,
      error: null,
      updatedAt: new Date().toISOString()
    }, initial.version)
  }

  async answer(projectId: string, sessionId: string, raw: AnswerAssistantGuide): Promise<AssistantGuideSession> {
    const input = AnswerAssistantGuideSchema.parse(raw)
    const current = this.current(projectId, sessionId, input.expectedVersion)
    const answer = confirmedAnswer(current, input)
    const prepared = this.prepare(projectId, current.domain, current.target)
    const review = this.reviewIfContextChanged(current, input.expectedVersion, prepared)
    if (review) return review
    const confirmedAnswers = [...current.confirmedAnswers, answer]
    const turn = await this.generateTurn('answer', prepared, current, confirmedAnswers)
    return saveAssistantGuideAnswer({
      database: this.database,
      project: prepared.project,
      sessionId,
      expectedVersion: input.expectedVersion,
      answer,
      nextTurn: turn,
      contextDigest: prepared.contextDigest
    })
  }

  async reanalyze(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession> {
    const current = this.current(projectId, sessionId, expectedVersion)
    const prepared = this.prepare(projectId, current.domain, current.target)
    const turn = await this.generateTurn('reanalyze', prepared, current, current.confirmedAnswers)
    return this.database.saveAssistantGuideSession({
      ...current,
      baseProjectRevision: prepared.project.revision,
      contextDigest: prepared.contextDigest,
      adapterVersion: prepared.adapter.version,
      version: current.version + 1,
      status: statusForTurn(turn),
      turn,
      error: null,
      updatedAt: new Date().toISOString()
    }, expectedVersion)
  }

  async complete(projectId: string, sessionId: string, raw: CompleteAssistantGuide): Promise<AssistantGuideSession> {
    const input = CompleteAssistantGuideSchema.parse(raw)
    const current = this.current(projectId, sessionId, input.expectedVersion)
    if (!current.turn?.readyToComplete) {
      throw fail('ASSISTANT_GUIDE_NOT_READY', '当前引导信息还不足以生成结果。')
    }
    const prepared = this.prepare(projectId, current.domain, current.target)
    const review = this.reviewIfContextChanged(current, input.expectedVersion, prepared)
    if (review) return review
    const completion = await this.generateCompletion(prepared, current)
    const preparedResultKinds = this.allowedResultKinds(prepared.adapter, prepared.adapterContext)
    if (!preparedResultKinds.includes(completion.resultKind)) {
      throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', `当前引导范围不允许生成 ${completion.resultKind} 结果。`)
    }
    return this.database.completeAssistantGuideSession(projectId, sessionId, input.expectedVersion, ({ session, project }) => {
      const adapter = this.adapters.get(session.domain)
      if (!adapter) throw fail('ASSISTANT_GUIDE_ADAPTER_NOT_CONFIGURED', `当前栏目还没有配置引导适配器：${session.domain}`)
      const adapterContext = adapter.readContext(project, session.target)
      const contextDigest = assistantGuideContextDigest(adapterContext.context)
      if (session.contextDigest !== contextDigest || session.adapterVersion !== adapter.version) {
        return {
          ...session,
          version: session.version + 1,
          status: '需要复核',
          error: '项目内容或引导规则已变化，请重新分析后继续。',
          updatedAt: new Date().toISOString()
        }
      }
      const turn = validateTurn(completion.turn, adapterContext.allowedEvidenceRefs)
      const resultKinds = this.allowedResultKinds(adapter, adapterContext)
      if (!resultKinds.includes(completion.resultKind)) {
        throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', `当前引导范围不允许生成 ${completion.resultKind} 结果。`)
      }
      const resultRef = AssistantGuideResultRefSchema.parse(adapter.complete({
        project,
        target: session.target,
        session,
        context: adapterContext.context,
        resultKind: completion.resultKind,
        payload: completion.payload
      }))
      if (resultRef.kind !== completion.resultKind) {
        throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '适配器返回的结果类型与已校验请求不一致。')
      }
      return {
        ...session,
        version: session.version + 1,
        status: '已生成',
        turn,
        resultRef,
        error: null,
        updatedAt: new Date().toISOString()
      }
    })
  }

  async restart(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession> {
    const current = this.current(projectId, sessionId, expectedVersion)
    const prepared = this.prepare(projectId, current.domain, current.target)
    const replacement = restartAssistantGuideSession({
      database: this.database,
      project: prepared.project,
      sessionId,
      expectedVersion,
      contextDigest: prepared.contextDigest,
      adapterVersion: prepared.adapter.version
    })
    const turn = await this.generateTurn('start', prepared, replacement, replacement.confirmedAnswers)
    return this.database.saveAssistantGuideSession({
      ...replacement,
      version: replacement.version + 1,
      status: statusForTurn(turn),
      turn,
      error: null,
      updatedAt: new Date().toISOString()
    }, replacement.version)
  }

  private prepare(projectId: string, domain: AssistantGuideDomain, target: AssistantTarget): PreparedGuide {
    const project = this.database.getProject(projectId)
    const adapter = this.adapters.get(domain)
    if (!adapter) throw fail('ASSISTANT_GUIDE_ADAPTER_NOT_CONFIGURED', `当前栏目还没有配置引导适配器：${domain}`)
    const run = resolveEffectiveRunConfig({
      database: this.database,
      project,
      stage: DOMAIN_STAGE[domain],
      taskType: '引导构建'
    })
    if (run.effective.unavailable) {
      throw fail(run.effective.unavailable.code, run.effective.unavailable.message)
    }
    const adapterContext = adapter.readContext(project, target)
    return {
      project,
      adapter,
      adapterContext,
      contextDigest: assistantGuideContextDigest(adapterContext.context),
      providerId: run.effective.providerId,
      skillPrompt: run.skillPrompt,
      markLoaded: run.markLoaded
    }
  }

  private current(projectId: string, sessionId: string, expectedVersion: number): AssistantGuideSession {
    const current = this.database.getAssistantGuideSession(projectId, sessionId)
    if (!current) throw fail('ASSISTANT_GUIDE_NOT_FOUND', '找不到该引导会话。')
    if (current.version !== expectedVersion) {
      throw new AssistantGuideVersionConflictError(expectedVersion, current.version)
    }
    return current
  }

  private reviewIfContextChanged(current: AssistantGuideSession, expectedVersion: number, prepared: PreparedGuide): AssistantGuideSession | undefined {
    if (current.contextDigest === prepared.contextDigest && current.adapterVersion === prepared.adapter.version) return undefined
    return markAssistantGuideForReview({
      database: this.database,
      projectId: current.projectId,
      sessionId: current.id,
      expectedVersion,
      message: '项目内容或引导规则已变化，请重新分析后继续。'
    })
  }

  private async generateTurn(
    action: 'start' | 'answer' | 'reanalyze',
    prepared: PreparedGuide,
    session: AssistantGuideSession,
    confirmedAnswers: AssistantGuideAnswer[]
  ): Promise<AssistantGuideTurn> {
    const raw = await this.runner.generate({
      system: this.systemPrompt(prepared),
      user: JSON.stringify({
        action,
        target: session.target,
        projectRevision: prepared.project.revision,
        context: prepared.adapterContext.context,
        previousTurn: session.turn,
        confirmedAnswers
      }),
      schema: AssistantGuideTurnSchema,
      schemaName: 'mojing_assistant_guide_turn',
      temperature: 0.35,
      maxOutputTokens: 2_500,
      providerId: prepared.providerId,
      singleAttempt: true,
      usageContext: { projectId: prepared.project.id, operation: `项目引导·${action}` }
    })
    const turn = validateTurn(raw, prepared.adapterContext.allowedEvidenceRefs)
    prepared.markLoaded?.()
    return turn
  }

  private async generateCompletion(prepared: PreparedGuide, session: AssistantGuideSession): Promise<GuideCompletion> {
    const raw = GuideCompletionSchema.parse(await this.runner.generate({
      system: this.systemPrompt(prepared),
      user: JSON.stringify({
        action: 'complete',
        target: session.target,
        projectRevision: prepared.project.revision,
        context: prepared.adapterContext.context,
        previousTurn: session.turn,
        confirmedAnswers: session.confirmedAnswers,
        allowedResultKinds: this.allowedResultKinds(prepared.adapter, prepared.adapterContext),
        completionContract: prepared.adapterContext.completionContract
      }),
      schema: GuideCompletionSchema,
      schemaName: 'mojing_assistant_guide_completion',
      temperature: 0.3,
      maxOutputTokens: 4_000,
      providerId: prepared.providerId,
      singleAttempt: true,
      usageContext: { projectId: prepared.project.id, operation: '项目引导·生成候选结果' }
    }))
    const turn = validateTurn(raw.turn, prepared.adapterContext.allowedEvidenceRefs)
    prepared.markLoaded?.()
    return { ...raw, turn }
  }

  private systemPrompt(prepared: PreparedGuide): string {
    const refs = prepared.adapterContext.allowedEvidenceRefs.join('\n')
    return `${SYSTEM}\n允许的 evidenceRefs：\n${refs}${prepared.skillPrompt ? `\n\n本次已装载的受限创作能力：\n${prepared.skillPrompt}` : ''}`
  }

  private allowedResultKinds(adapter: AssistantGuideAdapter, context: AssistantGuideAdapterContext): readonly AssistantGuideResultKind[] {
    return context.allowedResultKinds ?? adapter.resultKinds
  }
}
