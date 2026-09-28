import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { buildWritableProject } from './helpers/manual-workspace'

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

/** 受控模型桩：按请求的 schema 名返回对应形状，并记录每一次出站请求。 */
async function startStubModel(): Promise<{ server: Server; baseUrl: string; bodies: string[]; reset: () => void }> {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      bodies.push(body)
      const content = body.includes('mojing_style_trial')
        ? { text: '钟声在巷子里折了个弯，林砚停下脚步。' }
        : { answer: '这一段可以先从动作写起。', references: [], actions: [] }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'stub', object: 'chat.completion', created: Date.now(), model: 'stub-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, baseUrl: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, bodies, reset: () => { bodies.length = 0 } }
}

async function configureProvider(fixture: Fixture, page: import('@playwright/test').Page, baseUrl: string): Promise<void> {
  const response = await page.request.put(`${fixture.origin}/api/providers`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: { name: '隔离测试模型', baseUrl, model: 'stub-model', contextWindow: 32_000, supportsStreaming: false, supportsJsonSchema: true, hasApiKey: true, apiKey: 'stub-key' }
  })
  expect(response.status()).toBe(200)
}

async function chat(
  fixture: Fixture,
  page: import('@playwright/test').Page,
  stage: 'writing' | 'outline',
  chapterId?: string
): Promise<void> {
  const response = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/creative-chat`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      stage, mode: '综合协作', content: '帮我看看这一段的写法',
      target: stage === 'writing' && chapterId
        ? { kind: 'chapter', projectId: fixture.id, objectId: chapterId }
        : { kind: 'outline', projectId: fixture.id },
      taskType: stage === 'writing' ? '自由讨论' : '局部修改'
    }
  })
  expect(response.status(), `聊天请求应成功：${(await response.text()).slice(0, 200)}`).toBe(200)
}

// 未绑定时提示是「抽象文风画像：本项目未启用。」，所以判据必须取**只有绑定后才会出现**的 JSON 键。
const PROFILE_MARK = '文风说明'
// 试写走的是正文生成那条注入文案，绑定后才会出现这句话。
const TRIAL_MARK = '本项目启用一份作者确认的抽象文风画像'

test('绑定前后出站请求确实带/不带画像；大纲讨论不被文风支配；正文逐字不变', async ({ page }) => {
  const stub = await startStubModel()
  try {
    const fixture = await buildWritableProject(page, '文风注入验收')
    await configureProvider(fixture, page, stub.baseUrl)
    const initial = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      chapters: Array<{ id: string; blocks: Array<{ text: string }> }>
    }
    const chapterId = initial.chapters[0]!.id
    const bodyBefore = initial.chapters[0]!.blocks.map((item) => item.text)

    // ① 未绑定：出站请求里没有画像
    stub.reset()
    await chat(fixture, page, 'writing', chapterId)
    expect(stub.bodies.length, '应产生真实出站请求').toBeGreaterThan(0)
    expect(stub.bodies.join('')).not.toContain(PROFILE_MARK)

    // ② 绑定画像
    const created = await page.request.post(`${fixture.origin}/api/style-profiles`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: {
        name: '注入用文风', description: '先写动作再写情绪，这是注入校验专用说明。',
        traits: { sentenceRhythm: '短句为主', dialogueStyle: '少修饰', descriptionStyle: '白描' },
        guidelines: ['先写动作再写情绪'], avoidPatterns: ['不要连续三段用同类比喻']
      }
    })
    expect(created.status()).toBe(201)
    const profileId = ((await created.json()) as { id: string }).id
    const bound = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/style-profile/bind`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' }, data: { profileId }
    })
    expect(bound.status()).toBe(200)

    // ③ 绑定后：写作阶段的出站请求带画像
    stub.reset()
    await chat(fixture, page, 'writing', chapterId)
    expect(stub.bodies.join('')).toContain(PROFILE_MARK)
    expect(stub.bodies.join('')).toContain('先写动作再写情绪')

    // ④ 大纲结构讨论不被文风支配
    stub.reset()
    await chat(fixture, page, 'outline')
    expect(stub.bodies.join(''), '大纲讨论不应注入文风画像').not.toContain(PROFILE_MARK)

    // ⑤ 停用后：下一次写作请求不再带画像
    const unbound = await page.request.delete(`${fixture.origin}/api/novels/${fixture.id}/style-profile/bind`, { headers: fixture.headers })
    expect(unbound.status()).toBe(200)
    stub.reset()
    await chat(fixture, page, 'writing', chapterId)
    expect(stub.bodies.join('')).not.toContain(PROFILE_MARK)

    // ⑥ 已有正文逐字不变
    const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      chapters: Array<{ id: string; blocks: Array<{ text: string }> }>
    }
    expect(after.chapters[0]!.blocks.map((item) => item.text)).toEqual(bodyBefore)
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})

test('同场景试写走真实调用路径，两份只有画像不同，结果只是候选且不写入正文', async ({ page }) => {
  const stub = await startStubModel()
  try {
    const fixture = await buildWritableProject(page, '文风试写验收')
    await configureProvider(fixture, page, stub.baseUrl)

    const unboundTrial = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/style-trials`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { scenario: '林砚第一次听见钟声' }
    })
    expect(unboundTrial.status(), '未绑定时不能试写').toBe(400)

    const created = await page.request.post(`${fixture.origin}/api/style-profiles`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: {
        name: '试写文风', description: '白描写法。',
        traits: { sentenceRhythm: '短句', dialogueStyle: '少修饰', descriptionStyle: '白描' },
        guidelines: ['先写动作'], avoidPatterns: ['不要堆比喻']
      }
    })
    const profileId = ((await created.json()) as { id: string }).id
    await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/style-profile/bind`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' }, data: { profileId }
    })

    const before = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      chapters: Array<{ blocks: Array<{ text: string }> }>
    }
    const bodyBefore = before.chapters[0]!.blocks.map((item) => item.text)

    stub.reset()
    const trial = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/style-trials`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { scenario: '林砚第一次听见钟声' }
    })
    expect(trial.status()).toBe(201)
    const result = (await trial.json()) as { withoutProfile: string; withProfile: string; profileVersion: string }

    // 两份都真实生成：两次出站请求，且只有一次带画像。
    expect(stub.bodies.length, '试写必须真的调用两次').toBe(2)
    expect(stub.bodies.filter((item) => item.includes(TRIAL_MARK)).length).toBe(1)
    // 场景相同：两份请求的场景描述一致，只有画像那一项不同。
    for (const body of stub.bodies) expect(body).toContain('林砚第一次听见钟声')
    expect(result.withoutProfile.length).toBeGreaterThan(0)
    expect(result.withProfile.length).toBeGreaterThan(0)
    expect(result.profileVersion).toBeTruthy()

    const after = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      chapters: Array<{ blocks: Array<{ text: string }> }>
    }
    expect(after.chapters[0]!.blocks.map((item) => item.text), '试写不得写入正文').toEqual(bodyBefore)
  } finally {
    await new Promise<void>((resolve) => stub.server.close(() => resolve()))
  }
})
