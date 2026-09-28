import { expect, test, type Page } from '@playwright/test'
import { guideActionOf, guideResponder } from './helpers/guide-stub'
import { buildWritableProject, openModule, type ManualFixture } from './helpers/manual-workspace'
import { configureProvider, startStubModel } from './helpers/stub-model'

/**
 * 模型高级设置 · 输出上限是否**真的进入模型请求**（2026-09-16，依据作者裁决五；
 * 2026-09-17 Task 8 迁移到右栏引导）。
 *
 * 背景：契约与调用链一直支持输出上限（`maxOutputTokens` / `outputTokenParameter`，
 * 见 packages/contracts/src/provider.ts 与 packages/core/src/ai/provider.ts），
 * 但表单此前没有出口。补回控件之后，必须证明的不是「字段存在」，而是
 * **保存下来的设置真的写进了发给模型的请求**，以及**模型不接受该参数时是明确失败而不是假装成功**。
 *
 * ⚠️ Task 8 带来的行为变更：引导从「规则式、只有生成那一步调用模型」变成
 * 「模型式通用引导，每一步都是一次真实调用」。因此原先「生成只调用一次模型」这句断言
 * 已经不再成立，取而代之的是更精确的口径：**断言那一次「生成结果」（action=complete）
 * 请求体里带的就是作者保存的值**。任务预算是「一轮引导 2500 / 生成结果 4000」，
 * 用例把作者上限设在两者之下（2000 / 2500），所以请求里看到的正是作者设置的那个值本身。
 *
 * 三个受控场景（全部指向本机 `127.0.0.1` 的固定应答端点，不接任何真实外部模型）：
 *   ① 固定 `max_tokens`：请求里必须带 `max_tokens`，且不能再带 `max_completion_tokens`；
 *   ② 默认「自动」：请求里带的是新版写法 `max_completion_tokens`；
 *   ③ 模型明确拒绝该参数：生成如实报错，草稿与正式内容都不产生（不伪装生效）。
 *
 * 「连续次数」属于任务编排，不在模型设置里，本文件不涉及。
 */

const CANDIDATE = {
  core: '一座会改写记忆的钟，逼一个巡夜人选择记住还是遗忘。',
  skeleton: { 开端: '钟声第一次异常', 发展: '追查钟的来源', 转折: '巡夜人发现自己也被改写过', 高潮: '在钟前做出取舍', 结局: '城市记住了代价' },
  volumes: [{ volumeNumber: 1, title: '旧城', goal: '确认钟真的在改写记忆' }],
  storylines: [{ title: '潮汐钟的真相', why: '全书的悬念主线' }],
  pending: []
}

/** 右栏是唯一的引导入口：先选「引导构建」（0 次模型调用），再点「开始引导」。 */
async function openDockGuide(page: Page): Promise<void> {
  await page.getByTestId('assistant-mode-guide').click()
  await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
}

/** 当前作用域下的工作草稿 id：用来证明「失败时既没新建草稿，也没改动已有草稿」。 */
async function draftIds(fixture: ManualFixture, page: Page): Promise<string[]> {
  const response = await page.request.get(
    `${fixture.origin}/api/novels/${fixture.id}/assistant-drafts?scopeKey=${encodeURIComponent('story-core:')}`,
    { headers: fixture.headers }
  )
  return ((await response.json()) as Array<{ id: string }>).map((row) => row.id)
}

/** 正式大纲的当前总纲文本：用来证明「生成失败什么都没写进去」。 */
async function synopsisOf(fixture: ManualFixture, page: Page): Promise<string> {
  const project = (await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json()) as { outline: { synopsis: string } }
  return project.outline.synopsis
}

/** 逐题跳过，把引导推进到「可以生成结果」。每跳一题都是一次真实模型调用。 */
async function driveGuideToReady(page: Page): Promise<void> {
  await page.getByTestId('guide-start').click()
  for (let index = 0; index < 3; index += 1) {
    await expect(page.getByTestId('guide-question')).toBeVisible()
    await page.getByTestId('guide-skip').click()
  }
  await expect(page.getByTestId('guide-ready')).toBeVisible()
}

/** 取出「生成结果」那一次出站请求体（引导会发多次请求，只有它是生成那一步）。 */
function completeRequestBody(calls: string[]): { max_tokens?: number; max_completion_tokens?: number; stream?: boolean } {
  const complete = calls.find((body) => guideActionOf(body) === 'complete')
  expect(complete, '必须真的发出一次「生成结果」请求').toBeDefined()
  return JSON.parse(complete!) as { max_tokens?: number; max_completion_tokens?: number; stream?: boolean }
}

test('固定输出上限真的写进每一次引导请求，并只落草稿', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await buildWritableProject(page, '输出上限固定验收')
  const fixed = await startStubModel(guideResponder({ candidate: CANDIDATE }))
  try {
    await configureProvider(page, fixture.origin, fixture.headers, fixed.baseUrl, {
      maxOutputTokens: 2000,
      outputTokenParameter: 'max_tokens',
      supportsStreaming: false
    })
    // 保存的配置必须能读回：设置不是只活在界面状态里。
    const saved = (await (await page.request.get(`${fixture.origin}/api/providers`, { headers: fixture.headers })).json()) as Array<{ maxOutputTokens?: number; outputTokenParameter?: string }>
    expect(saved[0]).toMatchObject({ maxOutputTokens: 2000, outputTokenParameter: 'max_tokens' })

    const synopsisBefore = await synopsisOf(fixture, page)
    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)
    await driveGuideToReady(page)
    await page.getByTestId('guide-complete').click()
    await expect(page.getByTestId('guide-result')).toBeVisible()
    await page.getByTestId('guide-result-navigate').click()
    await page.getByTestId('candidate-panel').waitFor()

    // 作者上限低于两种任务预算，所以每一次请求里看到的都正是作者保存的那个值。
    expect(fixed.calls.length, '一段引导至少发过多次真实请求').toBeGreaterThan(1)
    for (const raw of fixed.calls) {
      const call = JSON.parse(raw) as { max_tokens?: number; max_completion_tokens?: number }
      expect(call.max_tokens, '保存的默认单次输出上限必须写进每一次请求').toBe(2000)
      expect(call.max_completion_tokens, '固定参数后不应再出现另一种写法').toBeUndefined()
    }
    const complete = completeRequestBody(fixed.calls)
    expect(complete.max_tokens, '生成那一步同样带作者设置的上限').toBe(2000)
    expect(complete.stream, '模型不支持流式时按非流式调用').not.toBe(true)
    // 生成只落草稿：正式大纲一个字不动。
    expect(await synopsisOf(fixture, page), '生成候选不得直接改正式大纲').toBe(synopsisBefore)
  } finally {
    await fixed.close()
  }
})

test('默认「自动」按新版写法发送，并只落草稿', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await buildWritableProject(page, '输出上限自动验收')
  const auto = await startStubModel(guideResponder({ candidate: CANDIDATE }))
  try {
    await configureProvider(page, fixture.origin, fixture.headers, auto.baseUrl, {
      maxOutputTokens: 2500,
      outputTokenParameter: 'auto',
      supportsStreaming: false
    })
    const synopsisBefore = await synopsisOf(fixture, page)
    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)
    await driveGuideToReady(page)
    await page.getByTestId('guide-complete').click()
    await expect(page.getByTestId('guide-result')).toBeVisible()
    await page.getByTestId('guide-result-navigate').click()
    await page.getByTestId('candidate-panel').waitFor()

    const complete = completeRequestBody(auto.calls)
    expect(complete.max_completion_tokens, '「自动」先按 max_completion_tokens 发送').toBe(2500)
    expect(complete.max_tokens).toBeUndefined()
    expect(await synopsisOf(fixture, page), '生成候选不得直接改正式大纲').toBe(synopsisBefore)
  } finally {
    await auto.close()
  }
})

test('模型拒绝该参数时如实报错，不新建草稿也不写正式内容', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await buildWritableProject(page, '输出上限拒绝验收')
  // 只有「生成结果」这一步被回绝：前面几轮引导正常，证明失败发生在生成而不是链路本身。
  const rejecting = await startStubModel(
    guideResponder({ candidate: CANDIDATE }),
    {
      reject: (body) => (guideActionOf(body) === 'complete' && body.includes('"max_tokens"')
        ? "Unsupported parameter: 'max_tokens' is not supported by this model."
        : undefined)
    }
  )
  try {
    await configureProvider(page, fixture.origin, fixture.headers, rejecting.baseUrl, {
      maxOutputTokens: 2000,
      outputTokenParameter: 'max_tokens',
      supportsStreaming: false
    })
    const before = await draftIds(fixture, page)
    const synopsisBefore = await synopsisOf(fixture, page)
    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)
    await driveGuideToReady(page)
    await page.getByTestId('guide-complete').click()

    // 生成必须失败并说明原因，而不是静默换一种参数继续跑。
    await expect(page.getByTestId('guide-error')).toBeVisible()
    await expect(page.getByTestId('guide-error')).not.toBeEmpty()
    expect(rejecting.calls.map((body) => guideActionOf(body)), '被回绝的是生成那一步').toContain('complete')
    // 此前几轮留下的草稿仍在（那是既有内容，不是这次失败产生的）；关键是**没有新草稿、也没有被改写**。
    expect(await draftIds(fixture, page), '失败不得新建或改写草稿').toEqual(before)
    expect(await synopsisOf(fixture, page), '失败不得写进正式大纲').toBe(synopsisBefore)
  } finally {
    await rejecting.close()
  }
})
