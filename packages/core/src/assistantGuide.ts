import { createHash, randomUUID } from 'node:crypto'
import {
  assistantGuideScopeKey,
  type AssistantGuideAnswer,
  type AssistantGuideDomain,
  type AssistantGuideSession,
  type AssistantGuideTurn,
  type AssistantTarget,
  type GuideSession,
  type NovelProject
} from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)]))
}

/** 为实际发送给适配器的上下文生成稳定 SHA-256 指纹。 */
export function assistantGuideContextDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)) ?? String(value)).digest('hex')
}

function assertTargetProject(project: NovelProject, target: AssistantTarget): void {
  if (target.projectId !== project.id) {
    throw fail('ASSISTANT_GUIDE_PROJECT_MISMATCH', '引导目标不属于当前项目。')
  }
}

function newSession(input: {
  project: NovelProject
  domain: AssistantGuideDomain
  target: AssistantTarget
  contextDigest: string
  adapterVersion: number
}): AssistantGuideSession {
  assertTargetProject(input.project, input.target)
  const timestamp = new Date().toISOString()
  return {
    id: randomUUID(),
    projectId: input.project.id,
    domain: input.domain,
    scopeKey: assistantGuideScopeKey(input.domain, input.target),
    target: input.target,
    baseProjectRevision: input.project.revision,
    contextDigest: input.contextDigest,
    adapterVersion: input.adapterVersion,
    version: 1,
    status: '分析中',
    turn: null,
    confirmedAnswers: [],
    resultRef: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function legacyAnswers(session: GuideSession): AssistantGuideAnswer[] {
  return session.answers.map((answer) => {
    const questionId = `legacy-${answer.slot}`
    return answer.state === '已回答' && answer.value.trim()
      ? { questionId, customText: answer.value.trim() }
      : { questionId, skip: true }
  })
}

function importLegacyOutlineSession(
  database: NovelDatabaseService,
  project: NovelProject,
  legacy: GuideSession,
  scopeKey: string
): AssistantGuideSession {
  const imported: AssistantGuideSession = {
    id: randomUUID(),
    projectId: project.id,
    domain: 'outline',
    scopeKey,
    target: { kind: 'story-core', projectId: project.id },
    baseProjectRevision: project.revision,
    contextDigest: assistantGuideContextDigest({ legacySessionId: legacy.id, answers: legacy.answers }),
    adapterVersion: 1,
    version: 1,
    status: '提问中',
    turn: null,
    confirmedAnswers: legacyAnswers(legacy),
    resultRef: null,
    error: null,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt
  }
  try {
    return database.saveAssistantGuideSession(imported)
  } catch (error) {
    const current = database.getCurrentAssistantGuideSession(project.id, 'outline', scopeKey)
    if (current) return current
    throw error
  }
}

export function getCurrentAssistantGuide(
  database: NovelDatabaseService,
  projectId: string,
  domain: AssistantGuideDomain,
  scopeKey: string
): AssistantGuideSession | undefined {
  const current = database.getCurrentAssistantGuideSession(projectId, domain, scopeKey)
  if (current) return current
  const legacyScope = assistantGuideScopeKey('outline', { kind: 'story-core', projectId })
  if (domain !== 'outline' || scopeKey !== legacyScope) return undefined
  const legacy = database.getGuideSession(projectId)
  if (!legacy) return undefined
  return importLegacyOutlineSession(database, database.getProject(projectId), legacy, scopeKey)
}

export function startAssistantGuideSession(input: {
  database: NovelDatabaseService
  project: NovelProject
  domain: AssistantGuideDomain
  target: AssistantTarget
  contextDigest: string
  adapterVersion: number
}): AssistantGuideSession {
  assertTargetProject(input.project, input.target)
  const scopeKey = assistantGuideScopeKey(input.domain, input.target)
  const current = getCurrentAssistantGuide(input.database, input.project.id, input.domain, scopeKey)
  if (current) return current
  return input.database.saveAssistantGuideSession(newSession(input))
}

export function saveAssistantGuideAnswer(input: {
  database: NovelDatabaseService
  project: NovelProject
  sessionId: string
  expectedVersion: number
  answer: AssistantGuideAnswer
  nextTurn: AssistantGuideTurn
  contextDigest: string
}): AssistantGuideSession {
  const current = input.database.getAssistantGuideSession(input.project.id, input.sessionId)
  if (!current) throw fail('ASSISTANT_GUIDE_NOT_FOUND', '找不到该引导会话。')
  const timestamp = new Date().toISOString()
  return input.database.saveAssistantGuideSession({
    ...current,
    baseProjectRevision: input.project.revision,
    contextDigest: input.contextDigest,
    version: current.version + 1,
    status: input.nextTurn.readyToComplete ? '可生成' : '提问中',
    turn: input.nextTurn,
    confirmedAnswers: [...current.confirmedAnswers, input.answer],
    error: null,
    updatedAt: timestamp
  }, input.expectedVersion)
}

export function markAssistantGuideForReview(input: {
  database: NovelDatabaseService
  projectId: string
  sessionId: string
  expectedVersion: number
  message: string
}): AssistantGuideSession {
  const current = input.database.getAssistantGuideSession(input.projectId, input.sessionId)
  if (!current) throw fail('ASSISTANT_GUIDE_NOT_FOUND', '找不到该引导会话。')
  return input.database.saveAssistantGuideSession({
    ...current,
    version: current.version + 1,
    status: '需要复核',
    error: input.message,
    updatedAt: new Date().toISOString()
  }, input.expectedVersion)
}

export function restartAssistantGuideSession(input: {
  database: NovelDatabaseService
  project: NovelProject
  sessionId: string
  expectedVersion: number
  contextDigest: string
  adapterVersion: number
}): AssistantGuideSession {
  const current = input.database.getAssistantGuideSession(input.project.id, input.sessionId)
  if (!current) throw fail('ASSISTANT_GUIDE_NOT_FOUND', '找不到该引导会话。')
  assertTargetProject(input.project, current.target)
  const replacement = newSession({
    project: input.project,
    domain: current.domain,
    target: current.target,
    contextDigest: input.contextDigest,
    adapterVersion: input.adapterVersion
  })
  return input.database.restartAssistantGuideSession(
    input.project.id,
    input.sessionId,
    input.expectedVersion,
    replacement
  )
}
