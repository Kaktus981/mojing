import { z } from 'zod'

export const ProviderConfigInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string().min(1).max(120),
  contextWindow: z.number().int().min(4_096).max(2_000_000),
  maxOutputTokens: z.number().int().min(256).max(200_000).optional(),
  outputTokenParameter: z.enum(['auto', 'max_completion_tokens', 'max_tokens']).optional(),
  supportsStreaming: z.boolean(),
  supportsJsonSchema: z.boolean(),
  inputPricePerMillion: z.number().min(0).optional(),
  outputPricePerMillion: z.number().min(0).optional(),
  currency: z.enum(['CNY', 'USD']).default('CNY'),
  showCost: z.boolean().default(true),
  singleCallWarning: z.number().min(0).optional()
})

export const ProviderConfigPublicSchema = ProviderConfigInputSchema.omit({ apiKey: true }).extend({
  id: z.string(),
  hasApiKey: z.boolean()
})

export const ProviderLongOutputTestInputSchema = ProviderConfigInputSchema.extend({
  testMode: z.enum(['非流式', '流式']).default('非流式'),
  targetOutputTokens: z.number().int().min(8_192).max(32_000).default(9_000)
})

export const ProviderOutputTestRecordSchema = z.object({
  id: z.string(),
  providerId: z.string().optional(),
  providerName: z.string(),
  model: z.string(),
  baseUrl: z.string().url(),
  contextWindow: z.number().int().positive(),
  outputTokenParameter: z.enum(['auto', 'max_completion_tokens', 'max_tokens']),
  supportsStreaming: z.boolean(),
  supportsJsonSchema: z.boolean(),
  testMode: z.enum(['非流式', '流式']),
  targetOutputTokens: z.number().int().positive(),
  outputTokens: z.number().int().nonnegative().optional(),
  finishReason: z.string().nullable().optional(),
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int().nonnegative().optional(),
  configDigest: z.string().length(64),
  testedAt: z.string(),
  expiresAt: z.string(),
  stale: z.boolean().default(false),
  staleReason: z.string().optional()
})

export const ProviderLongOutputTestResultSchema = z.object({
  ok: z.boolean(), message: z.string(), latencyMs: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), requestedOutputTokens: z.number().int().positive(),
  testMode: z.enum(['非流式', '流式']), finishReason: z.string().nullable().optional(),
  testRecordId: z.string().optional(), expiresAt: z.string().optional()
})

export const ProviderOutputCapabilitySchema = z.object({
  status: z.enum(['已验证', '未验证', '已过期', '未通过']),
  message: z.string(),
  sampleCount: z.number().int().nonnegative().default(0),
  successCount: z.number().int().nonnegative().default(0),
  successRate: z.number().min(0).max(100).default(0),
  averageOutputTokens: z.number().int().nonnegative().optional(),
  minOutputTokens: z.number().int().nonnegative().optional(),
  maxOutputTokens: z.number().int().nonnegative().optional(),
  latestOutputTokens: z.number().int().nonnegative().optional(),
  latestTargetOutputTokens: z.number().int().positive().optional(),
  latestTestMode: z.enum(['非流式', '流式']).optional(),
  latestTestedAt: z.string().optional(),
  validUntil: z.string().optional()
})

export const AiUsageRecordSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  episodeNumber: z.number().int().positive().optional(),
  providerId: z.string(),
  model: z.string(),
  operation: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative().optional(),
  currency: z.enum(['CNY', 'USD']),
  status: z.enum(['成功', '失败', '取消']),
  retryCount: z.number().int().nonnegative(),
  costKnown: z.boolean(),
  createdAt: z.string()
})

export type ProviderConfigInput = z.infer<typeof ProviderConfigInputSchema>
export type ProviderConfigPublic = z.infer<typeof ProviderConfigPublicSchema>
export type ProviderLongOutputTestInput = z.input<typeof ProviderLongOutputTestInputSchema>
export type ProviderOutputTestRecord = z.infer<typeof ProviderOutputTestRecordSchema>
export type ProviderLongOutputTestResult = z.infer<typeof ProviderLongOutputTestResultSchema>
export type ProviderOutputCapability = z.infer<typeof ProviderOutputCapabilitySchema>
export type AiUsageRecord = z.infer<typeof AiUsageRecordSchema>
