import { expect, test, type Page } from '@playwright/test'
import { openStage, openSubsection } from './helpers/workspace-ui'

/**
 * P09 · 世界观「世界总览」的本机草稿容灾（Edge 隔离 E2E，内存库 + 动态端口）。
 *
 *   npm run test:e2e -- tests/e2e/world-draft-recovery.spec.ts
 *
 * 为什么单独一条：`tests/e2e/world-finalize.spec.ts` 第 ④ 条只证明了「保存失败时
 * 界面字段仍保留（草案不丢）」，那是**同一页面实例内**的保留；本文件证明的是
 * 另一层——「输入即写本机容灾缓存」，所以**页面被刷新掉**之后未保存的输入仍然
 * 拿得回来，而且缓存绝不会自己覆盖服务端内容。
 *
 * 全部走真实大厅流程建项目，不注入、不伪造项目数据；服务端侧的核对一律复用
 * 应用自身请求的 Authorization，只读 GET /api/novels/:id（不注入 chapters）。
 *
 * testid 契约（与实现锁定）：
 *   - world-overview-edit                  进入四字段编辑态
 *   - world-overview-input-summary         摘要输入框（onChange 写容灾缓存，onBlur 才提交）
 *   - world-overview-save-state            编辑态的保存状态文案
 *   - world-overview-stash                 未保存本机草稿提示
 *   - world-overview-stash-restore         恢复草稿
 *   - world-overview-stash-discard         放弃草稿
 *
 * 关于「怎么确定容灾缓存真的写进去了」：本页没有暴露写入完成的界面信号，
 * 所以直接读 IndexedDB 里那条作用域草稿来当门槛。读取时**只打开已存在的库**
 * （先 `indexedDB.databases()` 确认存在、且不带版本号打开），避免测试自己
 * 创建出一个没有 object store 的库，把应用的草稿通道弄坏。
 *
 * 第 ② 条顺带守住一个真实丢字窗口：保存还没回来时又敲进去的字，不能被「上一次保存
 * 的确认」当成已确认而清掉（确认只覆盖到保存发出那一刻的输入）。所以那里用 blur()
 * 制造「一次保存刚落定、紧接着又输入」，而不是 Tab——Tab 会把焦点交给下一个文本框，
 * 引入与被测语义无关的第二次保存。
 */

const TYPED_SUMMARY = '钟声改写的其实是外海潮汐的周期，旧城只是被顺手抹掉了昨天。'
const SAVED_SUMMARY = '已保存的摘要：旧城钟楼在午夜鸣响。'

type ServerWorld = { worldBible?: { summary?: string; status?: string } }

/** 真实大厅流程建项目并取回 (origin, 鉴权头, 项目 id, 标题)。 */
async function createProject(page: Page): Promise<{ origin: string; headers: Record<string, string>; id: string; title: string }> {
  const firstApi = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApi
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const title = `世界观容灾验收-${Date.now()}`
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

/** worldBible 不存在时先建立空世界。 */
async function ensureWorldOverview(page: Page): Promise<void> {
  const blankStart = page.getByRole('button', { name: '从空白世界开始' })
  if (await blankStart.isVisible()) await blankStart.click()
  await expect(page.getByTestId('world-overview-finalize')).toBeVisible()
}

/** 进入字段编辑态（幂等）：输入框已在就什么都不做。 */
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

/**
 * 只输入、不失焦：onChange 写容灾缓存（400ms 防抖），onBlur 才走 updateProject → PUT。
 *
 * 输入前先等「已保存到服务端」：本页只在「本页出现过未保存 → 服务端已确认」的
 * 转换后清理容灾缓存，若不等这次确认就输入，晚到的确认会把刚写入的缓存清掉。
 */
async function typeSummaryWithoutBlur(page: Page, projectId: string, text: string): Promise<void> {
  await enterFieldEdit(page)
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')
  const input = page.getByTestId('world-overview-input-summary')
  await input.fill(text)
  await expect.poll(
    () => readStashedSummary(page, `world-overview:${projectId}`),
    { timeout: 15_000, message: '容灾缓存应记录本次未保存输入' }
  ).toBe(text)
}

/** 刷新并重新进入同一项目（容灾缓存按项目隔离，必须回到同一项目才谈得上恢复）。 */
async function reopenProject(page: Page, title: string): Promise<void> {
  await page.reload()
  await page.locator('.mjp-hall-project', { hasText: title }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openWorldOverview(page)
}

/** 读取 IndexedDB 里那条作用域草稿的摘要值；库不存在就返回 null（绝不代应用建库）。 */
function readStashedSummary(page: Page, key: string): Promise<string | null> {
  return page.evaluate(async (draftKey) => {
    const known = await indexedDB.databases()
    if (!known.some((entry) => entry.name === 'mojing-draft-recovery')) return null
    return await new Promise<string | null>((resolve) => {
      // 不带版本号打开：库里本来就有的版本，不会触发升级、也不会新建 object store。
      const open = indexedDB.open('mojing-draft-recovery')
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        const database = open.result
        try {
          const request = database.transaction('scoped-drafts', 'readonly').objectStore('scoped-drafts').get(draftKey)
          request.onsuccess = () => {
            const record = request.result as { payload?: { summary?: string } } | undefined
            database.close()
            resolve(record?.payload?.summary ?? null)
          }
          request.onerror = () => { database.close(); resolve(null) }
        } catch {
          database.close()
          resolve(null)
        }
      }
    })
  }, key)
}

async function readServerSummary(
  page: Page, origin: string, headers: Record<string, string>, id: string
): Promise<string> {
  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  return ((await stored.json()) as ServerWorld).worldBible?.summary ?? ''
}

test('① 未失焦就刷新：未保存输入不静默落库，重新进入后可从本机草稿恢复并真正保存', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)

  await typeSummaryWithoutBlur(page, id, TYPED_SUMMARY)

  // 还没失焦 → 还没发 PUT：服务端摘要仍为空，说明这确实只是本机草稿，不是「已经保存」。
  expect(await readServerSummary(page, origin, headers, id)).toBe('')

  // 刷新掉页面（未保存输入随之从内存消失），再回到同一项目。
  await reopenProject(page, title)

  // 本机容灾缓存被如实提示，并提供「恢复 / 放弃」两个动作。
  await expect(page.getByTestId('world-overview-stash')).toBeVisible()
  await expect(page.getByTestId('world-overview-stash-restore')).toBeVisible()

  // 缓存不会自动覆盖服务端：此时服务端摘要依然是空。
  expect(await readServerSummary(page, origin, headers, id)).toBe('')

  // 「恢复草稿」把草稿写回本页真实字段，并走统一保存通道真的落库。
  await page.getByTestId('world-overview-stash-restore').click()
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
  await expect(page.locator('.mjp-card', { hasText: '世界摘要' }).locator('.mjp-synopsis')).toContainText(TYPED_SUMMARY)
  await expect.poll(
    () => readServerSummary(page, origin, headers, id),
    { timeout: 15_000, message: '恢复草稿后应经统一保存通道真正落库' }
  ).toBe(TYPED_SUMMARY)

  // 恢复后缓存已被清理，再刷新一次不再提示存在未保存草稿。
  await expect.poll(() => readStashedSummary(page, `world-overview:${id}`), { timeout: 15_000 }).toBe(null)
  await reopenProject(page, title)
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
  await expect(page.locator('.mjp-card', { hasText: '世界摘要' }).locator('.mjp-synopsis')).toContainText(TYPED_SUMMARY)
})

test('② 放弃草稿只清本机缓存：不影响已保存内容，之后不再提示', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)

  // 先落一份「已保存内容」，用来证明放弃草稿不会动它。
  // 用 blur() 而不是 press('Tab')：Tab 会把焦点交给下一个文本框，等会儿再回到摘要框时
  // 那个文本框的 onBlur 会再发一次保存，把「这次输入」误当成已确认而清掉草稿缓存。
  await enterFieldEdit(page)
  const summary = page.getByTestId('world-overview-input-summary')
  await summary.fill(SAVED_SUMMARY)
  const saved = waitForWorldPut(page, id)
  await summary.blur()
  expect((await saved).status()).toBe(200)
  const settled = await readServerSummary(page, origin, headers, id)
  expect(settled).toBe(SAVED_SUMMARY)
  // 等这次保存的确认真正落定（本页确实回到「已保存到服务端」）再敲下一段。
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')

  // 之后再输入一段、不失焦就刷新 → 产生一条未保存的本机草稿。
  await typeSummaryWithoutBlur(page, id, TYPED_SUMMARY)
  await reopenProject(page, title)
  await expect(page.getByTestId('world-overview-stash')).toBeVisible()

  // 「放弃草稿」：只删本机缓存。
  await page.getByTestId('world-overview-stash-discard').click()
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
  await expect.poll(() => readStashedSummary(page, `world-overview:${id}`), { timeout: 15_000 }).toBe(null)

  // 已保存内容一个字符都没变。
  expect(await readServerSummary(page, origin, headers, id)).toBe(settled)
  await expect(page.locator('.mjp-card', { hasText: '世界摘要' }).locator('.mjp-synopsis')).toContainText(settled)

  // 再刷新一次：缓存已删，不再提示。
  await reopenProject(page, title)
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
})

test('③ 失焦后落库防抖未到期就刷新：服务端没有这次改动，本机草稿仍可恢复并落库', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)

  await enterFieldEdit(page)
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')
  const input = page.getByTestId('world-overview-input-summary')
  await input.fill(TYPED_SUMMARY)
  // 输入即写本机缓存（400ms 防抖）：先证明「还没失焦」时缓存里已经有这段字。
  await expect.poll(
    () => readStashedSummary(page, `world-overview:${id}`),
    { timeout: 15_000, message: '失焦之前本机草稿就应写好' }
  ).toBe(TYPED_SUMMARY)

  /**
   * 复现「字段已失焦、服务端保存还没落定」的那段窗口：把落库 PUT 按住不放。
   * 这样无论刷新发生在 900ms 落库防抖到期之前还是之后，服务端都不会真的收到这次改动，
   * 「在落库完成前刷新」这个前提是确定的，不需要靠抢时间（抢时间会变成随机用例）。
   */
  let releaseHeld: () => void = () => {}
  const held = new Promise<void>((resolve) => { releaseHeld = resolve })
  await page.route('**/api/novels/**', async (route) => {
    if (route.request().method() === 'PUT') { await held; await route.continue() } else await route.continue()
  })

  await input.blur()          // 进入「保存已排期、尚未落库」的状态
  await page.reload()         // 落库完成之前就刷新
  releaseHeld()
  await page.unroute('**/api/novels/**')

  // 服务端没有被这次改动写脏。
  expect(await readServerSummary(page, origin, headers, id)).toBe('')

  // 重新进入同一项目：本机草稿仍在，恢复后经统一保存通道真正落库。
  await page.locator('.mjp-hall-project', { hasText: title }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openWorldOverview(page)
  await expect(page.getByTestId('world-overview-stash')).toBeVisible()
  await page.getByTestId('world-overview-stash-restore').click()
  await expect.poll(
    () => readServerSummary(page, origin, headers, id),
    { timeout: 15_000, message: '落库窗口内刷新后，恢复草稿仍应真正落库' }
  ).toBe(TYPED_SUMMARY)
})

test('④ 草稿按项目隔离：不串到别的项目，也不会覆盖更新的正式内容', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  // 项目 A：只留下一条未保存的本机草稿，不落库。
  const a = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)
  await typeSummaryWithoutBlur(page, a.id, TYPED_SUMMARY)

  // 项目 B：另起一个项目。A 的草稿不能出现在 B（缓存 key 自带项目 ID）。
  const b = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
  expect(await readStashedSummary(page, `world-overview:${b.id}`)).toBe(null)

  // B 正常保存一次 → 服务端确认；此后刷新不应出现草稿提示（保存确认不会错误复活缓存）。
  await enterFieldEdit(page)
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')
  const bInput = page.getByTestId('world-overview-input-summary')
  await bInput.fill(SAVED_SUMMARY)
  const saved = waitForWorldPut(page, b.id)
  await bInput.blur()
  expect((await saved).status()).toBe(200)
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')
  expect(await readServerSummary(page, b.origin, b.headers, b.id)).toBe(SAVED_SUMMARY)
  await reopenProject(page, b.title)
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
  expect(await readServerSummary(page, b.origin, b.headers, b.id)).toBe(SAVED_SUMMARY)

  // 回到 A：草稿还在，且 A 的服务端内容从未被这条草稿改写（草稿绝不主动覆盖正式内容）。
  await page.goto('/')
  await page.locator('.mjp-hall-project', { hasText: a.title }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openWorldOverview(page)
  await expect(page.getByTestId('world-overview-stash')).toBeVisible()
  expect(await readServerSummary(page, a.origin, a.headers, a.id)).toBe('')
  await expect(page.locator('.mjp-card', { hasText: '世界摘要' }).locator('.mjp-synopsis')).not.toContainText(TYPED_SUMMARY)
})

test('⑤ 更新的正式内容保存成功后，旧草稿不复活也不覆盖新正式内容', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)

  // 第一步：一段「旧」输入只进本机草稿（不失焦、不落库）。
  await typeSummaryWithoutBlur(page, id, TYPED_SUMMARY)

  // 第二步：在同一页继续改成更新的内容，并真正保存成功。
  const summary = page.getByTestId('world-overview-input-summary')
  await summary.fill(SAVED_SUMMARY)
  const saved = waitForWorldPut(page, id)
  await summary.blur()
  expect((await saved).status()).toBe(200)
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')

  // 旧草稿的缓存被确认清理，且不会被迟到的防抖写入「复活」。
  await expect.poll(
    () => readStashedSummary(page, `world-overview:${id}`),
    { timeout: 15_000, message: '保存确认后旧草稿缓存应被清掉且不复活' }
  ).toBe(null)

  // 刷新重进：不出现草稿提示，正式内容是被保存成功的那一版。
  await reopenProject(page, title)
  await expect(page.getByTestId('world-overview-stash')).toHaveCount(0)
  expect(await readServerSummary(page, origin, headers, id)).toBe(SAVED_SUMMARY)
  await expect(page.locator('.mjp-card', { hasText: '世界摘要' }).locator('.mjp-synopsis')).toContainText(SAVED_SUMMARY)
})

test('⑥ 保存失败后刷新：本机草稿仍可恢复，界面不谎报已保存', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 900 })

  const { origin, headers, id, title } = await createProject(page)
  await openWorldOverview(page)
  await ensureWorldOverview(page)

  await enterFieldEdit(page)
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('已保存到服务端')
  const input = page.getByTestId('world-overview-input-summary')
  await input.fill(TYPED_SUMMARY)
  await expect.poll(
    () => readStashedSummary(page, `world-overview:${id}`),
    { timeout: 15_000, message: '输入即应写入本机草稿' }
  ).toBe(TYPED_SUMMARY)

  // 只让写请求失败，其余请求放行。
  await page.route('**/api/novels/**', async (route) => {
    if (route.request().method() === 'PUT') await route.abort()
    else await route.continue()
  })
  await input.blur()

  // 绝不接受「界面显示已保存」：落库失败必须如实显示改动还在本机。
  await expect(page.getByTestId('world-overview-save-state')).toHaveText('改动还在本机，尚未保存到服务端')
  expect(await readServerSummary(page, origin, headers, id)).toBe('')
  // 失败不清草稿：本机缓存里那段字还在。
  expect(await readStashedSummary(page, `world-overview:${id}`)).toBe(TYPED_SUMMARY)

  // 刷新后草稿仍在；撤掉失败拦截，恢复草稿应真正落库。
  await page.reload()
  await page.unroute('**/api/novels/**')
  await page.locator('.mjp-hall-project', { hasText: title }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openWorldOverview(page)
  await expect(page.getByTestId('world-overview-stash')).toBeVisible()
  await page.getByTestId('world-overview-stash-restore').click()
  await expect.poll(
    () => readServerSummary(page, origin, headers, id),
    { timeout: 15_000, message: '保存失败后从草稿恢复仍应真正落库' }
  ).toBe(TYPED_SUMMARY)
})
