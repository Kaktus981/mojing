import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { CreativeChatReplySchema } from '../../../contracts/src/creativeChat'
import { assessProviderOutputCapability, classifyProviderError, DEFAULT_MODEL_OUTPUT_TOKENS, isLengthFinishReason, isLikelyEphemeralLocalBaseUrl, isLoopbackModelBaseUrl, isOutputTokenParameterCompatibilityError, isResponseFormatCompatibilityError, isStrictSchemaCompatibilityError, isTransientProviderError, parseStructuredOutput, providerConfigDigest, ProviderContextLimitError, ProviderService, sanitizeProviderBaseUrl, shouldFallbackToPlainJson, type ProviderRepository } from './provider'
import { MemorySecretStore } from '../secrets'

describe('OpenAI 严格结构化输出', () => {
  it('能够识别兼容服务的严格 Schema 与 response_format 拒绝错误', () => {
    expect(isStrictSchemaCompatibilityError(new Error("Invalid schema for response_format: additionalProperties must be false"))).toBe(true)
    expect(isStrictSchemaCompatibilityError(new Error('API Key invalid'))).toBe(false)
    expect(isResponseFormatCompatibilityError(new Error('unknown parameter: response_format'))).toBe(true)
    expect(isResponseFormatCompatibilityError(new Error('rate limit'))).toBe(false)
    expect(shouldFallbackToPlainJson(new Error('schema not supported by this gateway'))).toBe(true)
    expect(shouldFallbackToPlainJson(new Error('json_object not supported'))).toBe(true)
    expect(shouldFallbackToPlainJson(new Error('API Key invalid'))).toBe(false)
  })

  it('兼容模型在 JSON 前后附带说明或思考内容时仍能提取正确对象', () => {
    const schema = z.object({ title: z.string(), count: z.number().int() })
    expect(parseStructuredOutput('说明：下面是结果。\n```json\n{"title":"潮声","count":2}\n```\n以上。', schema)).toEqual({ title: '潮声', count: 2 })
    expect(parseStructuredOutput('<think>{"title":"错误草稿"}</think>\n最终：{"title":"钟塔","count":3}', schema)).toEqual({ title: '钟塔', count: 3 })
    expect(parseStructuredOutput('<think>{"title":"思考草稿","count":99}</think>\n最终：{"title":"正式答案","count":1}', schema)).toEqual({ title: '正式答案', count: 1 })
  })

  it('保持勾选严格结构时，AI 对话可自动降级到基础 JSON 提示', async () => {
    const protocols: string[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        const parsed = JSON.parse(body) as { response_format?: { type?: string } }
        const protocol = parsed.response_format?.type ?? 'plain'
        protocols.push(protocol)
        response.setHeader('content-type', 'application/json')
        if (protocol !== 'plain') {
          response.statusCode = 400
          response.end(JSON.stringify({ error: { message: 'schema not supported by this gateway', type: 'invalid_request_error', code: 'invalid_json_schema' } }))
          return
        }
        response.end(JSON.stringify({
          id: 'chatcmpl-local-test', object: 'chat.completion', created: 0, model: 'local-test',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '<think>{"answer":"草稿"}</think>\n{"answer":"可以继续对话","references":[],"actions":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
        }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'strict-compatible', name: '严格模式兼容测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: true, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    try {
      const service = new ProviderService(repository, new MemorySecretStore('local-test-key'))
      const result = await service.generate({
        system: '你是当前小说的创作对话助手。', user: '继续讨论当前世界观。', schemaName: 'creative_chat_fallback', schema: CreativeChatReplySchema
      })
      expect(result).toEqual({ answer: '可以继续对话', references: [], actions: [] })
      expect(protocols).toEqual(['json_object', 'plain'])
      expect(config.supportsJsonSchema).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('single-attempt 请求遇到结构化协议兼容错误时不再发起降级请求', async () => {
    const requests: Array<{ response_format?: { type?: string } }> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        requests.push(JSON.parse(body) as { response_format?: { type?: string } })
        response.setHeader('content-type', 'application/json')
        response.statusCode = 400
        response.end(JSON.stringify({ error: { message: 'schema not supported by this gateway', type: 'invalid_request_error', code: 'invalid_json_schema' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'single-protocol', name: '单次协议测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: true, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    try {
      await expect(new ProviderService(repository, new MemorySecretStore('local-test-key')).generate({
        system: '你是测试助手。', user: '返回结果。', schemaName: 'single_attempt_protocol', schema: CreativeChatReplySchema,
        singleAttempt: true
      } as any)).rejects.toThrow()
      expect(requests).toHaveLength(1)
      expect(requests[0]?.response_format?.type).toBe('json_object')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('single-attempt 请求遇到 503 时不进行传输重试', async () => {
    let requests = 0
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        requests += 1
        response.setHeader('content-type', 'application/json')
        response.statusCode = 503
        response.end(JSON.stringify({ error: { message: 'temporary upstream failure' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'single-503', name: '单次 503 测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    try {
      await expect(new ProviderService(repository, new MemorySecretStore('local-test-key')).generate({
        system: '你是测试助手。', user: '返回结果。', schemaName: 'single_attempt_503', schema: CreativeChatReplySchema,
        singleAttempt: true
      } as any)).rejects.toThrow()
      expect(requests).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('single-attempt 请求遇到坏 JSON 时不发起 JSON 修复请求', async () => {
    const requests: unknown[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        requests.push(JSON.parse(body))
        response.setHeader('content-type', 'application/json')
        const content = requests.length === 1
          ? '{"answer":'
          : '{"answer":"修复后内容","references":[],"actions":[]}'
        response.end(JSON.stringify({
          id: 'chatcmpl-single-repair-test', object: 'chat.completion', created: 0, model: 'local-test',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 }
        }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'single-repair', name: '单次修复测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    try {
      await expect(new ProviderService(repository, new MemorySecretStore('local-test-key')).generate({
        system: '你是测试助手。', user: '返回结果。', schemaName: 'single_attempt_repair', schema: CreativeChatReplySchema,
        singleAttempt: true
      } as any)).rejects.toThrow()
      expect(requests).toHaveLength(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('默认发送新版输出上限，兼容服务拒绝时保留同一上限并回退旧参数', async () => {
    const requests: Array<{ max_completion_tokens?: number; max_tokens?: number }> = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        const parsed = JSON.parse(body) as { max_completion_tokens?: number; max_tokens?: number }
        requests.push(parsed)
        response.setHeader('content-type', 'application/json')
        if (parsed.max_completion_tokens !== undefined) {
          response.statusCode = 400
          response.end(JSON.stringify({ error: { message: "Unknown parameter: 'max_completion_tokens'. Use 'max_tokens' instead." } }))
          return
        }
        response.end(JSON.stringify({
          id: 'chatcmpl-output-limit-test', object: 'chat.completion', created: 0, model: 'local-test',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":"已兼容","references":[],"actions":[]}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 }
        }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'output-limit-compatible', name: '输出参数兼容测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    try {
      const result = await new ProviderService(repository, new MemorySecretStore('local-test-key')).generate({
        system: '你是测试助手。', user: '返回结果。', schemaName: 'output_limit_fallback', schema: CreativeChatReplySchema
      })
      expect(result.answer).toBe('已兼容')
      expect(requests).toHaveLength(2)
      expect(requests[0]?.max_completion_tokens).toBe(DEFAULT_MODEL_OUTPUT_TOKENS)
      expect(requests[0]?.max_tokens).toBeUndefined()
      expect(requests[1]?.max_tokens).toBe(DEFAULT_MODEL_OUTPUT_TOKENS)
      expect(requests[1]?.max_completion_tokens).toBeUndefined()
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('明确识别模型因输出长度结束，不把它误报为普通 JSON 错误', async () => {
    const server = createServer((request, response) => {
      request.resume()
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          id: 'chatcmpl-length-test', object: 'chat.completion', created: 0, model: 'local-test',
          choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '{"answer":"看似完整","references":[],"actions":[]}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 16_000, total_tokens: 16_012 }
        }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'length-test', name: '长度结束测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    try {
      await expect(new ProviderService(repository, new MemorySecretStore('local-test-key')).generate({
        system: '你是测试助手。', user: '返回结果。', schemaName: 'length_finish_reason', schema: CreativeChatReplySchema
      })).rejects.toThrow('模型输出达到本次上限')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('允许作者主动验证超过 8192 Token 的长输出能力，并显示实际返回量', async () => {
    const requests: Array<{ max_completion_tokens?: number; max_tokens?: number }> = []
    const saved: any[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        requests.push(JSON.parse(body) as { max_completion_tokens?: number; max_tokens?: number })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          id: 'chatcmpl-long-output-test', object: 'chat.completion', created: 0, model: 'local-test',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '长输出测试完成。' } }],
          usage: { prompt_tokens: 120, completion_tokens: 8_320, total_tokens: 8_440 }
        }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'long-output-test', name: '长输出能力测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = { listProviders: () => [config], getProvider: () => config, saveProvider: () => config, insertUsage: () => undefined, insertProviderOutputTest: (input) => { const record = { ...input, id: 'long-output-record', stale: false }; saved.push(record); return record as any } }
    try {
      const result = await new ProviderService(repository, new MemorySecretStore('local-test-key')).testLongOutput(config)
      expect(result.ok).toBe(true)
      expect(result.outputTokens).toBe(8_320)
      expect(result.testRecordId).toBe('long-output-record')
      expect(saved[0]).toMatchObject({ providerId: config.id, targetOutputTokens: 9_000, outputTokens: 8_320, ok: true })
      expect(requests[0]?.max_completion_tokens).toBe(9_000)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('长输出能力测试支持流式结束信号并读取服务返回的用量', async () => {
    let streamRequested = false
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        streamRequested = JSON.parse(body).stream === true
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(`data: ${JSON.stringify({ id: 'stream-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '测试中' }, finish_reason: null }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ id: 'stream-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 8_320, total_tokens: 8_440 } })}\n\n`)
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const config = {
      id: 'stream-long-output-test', name: '流式长输出能力测试', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-test',
      contextWindow: 32_000, supportsStreaming: true, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = { listProviders: () => [config], getProvider: () => config, saveProvider: () => config, insertUsage: () => undefined }
    try {
      const result = await new ProviderService(repository, new MemorySecretStore('local-test-key')).testLongOutput({ ...config, testMode: '流式', targetOutputTokens: 9_000 })
      expect(result.ok).toBe(true)
      expect(result.testMode).toBe('流式')
      expect(result.outputTokens).toBe(8_320)
      expect(streamRequested).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('保存长输出能力测试历史，并在模型配置变化后标记需要重测', async () => {
    const records: any[] = []
    let current = {
      id: 'history-provider', name: '历史测试模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-test',
      contextWindow: 32_000, maxOutputTokens: 16_000, outputTokenParameter: 'auto' as const,
      supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [current], getProvider: () => current, saveProvider: () => current, insertUsage: () => undefined,
      insertProviderOutputTest: (input) => { const record = { ...input, id: input.id ?? 'history-record', stale: false }; records.push(record); return record as any },
      listProviderOutputTests: () => records
    }
    const service = new ProviderService(repository, new MemorySecretStore('local-test-key'))
    // 该测试只验证历史模型，不依赖真实服务；手工插入一条已通过快照后检查过期规则。
    repository.insertProviderOutputTest!({
      providerId: current.id, providerName: current.name, model: current.model, baseUrl: current.baseUrl,
      contextWindow: current.contextWindow, outputTokenParameter: current.outputTokenParameter,
      supportsStreaming: current.supportsStreaming, supportsJsonSchema: current.supportsJsonSchema,
      testMode: '非流式', targetOutputTokens: 8_192, outputTokens: 8_320, finishReason: 'stop', ok: true,
      message: '测试通过', latencyMs: 100, configDigest: providerConfigDigest(current),
      testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString()
    })
    expect(records).toHaveLength(1)
    const listed = await service.listOutputTests(current.id)
    expect(listed[0]).toMatchObject({ stale: false, providerId: current.id })
    current = { ...current, model: 'changed-model' }
    const stale = await service.listOutputTests(current.id)
    expect(stale[0]?.stale).toBe(true)
    expect(stale[0]?.staleReason).toContain('模型地址、名称或输出参数已经变化')
    expect(providerConfigDigest(current)).not.toBe(records[0].configDigest)
  })

  it('发送前阻止输入加输出超过上下文窗口的请求', async () => {
    const config = {
      id: 'context-overflow', name: '上下文预算测试', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-test',
      contextWindow: 4_096, supportsStreaming: false, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: true
    }
    const repository: ProviderRepository = {
      listProviders: () => [config], getProvider: () => config,
      saveProvider: () => config, insertUsage: () => undefined
    }
    const service = new ProviderService(repository, new MemorySecretStore('local-test-key'))
    await expect(service.generate({
      system: '你是测试助手。', user: '中'.repeat(12_000), schemaName: 'context_overflow', schema: CreativeChatReplySchema
    })).rejects.toBeInstanceOf(ProviderContextLimitError)
  })

  it('区分长度结束、超时、断流、结构错误和输出参数兼容错误', () => {
    expect(isLengthFinishReason('length')).toBe(true)
    expect(isLengthFinishReason('stop')).toBe(false)
    expect(isOutputTokenParameterCompatibilityError(new Error("Unsupported parameter: 'max_completion_tokens'"))).toBe(true)
    expect(isOutputTokenParameterCompatibilityError(new Error('API Key invalid'))).toBe(false)
    expect(classifyProviderError(new Error('Request timed out.'))).toBe('timeout')
    expect(classifyProviderError(new Error('stream terminated before completion'))).toBe('stream')
    expect(classifyProviderError(new SyntaxError('Unexpected end of JSON input'))).toBe('schema')
  })

  it('把模型超时识别为可自动重试的临时故障', () => {
    expect(isTransientProviderError(new Error('Request timed out.'))).toBe(true)
    expect(isTransientProviderError(new Error('ETIMEDOUT while reading upstream'))).toBe(true)
    expect(isTransientProviderError(new Error('API Key invalid'))).toBe(false)
  })

  it('识别容易失效的临时本机高位端口', () => {
    expect(isLikelyEphemeralLocalBaseUrl('http://localhost:63352/v1')).toBe(true)
    expect(isLikelyEphemeralLocalBaseUrl('http://127.0.0.1:11434/v1')).toBe(false)
    expect(isLikelyEphemeralLocalBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('识别可免密钥的本机模型地址', () => {
    expect(isLoopbackModelBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackModelBaseUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLoopbackModelBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('能力历史快照会清理 Base URL 中的凭据和查询密钥', () => {
    expect(sanitizeProviderBaseUrl('https://user:secret@example.com/v1?api_key=hidden#config')).toBe('https://example.com/v1')
  })

  it('只用当前配置且未过期的记录计算长输出成功率', () => {
    const provider = { id: 'capability-provider', name: '能力模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-test', contextWindow: 32_000, maxOutputTokens: 16_000, outputTokenParameter: 'auto' as const, supportsStreaming: true, supportsJsonSchema: false, currency: 'CNY' as const, showCost: false, hasApiKey: false }
    const now = Date.parse('2026-08-30T12:00:00.000Z')
    const base = { providerId: provider.id, providerName: provider.name, model: provider.model, baseUrl: provider.baseUrl, contextWindow: provider.contextWindow, outputTokenParameter: provider.outputTokenParameter, supportsStreaming: provider.supportsStreaming, supportsJsonSchema: provider.supportsJsonSchema, configDigest: providerConfigDigest(provider) }
    const records = [
      { ...base, id: 'cap-1', testMode: '非流式' as const, targetOutputTokens: 9_000, outputTokens: 8_600, finishReason: 'stop', ok: true, message: '通过', latencyMs: 1, testedAt: '2026-08-30T10:00:00.000Z', expiresAt: '2026-09-29T10:00:00.000Z', stale: false },
      { ...base, id: 'cap-2', testMode: '流式' as const, targetOutputTokens: 9_000, outputTokens: 7_900, finishReason: 'length', ok: false, message: '未通过', latencyMs: 1, testedAt: '2026-08-30T11:00:00.000Z', expiresAt: '2026-09-29T11:00:00.000Z', stale: false }
    ]
    const summary = assessProviderOutputCapability(records, provider, now)
    expect(summary).toMatchObject({ status: '已验证', sampleCount: 2, successCount: 1, successRate: 50, minOutputTokens: 8_600, maxOutputTokens: 8_600 })
  })

})
