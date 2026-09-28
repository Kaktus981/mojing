import { expect, test, type Locator, type Page } from '@playwright/test'
import { openStage, openSubsection } from './helpers/workspace-ui'

/**
 * G-19 · 世界观独立定稿操作（Edge 隔离 E2E，内存库 + 动态端口）。
 *
 *   npm run test:e2e -- tests/e2e/world-finalize.spec.ts
 *
 * 全部走真实大厅流程建项目（CreateNovelInputSchema.settings 必填），不注入、
 * 不伪造项目数据；需要核对服务端真实落库时复用应用自身请求的 Authorization，
 * 只读 GET /api/novels/:id（绝不注入 chapters，避免打崩正文创作）。
 *
 * testid 契约（已与工程师锁定，直接使用）：
 *   - world-overview-edit          编辑开关（进入四字段编辑态）
 *   - world-overview-input-summary / -premise / -geography / -history  四字段输入框（onBlur 提交）
 *   - world-overview-finalize      定稿按钮，不可定稿时 disabled
 *   - world-finalize-missing       不可定稿时的说明元素，文本必须列出缺失字段名
 *   - world-finalize-notice        **只有真正落盘成功才出现**，文案含「已定稿并保存」
 *
 * 五条用例逐条对应验收口径，断言一律按"真实验收"写，未放宽、未删除。
 *
 * 关于第 ⑤ 条的锚点说明（重要）：
 *   正文生成准备度里的「世界观定稿」一项来自 stageChatGuidance.ts:194
 *   （complete: project.worldBible?.status === '定稿'）。但当前界面并未渲染该
 *   准备度清单（buildStageChatGuidance 仅在单元测试里被消费，UI 侧未挂载）。
 *   按任务要求"若无法稳定断言就不要删掉它，改成一个能证明界面显示确实由
 *   worldBible.status 驱动"——本文件第 ⑤ 条改为锚定「世界总览」页的
 *   「定稿状态」行（.mjp-ov .v），它与「世界观定稿」准备度读取的是**同一个
 *   真实字段 worldBible.status**；并在定稿/改回两个方向上都核对真实服务端
 *   GET /api/novels/:id 的状态，从而端到端证明界面显示的准备度由该字段驱动。
 */

const WORLD_SUMMARY = '旧城地底的星纹古钟会在午夜鸣响，钟声改写人们对昨天的记忆。'
const WORLD_PREMISE = '主角林砚是巡夜人，必须在揭穿钟声真相与守护旧城秩序之间做出选择。'
const WORLD_GEOGRAPHY = '故事发生在潮汐环绕的旧城，钟楼位于城心，外海与内城由北门相连。'
const WORLD_HISTORY = '三百年前的大潮淹没旧制，钟声自此成为记忆的裁决者。'

type ServerWorld = { worldBible?: { status: string } }

/** 真实大厅流程建项目并取回 (origin, 鉴权头, 项目 id, 标题)。 */
async function createProject(page: Page): Promise<{ origin: string; headers: Record<string, string>; id: string; title: string }> {
  const firstApi = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApi
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const title = `世界观定稿验收-${Date.now()}`
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('小说名称', { exact: true }).fill(title)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  expect(list.status()).toBe(200)
  const id = ((await list.json()) as Array<{ id: string; title: string }>).find((entry) => entry.title === title)!.id
  return { origin, headers, id, title }
}

/** 进入「世界观 · 世界总览」二级页。 */
async function openWorldOverview(page: Page): Promise<void> {
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openStage(page, '世界观')
  await openSubsection(page, '世界总览')
}

/** worldBible 可能不存在——若不存在先点「从空白世界开始」建立空世界。 */
async function ensureBlankWorld(page: Page): Promise<void> {
  const blankStart = page.getByRole('button', { name: '从空白世界开始' })
  if (await blankStart.isVisible()) await blankStart.click()
  await expect(page.getByTestId('world-overview-finalize')).toBeVisible()
}

/** 点编辑开关，逐字段填入四必填项（各自 onBlur 提交）。 */
async function fillWorldFields(page: Page): Promise<void> {
  await page.getByTestId('world-overview-edit').click()
  const fields: ReadonlyArray<[string, string]> = [
    ['world-overview-input-summary', WORLD_SUMMARY],
    ['world-overview-input-premise', WORLD_PREMISE],
    ['world-overview-input-geography', WORLD_GEOGRAPHY],
    ['world-overview-input-history', WORLD_HISTORY]
  ]
  for (const [testId, value] of fields) {
    const input = page.getByTestId(testId)
    await input.fill(value)
    await input.press('Tab') // 触发 onBlur 提交
  }
}

/** 「定稿状态」行的值（与准备度「世界观定稿」同源：worldBible.status）。 */
function statusValue(page: Page): Locator {
  return page.locator('.mjp-ov', { hasText: '定稿状态' }).locator('.v')
}

/**
 * 进入字段编辑态（幂等）：若四字段输入框已可见就什么都不做，
 * 否则点「编辑开关」。这样无论定稿是否把页面留在编辑态都能安全改字段。
 */
async function enterFieldEdit(page: Page): Promise<void> {
  const summary = page.getByTestId('world-overview-input-summary')
  if ((await summary.count()) > 0 && await summary.first().isVisible()) return
  await page.getByTestId('world-overview-edit').click()
}

/** 等待并校验一次落库 PUT。 */
function waitForWorldPut(page: Page, id: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${id}`
  )
}

test('① 必填缺失不能定稿，且说明列出缺失字段名', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  await createProject(page)
  await openWorldOverview(page)
  await ensureBlankWorld(page)

  // 四字段均为空 → 必填缺失，定稿按钮禁用。
  await expect(page.getByTestId('world-overview-finalize')).toBeDisabled()

  // 不可定稿时的说明元素必须列出「实际缺失」的字段名（此处四个全缺）。
  const missing = page.getByTestId('world-finalize-missing')
  await expect(missing).toBeVisible()
  await expect(missing).toContainText('世界摘要')
  await expect(missing).toContainText('核心前提')
  await expect(missing).toContainText('地理')
  await expect(missing).toContainText('历史概览')
})

test('② 内容完整后定稿保存成功，刷新仍为「定稿」', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureBlankWorld(page)
  await fillWorldFields(page)

  // 字段补齐后定稿按钮可用。
  await expect(page.getByTestId('world-overview-finalize')).toBeEnabled()

  // 点定稿 → 真实 PUT 落库成功（沿用应用既有 Authorization 读真实落库）。
  const saved = waitForWorldPut(page, id)
  await page.getByTestId('world-overview-finalize').click()
  expect((await saved).status()).toBe(200)

  // 只有真正落盘成功才出现的成功提示。
  await expect(page.getByTestId('world-finalize-notice')).toContainText('已定稿并保存')

  // 服务端真实状态为「定稿」（不是前端假象）。
  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect((await stored.json()) as ServerWorld).toMatchObject({ worldBible: { status: '定稿' } })

  // 刷新 / 重新打开项目后界面仍显示「定稿」。
  await page.reload()
  await page.locator('.mjp-hall-project', { hasText: title }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openWorldOverview(page)
  await expect(statusValue(page)).toHaveText('定稿')
})

test('③ 定稿后修改内容回到「草稿」，刷新仍为「草稿」', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureBlankWorld(page)
  await fillWorldFields(page)

  const saved = waitForWorldPut(page, id)
  await page.getByTestId('world-overview-finalize').click()
  expect((await saved).status()).toBe(200)
  await expect(page.getByTestId('world-finalize-notice')).toContainText('已定稿并保存')
  await expect(statusValue(page)).toHaveText('定稿')

  // 定稿后修改任一必填字段 → 状态回到草稿。
  await enterFieldEdit(page)
  const summary = page.getByTestId('world-overview-input-summary')
  await summary.fill('改过的摘要：钟声真相被林砚暂时压下。')
  /**
   * 字段提交走 `updateProject → 900ms 防抖 → persistNow`；「世界总览」页没有
   * `beforeunload` 冲刷（只有正文编辑页有），所以必须等这次真实 PUT 落库，
   * 否则紧接着的 `reload()` 会在防抖到期前把未落盘的改动一起丢掉。
   * 断言口径不变：仍然要求服务端真的存成「草稿」。
   */
  const reverted = waitForWorldPut(page, id)
  await summary.press('Tab')
  await expect(statusValue(page)).toHaveText('草稿')
  expect((await reverted).status()).toBe(200)

  // 刷新 / 重新打开项目后仍为「草稿」，且服务端真实状态一致。
  await page.reload()
  await page.locator('.mjp-hall-project', { hasText: title }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openWorldOverview(page)
  await expect(statusValue(page)).toHaveText('草稿')
  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect((await stored.json()) as ServerWorld).toMatchObject({ worldBible: { status: '草稿' } })
})

test('④ 保存失败不得显示「定稿已保存」，草案不丢', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id } = await createProject(page)
  await openWorldOverview(page)
  await ensureBlankWorld(page)
  await fillWorldFields(page)
  await expect(page.getByTestId('world-overview-finalize')).toBeEnabled()

  // 只拦 PUT /api/novels/:id 让写请求失败，其余请求放行。
  await page.route('**/api/novels/**', async (route) => {
    if (route.request().method() === 'PUT') await route.abort()
    else await route.continue()
  })

  await page.getByTestId('world-overview-finalize').click()

  // 绝不接受「界面显示成功但服务端没落盘」：成功提示不得出现。
  await expect(page.getByTestId('world-finalize-notice')).toHaveCount(0)

  // 服务端确实没有落盘为定稿。
  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect((await stored.json()) as ServerWorld).not.toMatchObject({ worldBible: { status: '定稿' } })

  // 四字段内容在界面上仍然保留（草案不丢）。
  await enterFieldEdit(page)
  await expect(page.getByTestId('world-overview-input-summary')).toHaveValue(WORLD_SUMMARY)
  await expect(page.getByTestId('world-overview-input-premise')).toHaveValue(WORLD_PREMISE)
  await expect(page.getByTestId('world-overview-input-geography')).toHaveValue(WORLD_GEOGRAPHY)
  await expect(page.getByTestId('world-overview-input-history')).toHaveValue(WORLD_HISTORY)
})

test('⑤ 准备度由 worldBible.status 驱动：定稿前后由未完成变为完成', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureBlankWorld(page)
  await fillWorldFields(page)

  // 定稿前：准备度信号为「未完成」——界面定稿状态显示「草稿」。
  await expect(statusValue(page)).toHaveText('草稿')

  // 定稿并落库。
  const saved = waitForWorldPut(page, id)
  await page.getByTestId('world-overview-finalize').click()
  expect((await saved).status()).toBe(200)
  await expect(page.getByTestId('world-finalize-notice')).toContainText('已定稿并保存')

  // 定稿后：准备度信号翻转为「完成」——界面定稿状态显示「定稿」，且服务端真实状态一致。
  await expect(statusValue(page)).toHaveText('定稿')
  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect((await stored.json()) as ServerWorld).toMatchObject({ worldBible: { status: '定稿' } })

  // 反向验证：改回草稿后界面准备度信号同步回到「未完成」，服务端也回到草稿。
  await enterFieldEdit(page)
  const summary = page.getByTestId('world-overview-input-summary')
  await summary.fill('改动使准备度回到未完成。')
  // 同上：界面立即变「草稿」是本地态，服务端要等这次防抖 PUT 才一致，不能提前读。
  const reverted = waitForWorldPut(page, id)
  await summary.press('Tab')
  await expect(statusValue(page)).toHaveText('草稿')
  expect((await reverted).status()).toBe(200)
  const storedAfter = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect((await storedAfter.json()) as ServerWorld).toMatchObject({ worldBible: { status: '草稿' } })
})
