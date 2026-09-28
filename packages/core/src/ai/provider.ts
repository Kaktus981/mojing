import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ProviderConfigInput, ProviderConfigPublic, ProviderLongOutputTestInput, ProviderLongOutputTestResult, ProviderOutputCapability, ProviderOutputTestRecord } from '../../../contracts/src/provider'
import { ProviderConfigInputSchema, ProviderLongOutputTestInputSchema } from '../../../contracts/src/provider'
import type { SecretStore } from '../secrets'

export interface ProviderRepository {
  listProviders(): ProviderConfigPublic[]
  getProvider(id?: string): ProviderConfigPublic | undefined
  saveProvider(input: ProviderConfigInput & { id?: string; hasApiKey: boolean }): ProviderConfigPublic
  insertUsage(input: {
    projectId?: string; episodeNumber?: number; providerId: string; model: string; operation: string;
    inputTokens: number; outputTokens: number; estimatedCost?: number; currency: 'CNY' | 'USD';
    status: '成功' | '失败' | '取消'; retryCount: number; costKnown: boolean
  }): unknown
  /** 能力测试历史是附加能力；旧的测试仓库没有实现时仍可正常测试模型。 */
  insertProviderOutputTest?(input: Omit<ProviderOutputTestRecord, 'id' | 'stale' | 'staleReason'> & { id?: string }): ProviderOutputTestRecord
  listProviderOutputTests?(providerId?: string, limit?: number): ProviderOutputTestRecord[]
}

export interface StructuredGenerationRequest<T> {
  system: string
  user: string
  schema: z.ZodType<T>
  schemaName: string
  temperature?: number
  /**
   * 本次调用期望的最大输出 Token。省略时按模型上下文和任务类型计算一个
   * 保守的默认值；它只限制单次模型输出，不会改变上下文召回预算。
   */
  maxOutputTokens?: number
  /**
   * 输出上限参数的兼容策略。默认先尝试新版 max_completion_tokens，
   * 遇到兼容网关明确拒绝时自动回退到旧版 max_tokens。
   */
  outputTokenParameter?: 'auto' | 'max_completion_tokens' | 'max_tokens'
  /** 指定本次职责席位使用的模型配置；省略时沿用最近使用的默认配置。 */
  providerId?: string
  signal?: AbortSignal
  /** 对需要严格一次请求语义的调用禁用传输重试、协议降级和 JSON 修复二次请求。 */
  singleAttempt?: boolean
  usageContext?: {
    projectId?: string
    episodeNumber?: number
    operation: string
  }
}

interface CompletionResult {
  content: string
  inputTokens?: number
  outputTokens?: number
  retryCount: number
  finishReason?: string | null
  streamEnded: boolean
}

const MODEL_REQUEST_TIMEOUT_MS = 15 * 60 * 1000
export const DEFAULT_MODEL_OUTPUT_TOKENS = 16_000
const OUTPUT_TOKEN_SAFETY_MARGIN = 1_024
export const PROVIDER_OUTPUT_TEST_VALIDITY_DAYS = 30

export type ProviderFailureKind = 'length' | 'context' | 'stream' | 'timeout' | 'schema' | 'authentication' | 'rate_limit' | 'network' | 'unknown'

/**
 * 请求在发送到模型前已经超出上下文预算。
 *
 * 这类错误必须在本地尽早抛出：把请求发给网关后才由网关拒绝，通常只会
 * 显示一个含糊的“约 8000 Token 失败”，也无法告诉作者应当裁剪哪一层内容。
 */
export class ProviderContextLimitError extends Error {
  readonly code = 'MODEL_CONTEXT_OVERFLOW' as const
  readonly providerFailureKind = 'context' as const
  readonly inputTokens: number
  readonly requestedOutputTokens: number
  readonly contextWindow: number
  readonly safetyMargin: number

  constructor(inputTokens: number, requestedOutputTokens: number, contextWindow: number, safetyMargin = OUTPUT_TOKEN_SAFETY_MARGIN) {
    super(`模型上下文预算不足：输入约 ${inputTokens.toLocaleString()} Token，预留输出 ${requestedOutputTokens.toLocaleString()} Token 和安全余量 ${safetyMargin.toLocaleString()} Token，但模型上下文窗口只有 ${contextWindow.toLocaleString()} Token。请缩小本次生成范围、减少召回内容，或更换上下文窗口更大的模型。`)
    this.name = 'ProviderContextLimitError'
    this.inputTokens = inputTokens
    this.requestedOutputTokens = requestedOutputTokens
    this.contextWindow = contextWindow
    this.safetyMargin = safetyMargin
  }
}

export function isOutputTokenParameterCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:max_completion_tokens|max_tokens).*(?:unsupported|not supported|unknown|invalid|unrecognized|not allowed)|(?:unknown|unsupported|invalid)\s+parameter.*(?:max_completion_tokens|max_tokens)|does not support.*(?:max_completion_tokens|max_tokens)/i.test(message)
}

export function isStreamOptionsCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:stream_options|include_usage).*(?:unsupported|not supported|unknown|invalid|unrecognized|not allowed)|(?:unknown|unsupported|invalid)\s+parameter.*(?:stream_options|include_usage)/i.test(message)
}

export function isLengthFinishReason(reason: unknown): boolean {
  return reason === 'length' || reason === 'max_output_tokens' || reason === 'max_completion_tokens'
}

export function classifyProviderError(error: unknown): ProviderFailureKind {
  const tagged = error && typeof error === 'object' && 'providerFailureKind' in error
    ? (error as { providerFailureKind?: ProviderFailureKind }).providerFailureKind
    : undefined
  if (tagged) return tagged
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'schema'
  const message = error instanceof Error ? error.message : String(error)
  if (isLengthFinishReason(message) || /maximum output|output limit|output token limit|finish[_ ]reason\s*[=:]\s*length|incomplete.*max_(?:output|completion)_tokens/i.test(message)) return 'length'
  if (/timeout|timed\s*out|etimedout/i.test(message)) return 'timeout'
  if (/401|api.?key|unauthorized|forbidden|permission/i.test(message)) return 'authentication'
  if (/429|rate.?limit|quota|insufficient.*(?:quota|credit)/i.test(message)) return 'rate_limit'
  if (/unexpected\s*eof|bad\s*gateway|upstream|econnreset|socket|terminated|connection\s*closed|stream/i.test(message)) return 'stream'
  if (/fetch|network|connect|ENOTFOUND|ECONN/i.test(message)) return 'network'
  if (/invalid\s+(?:json|response)|json\s+(?:parse|parsing)|schema\s+validation|malformed\s+json/i.test(message)) return 'schema'
  return 'unknown'
}

class ProviderOutputLimitError extends Error {
  readonly providerFailureKind = 'length' as const
  readonly limit?: number
  constructor(reason?: string | null, limit?: number) {
    const detail = limit ? `${limit.toLocaleString()} Token${reason ? `，${reason}` : ''}` : (reason ?? '')
    super(`模型输出达到本次上限${detail ? `（${detail}）` : ''}。`)
    this.name = 'ProviderOutputLimitError'
    this.limit = limit
  }
}

function withProviderFailureKind(error: unknown, kind: ProviderFailureKind): Error {
  const source = error instanceof Error ? error : new Error(String(error))
  const wrapped = new Error(source.message)
  wrapped.name = source.name
  ;(wrapped as Error & { providerFailureKind?: ProviderFailureKind }).providerFailureKind = kind
  return wrapped
}

export function isStrictSchemaCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /invalid_json_schema|invalid schema for response_format|text\.format\.schema|optional\(\).*nullable|all-fields-must-be-required|additionalProperties.*false|schema.*not supported/i.test(message)
}

export function isResponseFormatCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /response_format.*(?:unsupported|not supported|unknown|invalid)|unknown parameter.*response_format|json_object.*not supported/i.test(message)
}

/**
 * Some OpenAI-compatible gateways reuse their strict-schema error message when
 * rejecting json_object as well. Once strict mode has already failed, either
 * family of compatibility errors means we should retry without response_format.
 */
export function shouldFallbackToPlainJson(error: unknown): boolean {
  return isResponseFormatCompatibilityError(error) || isStrictSchemaCompatibilityError(error)
}

export function isTransientProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /502|503|504|unexpected\s*eof|bad\s*gateway|upstream|econnreset|connection\s*reset|etimedout|timeout|timed\s*out|socket|terminated|fetch\s*failed|connection\s*closed|stream\s*(?:reset|interrupted|aborted)/i.test(message)
}

export function isLikelyEphemeralLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    const port = Number(url.port)
    return local && Number.isInteger(port) && port >= 49_152
  } catch {
    return false
  }
}

export function isLoopbackModelBaseUrl(baseUrl: string): boolean {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(baseUrl).hostname) } catch { return false }
}

/** 历史快照只保留服务地址，不把 URL 中可能存在的凭据或查询密钥写入数据库。 */
export function sanitizeProviderBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl.replace(/[?#].*$/, '').replace(/\/$/, '')
  }
}

/**
 * 用于判断能力测试是否仍对应当前模型配置；刻意排除 API Key，避免密钥进入
 * 历史记录或摘要。只要影响输出协议的配置发生变化，旧记录就会显示为待重测。
 */
export function providerConfigDigest(input: Pick<ProviderConfigInput, 'name' | 'baseUrl' | 'model' | 'contextWindow' | 'maxOutputTokens' | 'outputTokenParameter' | 'supportsStreaming' | 'supportsJsonSchema'>): string {
  const normalized = {
    name: input.name.trim(), baseUrl: sanitizeProviderBaseUrl(input.baseUrl), model: input.model.trim(),
    contextWindow: input.contextWindow, maxOutputTokens: input.maxOutputTokens ?? null,
    outputTokenParameter: input.outputTokenParameter ?? 'auto', supportsStreaming: input.supportsStreaming,
    supportsJsonSchema: input.supportsJsonSchema
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

/**
 * 从同一配置的历史快照计算稳定性概况。只有未过期且配置摘要一致的记录
 * 才能参与统计，避免旧模型或旧协议的结果污染当前预算提示。
 */
export function assessProviderOutputCapability(records: ProviderOutputTestRecord[], provider: ProviderConfigPublic, now = Date.now()): ProviderOutputCapability {
  const matching = records
    .filter((record) => record.providerId === provider.id && record.configDigest === providerConfigDigest(provider))
    .sort((left, right) => Date.parse(right.testedAt) - Date.parse(left.testedAt))
  const current = matching.filter((record) => Date.parse(record.expiresAt) > now)
  const successful = current.filter((record) => record.ok && record.outputTokens !== undefined)
  const latest = current[0]
  if (!matching.length) return { status: '未验证', message: '当前模型还没有对应配置的长输出实测。', sampleCount: 0, successCount: 0, successRate: 0 }
  if (!current.length) return { status: '已过期', message: '已有长输出实测，但全部已超过 30 天或配置已变化，请重新验证。', sampleCount: matching.length, successCount: 0, successRate: 0, latestTestedAt: latest?.testedAt }
  const outputs = successful.map((record) => record.outputTokens!)
  const successRate = Math.round(successful.length / current.length * 100)
  const status: ProviderOutputCapability['status'] = successful.length ? '已验证' : '未通过'
  const message = successful.length
    ? `最近 ${current.length} 次实测成功 ${successful.length} 次，成功率 ${successRate}%。`
    : `最近 ${current.length} 次实测均未通过 8,192 Token 验证线。`
  return {
    status, message, sampleCount: current.length, successCount: successful.length, successRate,
    averageOutputTokens: outputs.length ? Math.round(outputs.reduce((sum, value) => sum + value, 0) / outputs.length) : undefined,
    minOutputTokens: outputs.length ? Math.min(...outputs) : undefined, maxOutputTokens: outputs.length ? Math.max(...outputs) : undefined,
    latestOutputTokens: latest?.outputTokens, latestTargetOutputTokens: latest?.targetOutputTokens,
    latestTestMode: latest?.testMode, latestTestedAt: latest?.testedAt, validUntil: latest?.expiresAt
  }
}

export function createStrictResponseFormat<T>(schema: z.ZodType<T>, schemaName: string) {
  return zodResponseFormat(schema, schemaName.replace(/[^a-zA-Z0-9_-]/g, '_'))
}

export class ProviderService {
  constructor(
    private readonly database: ProviderRepository,
    private readonly secrets: SecretStore
  ) {}

  async list(): Promise<ProviderConfigPublic[]> {
    return Promise.all(this.database.listProviders().map(async (config) => ({
      ...config,
      hasApiKey: Boolean(await this.secrets.get(config.id))
    })))
  }

  async save(rawInput: ProviderConfigInput): Promise<ProviderConfigPublic> {
    const input = ProviderConfigInputSchema.parse(rawInput)
    const id = input.id ?? randomUUID()
    const existingKey = input.id ? await this.secrets.get(input.id) : undefined
    if (input.apiKey) {
      await this.secrets.set(id, input.apiKey)
    }
    const hasApiKey = Boolean(input.apiKey || existingKey)
    if (!hasApiKey && !isLoopbackModelBaseUrl(input.baseUrl)) throw new Error('远程模型服务必须填写 API Key；本机回环地址可以留空。')
    return this.database.saveProvider({ ...input, id, hasApiKey })
  }

  async test(rawInput: ProviderConfigInput): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    const startedAt = Date.now()
    try {
      const input = ProviderConfigInputSchema.parse(rawInput)
      const savedKey = input.id ? await this.secrets.get(input.id) : undefined
      const apiKey = input.apiKey || savedKey || (isLoopbackModelBaseUrl(input.baseUrl) ? 'mojing-local' : undefined)
      if (!apiKey) return { ok: false, message: '远程模型服务必须填写 API Key；本机回环地址可以留空。' }
      const client = new OpenAI({ apiKey, baseURL: input.baseUrl.replace(/\/$/, ''), timeout: MODEL_REQUEST_TIMEOUT_MS, maxRetries: 0 })
      const testSchema = z.object({ status: z.literal('连接成功') })
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: input.model,
        messages: [{ role: 'user', content: '只返回 JSON：{"status":"连接成功"}。' }],
        temperature: 0,
        response_format: input.supportsJsonSchema ? createStrictResponseFormat(testSchema, 'mojing_connection_test') : { type: 'json_object' }
      }
      if (input.outputTokenParameter === 'max_tokens') request.max_tokens = 32
      else request.max_completion_tokens = 32
      const invoke = async (body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<string> => {
        let content = ''
        if (input.supportsStreaming) {
          try {
            const stream = await client.chat.completions.create({ ...body, stream: true })
            for await (const chunk of stream) content += chunk.choices[0]?.delta?.content ?? ''
          } catch (error) {
            if (body.max_completion_tokens !== undefined && isOutputTokenParameterCompatibilityError(error)) {
              const compatible = { ...body, max_tokens: body.max_completion_tokens }
              delete compatible.max_completion_tokens
              const stream = await client.chat.completions.create({ ...compatible, stream: true })
              for await (const chunk of stream) content += chunk.choices[0]?.delta?.content ?? ''
            } else throw error
          }
        } else {
          try {
            const completion = await client.chat.completions.create(body)
            content = completion.choices[0]?.message.content ?? ''
          } catch (error) {
            if (body.max_completion_tokens !== undefined && isOutputTokenParameterCompatibilityError(error)) {
              const compatible = { ...body, max_tokens: body.max_completion_tokens }
              delete compatible.max_completion_tokens
              const completion = await client.chat.completions.create(compatible)
              content = completion.choices[0]?.message.content ?? ''
            } else throw error
          }
        }
        return content
      }
      let raw = '', protocol = input.supportsJsonSchema ? '严格 JSON Schema' : 'JSON 对象模式'
      try { raw = await invoke(request) } catch (error) {
        const compatible = { ...request, response_format: { type: 'json_object' as const } }
        if (input.supportsJsonSchema && isStrictSchemaCompatibilityError(error)) { protocol = 'JSON 对象兼容模式'; try { raw = await invoke(compatible) } catch (fallbackError) { if (!shouldFallbackToPlainJson(fallbackError)) throw fallbackError; protocol = '基础 JSON 提示模式'; const plain = { ...request }; delete plain.response_format; raw = await invoke(plain) } }
        else if (isResponseFormatCompatibilityError(error)) { protocol = '基础 JSON 提示模式'; const plain = { ...request }; delete plain.response_format; raw = await invoke(plain) }
        else throw error
      }
      parseStructuredOutput(raw, testSchema)
      const modes = [input.supportsStreaming ? '流式输出' : '非流式输出', protocol, isLoopbackModelBaseUrl(input.baseUrl) ? '本机模型' : '远程模型'].join('、')
      const endpointWarning = isLikelyEphemeralLocalBaseUrl(input.baseUrl) ? ' 但当前地址使用临时高位本机端口，进程重启后可能失效，不建议用于长任务。' : ''
      return { ok: true, message: `模型连接与生成协议均正常（${modes}）。${endpointWarning}`, latencyMs: Date.now() - startedAt }
    } catch (error) {
      const input = ProviderConfigInputSchema.safeParse(rawInput)
      return { ok: false, message: this.toSafeError(error, input.success ? input.data.baseUrl : undefined) }
    }
  }

  async testLongOutput(rawInput: ProviderLongOutputTestInput): Promise<ProviderLongOutputTestResult> {
    const startedAt = Date.now()
    const parsedInput = ProviderLongOutputTestInputSchema.parse(rawInput)
    const requestedOutputTokens = parsedInput.targetOutputTokens
    const testMode = parsedInput.testMode
    let parsedConfig: ProviderConfigInput | undefined
    const persist = (result: ProviderLongOutputTestResult): ProviderLongOutputTestResult => {
      if (!parsedConfig || !this.database.insertProviderOutputTest) return result
      const testedAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + PROVIDER_OUTPUT_TEST_VALIDITY_DAYS * 24 * 60 * 60 * 1_000).toISOString()
      try {
        const record = this.database.insertProviderOutputTest({
          providerId: parsedConfig.id, providerName: parsedConfig.name, model: parsedConfig.model,
          baseUrl: sanitizeProviderBaseUrl(parsedConfig.baseUrl), contextWindow: parsedConfig.contextWindow,
          outputTokenParameter: parsedConfig.outputTokenParameter ?? 'auto', supportsStreaming: parsedConfig.supportsStreaming,
          supportsJsonSchema: parsedConfig.supportsJsonSchema, testMode, targetOutputTokens: requestedOutputTokens,
          outputTokens: result.outputTokens, finishReason: result.finishReason, ok: result.ok, message: result.message,
          latencyMs: result.latencyMs, configDigest: providerConfigDigest(parsedConfig), testedAt, expiresAt
        })
        return { ...result, testRecordId: record.id, expiresAt: record.expiresAt }
      } catch {
        // 测试历史是辅助信息，写入失败不能让作者误以为模型测试失败。
        return result
      }
    }
    try {
      const input = ProviderConfigInputSchema.parse(parsedInput)
      parsedConfig = input
      const savedKey = input.id ? await this.secrets.get(input.id) : undefined
      const apiKey = input.apiKey || savedKey || (isLoopbackModelBaseUrl(input.baseUrl) ? 'mojing-local' : undefined)
      if (!apiKey) return persist({ ok: false, message: '远程模型服务必须填写 API Key；本机回环地址可以留空。', requestedOutputTokens, testMode })
      const client = new OpenAI({ apiKey, baseURL: input.baseUrl.replace(/\/$/, ''), timeout: MODEL_REQUEST_TIMEOUT_MS, maxRetries: 0 })
      const prompt = `这是一次由作者主动发起的长输出能力测试。请连续输出不少于 ${requestedOutputTokens.toLocaleString()} Token 的普通中文测试文本，每段都使用完整句子，不要输出 JSON、Markdown 标题或解释。测试内容可以重复表达“长输出能力测试进行中”，直到达到要求。`
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = { model: input.model, messages: [{ role: 'user', content: prompt }], temperature: 0 }
      const parameter = input.outputTokenParameter ?? 'auto'
      if (parameter === 'max_tokens') request.max_tokens = requestedOutputTokens
      else request.max_completion_tokens = requestedOutputTokens
      if (testMode === '流式') request.stream_options = { include_usage: true }
      const inputTokens = this.estimateTokens(prompt)
      const available = input.contextWindow - inputTokens - OUTPUT_TOKEN_SAFETY_MARGIN
      if (available < requestedOutputTokens) throw new ProviderContextLimitError(inputTokens, requestedOutputTokens, input.contextWindow)
      let result: CompletionResult
      try {
        result = await this.createWithRetry(client, request, undefined, testMode === '流式', parameter === 'auto')
      } catch (error) {
        if (testMode !== '流式' || !isStreamOptionsCompatibilityError(error)) throw error
        const compatible = { ...request }
        delete compatible.stream_options
        result = await this.createWithRetry(client, compatible, undefined, true, parameter === 'auto')
      }
      const outputTokens = result.outputTokens ?? this.estimateTokens(result.content)
      if (!result.streamEnded || (testMode === '流式' && !result.finishReason)) return persist({ ok: false, message: '流式响应没有收到完整结束信号，不能确认长输出成功。', latencyMs: Date.now() - startedAt, outputTokens, requestedOutputTokens, testMode, finishReason: result.finishReason })
      if (isLengthFinishReason(result.finishReason)) return persist({ ok: false, message: `模型在 ${outputTokens.toLocaleString()} Token 处达到服务上限，未能稳定达到本次 ${requestedOutputTokens.toLocaleString()} Token 目标。请提高供应商输出上限或更换模型。`, latencyMs: Date.now() - startedAt, outputTokens, requestedOutputTokens, testMode, finishReason: result.finishReason })
      if (outputTokens < 8_192) return persist({ ok: false, message: `模型本次只返回约 ${outputTokens.toLocaleString()} Token，未达到 8,192 Token 验证线；这可能是模型主动提前结束，不能据此宣称支持更长输出。`, latencyMs: Date.now() - startedAt, outputTokens, requestedOutputTokens, testMode, finishReason: result.finishReason })
      return persist({ ok: true, message: `${testMode}长输出能力测试通过：本次返回约 ${outputTokens.toLocaleString()} Token，结束原因正常。`, latencyMs: Date.now() - startedAt, outputTokens, requestedOutputTokens, testMode, finishReason: result.finishReason })
    } catch (error) {
      const input = ProviderConfigInputSchema.safeParse(parsedInput)
      if (input.success) parsedConfig = input.data
      return persist({ ok: false, message: this.toSafeError(error, input.success ? input.data.baseUrl : undefined), latencyMs: Date.now() - startedAt, requestedOutputTokens, testMode })
    }
  }

  async listOutputTests(providerId?: string, limit = 30): Promise<ProviderOutputTestRecord[]> {
    const records = this.database.listProviderOutputTests?.(providerId, limit) ?? []
    return records.map((record) => {
      const reasons: string[] = []
      if (Date.parse(record.expiresAt) <= Date.now()) reasons.push('这次验证已超过 30 天有效期。')
      if (record.providerId) {
        const current = this.database.getProvider(record.providerId)
        if (!current) reasons.push('原模型配置已不存在。')
        else if (providerConfigDigest(current) !== record.configDigest) reasons.push('模型地址、名称或输出参数已经变化。')
      }
      return { ...record, stale: reasons.length > 0, staleReason: reasons.length ? reasons.join(' ') : undefined }
    })
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const config = this.database.getProvider(request.providerId)
    if (!config) throw new Error('请先在“模型设置”中配置并测试模型。')
    const storedKey = await this.secrets.get(config.id)
    const apiKey = storedKey || (isLoopbackModelBaseUrl(config.baseUrl) ? 'mojing-local' : undefined)
    if (!apiKey) throw new Error('模型密钥需要重新输入；本机回环模型可在不填写密钥的情况下保存。')
    const client = new OpenAI({ apiKey, baseURL: config.baseUrl, timeout: MODEL_REQUEST_TIMEOUT_MS, maxRetries: 0 })
    const safeSchemaName = request.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_')
    let strictResponseFormat: ReturnType<typeof createStrictResponseFormat> | undefined
    try {
      strictResponseFormat = config.supportsJsonSchema
        ? createStrictResponseFormat(request.schema, safeSchemaName)
        : undefined
    } catch (error) {
      // Some business replies intentionally contain optional targeting fields.
      // OpenAI strict mode requires every property to be required, so such a
      // schema cannot be converted locally. Keep the user's preference enabled
      // and start this request in json_object mode instead of failing before the
      // first network call.
      if (!isStrictSchemaCompatibilityError(error)) throw new Error(this.toSafeError(error))
      strictResponseFormat = undefined
    }
    const jsonSchema = strictResponseFormat?.json_schema.schema
      ?? zodToJsonSchema(request.schema, request.schemaName)

    const schemaGuidance = `只返回一个 JSON 对象，不要输出 Markdown 或解释。返回值必须满足以下 JSON Schema：\n${JSON.stringify(jsonSchema)}`
    const strictUserContent = `${request.user}\n\n只返回符合 response_format 的 JSON 对象，不要输出 Markdown 或解释。`
    const compatibleUserContent = `${request.user}\n\n${schemaGuidance}`

    const configuredOutputLimit = config.maxOutputTokens ?? DEFAULT_MODEL_OUTPUT_TOKENS
    const requestedOutputLimit = request.maxOutputTokens === undefined
      ? configuredOutputLimit
      : Math.min(request.maxOutputTokens, configuredOutputLimit)
    const outputTokenParameter = request.outputTokenParameter ?? config.outputTokenParameter ?? 'auto'
    const baseRequest: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: strictResponseFormat ? strictUserContent : compatibleUserContent }
      ],
      temperature: request.temperature ?? 0.65
    }
    // 以实际发送的消息估算输入，而不是只计算 request.user。兼容模式会把
    // JSON Schema 追加到用户消息，严格模式也会把 Schema 交给 response_format；
    // 两者都必须计入预算，否则长提示会在真实模型侧越过窗口。
    const requestInput = baseRequest.messages
      .map((message) => typeof message.content === 'string' ? message.content : '')
      .join('\n') + `\n${JSON.stringify(jsonSchema)}`
    const maxOutputTokens = this.resolveOutputTokenLimit(config.contextWindow, requestInput, requestedOutputLimit)
    if (outputTokenParameter === 'max_tokens') baseRequest.max_tokens = maxOutputTokens
    else baseRequest.max_completion_tokens = maxOutputTokens
    if (strictResponseFormat) {
      baseRequest.response_format = strictResponseFormat
    } else {
      baseRequest.response_format = { type: 'json_object' }
    }
    const singleAttempt = request.singleAttempt === true

    let raw = ''
    let inputTokens = 0
    let outputTokens = 0
    let retryCount = 0
    let usageKnown = false
    let outputProtocol: 'strict' | 'json-object' | 'plain' = strictResponseFormat ? 'strict' : 'json-object'
    try {
      let result: CompletionResult
      try {
        result = await this.createWithRetry(client, baseRequest, request.signal, config.supportsStreaming, outputTokenParameter === 'auto' && !singleAttempt, singleAttempt ? 1 : 3)
      } catch (error) {
        if (singleAttempt) throw error
        if (outputProtocol === 'strict' && isStrictSchemaCompatibilityError(error)) {
          // 部分 OpenAI 兼容服务支持 json_object，却不实现严格 JSON Schema。
          // 自动降级后仍会经过本地 Zod 校验，不能绕过原稿保护。
          outputProtocol = 'json-object'
          const compatibleRequest = {
            ...baseRequest,
            messages: [{ role: 'system' as const, content: request.system }, { role: 'user' as const, content: compatibleUserContent }],
            response_format: { type: 'json_object' as const }
          }
          try {
            result = await this.createWithRetry(client, compatibleRequest, request.signal, config.supportsStreaming, outputTokenParameter === 'auto')
          } catch (fallbackError) {
            if (!shouldFallbackToPlainJson(fallbackError)) throw fallbackError
            outputProtocol = 'plain'
            const plainRequest = {
              ...baseRequest,
              messages: [{ role: 'system' as const, content: request.system }, { role: 'user' as const, content: compatibleUserContent }]
            }
            delete plainRequest.response_format
            result = await this.createWithRetry(client, plainRequest, request.signal, config.supportsStreaming, outputTokenParameter === 'auto')
          }
        } else if (shouldFallbackToPlainJson(error)) {
          outputProtocol = 'plain'
          const plainRequest = {
            ...baseRequest,
            messages: [{ role: 'system' as const, content: request.system }, { role: 'user' as const, content: compatibleUserContent }]
          }
          delete plainRequest.response_format
          result = await this.createWithRetry(client, plainRequest, request.signal, config.supportsStreaming, outputTokenParameter === 'auto')
        } else throw error
      }
      retryCount += result.retryCount
      raw = result.content
      const usage = this.readUsage(result, request.system + request.user, raw)
      inputTokens += usage.input
      outputTokens += usage.output
      usageKnown ||= usage.known
      if (isLengthFinishReason(result.finishReason)) throw new ProviderOutputLimitError(result.finishReason, maxOutputTokens)
      const parsed = this.parseAndValidate(raw, request.schema)
      this.recordUsage(config, request, inputTokens, outputTokens, retryCount, usageKnown, '成功')
      return parsed
    } catch (firstError) {
      if (request.signal?.aborted) {
        this.recordUsage(config, request, inputTokens || this.estimateTokens(request.system + request.user), outputTokens, retryCount, usageKnown, '取消')
        throw new Error('已取消本次生成。')
      }
      if (!raw || classifyProviderError(firstError) === 'length' || classifyProviderError(firstError) === 'stream' || classifyProviderError(firstError) === 'timeout') {
        this.recordUsage(config, request, inputTokens || this.estimateTokens(request.system + request.user), outputTokens, retryCount, usageKnown, '失败')
        throw new Error(this.toSafeError(firstError, config.baseUrl))
      }
      if (singleAttempt) {
        this.recordUsage(config, request, inputTokens, outputTokens, retryCount, usageKnown, '失败')
        throw new Error(this.toSafeError(firstError, config.baseUrl))
      }
      try {
        const repairRequest: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
          model: config.model,
          messages: [
            {
              role: 'system',
              content: '你是 JSON 格式修复器。只修复格式和缺失字段，不改变原意；只返回符合给定 Schema 的 JSON。'
            },
            {
              role: 'user',
              content: `Schema：\n${JSON.stringify(jsonSchema)}\n\n待修复内容：\n${raw}`
            }
          ],
          temperature: 0
        }
        const repairInput = repairRequest.messages.map((message) => typeof message.content === 'string' ? message.content : '').join('\n') + `\n${JSON.stringify(jsonSchema)}`
        const repairBudget = this.resolveOutputTokenLimit(config.contextWindow, repairInput, Math.min(maxOutputTokens, 4_096))
        if (outputTokenParameter === 'max_tokens') repairRequest.max_tokens = repairBudget
        else repairRequest.max_completion_tokens = repairBudget
        if (outputProtocol === 'strict') repairRequest.response_format = createStrictResponseFormat(request.schema, `repair_${safeSchemaName}`)
        else if (outputProtocol === 'json-object') repairRequest.response_format = { type: 'json_object' }
        let repair: CompletionResult
        try {
          repair = await this.createWithRetry(client, repairRequest, request.signal, config.supportsStreaming, outputTokenParameter === 'auto')
        } catch (repairProtocolError) {
          if (!shouldFallbackToPlainJson(repairProtocolError)) throw repairProtocolError
          const plainRepairRequest = { ...repairRequest }
          delete plainRepairRequest.response_format
          repair = await this.createWithRetry(client, plainRepairRequest, request.signal, config.supportsStreaming, outputTokenParameter === 'auto')
        }
        retryCount += repair.retryCount
        const repairedRaw = repair.content
        const repairUsage = this.readUsage(repair, JSON.stringify(jsonSchema) + raw, repairedRaw)
        inputTokens += repairUsage.input
        outputTokens += repairUsage.output
        usageKnown ||= repairUsage.known
        const parsed = this.parseAndValidate(repairedRaw, request.schema)
        this.recordUsage(config, request, inputTokens, outputTokens, retryCount, usageKnown, '成功')
        return parsed
      } catch (repairError) {
        this.recordUsage(config, request, inputTokens, outputTokens, retryCount, usageKnown, '失败')
        throw new Error(`模型输出未通过结构校验，原稿未被修改。${this.toSafeError(repairError, config.baseUrl)}`)
      }
    }
  }

  private parseAndValidate<T>(raw: string, schema: z.ZodType<T>): T {
    return parseStructuredOutput(raw, schema)
  }

  private async createWithRetry(
    client: OpenAI,
    request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    signal?: AbortSignal,
    stream = false,
    allowOutputParameterFallback = true,
    maxAttempts = 3
  ): Promise<CompletionResult> {
    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (stream) {
          const response = await client.chat.completions.create({ ...request, stream: true }, { signal })
          let content = ''
          let inputTokens: number | undefined
          let outputTokens: number | undefined
          let finishReason: string | null | undefined
          try {
            for await (const chunk of response) {
              content += chunk.choices[0]?.delta?.content ?? ''
              finishReason = chunk.choices[0]?.finish_reason ?? finishReason
              if (chunk.usage) {
                inputTokens = chunk.usage.prompt_tokens
                outputTokens = chunk.usage.completion_tokens
              }
            }
          } catch (error) {
            // An error while iterating a stream is different from a rejected
            // request: the gateway accepted the request but disconnected before
            // sending the terminating chunk. Keep that distinction for the UI.
            throw withProviderFailureKind(error, classifyProviderError(error) === 'timeout' ? 'timeout' : 'stream')
          }
          return { content, inputTokens, outputTokens, finishReason, streamEnded: true, retryCount: attempt }
        }
        const completion = await client.chat.completions.create(request, { signal })
        return {
          content: completion.choices[0]?.message.content ?? '',
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          finishReason: completion.choices[0]?.finish_reason,
          streamEnded: true,
          retryCount: attempt
        }
      } catch (error) {
        lastError = error
        if (signal?.aborted) throw error
        if (allowOutputParameterFallback && request.max_completion_tokens !== undefined && isOutputTokenParameterCompatibilityError(error)) {
          // OpenAI calls the new parameter max_completion_tokens; many local
          // OpenAI-compatible gateways still only understand max_tokens. Retry
          // once with the legacy spelling instead of silently dropping the cap.
          const compatible = { ...request, max_tokens: request.max_completion_tokens }
          delete compatible.max_completion_tokens
          const fallback = await this.createWithRetry(client, compatible, signal, stream, false, maxAttempts)
          return { ...fallback, retryCount: fallback.retryCount + attempt + 1 }
        }
        // Stream iterators can report a bare "aborted"/"closed" error that
        // does not contain the usual socket keywords. The stream tag is still
        // enough evidence to retry safely because no terminating chunk arrived.
        if ((!isTransientProviderError(error) && classifyProviderError(error) !== 'stream') || attempt === maxAttempts - 1) throw error
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 700 * (attempt + 1) ** 2)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('已取消本次生成。'))
          }, { once: true })
        })
      }
    }
    throw lastError
  }

  private readUsage(result: CompletionResult, input: string, output: string): { input: number; output: number; known: boolean } {
    return {
      input: result.inputTokens ?? this.estimateTokens(input),
      output: result.outputTokens ?? this.estimateTokens(output),
      known: result.inputTokens !== undefined || result.outputTokens !== undefined
    }
  }

  private resolveOutputTokenLimit(contextWindow: number, input: string, requested?: number): number {
    const inputTokens = this.estimateTokens(input)
    const desired = requested ?? DEFAULT_MODEL_OUTPUT_TOKENS
    const available = contextWindow - inputTokens - OUTPUT_TOKEN_SAFETY_MARGIN
    // Math.max(256, available) 会把已经超出上下文的请求“伪装”成合法请求，
    // 最终仍由模型拒绝。至少保留一个最小 JSON 响应空间，并明确阻止发送。
    if (available < 256) throw new ProviderContextLimitError(inputTokens, Math.floor(desired), contextWindow)
    return Math.max(256, Math.min(Math.floor(desired), available))
  }

  private estimateTokens(value: string): number {
    const chinese = (value.match(/[\u3400-\u9fff]/g) ?? []).length
    const other = Math.max(0, value.length - chinese)
    return Math.max(1, Math.ceil(chinese * 0.65 + other / 4))
  }

  private recordUsage<T>(
    config: ProviderConfigPublic,
    request: StructuredGenerationRequest<T>,
    inputTokens: number,
    outputTokens: number,
    retryCount: number,
    _costKnown: boolean,
    status: '成功' | '失败' | '取消'
  ): void {
    try {
      this.database.insertUsage({
        projectId: request.usageContext?.projectId,
        episodeNumber: request.usageContext?.episodeNumber,
        providerId: config.id,
        model: config.model,
        operation: request.usageContext?.operation ?? request.schemaName,
        inputTokens,
        outputTokens,
        estimatedCost: undefined,
        currency: 'CNY',
        status,
        retryCount,
        costKnown: false
      })
    } catch {
      // Usage records are auxiliary and must never interrupt script generation.
    }
  }

  private toSafeError(error: unknown, baseUrl?: string): string {
    const message = error instanceof Error ? error.message : String(error)
    const localEndpointHint = baseUrl && isLikelyEphemeralLocalBaseUrl(baseUrl) ? ' 当前 Base URL 使用临时高位本机端口；该中转进程可能已经退出或更换端口，请改用固定地址的模型服务。' : ''
    const failureKind = classifyProviderError(error)
    if (failureKind === 'context') return message
    if (failureKind === 'length') return '模型输出达到本次上限，内容可能被截断；当前小说未被修改。请缩小本次生成范围、分段生成，或在模型设置中确认服务支持更大的输出上限。'
    if (failureKind === 'stream') return `模型流式输出中途断开，未收到完整结束信号；应用已自动重试 3 次，当前小说未被修改。${localEndpointHint}`
    if (failureKind === 'timeout') return `模型请求超时，应用已自动重试 3 次。请检查模型服务或缩短生成要求。当前小说未被修改。${localEndpointHint}`
    if (failureKind === 'schema') return '模型返回的数据格式仍不完整或缺少必要内容；当前小说未被修改。可以缩小本次生成范围后重试。'
    if (isStrictSchemaCompatibilityError(error)) return '模型服务拒绝了结构化输出协议。应用已依次尝试严格结构、JSON 对象和基础 JSON 提示模式，但服务仍未返回可用内容；当前小说未被修改。请检查模型名称、Base URL 和 API Key，或先用“测试连接”确认该模型支持对话请求。'
    if (/401|api.?key|unauthorized/i.test(message)) return 'API Key 无效或没有访问该模型的权限。'
    if (/429|rate.?limit/i.test(message)) return '请求过于频繁或模型额度不足，请稍后重试。'
    if (/fetch|network|connect|ENOTFOUND|ECONN/i.test(message)) return `无法连接模型服务，请检查 Base URL 和网络。${localEndpointHint}`
    return message.replace(/sk-[a-zA-Z0-9_-]+/g, '[已隐藏密钥]')
  }
}

/**
 * Compatibility models occasionally wrap JSON in Markdown, <think> blocks or
 * a short explanation. Try the complete response first, then each fenced or
 * balanced JSON object, and only accept a candidate that passes the Zod schema.
 */
export function parseStructuredOutput<T>(raw: string, schema: z.ZodType<T>): T {
  const normalized = raw.replace(/^\uFEFF/, '').trim()
  // Reasoning wrappers are not the answer. Remove them before extracting
  // balanced JSON so a valid-looking draft inside <think> cannot win over the
  // actual answer that follows it.
  const withoutReasoning = normalized.replace(/<(?:think|analysis|reasoning)>[\s\S]*?<\/(?:think|analysis|reasoning)>/gi, '').trim()
  const candidates = new Set<string>()
  if (withoutReasoning && withoutReasoning !== normalized) candidates.add(withoutReasoning.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  if (normalized) candidates.add(normalized.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  for (const match of withoutReasoning.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) candidates.add(match[1].trim())
  }
  for (const candidate of extractBalancedJsonObjects(withoutReasoning)) candidates.add(candidate)

  let lastError: unknown = new SyntaxError('模型没有返回 JSON 对象。')
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function extractBalancedJsonObjects(value: string): string[] {
  const results: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"' && start >= 0) {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        results.push(value.slice(start, index + 1))
        start = -1
      }
    }
  }
  return results
}
