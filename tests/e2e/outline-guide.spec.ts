import { expect, test } from '@playwright/test'
import { guideActionOf, guideResponder } from './helpers/guide-stub'
import { buildWritableProject, openModule } from './helpers/manual-workspace'
import { configureProvider, startStubModel, type StubModel } from './helpers/stub-model'

/**
 * 大纲引导的端到端验收（2026-09-17 Task 8 迁移）。
 *
 * ⚠️ 本轮的关键变更：中央「创作起点」里的 `OutlineGuide` 挂载**已下线**，
 * 右栏的「引导构建」（`assistant-mode-guide` → `guided-assistant-panel`）是**唯一**的引导界面。
 * 因此本文件里所有引导交互都从中央模块迁到了右栏；业务断言一条都没有删除。
 *
 * 出题与作答由 `helpers/guide-stub.ts` 的受控桩驱动：它是**本机**开放的 OpenAI 兼容最小端点，
 * **不接任何真实外部模型**，也不绕过鉴权、Schema 校验或候选事务 —— 被验证的仍是产品自己的链路。
 *
 * 图例：`guide-*` 的 testid 现在只可能来自右栏，中央模块不再是候选来源。
 */

type Fixture = Awaited<ReturnType<typeof buildWritableProject>>

const CANDIDATE = {
  core: '一座会改写记忆的钟，逼一个巡夜人选择记住还是遗忘。',
  skeleton: { 开端: '钟声第一次异常', 发展: '追查钟的来源', 转折: '巡夜人发现自己也被改写过', 高潮: '在钟前做出取舍', 结局: '城市记住了代价' },
  volumes: [{ volumeNumber: 1, title: '旧城', goal: '确认钟真的在改写记忆' }, { volumeNumber: 2, title: '潮汐', goal: '找到钟的来源并付出代价' }],
  storylines: [{ title: '潮汐钟的真相', why: '全书的悬念主线' }],
  pending: []
}

function startStubModelForGuide(reject?: (body: string) => string | undefined): Promise<StubModel> {
  return startStubModel(guideResponder({ candidate: CANDIDATE }), reject ? { reject } : {})
}

/**
 * 右栏是唯一的引导入口：先选「引导构建」，再点「开始引导」。
 *
 * 选择模式本身是一次纯界面动作（0 次模型调用）；真正的第一次模型调用发生在
 * 点击「开始引导」之后 —— 这是已批准的行为变更，原「引导本身 0 调用」的旧规则
 * 由下面每条用例的计数断言按新规则迁移。
 */
async function openDockGuide(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('assistant-mode-guide').click()
  await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
}

/** 通用会话的作用域键：`outline:<projectId>:story-core:`。 */
function guideScopeKey(projectId: string): string {
  return `outline:${projectId}:story-core:`
}

async function readGuideSession(fixture: Fixture, page: import('@playwright/test').Page): Promise<{ confirmedAnswers: unknown[] } | null> {
  const response = await page.request.get(
    `${fixture.origin}/api/novels/${fixture.id}/assistant-guides/current?domain=outline&scopeKey=${encodeURIComponent(guideScopeKey(fixture.id))}`,
    { headers: fixture.headers }
  )
  return (await response.json()) as { confirmedAnswers: unknown[] } | null
}

test('从故事想法开始引导：跳题不阻断，退出刷新保留，生成初纲后采用才改正式内容', async ({ page }) => {
  const stub = await startStubModelForGuide()
  try {
    const fixture = await buildWritableProject(page, '大纲引导验收')
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)

    // 已批准的行为变更（规则式引导 → 模型式通用引导）：
    // 选择「引导构建」本身 0 次模型调用；点击「开始引导」才发第一次。
    expect(stub.calls.length, '选择引导本身不调用模型').toBe(0)
    // 等待态：中央引导挂载下线后，「开始引导」在全页只可能有一个。
    await expect(page.getByTestId('guide-start'), '等待态下 guide-start 必须唯一').toHaveCount(1)
    await expect(page.getByTestId('guide-question'), '等待态下不应有问题块').toHaveCount(0)
    await expect(page.getByTestId('guide-error'), '等待态下不应有错误块').toHaveCount(0)
    await page.getByTestId('guide-start').click()
    await expect(page.getByTestId('guide-question')).toBeVisible()
    expect(stub.calls.length, '点击开始引导才发第一次模型调用').toBe(1)

    // 一次只问一个缺口，并且永远可以跳过；同时必须说清「为什么先问它」。
    await expect(page.getByTestId('guide-question')).toContainText('先问这个')
    // 提问态：问题块与焦点块都只来自右栏，必须各自唯一。
    await expect(page.getByTestId('guide-question'), '提问态下 guide-question 必须唯一').toHaveCount(1)
    await expect(page.getByTestId('guide-focus'), '提问态下 guide-focus 必须唯一').toHaveCount(1)
    await expect(page.getByTestId('guide-start'), '提问态下不应再出现开始引导').toHaveCount(0)
    const firstQuestion = (await page.getByTestId('guide-question').innerText()).trim()
    await expect(page.getByTestId('guide-focus')).toBeVisible()
    await page.getByTestId('guide-skip').click()
    // 等进度真的前进再读题：题目区在请求在途时仍可见，直接读会读到上一题。
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')
    await expect(page.getByTestId('guide-question')).toBeVisible()
    expect(stub.calls.length, '每次作答恰好一次模型调用').toBe(2)
    expect((await page.getByTestId('guide-question').innerText()).trim(), '下一问必须换一个缺口').not.toBe(firstQuestion)

    // 采用一个方向 → 已确认回答数真实增加（不是估算的题数）。
    const optionRow = page.getByTestId('guide-option').first()
    const adoptedLabel = (await optionRow.locator('.t').first().innerText()).trim()
    expect(adoptedLabel.length, '选项必须带可读标签').toBeGreaterThan(0)
    await optionRow.locator('input[type="radio"]').check()
    await page.getByTestId('guide-submit-option').click()
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 2 个回答')
    await expect(page.getByTestId('guide-question')).toBeVisible()
    expect(stub.calls.length, '每次作答恰好一次模型调用').toBe(3)

    // P04：下一问要建立在作者刚才那条回答上，不是把静态题目换个问法。
    // 注意：题目文本由受控桩产出，这里的「包含上一条答案」验证的是
    // 「答案确实进了链路并被渲染」，**不**证明模型智能；真正的业务断言是下面的出站上下文。
    await expect(page.getByTestId('guide-question')).toContainText(adoptedLabel)
    await expect(page.getByTestId('guide-question')).toContainText('这条阻力')
    await expect(page.getByTestId('guide-question')).toContainText('你已经写下的阻力是')
    // 静态模板句不再出现，证明问的是「当前这个故事」，不是固定脚本。
    await expect(page.getByTestId('guide-question')).not.toContainText('你希望故事大致走向什么样的结局？')

    await page.getByTestId('guide-skip').click()

    // 退出再回来：回答没丢（已确认回答数仍然真实反映进度）。
    await page.reload()
    await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
    await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
    await openModule(page, '小说大纲', '创作起点')
    await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 3 个回答')

    // 生成初纲：只落草稿，正式项目不变。
    const before = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      outline: { synopsis: string; volumes: Array<{ goal: string }> }
    }
    await expect(page.getByTestId('guide-ready')).toBeVisible()
    await page.getByTestId('guide-complete').click()
    await expect(page.getByTestId('guide-result')).toBeVisible()
    const afterGenerate = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      outline: { synopsis: string }
    }
    expect(afterGenerate.outline.synopsis, '生成初纲不得直接改正式内容').toBe(before.outline.synopsis)

    // 草稿出现在右侧候选面板，采用后才写入。
    await page.getByTestId('guide-result-navigate').click()
    await page.getByTestId('candidate-panel').waitFor()
    await page.getByTestId('candidate-preview').click()
    await expect(page.getByTestId('candidate-panel')).toContainText('初步大纲（总纲 + 卷目标 + 故事线）')
    const applied = page.waitForResponse((response) => response.url().includes('/assistant-drafts/') && response.url().endsWith('/apply') && response.status() === 200)
    await page.getByTestId('candidate-adopt').click()
    await applied
    await expect(page.getByTestId('candidate-panel')).toHaveCount(0)

    const adopted = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json() as {
      outline: { synopsis: string; volumes: Array<{ goal: string }> }
      storylines: Array<{ title: string }>
      chapters: Array<{ blocks: Array<{ text: string }> }>
      worldBible: { entries: unknown[] }
      plotThreads: unknown[]
    }
    expect(adopted.outline.synopsis).toBe(CANDIDATE.core)
    expect(adopted.outline.volumes.map((item) => item.goal)).toEqual(['确认钟真的在改写记忆', '找到钟的来源并付出代价'])
    expect(adopted.storylines.map((item) => item.title)).toContain('潮汐钟的真相')
    // 初纲不自动生成正文、词条或伏笔。
    expect(adopted.chapters[0]!.blocks[0]!.text.length).toBeGreaterThan(0)
    expect(adopted.plotThreads, '初纲不自动生成伏笔').toHaveLength(0)
    expect(stub.calls.length).toBeGreaterThan(0)
    // P04 出站上下文：模型收到的「已确认回答」里必须带着作者刚才那条回答。
    // 受控模型只用来证明「上下文确实带过去了」，它的产出**不作为创作质量验收**。
    // 先 parse 再 stringify：转义过的中文在这里被还原，比对原始字节不稳。
    const outbound = stub.calls.map((body) => JSON.stringify(JSON.parse(body) as unknown)).join('\n')
    expect(outbound, '出站上下文必须带上作者刚给出的回答').toContain(adoptedLabel)
  } finally {
    await stub.close()
  }
})

/**
 * 动态引导的直证：第二问必须建立在第一问的回答上。
 *
 * 证据链刻意分成两段（这是受控桩的能力边界，见本文件顶部注释）：
 *   - 本条证明「回答真的被用起来」：进了服务端会话、下一问引用它、界面显示对应问题与选项；
 *   - 「出站上下文携带这条回答」在下面那条会真正生成初纲的用例里断言。
 */
test('第二问建立在第一问的回答上，服务端会话与界面都留有这条依据', async ({ page }) => {
  const stub = await startStubModelForGuide()
  try {
    const fixture = await buildWritableProject(page, '引导动态性验收')
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)
    await page.getByTestId('guide-start').click()

    // 第一问：作者采用一个方向 —— 这就是「第一问的回答」。
    await expect(page.getByTestId('guide-question')).toBeVisible()
    const optionRow = page.getByTestId('guide-option').first()
    const answer = (await optionRow.locator('.t').first().innerText()).trim()
    expect(answer.length, '选项必须带可读标签').toBeGreaterThan(0)
    await optionRow.locator('input[type="radio"]').check()
    await page.getByTestId('guide-submit-option').click()

    // 1) 界面：已确认回答数真实增加，下一问把它引用回来（不只是换了个问法）。
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')
    await expect(page.getByTestId('guide-question')).toContainText(answer)
    await expect(page.getByTestId('guide-question')).toContainText('先问这个')
    // 2) 与这条回答对应的问题与选项仍然渲染出来，作者可以继续作答。
    expect(await page.getByTestId('guide-option').count(), '选项行仍然渲染出来').toBeGreaterThan(0)

    // 3) 服务端：通用会话里真的存着这条回答，不是界面显示一下就算。
    const session = await readGuideSession(fixture, page)
    expect(JSON.stringify(session?.confirmedAnswers ?? [])).toContain(answer)
  } finally {
    await stub.close()
  }
})

test('模型不可用时生成如实失败，讨论与旧草稿都还在', async ({ page }) => {
  // 「生成结果」这一步模型不可用：桩按 400 回绝 complete，产品必须如实报错而不是假装成功。
  const stub = await startStubModelForGuide((body) => (guideActionOf(body) === 'complete' ? '模型暂时不可用（stub）' : undefined))
  try {
    const fixture = await buildWritableProject(page, '引导失败验收')
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)
    await page.getByTestId('guide-start').click()

    // 逐题推进到「可以生成结果」。
    await expect(page.getByTestId('guide-question')).toBeVisible()
    await page.getByTestId('guide-option').first().locator('input[type="radio"]').check()
    await page.getByTestId('guide-submit-option').click()
    await expect(page.getByTestId('guide-question')).toBeVisible()
    await page.getByTestId('guide-skip').click()
    await expect(page.getByTestId('guide-question')).toBeVisible()
    await page.getByTestId('guide-skip').click()

    await expect(page.getByTestId('guide-ready')).toBeVisible()
    await page.getByTestId('guide-complete').click()

    const error = page.getByTestId('guide-error')
    await expect(error).toBeVisible()
    await expect(page.getByTestId('guide-error'), '失败态下 guide-error 必须唯一').toHaveCount(1)
    await expect(error).toContainText(/模型|密钥|失败/)
    // 已经确认的回答没有被清掉：作者不点模型也能继续作答或重新分析。
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 3 个回答')
    // 引导会话没有被清掉：服务端会话里仍留着这些回答。
    const session = await readGuideSession(fixture, page)
    expect(session?.confirmedAnswers.length ?? 0).toBeGreaterThan(0)
    // 没有产生任何草稿。
    const drafts = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, { headers: fixture.headers })).json() as unknown[]
    expect(drafts.length).toBe(0)
  } finally {
    await stub.close()
  }
})

/**
 * 旧会话兼容桥（Task 8 approved behavior #3）。
 *
 * `novel_guide_sessions` 与 `/outline-guide` 这套旧接口**不删除**：作者在旧版本里
 * 已经答过的内容必须还能看见、还能继续用。旧会话被懒导入成通用会话后，
 * 形态是「已有 `confirmedAnswers`、`turn` 为 `null`」，此时界面**不得**
 * 假装还在分析、也不得强制重新开始把答案清掉，而应如实要求「重新分析」并保留答案。
 *
 * 这里走的是真实旧接口（`POST /outline-guide/start` + `PUT /outline-guide/answers`），
 * 不是手写数据库；验证的是浏览器里右栏的真实表现。
 */
test('旧大纲引导会话被导入右栏：旧答案可见可续，重新分析不清空答案', async ({ page }) => {
  test.setTimeout(120_000)
  const stub = await startStubModelForGuide()
  try {
    const fixture = await buildWritableProject(page, '旧会话兼容验收')
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

    // 用真实旧接口写下两条「已回答」，模拟旧版本留下的会话。
    const started = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/outline-guide/start`, {
      headers: fixture.headers, data: {}
    })
    expect(started.status(), '旧接口必须保留可用').toBe(201)
    for (const [slot, value] of [['protagonist', '巡夜人林砚'], ['coreConflict', '潮汐钟正在改写记忆']] as const) {
      const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}/outline-guide/answers`, {
        headers: { ...fixture.headers, 'Content-Type': 'application/json' },
        data: { slot, state: '已回答', value, source: '作者填写' }
      })
      expect(saved.status(), '旧答案必须写得进去').toBe(200)
    }
    const legacyBefore = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/outline-guide`, { headers: fixture.headers })).json() as {
      session: { answers: unknown[] } | null
    }
    expect(legacyBefore.session?.answers.length, '旧会话里应留下两条回答').toBe(2)

    // 打开右栏引导：旧会话被懒导入，界面如实落到「需要复核」，而不是永久等待或强制重来。
    await openModule(page, '小说大纲', '创作起点')
    await openDockGuide(page)
    await expect(page.getByTestId('guide-needs-review')).toBeVisible()
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 2 个回答')
    // 这一次导入**不**调用模型：界面上还看不到任何引导请求。
    expect(stub.calls.length, '导入旧会话本身不调用模型').toBe(0)

    // 重新分析：恰好一次模型调用，且答案必须被带进这次出站请求。
    await page.getByTestId('guide-reanalyze').click()
    await expect(page.getByTestId('guide-question')).toBeVisible()
    expect(stub.calls.length, '重新分析恰好一次模型调用').toBe(1)
    expect(guideActionOf(stub.calls[0]!), '这一次出站是重新分析').toBe('reanalyze')
    const outbound = stub.calls[0]!
    expect(outbound, '重新分析必须带上旧答案').toContain('巡夜人林砚')
    expect(outbound, '重新分析必须带上旧答案').toContain('潮汐钟正在改写记忆')

    // 答案没有被清空、也没有被强制重新开始。
    await expect(page.getByTestId('guide-progress')).toContainText('已确认 2 个回答')
    const session = await readGuideSession(fixture, page)
    expect(session?.confirmedAnswers.length ?? 0).toBe(2)
    // 旧会话表与旧答案仍然可读（没有被这次兼容桥删掉）。
    const legacyAfter = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/outline-guide`, { headers: fixture.headers })).json() as {
      session: { answers: unknown[] } | null
    }
    expect(legacyAfter.session?.answers.length, '旧答案不得被删除').toBe(2)
    expect(JSON.stringify(legacyAfter.session)).toContain('巡夜人林砚')
  } finally {
    await stub.close()
  }
})
