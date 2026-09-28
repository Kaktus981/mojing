import { expect, test, type Page } from '@playwright/test'
import { assertNoViewportOverflow } from './helpers/workspace-ui'

/**
 * 小说大纲 · 四模块整合版（隔离 E2E，使用本机 Microsoft Edge）。
 *
 * 运行方式（唯一允许的方式，内存数据库 + 动态端口）：
 *   npm run test:e2e -- tests/e2e/outline-four-module.spec.ts
 * 绝不连接 `.mojing-dev/mojing.db` 或任何正式库。
 *
 * 测试数据来源：**全部经服务端 `NovelProjectSchema` 校验后真实落库**。
 *   1. `POST /api/novels` 建项目（服务端自己 parse 一份合法项目）；
 *   2. 在它之上补齐卷章结构、章纲、正文与事件线，`PUT /api/novels/:id` 写入；
 *      写入失败即抛错（不允许用不合法的简化数据糊过去）；
 *   3. UI 从大厅真实打开这个项目，因此保存 / 刷新 / 重开都是真实链路。
 * 不用 `page.route` 伪造项目数据；只在「连续编辑竞态」与「保存失败」两条用例里
 * 拦截 PUT 以**延迟 / 失败**，用于验证真实的并发与错误处理。
 */

const MODULE_LABELS = ['创作起点', '总纲与卷纲', '章节规划', '故事线'] as const
const NOW = '2026-09-14T00:00:00.000Z'
const INITIAL_SEED = '巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。'

const moduleTitle = (page: Page) => page.locator('.mjp-view-head .title')
const seedBox = (page: Page) => page.getByRole('textbox', { name: '故事种子' })
const saveState = (page: Page) => page.locator('.mjp-save-state')

function bodyChapter(number: number, title: string, text: string) {
  return {
    id: `ch-${number}`,
    volumeNumber: 1,
    chapterNumber: number,
    title,
    blocks: [{ id: `ch-${number}-b1`, text }],
    status: '草稿' as const,
    sourceDigest: '',
    updatedAt: NOW
  }
}

function beat(order: number, title: string) {
  return {
    id: `beat-${order}`,
    order,
    title,
    purpose: `${title}的目的`,
    conflict: `${title}的冲突`,
    outcome: `${title}的结果`,
    location: '旧城',
    timeframe: '夜',
    reveal: `${title}的揭示`,
    characterIds: [] as string[],
    threadActions: [] as string[]
  }
}

/** 章纲卡：字段齐到能通过 ChapterOutlineSchema。 */
function outlineCard(number: number, title: string, beats: ReturnType<typeof beat>[], extra: Record<string, unknown> = {}) {
  return {
    id: `card-${number}`,
    volumeNumber: 1,
    chapterNumber: number,
    title,
    pov: '林砚',
    objective: `第${number}章目标`,
    conflict: `第${number}章冲突`,
    turningPoint: `第${number}章转折`,
    reveal: `第${number}章揭示`,
    endingHook: `第${number}章钩子`,
    characterIds: [] as string[],
    setupThreadIds: [] as string[],
    payoffThreadIds: [] as string[],
    beats,
    status: number === 1 ? '已写作' : '已规划',
    beatFindings: [] as unknown[],
    lineAssignments: [{ lineId: 'line-1', role: '主线' }],
    ...extra
  }
}

/** 在服务端创建的项目上补齐完整场景数据（真实落库，不用 route 伪造）。 */
function scenarioDocument(created: Record<string, unknown>): Record<string, unknown> {
  return {
    ...created,
    outline: {
      status: '定稿',
      synopsis: '旧城的潮汐钟正在改写人们对昨天的记忆。',
      themes: ['记忆', '责任'],
      mainConflict: '记住真相与维持秩序的对立',
      endingDirection: '主角接管巡夜职责',
      volumes: [
        {
          id: 'vol-1',
          volumeNumber: 1,
          title: '潮汐卷',
          goal: '确认记忆被改写',
          climax: '与巡夜人正面对峙',
          resolution: '暂时守住秘密',
          chapters: [
            outlineCard(1, '古钟初鸣', [beat(1, '发现钟摆异常'), beat(2, '潜入档案室')]),
            outlineCard(2, '裂痕初现', [beat(1, '第2章独有步骤')]),
            outlineCard(3, '钟声之外', [], { downstreamReviewStatus: '待复核', downstreamReviewReason: '卷目标调整' })
          ]
        }
      ],
      updatedAt: NOW
    },
    chapters: [
      bodyChapter(1, '古钟初鸣', '林砚在旧城发现一座刻有星纹的古钟，并决定隐瞒此事。'),
      bodyChapter(2, '裂痕初现', '林砚继续追查古钟的下落。')
    ],
    // 世界观「规则与边界」以 worldBible 为前提；术语与边界只在那一处管理（创作起点已去重）
    worldBible: {
      status: '定稿',
      summary: '旧城靠星纹古钟维持记忆秩序。',
      premise: '记住真相需要付出代价。',
      themes: ['记忆'],
      rules: ['钟声会改写关于昨天的记忆'],
      geography: '',
      historySummary: '',
      entries: [],
      timeline: [],
      updatedAt: NOW
    },
    worldConstraints: [
      {
        id: 'term-1',
        term: '星纹古钟',
        definition: '旧城地底的计时装置，钟声会改写记忆。',
        notDefinition: '不是普通的报时钟。',
        entityType: '器物',
        allowedUsages: ['古钟', '星纹钟'],
        forbiddenUsages: [],
        unresolvedQuestions: ['钟声的改写范围有多大'],
        facts: [{ subject: '星纹古钟', relation: '能够', object: '改写关于昨天的记忆', polarity: '允许' }],
        source: { fieldPath: 'worldConstraints.term-1', excerpt: '刻有星纹的古钟' },
        status: '待确认',
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    storylines: [
      {
        id: 'line-1',
        title: '找出篡改记忆的人',
        type: '调查',
        whyNecessary: '主线推进',
        openingState: '钟声开始异常',
        finalGoal: '让旧城重新记住昨天',
        endCondition: '真相被公开',
        startChapterNumber: 1,
        expectedEndChapterNumber: 8,
        currentProgress: 0.4,
        nextAction: '核对被抹去的名单',
        status: '推进中',
        keyNodes: [{ id: 'kn-1', title: '拿到名单', description: '在档案馆找到被抹去的名单', targetChapterNumber: 3, status: '进行中' }],
        chapterPlans: [{ chapterId: 'ch-1', chapterNumber: 1, subGoal: '进入钟楼', method: '假扮值守', obstacle: '门禁', outcome: '看到异常', nextTrigger: '名单出现', changes: ['信息'], status: '计划' }],
        evidenceChain: [{ chapterId: 'ch-1', excerpt: '刻有星纹的古钟' }],
        unresolvedQuestions: ['谁是第一个被改写的人'],
        updatedAt: NOW
      },
      {
        id: 'line-2',
        title: '巡夜人的背叛',
        type: '战争',
        whyNecessary: '制造对立体',
        openingState: '巡夜人态度暧昧',
        finalGoal: '查清巡夜人为什么放手',
        endCondition: '巡夜人说出真相',
        startChapterNumber: 2,
        expectedEndChapterNumber: 12,
        currentProgress: 0.1,
        nextAction: '等待裂痕卷的关键事件',
        status: '计划暂停',
        pause: {
          reason: '需要先推进主线',
          currentState: '线索中断',
          returnCondition: '主线推进到第 5 章',
          expectedReturnPosition: '下一章开头',
          scope: '本卷'
        },
        updatedAt: NOW
      }
    ]
  }
}

function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

async function openNavSection(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(moduleTitle(page)).toHaveText(itemLabel)
}

async function openModule(page: Page, label: (typeof MODULE_LABELS)[number]): Promise<void> {
  await openNavSection(page, '小说大纲', label)
}

/**
 * 建项目 + 写入契约完整场景数据 + 从大厅真实打开。
 *
 * 建项目走**真实大厅流程**（`settings` 等必填字段由产品自己生成，测试不手写契约），
 * 随后取回服务端的合法文档、补齐卷章 / 章纲 / 正文 / 事件线，再经
 * `PUT /api/novels/:id` 由服务端 `NovelProjectSchema` 校验后真实落库。
 * 会话凭据直接复用应用自身请求上的 `Authorization`，不硬编码令牌、不绕过校验。
 */
async function openScenarioWorkspace(page: Page, prefix: string): Promise<{ origin: string; id: string; revision: number; headers: Record<string, string> }> {
  const firstApiRequest = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApiRequest
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const title = `${prefix}-${Date.now()}`
  // 大厅在「还没有项目」时按钮是「新建小说」，已有项目时是「新建项目」
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(title)
  await page.getByLabel('最初的故事想法').fill(INITIAL_SEED)
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()

  const listResponse = await page.request.get(`${origin}/api/novels`, { headers })
  expect(listResponse.status()).toBe(200)
  const summaries = (await listResponse.json()) as Array<{ id: string; title: string }>
  const summary = summaries.find((item) => item.title === title)
  expect(summary, '新建的项目必须出现在项目列表里').toBeTruthy()

  const projectId = summary!.id
  const currentResponse = await page.request.get(`${origin}/api/novels/${projectId}`, { headers })
  expect(currentResponse.status()).toBe(200)
  const current = (await currentResponse.json()) as Record<string, unknown>

  const seeded = await page.request.put(`${origin}/api/novels/${projectId}`, {
    data: { document: scenarioDocument(current), baseRevision: current.revision },
    headers
  })
  // 服务端会用 NovelProjectSchema 校验；不合法直接失败，不允许用简化数据糊过去。
  if (!seeded.ok()) throw new Error(`测试场景数据未通过服务端契约校验：${seeded.status()} ${await seeded.text()}`)
  const saved = (await seeded.json()) as { revision: number }

  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '创作起点')

  return { origin, id: projectId, revision: saved.revision, headers }
}

test('本项目 E2E 由本机 Microsoft Edge 运行（不下载专用 Chromium）', async ({ page }) => {
  await page.goto('/')
  const userAgent = await page.evaluate(() => navigator.userAgent)
  expect(userAgent, '浏览器标识必须为 Edge').toMatch(/Edg\//)
})

test('正式导航只显示四个模块', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await openScenarioWorkspace(page, '四模块导航')

  const section = page.locator('.mjp-snav').getByRole('button', { name: '小说大纲', exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()

  // 导航项右侧可能带真实计数徽标（卷数 / 事件线数），这里只断言四个模块名
  const labels = (await page.locator('.mjp-snav-item').allInnerTexts())
    .map((text) => text.replace(/\s+/g, '').replace(/[0-9]+$/, ''))
  expect(labels).toEqual([...MODULE_LABELS])
})

test('四个模块之间切换：标题归一为模块名', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await openScenarioWorkspace(page, '四模块切换')
  for (const label of MODULE_LABELS) await openModule(page, label)
})

test('编辑故事种子：保存返回 2xx 且 revision 正确递增', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, revision } = await openScenarioWorkspace(page, '保存成功')

  const saved = projectPut(page, id)
  await seedBox(page).fill('保存成功验证：种子已更新。')
  const response = await saved

  expect(response.status()).toBe(200)
  const body = (await response.json()) as { revision: number; seed: string }
  expect(body.revision, 'revision 必须相对本次基线 +1').toBe(revision + 1)
  expect(body.seed).toBe('保存成功验证：种子已更新。')
  await expect(saveState(page)).toHaveText('已保存')
  console.log(`[保存] PUT 状态=${response.status()} revision ${revision} -> ${body.revision} seed=「${body.seed}」`)
})

test('刷新并返回大厅重新打开后，保存内容仍然保留', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await openScenarioWorkspace(page, '持久化')

  const saved = projectPut(page, id)
  await seedBox(page).fill('重新打开后应保留的内容。')
  expect((await saved).status()).toBe(200)

  // 刷新后回到大厅，重新打开同一个项目
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '创作起点')
  await expect(seedBox(page)).toHaveValue('重新打开后应保留的内容。')

  // 同时从服务端复核，确认不是界面缓存出来的假象
  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(stored.status()).toBe(200)
  const persistedSeed = ((await stored.json()) as { seed: string }).seed
  expect(persistedSeed).toBe('重新打开后应保留的内容。')
  console.log(`[持久化] 刷新+重开后界面与 GET /api/novels/:id 均为「${persistedSeed}」`)
})

test('连续编辑：较早的保存响应不覆盖较新输入，最终内容为最新输入', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, revision } = await openScenarioWorkspace(page, '连续编辑')

  // 只延迟真实 PUT 的返回，不伪造内容：把「响应晚于下一次输入」的竞态放大到可观测
  await page.route(`**/api/novels/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 900))
    await route.continue()
  })

  const isProjectPut = (url: string, method: string) => method === 'PUT' && new URL(url).pathname === `/api/novels/${id}`
  const requests: Array<{ baseRevision: number; document: { seed: string } }> = []
  const responses: Array<{ status: number; body: { revision: number; seed: string } }> = []
  page.on('request', (request) => {
    if (!isProjectPut(request.url(), request.method())) return
    requests.push(request.postDataJSON() as { baseRevision: number; document: { seed: string } })
  })
  page.on('response', (response) => {
    if (!isProjectPut(response.url(), response.request().method())) return
    const status = response.status()
    void response
      .json()
      .then((body) => responses.push({ status, body: body as { revision: number; seed: string } }))
      .catch(() => responses.push({ status, body: { revision: -1, seed: '' } }))
  })

  // A 的请求已发出，但响应还在 900ms 延迟里 —— 此时输入 B
  await seedBox(page).fill('较早的输入 A')
  await expect.poll(() => requests.length, { message: 'A 的保存请求应已发出' }).toBe(1)
  await seedBox(page).fill('较新的输入 B')

  // 两轮保存都结束后，服务端最终内容必须是最新输入
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(2)
  await expect.poll(() => responses.length, { timeout: 15_000 }).toBe(2)
  await expect(saveState(page)).toHaveText('已保存')

  // 关键断言：A 的响应到达后，输入框既不能被打回 A，服务端也不能停在 A
  await expect(seedBox(page)).toHaveValue('较新的输入 B')
  expect(responses[0]!.status).toBe(200)
  expect(responses[1]!.status).toBe(200)
  expect(responses[0]!.body.seed).toBe('较早的输入 A')
  expect(responses[1]!.body.seed, '服务端最终保存的必须是最新输入').toBe('较新的输入 B')
  expect(responses[1]!.body.revision).toBe(revision + 2)
  expect(requests[1]!.baseRevision, '第二次保存必须建立在第一次的新版本上').toBe(revision + 1)
  console.log(`[连续编辑] 状态=${responses.map((item) => item.status).join('/')} 内容=${responses.map((item) => item.body.seed).join(' -> ')} revision ${revision} -> ${responses[1]!.body.revision}（第二次 baseRevision=${requests[1]!.baseRevision}，界面仍为「较新的输入 B」）`)
})

test('已保存状态下：切换模块 / 折叠 / 筛选 / 选择章节与故事线都不产生项目写请求', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openScenarioWorkspace(page, '零写入')
  expect(id).toBeTruthy()
  // 先让任何潜在防抖窗口结束，避免把上一次编辑的请求误判成导航写入
  await page.waitForTimeout(1400)

  const puts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/novels\/[^/]+$/.test(new URL(request.url()).pathname)) puts.push(request.url())
  })

  for (const label of MODULE_LABELS) await openModule(page, label)

  // 世界观也需要覆盖：去重后术语管理只在「规则与边界」，来回切换同样不得写项目
  await openNavSection(page, '世界观', '世界总览')
  await openNavSection(page, '世界观', '规则与边界')
  await openNavSection(page, '世界观', '世界词条')
  await openNavSection(page, '世界观', '规则与边界')

  await openModule(page, '创作起点')
  await page.locator('.mjp-oi-fold-h').first().click()
  await page.locator('.mjp-oi-fold-h').last().click()

  await openModule(page, '章节规划')
  await page.getByRole('tab', { name: '当前附近 5 章' }).click()
  await page.getByRole('tab', { name: '全部章节' }).click()
  const items = page.locator('.mjp-oi-item')
  await items.nth(1).click()
  await items.nth(0).click()
  await page.locator('.mjp-oi-fold-h', { hasText: '剧情步骤' }).click()

  await openModule(page, '故事线')
  await page.locator('.mjp-oi-item.is-line').nth(1).click()

  expect(puts, `不得出现项目写请求（实际 ${puts.length} 次：${puts.join(' , ')}）`).toHaveLength(0)
})

test('章节规划：从已保存的真实正文进入对应章节，页面不崩溃', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await openScenarioWorkspace(page, '进入正文')
  await openModule(page, '章节规划')

  // 第 1 章同时有章纲与正文，详情默认落在它上面；已有正文时入口叫「继续写作」
  await expect(page.locator('.mjp-beats-head .tt')).toContainText('古钟初鸣')
  await expect(page.getByRole('button', { name: '开始写作' })).toHaveCount(0)
  await page.getByRole('button', { name: '继续写作' }).click()

  await expect(moduleTitle(page)).toHaveText('正文编辑')
  await expect(page.locator('.mjp-prose')).toContainText('林砚在旧城发现一座刻有星纹的古钟')
  await expect(page.locator('.mjp-editor-bar .ch-title')).toHaveValue('古钟初鸣')
  expect(errors, `正文创作视图不应抛错：${errors.join(' | ')}`).toHaveLength(0)
  console.log(`[进入正文] 落点模块=「${await moduleTitle(page).innerText()}」章节=「${await page.locator('.mjp-editor-bar .ch-title').inputValue()}」正文含「林砚在旧城发现一座刻有星纹的古钟」`)
})

test('模拟保存失败：保留草稿并显示「保存失败」与真实错误，不显示成功', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openScenarioWorkspace(page, '保存失败')

  await page.route(`**/api/novels/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 500,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: { code: 'TEST_SAVE_FAILURE', message: '测试：保存失败', retryable: true } })
    })
  })

  const attempted = projectPut(page, id)
  await seedBox(page).fill('保存会失败，但草稿必须留下。')
  expect((await attempted).status()).toBe(500)

  await expect(saveState(page)).toHaveText('保存失败')
  await expect(seedBox(page), '失败后必须保留内存草稿').toHaveValue('保存会失败，但草稿必须留下。')
  const errorToast = page.locator('.mjp-toast.is-error')
  await expect(errorToast).toBeVisible()
  await expect(errorToast).toContainText('保存失败')
  await expect(page.locator('.mjp-toast.is-success')).toHaveCount(0)
  console.log(`[保存失败] PUT 状态=${(await attempted).status()} 保存态=「${await saveState(page).innerText()}」提示=「${(await errorToast.innerText()).replace(/\s+/g, ' ')}」草稿保留=是`)
})

test('创作起点不再出现术语管理，术语只在世界观「规则与边界」', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await openScenarioWorkspace(page, '术语去重')
  const canvas = page.locator('.mjp-canvas-scroll')

  // 创作起点：没有术语折叠区、没有重复的状态按钮、也不引用 worldConstraints
  await expect(canvas.locator('.mjp-oi-fold-h', { hasText: '术语与边界' })).toHaveCount(0)
  await expect(canvas.getByRole('button', { name: /^标记(待确认|已确认|已锁定|已拒绝)$/ })).toHaveCount(0)
  await expect(canvas).not.toContainText('worldConstraints')

  const foldTitles = (await canvas.locator('.mjp-oi-fold-h').allInnerTexts()).map((text) => text.replace(/\s+/g, ''))
  expect(foldTitles).toHaveLength(2)
  expect(foldTitles[0]).toContain('方向卡详情')
  expect(foldTitles[1]).toContain('全部创作规格')
  expect(foldTitles.join('|'), '创作起点不应再出现术语折叠区').not.toContain('术语')

  // 世界观「规则与边界」：术语管理仍在这里，并且是导航高亮项
  await openNavSection(page, '世界观', '规则与边界')
  await expect(canvas).toContainText('星纹古钟')
  await expect(canvas.getByRole('button', { name: '标记已确认' })).toBeVisible()
  await expect(page.locator('.mjp-snav-item.is-active')).toHaveText('规则与边界')
  console.log(`[术语去重] 创作起点折叠区=${foldTitles.map((text) => text.replace(/[0-9,]+/g, '')).join(' / ')}、状态按钮=0；世界观「规则与边界」仍管理术语`)
})

test('世界观「规则与边界」切换术语状态：真实保存、revision 递增且不改写定义', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, revision } = await openScenarioWorkspace(page, '术语管理')
  await openNavSection(page, '世界观', '规则与边界')

  const canvas = page.locator('.mjp-canvas-scroll')
  await expect(canvas).toContainText('星纹古钟')

  const saved = projectPut(page, id)
  await canvas.getByRole('button', { name: '标记已确认' }).click()
  const response = await saved

  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    revision: number
    worldConstraints: Array<{ status: string; definition: string; updatedAt: string }>
  }
  expect(body.revision, '术语状态切换必须走同一个 revision 递增通道').toBe(revision + 1)
  expect(body.worldConstraints[0]!.status).toBe('已确认')
  expect(body.worldConstraints[0]!.definition, '只改状态，不改写定义文本').toBe('旧城地底的计时装置，钟声会改写记忆。')
  expect(body.worldConstraints[0]!.updatedAt).not.toBe(NOW)

  // 界面随之更新：不再提供「标记已确认」，改为「标记已锁定」
  await expect(canvas.getByRole('button', { name: '标记已确认' })).toHaveCount(0)
  await expect(canvas.getByRole('button', { name: '标记已锁定' })).toBeVisible()
  console.log(`[术语管理] PUT 状态=${response.status()} revision ${revision} -> ${body.revision} status=待确认→已确认 定义未改写`)
})

test('Edge 下日间 / 夜间与 1500×940 / 1120×940 都无页面级横向滚动，右栏 360px 常驻', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await openScenarioWorkspace(page, '布局与主题')

  const dock = page.locator('.mjp-dock')

  for (const width of [1500, 1120]) {
    for (const theme of ['paper', 'ink'] as const) {
      await page.setViewportSize({ width, height: 940 })
      // 主题是语义令牌切换（写 documentElement.dataset.theme），与设置面板同一处状态
      await page.evaluate((next) => { document.documentElement.dataset.theme = next }, theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      for (const label of MODULE_LABELS) {
        await openModule(page, label)
        await assertNoViewportOverflow(page, `${label} @ ${width} / ${theme}`)
        await expect(dock).toBeVisible()
        expect(
          await dock.evaluate((element) => element.getBoundingClientRect().width),
          `右栏宽度必须固定为 360px（${label} @ ${width} / ${theme}）`
        ).toBeCloseTo(360, 0)
      }
    }
  }

  // 助手栏不得存在折叠 / 抽屉 / 遮罩
  await expect(dock.getByRole('button', { name: /收起|折叠|关闭/ })).toHaveCount(0)
  await expect(page.locator('.mjp-mask')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /助手|对话/ })).toHaveCount(0)
})
