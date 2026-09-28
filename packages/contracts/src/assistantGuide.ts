import { z } from 'zod'
import { AssistantTargetSchema, assistantScopeKey, type AssistantTarget } from './assistantWorkflow'
import { CreativeAssistantSkillStageSchema } from './creativeSeats'
import { NovelExportFormatSchema } from './novelApi'

export type NovelExportFormat = z.infer<typeof NovelExportFormatSchema>

export type AssistantGuideDomain = 'outline' | 'world' | 'writing' | 'memory' | 'delivery'
export type AssistantGuideStatus = '分析中' | '提问中' | '需要复核' | '可生成' | '生成中' | '已生成' | '失败' | '已结束'
export type AssistantGuideResultKind =
  | 'assistant-draft'
  | 'world-setting-proposal'
  | 'revision-proposal'
  | 'generation-job'
  | 'chapter-analysis'
  | 'export-precheck'

export type AssistantGuideResultRef =
  | { kind: 'assistant-draft'; draftId: string }
  | { kind: 'world-setting-proposal'; proposalId: string }
  | { kind: 'revision-proposal'; proposalId: string }
  | { kind: 'generation-job'; jobId: string }
  | { kind: 'chapter-analysis'; taskId: string }
  | { kind: 'export-precheck'; projectRevision: number; format: NovelExportFormat }

export type AssistantGuideAnswer =
  | { questionId: string; selectedOptionId: string; selectedOptionLabel?: string }
  | { questionId: string; customText: string }
  | { questionId: string; skip: true }

export type AssistantGuideTurn = {
  analysisSummary: string
  strengths: Array<{ title: string; evidenceRefs: string[] }>
  gaps: Array<{ key: string; title: string; impact: string; evidenceRefs: string[] }>
  focus: string
  question: { id: string; text: string; whyNow: string; options: Array<{ id: string; label: string; reason: string }>; allowCustom: true; allowSkip: true } | null
  readyToComplete: boolean
}

export type AssistantGuideSession = {
  id: string
  projectId: string
  domain: AssistantGuideDomain
  scopeKey: string
  target: AssistantTarget
  baseProjectRevision: number
  contextDigest: string
  adapterVersion: number
  version: number
  status: AssistantGuideStatus
  turn: AssistantGuideTurn | null
  confirmedAnswers: AssistantGuideAnswer[]
  resultRef: AssistantGuideResultRef | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type StartAssistantGuide = { domain: AssistantGuideDomain; target: AssistantTarget }
export type AnswerAssistantGuide =
  | { expectedVersion: number; questionId: string; selectedOptionId: string }
  | { expectedVersion: number; questionId: string; customText: string }
  | { expectedVersion: number; questionId: string; skip: true }
export type CompleteAssistantGuide = { expectedVersion: number }

const IdSchema = z.string().trim().min(1).max(120)
const TextSchema = z.string().trim().min(1).max(4_000)
const EvidenceRefsSchema = z.array(z.string().trim().min(1).max(500)).min(1).max(20)
const AssistantGuideTargetSchema = z.any().superRefine((value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const target = value as Record<string, unknown>
  const allowed = new Set(['kind', 'projectId'])
  if (['volume', 'chapter', 'beat', 'storyline', 'world-entry'].includes(String(target.kind))) allowed.add('objectId')
  if (target.kind === 'beat') allowed.add('beatId')
  for (const key of Object.keys(target)) {
    if (!allowed.has(key)) context.addIssue({ code: z.ZodIssueCode.unrecognized_keys, keys: [key], path: [key] })
  }
}).pipe(AssistantTargetSchema) as z.ZodType<AssistantTarget>

export const AssistantGuideDomainSchema = CreativeAssistantSkillStageSchema.extract(['outline', 'world', 'writing', 'memory', 'delivery'])
export const AssistantGuideStatusSchema = z.enum(['分析中', '提问中', '需要复核', '可生成', '生成中', '已生成', '失败', '已结束'])
export const AssistantGuideResultKindSchema = z.enum(['assistant-draft', 'world-setting-proposal', 'revision-proposal', 'generation-job', 'chapter-analysis', 'export-precheck'])

export const AssistantGuideResultRefSchema: z.ZodType<AssistantGuideResultRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('assistant-draft'), draftId: IdSchema }).strict(),
  z.object({ kind: z.literal('world-setting-proposal'), proposalId: IdSchema }).strict(),
  z.object({ kind: z.literal('revision-proposal'), proposalId: IdSchema }).strict(),
  z.object({ kind: z.literal('generation-job'), jobId: IdSchema }).strict(),
  z.object({ kind: z.literal('chapter-analysis'), taskId: IdSchema }).strict(),
  z.object({ kind: z.literal('export-precheck'), projectRevision: z.number().int().nonnegative(), format: NovelExportFormatSchema }).strict()
])

export const AssistantGuideAnswerSchema: z.ZodType<AssistantGuideAnswer> = z.union([
  z.object({ questionId: IdSchema, selectedOptionId: IdSchema, selectedOptionLabel: TextSchema.max(200).optional() }).strict(),
  z.object({ questionId: IdSchema, customText: TextSchema }).strict(),
  z.object({ questionId: IdSchema, skip: z.literal(true) }).strict()
])

export const AssistantGuideTurnSchema: z.ZodType<AssistantGuideTurn> = z.object({
  analysisSummary: TextSchema.max(2_000),
  strengths: z.array(z.object({ title: TextSchema.max(200), evidenceRefs: EvidenceRefsSchema }).strict()).max(12),
  gaps: z.array(z.object({ key: IdSchema, title: TextSchema.max(200), impact: TextSchema.max(1_000), evidenceRefs: EvidenceRefsSchema }).strict()).max(12),
  focus: TextSchema.max(500),
  question: z.object({
    id: IdSchema, text: TextSchema.max(1_000), whyNow: TextSchema.max(1_000),
    options: z.array(z.object({ id: IdSchema, label: TextSchema.max(200), reason: TextSchema.max(500) }).strict()).min(3).max(5),
    allowCustom: z.literal(true), allowSkip: z.literal(true)
  }).strict().nullable(),
  readyToComplete: z.boolean()
}).strict()

export const AssistantGuideSessionSchema: z.ZodType<AssistantGuideSession> = z.object({
  id: IdSchema, projectId: IdSchema, domain: AssistantGuideDomainSchema, scopeKey: TextSchema.max(500), target: AssistantGuideTargetSchema,
  baseProjectRevision: z.number().int().nonnegative(), contextDigest: z.string().trim().min(1).max(128),
  adapterVersion: z.number().int().positive(), version: z.number().int().positive(), status: AssistantGuideStatusSchema,
  turn: AssistantGuideTurnSchema.nullable(), confirmedAnswers: z.array(AssistantGuideAnswerSchema).max(50),
  resultRef: AssistantGuideResultRefSchema.nullable(), error: z.string().trim().min(1).max(2_000).nullable(),
  createdAt: z.string().trim().min(1).max(64), updatedAt: z.string().trim().min(1).max(64)
}).strict()

export const StartAssistantGuideSchema: z.ZodType<StartAssistantGuide> = z.object({
  domain: AssistantGuideDomainSchema, target: AssistantGuideTargetSchema
}).strict()

export const AnswerAssistantGuideSchema: z.ZodType<AnswerAssistantGuide> = z.union([
  z.object({ expectedVersion: z.number().int().positive(), questionId: IdSchema, selectedOptionId: IdSchema }).strict(),
  z.object({ expectedVersion: z.number().int().positive(), questionId: IdSchema, customText: TextSchema }).strict(),
  z.object({ expectedVersion: z.number().int().positive(), questionId: IdSchema, skip: z.literal(true) }).strict()
])

export const CompleteAssistantGuideSchema: z.ZodType<CompleteAssistantGuide> = z.object({
  expectedVersion: z.number().int().positive()
}).strict()

export function assistantGuideScopeKey(domain: AssistantGuideDomain, target: AssistantTarget): string {
  return `${domain}:${target.projectId}:${assistantScopeKey(target)}`
}
