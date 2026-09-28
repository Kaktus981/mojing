import { expect, test, type Page } from '@playwright/test'

/**
 * M3 · 空项目到总纲与卷纲（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-outline.spec.ts
 *
 * 全流程纯 UI：大厅真实创建空项目 → 创作起点「创建空白大纲」→ 手写总纲 →
 * 新增首卷并填写卷字段 → 刷新重开保留。
 * 不使用 page.route 伪造项目数据；只在最后用 GET 复核服务端真实内容。
 */

const NOW_TEXT = '旧城的潮汐钟会改写人们对昨天的记忆。'
const CONFLICT_TEXT = '记住真相与维持秩序的对立。'
const ENDING_TEXT = '主角接手巡夜职责。'
const VOLUME_TITLE = '潮汐卷'
const VOLUME_GOAL = '确认记忆被改写'
const VOLUME_CLIMAX = '与巡夜人正面对峙'
const VOLUME_RESOLUTION = '暂时守住秘密'

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')

function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

async function createEmptyProject(page: Page, prefix: string): Promise<{ origin: string; id: string; headers: Record<string, string> }> {
  const firstApiRequest = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApiRequest
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const projectTitle = `${prefix}-${Date.now()}`
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(projectTitle)
  await page.getByLabel('最初的故事想法').fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()

  // 新建项目先进入项目工作台；回到创作起点后才能创建空白大纲。
  const outlineSection = page.locator('.mjp-snav').getByRole('button', { name: '小说大纲', exact: true })
  if ((await outlineSection.getAttribute('aria-expanded')) !== 'true') await outlineSection.click()
  await page.locator('.mjp-snav').getByRole('button', { name: /^创作起点/ }).click()
  await expect(title(page)).toHaveText('创作起点')

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  const summaries = (await list.json()) as Array<{ id: string; title: string }>
  const summary = summaries.find((item) => item.title === projectTitle)!
  return { origin, id: summary.id, headers }
}

test('空项目纯 UI 建立空白大纲、手写总纲与首卷，刷新重开保留', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createEmptyProject(page, 'M3 大纲')

  // 1) 创作起点：还没有大纲时提供「创建空白大纲」
  await expect(title(page)).toHaveText('创作起点')
  const createOutline = page.getByRole('button', { name: '创建空白大纲' })
  await expect(createOutline).toBeEnabled()

  const created = projectPut(page, id)
  await createOutline.click()
  expect((await created).status()).toBe(200)

  // 2) 建立后落在总纲与卷纲，且内容全空（不预填示例）
  await expect(title(page)).toHaveText('总纲与卷纲')
  await expect(page.getByRole('textbox', { name: '总纲' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '主冲突' })).toHaveValue('')
  await expect(page.getByRole('textbox', { name: '结局方向' })).toHaveValue('')
  await expect(canvas(page)).toContainText('还没有卷')

  // 3) 手写总纲三字段
  await page.getByRole('textbox', { name: '总纲' }).fill(NOW_TEXT)
  await page.getByRole('textbox', { name: '主冲突' }).fill(CONFLICT_TEXT)
  await page.getByRole('textbox', { name: '结局方向' }).fill(ENDING_TEXT)

  // 4) 新增首卷并填写卷字段
  const added = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  await added

  await page.getByRole('textbox', { name: '第1卷 卷名' }).fill(VOLUME_TITLE)
  await page.getByRole('textbox', { name: '第1卷 本卷目标' }).fill(VOLUME_GOAL)
  await page.getByRole('textbox', { name: '第1卷 本卷高潮' }).fill(VOLUME_CLIMAX)
  const lastSaved = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1卷 本卷收束' }).fill(VOLUME_RESOLUTION)
  expect((await lastSaved).status()).toBe(200)

  // 5) 服务端复核：内容确实落库
  const stored = (await (await page.request.get(`${origin}/api/novels/${id}`, { headers })).json()) as {
    outline: { synopsis: string; mainConflict: string; endingDirection: string; volumes: Array<{ title: string; goal: string; climax: string; resolution: string; chapters: unknown[] }> }
  }
  expect(stored.outline.synopsis).toBe(NOW_TEXT)
  expect(stored.outline.mainConflict).toBe(CONFLICT_TEXT)
  expect(stored.outline.endingDirection).toBe(ENDING_TEXT)
  expect(stored.outline.volumes).toHaveLength(1)
  expect(stored.outline.volumes[0]).toMatchObject({
    title: VOLUME_TITLE,
    goal: VOLUME_GOAL,
    climax: VOLUME_CLIMAX,
    resolution: VOLUME_RESOLUTION,
    chapters: []
  })

  // 6) 刷新后重新打开：内容保留
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  // 232px 导航是手风琴：已展开时再点会收起，所以先判断状态
  const section = page.locator('.mjp-snav').getByRole('button', { name: '小说大纲', exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: /^总纲与卷纲/ }).click()
  await expect(title(page)).toHaveText('总纲与卷纲')
  await expect(page.getByRole('textbox', { name: '总纲' })).toHaveValue(NOW_TEXT)
  await expect(page.getByRole('textbox', { name: '第1卷 卷名' })).toHaveValue(VOLUME_TITLE)
  await expect(page.getByRole('textbox', { name: '第1卷 本卷收束' })).toHaveValue(VOLUME_RESOLUTION)

  console.log(`[M3] 空白大纲建立→总纲/主冲突/结局已写→首卷「${VOLUME_TITLE}」→刷新重开保留；服务端 chapters=0`)
})
