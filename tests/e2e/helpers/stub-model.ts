import { createServer, type Server } from 'node:http'
import { expect, type Page } from '@playwright/test'

/**
 * 受控模型端点（OpenAI 兼容）。
 *
 * 只在隔离 E2E 里起一个监听 `127.0.0.1` 随机端口的最小服务，按 `respond(body, index)`
 * 返回固定内容。**不接任何真实外部模型**，也不绕过鉴权、Schema 校验或候选事务 ——
 * 被验证的仍然是产品自己的真实链路。
 *
 * 为什么要共用这一份：此前每个需要模型能力的 spec 各抄一份 `startStubModel`，
 * 而它们唯一真正不同的只是「返回什么 JSON」。抽成一个「你给我一个响应函数」的入口后，
 * 各 spec 只描述自己关心的返回内容，端点骨架与关停逻辑只有一份。
 */

export type StubModel = {
  server: Server
  /** 直接把配置写进后端时要指向的地址（已带 `/v1`）。 */
  baseUrl: string
  /** 每次调用收到的原始请求体，用来断言真实请求里到底带了哪些参数。 */
  calls: string[]
  /** 关停端点；用例必须在 finally 里调用，避免端口泄漏到下一个用例。 */
  close: () => Promise<void>
}

export type StubModelResponder = (body: string, index: number) => unknown

export type StubModelOptions = {
  /**
   * 可选的拒绝规则：返回一段错误消息就按 400 回绝这次调用，返回 `undefined` 才正常作答。
   * 用来验证「模型不接受某个参数时，墨境是否如实报错」这类行为 ——
   * 例如只换 max_completion_tokens / max_tokens 其中之一。
   */
  reject?: (body: string, index: number) => string | undefined
}

export async function startStubModel(respond: StubModelResponder, options: StubModelOptions = {}): Promise<StubModel> {
  const calls: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const index = calls.length
      calls.push(body)
      response.setHeader('Content-Type', 'application/json')
      const rejected = options.reject?.(body, index)
      if (rejected) {
        response.statusCode = 400
        response.end(JSON.stringify({ error: { message: rejected, type: 'invalid_request_error' } }))
        return
      }
      response.end(JSON.stringify({
        id: 'stub',
        object: 'chat.completion',
        created: Date.now(),
        model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(respond(body, index)) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    calls,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

/**
 * 把隔离测试模型写进后端（`PUT /api/providers`）。
 *
 * `origin` / `headers` 取自 `buildWritableProject`（复用应用自身请求的会话凭据），
 * 否则拿不到鉴权。`overrides` 用来描述本次用例真正关心的配置差异
 * （例如输出上限参数），默认值只保证「能连通、能返回结构化内容」。
 */
export async function configureProvider(
  page: Page,
  origin: string,
  headers: Record<string, string>,
  baseUrl: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const response = await page.request.put(`${origin}/api/providers`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: {
      name: '隔离测试模型',
      baseUrl,
      model: 'stub-model',
      contextWindow: 32_000,
      supportsStreaming: false,
      supportsJsonSchema: true,
      hasApiKey: true,
      apiKey: 'stub-key',
      ...overrides
    }
  })
  expect(response.status()).toBe(200)
}
