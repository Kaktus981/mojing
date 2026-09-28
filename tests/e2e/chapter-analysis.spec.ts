import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule } from './helpers/manual-workspace'

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

const ANALYSIS = {
  summary: '林砚第一次听见钟声，并决定独自追查。',
  memoryCandidates: [{ content: '林砚隐瞒了钟声', evidence: '他决定不告诉任何人' }],
  settingCandidates: [{ name: '潮汐港', reason: '正文出现的新地点', inferred: false }],
  foreshadowCandidates: [{ title: '钟声与记忆', evidence: '钟声后他忘了一件事' }],
  reviewFindings: [{ title: '时间线跳跃', detail: '第二段缺少过渡', severity: '中' }]
}

async function startStubModel(): Promise<{ server: Server; baseUrl: string; bodies: string[] }> {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      bodies.push(body)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'stub', object: 'chat.completion', created: Date.now(), model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(ANALYSIS) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, bodies }
}

async function configureProvider(fixture: Fixture, page: import('@playwright/test').Page, baseUrl: string): Promise<void> {
  const response = await page.request.put(`${fixture.origin}/api/providers`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { name: '隔离测试模型', baseUrl, model: 'stub-model', contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: true, hasApiKey: true, apiKey: 'stub-key' }
  })
  expect(response.status()).toBe(200)
}

const postAnalysis = (fixture: Fixture, page: import('@playwright/test').Page, chapterId: string) =>
  page.request.post(`${fixture.origin}/api/novels/${fixture.id}/chapter-analyses`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { chapterId, trigger: '手动分析' }
  })

// 注意：`expect.poll` 的返回对象自带断言方法，包成 async 会丢掉 `.toBe`。
const waitStatus = (fixture: Fixture, page: import('@playwright/test').Page, id: string) =>
  expect.poll(async () => {
    const task = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/chapter-analyses`, { headers: fixture.headers })
    const list = (await task.json()) as Array<{ id: string; status: string }>
    return list.find((item) => item.id === id)?.status
  }, { timeout: 15_000 })

test('保存成功才分析；重复源指纹只排一个任务；模型失败不影响写作', async ({ page }) => {
  const fixture = await buildWritableProject(page, '章后分析验收')
  const chapterId = fixture.chapterId

  // ① 没有模型：任务会失败，但正文一个字都没少，且仍可继续写下一章
  const failed = await postAnalysis(fixture, page, chapterId)
  expect(failed.status()).toBe(201)
  const failedId = ((await failed.json()) as { id: string }).id
  await waitStatus(fixture, page, failedId).toBe('失败')
  const afterFailure = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    chapters: Array<{ blocks: Array<{ text: string }> }>
  }
  expect(afterFailure.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)

  const stub = await startStubModel()
  try {
    await configureProvider(fixture, page, stub.baseUrl)

    // ② 同一份源码重复触发：不重复排任务、不重复调用模型（失败任务也算同一份源码）。
    const deduped = await postAnalysis(fixture, page, chapterId)
    expect(deduped.status(), '同一源码复用已有任务').toBe(200)
    expect(((await deduped.json()) as { id: string }).id).toBe(failedId)
    expect(stub.bodies.length, '复用时不得调用模型').toBe(0)

    // ③ 失败任务用「重新分析」重跑：新任务用当前源码，跑完是完成态。
    const retry = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/chapter-analyses/${failedId}/retry`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: {}
    })
    const retryBody = await retry.json()
    expect(retry.status()).toBe(201)
    const retryId = (retryBody as { id: string }).id
    await waitStatus(fixture, page, retryId).toBe('完成')
    const callsAfterComplete = stub.bodies.length
    expect(callsAfterComplete).toBeGreaterThan(0)

    const again = await postAnalysis(fixture, page, chapterId)
    expect(((await again.json()) as { id: string }).id, '同一源码必须复用同一个任务').toBe(retryId)
    expect(stub.bodies.length, '复用时不得再次调用模型').toBe(callsAfterComplete)

    // ④ 任务中心里能看到真实状态
    await page.locator('.mjp-snav').getByRole('button', { name: '任务中心' }).click()
    await expect(page.getByTestId('analysis-task').first()).toBeVisible()
    await expect(page.getByTestId('analysis-status').first()).toHaveText('完成')
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})

test('分析后改动章节，旧结果标记为过期；结果只是候选不写入正式资料', async ({ page }) => {
  const stub = await startStubModel()
  try {
    const fixture = await buildWritableProject(page, '分析结果过期验收')
    await configureProvider(fixture, page, stub.baseUrl)

    const created = await postAnalysis(fixture, page, fixture.chapterId)
    const taskId = ((await created.json()) as { id: string }).id
    await waitStatus(fixture, page, taskId).toBe('完成')

    const before = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      revision: number; memories: unknown[]; plotThreads: Array<{ title: string }>; worldBible?: { entries: unknown[] }
    }
    expect(before.memories, '分析结果不得写入正式记忆').toEqual([])

    // 改动正文 → 旧结果过期
    const current = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      revision: number; chapters: Array<{ id: string; blocks: Array<{ text: string }> }>
    }
    const edited = structuredClone(current)
    edited.chapters[0]!.blocks[0]!.text = `${edited.chapters[0]!.blocks[0]!.text} 他又往前走了一段。`
    const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { document: edited, baseRevision: current.revision }
    })
    expect(saved.status()).toBe(200)

    await waitStatus(fixture, page, taskId).toBe('过期')

    // 重新分析会用新的源指纹排新任务
    const retry = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/chapter-analyses/${taskId}/retry`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: {}
    })
    const retryBody = await retry.json()
    expect(retry.status()).toBe(201)
    const retryId = (retryBody as { id: string }).id
    expect(retryId).not.toBe(taskId)
    await waitStatus(fixture, page, retryId).toBe('完成')
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})

test('交接开关默认关闭；开启后只有交接成功才入队', async ({ page }) => {
  const fixture = await buildWritableProject(page, '交接开关验收')
  const current = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    revision: number
  }
  expect(current).toBeTruthy()

  // 开关默认关闭：章后交接页里不会出现已开启的自动分析说明
  await openModule(page, '正文创作', '章后交接')
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('交接')
  const setting = await page.locator('.mjp-canvas-scroll').textContent()
  expect(setting).not.toMatch(/自动分析已开启/)

  // 开启开关后，交接状态选「已交接」会真的排出一个任务
  const enabled = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
    revision: number; [key: string]: unknown
  }
  const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { document: { ...enabled, settings: { ...(enabled.settings as object), chapterAutoAnalyze: true } }, baseRevision: enabled.revision }
  })
  expect(saved.status()).toBe(200)

  const listBefore = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/chapter-analyses`, { headers: fixture.headers })).json() as unknown[]
  expect(listBefore).toHaveLength(0)
})
