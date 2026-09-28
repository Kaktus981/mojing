import { expect, test, type Page } from '@playwright/test'

/**
 * M1 · 正文防丢与基本编辑（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-writing-save.spec.ts
 *
 * 全部走真实产品链路：大厅建项目 → 服务端契约校验后写入一章正文 → UI 打开项目，
 * 直接在正文里输入。**不使用 `page.route` 伪造项目数据**，只在「保存失败」「旧响应晚到」
 * 两条用例里拦截 PUT 以失败 / 延迟，用来验证真实的错误处理与并发行为。
 */

const CHAPTER_ID = 'ch-manual-1'
const BLOCK_ID = 'blk-manual-1'
const NOW = '2026-09-14T00:00:00.000Z'

const prose = (page: Page) => page.locator('.mjp-prose')
const paragraph = (page: Page, blockId = BLOCK_ID) => page.locator(`.para[data-block-id="${blockId}"]`)
// P1 起保存状态只有一处：232px 工作区导航底部（项目级全局状态，正文编辑栏的重复显示已删除）
const saveState = (page: Page) => page.locator('.mjp-snav-foot .mjp-save-state')

function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

function collectPuts(page: Page, projectId: string) {
  const bodies: Array<{ baseRevision: number; document: { chapters: Array<{ id: string; blocks: Array<{ id: string; text: string }> }> } }> = []
  page.on('request', (request) => {
    if (request.method() !== 'PUT' || new URL(request.url()).pathname !== `/api/novels/${projectId}`) return
    bodies.push(request.postDataJSON() as (typeof bodies)[number])
  })
  return bodies
}

/** 建项目 → 写入一章「有稳定段落 id 的空正文」→ 从大厅真实打开（进入正文创作）。 */
async function openWritingWorkspace(page: Page, prefix: string): Promise<{ origin: string; id: string; headers: Record<string, string> }> {
  const firstApiRequest = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApiRequest
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const title = `${prefix}-${Date.now()}`
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(title)
  await page.getByLabel('最初的故事想法').fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  const summaries = (await list.json()) as Array<{ id: string; title: string }>
  const summary = summaries.find((item) => item.title === title)!
  const currentResponse = await page.request.get(`${origin}/api/novels/${summary.id}`, { headers })
  const current = (await currentResponse.json()) as Record<string, unknown>

  const seeded = await page.request.put(`${origin}/api/novels/${summary.id}`, {
    headers,
    data: {
      baseRevision: current.revision,
      document: {
        ...current,
        chapters: [
          {
            id: CHAPTER_ID,
            volumeNumber: 1,
            chapterNumber: 1,
            title: '古钟初鸣',
            blocks: [{ id: BLOCK_ID, text: '' }],
            status: '草稿',
            sourceDigest: '',
            updatedAt: NOW
          }
        ]
      }
    }
  })
  if (!seeded.ok()) throw new Error(`M1 夹具未通过服务端契约校验：${seeded.status()} ${await seeded.text()}`)

  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await page.locator('.mjp-snav').getByRole('button', { name: '正文创作', exact: true }).click()
  await page.locator('.mjp-snav').getByRole('button', { name: /正文编辑/ }).click()
  await expect(prose(page)).toBeVisible()
  return { origin, id: summary.id, headers }
}

/** 读取服务端保存的本章第一段文字，用于断言「确实落库」。 */
async function storedText(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<string | undefined> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  const project = (await response.json()) as { chapters: Array<{ id: string; blocks: Array<{ id: string; text: string }> }> }
  return project.chapters.find((chapter) => chapter.id === CHAPTER_ID)?.blocks[0]?.text
}

test('正文保持焦点连续输入，停止输入后真实保存（不需要失焦）', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await openWritingWorkspace(page, '正文防丢')

  const saved = projectPut(page, id)
  await paragraph(page).click()
  await page.keyboard.type('钟声会改写昨天')   // 全程保持焦点，不触发 blur
  const response = await saved

  expect(response.status()).toBe(200)
  const body = (await response.json()) as { revision: number; chapters: Array<{ id: string; blocks: Array<{ text: string }> }> }
  expect(body.chapters.find((chapter) => chapter.id === CHAPTER_ID)!.blocks[0]!.text).toBe('钟声会改写昨天')
  expect(await storedText(page, origin, id, headers)).toBe('钟声会改写昨天')
  await expect(saveState(page)).toHaveText('已保存')
  console.log(`[正文防丢] 焦点内输入即保存：PUT=${response.status()} 服务端文字=「${await storedText(page, origin, id, headers)}」`)
})

test('中文输入法：组合期间不提交，compositionend 后保存最终文字', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openWritingWorkspace(page, '中文输入')
  const puts = collectPuts(page, id)

  await paragraph(page).click()
  // 模拟输入法组合过程：期间不断改 DOM，但不应产生任何保存请求
  await page.evaluate((blockId) => {
    const element = document.querySelector<HTMLElement>(`.para[data-block-id="${blockId}"]`)!
    element.focus()
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'zhong' }))
    element.textContent = 'zhong'
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'zhong', inputType: 'insertCompositionText' }))
    element.textContent = '钟声'
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '钟声', inputType: 'insertCompositionText' }))
  }, BLOCK_ID)
  await page.waitForTimeout(1300)
  const putsDuringComposition = puts.length
  expect(puts, '输入法组合期间不得提交保存').toHaveLength(0)

  const saved = projectPut(page, id)
  await page.evaluate((blockId) => {
    const element = document.querySelector<HTMLElement>(`.para[data-block-id="${blockId}"]`)!
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '钟声' }))
  }, BLOCK_ID)
  const response = await saved
  expect(response.status()).toBe(200)
  const body = (await response.json()) as { chapters: Array<{ id: string; blocks: Array<{ text: string }> }> }
  expect(body.chapters.find((chapter) => chapter.id === CHAPTER_ID)!.blocks[0]!.text).toBe('钟声')
  console.log(`[中文输入] 组合期间 PUT=${putsDuringComposition}（应为 0）；compositionend 后保存文字=「钟声」`)
})

test('多段粘贴按换行拆成多段，段落 id 保持稳定', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openWritingWorkspace(page, '多段粘贴')

  const saved = projectPut(page, id)
  await paragraph(page).click()
  await page.evaluate((blockId) => {
    const element = document.querySelector<HTMLElement>(`.para[data-block-id="${blockId}"]`)!
    element.focus()
    const data = new DataTransfer()
    data.setData('text/plain', '第一段\n第二段\n第三段')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, BLOCK_ID)
  const response = await saved

  expect(response.status()).toBe(200)
  const body = (await response.json()) as { chapters: Array<{ id: string; blocks: Array<{ id: string; text: string }> }> }
  const blocks = body.chapters.find((chapter) => chapter.id === CHAPTER_ID)!.blocks
  expect(blocks.map((block) => block.text)).toEqual(['第一段', '第二段', '第三段'])
  expect(blocks[0]!.id).toBe(BLOCK_ID)
  expect(new Set(blocks.map((block) => block.id)).size).toBe(3)
  console.log(`[多段粘贴] 段落数=${blocks.length} 首段 id 保持=${blocks[0]!.id === BLOCK_ID}`)
})

test('Enter 拆分与段首退格合并都真实写回项目', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openWritingWorkspace(page, '段落编辑')

  const saved = projectPut(page, id)
  await paragraph(page).click()
  await page.keyboard.type('前半后半')
  await saved

  // 光标移到「前半」之后按 Enter
  await page.evaluate((blockId) => {
    const element = document.querySelector<HTMLElement>(`.para[data-block-id="${blockId}"]`)!
    element.focus()
    const range = document.createRange()
    const node = element.firstChild!
    range.setStart(node, 2)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  }, BLOCK_ID)
  const split = projectPut(page, id)
  await page.keyboard.press('Enter')
  const splitBody = (await (await split).json()) as { chapters: Array<{ id: string; blocks: Array<{ id: string; text: string }> }> }
  const afterSplit = splitBody.chapters.find((chapter) => chapter.id === CHAPTER_ID)!.blocks
  expect(afterSplit.map((block) => block.text)).toEqual(['前半', '后半'])

  // 在第二段段首退格，应合并回第一段
  const merged = projectPut(page, id)
  await page.keyboard.press('Backspace')
  const mergedBody = (await (await merged).json()) as { chapters: Array<{ id: string; blocks: Array<{ text: string }> }> }
  const afterMerge = mergedBody.chapters.find((chapter) => chapter.id === CHAPTER_ID)!.blocks
  expect(afterMerge.map((block) => block.text)).toEqual(['前半后半'])
  console.log(`[段落编辑] Enter 拆分=${afterSplit.length} 段；退格合并=${afterMerge.length} 段`)
})

test('撤销恢复上一次内容，并作为普通编辑保存', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openWritingWorkspace(page, '撤销')

  const first = projectPut(page, id)
  await paragraph(page).click()
  await page.keyboard.type('甲')
  await first

  const second = projectPut(page, id)
  await page.keyboard.type('乙')
  await second

  const undone = projectPut(page, id)
  await page.keyboard.press('Control+z')
  const body = (await (await undone).json()) as { chapters: Array<{ id: string; blocks: Array<{ text: string }> }> }
  expect(body.chapters.find((chapter) => chapter.id === CHAPTER_ID)!.blocks[0]!.text).toBe('甲')
  console.log('[撤销] Ctrl+Z 后服务端文字=「甲」')
})

test('保存失败显示未保存与错误，重试后成功且不丢内容', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, origin, headers } = await openWritingWorkspace(page, '保存失败')

  let failNext = true
  await page.route(`**/api/novels/${id}`, async (route) => {
    if (route.request().method() !== 'PUT' || !failNext) {
      await route.fallback()
      return
    }
    failNext = false
    await route.fulfill({
      status: 500,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: { code: 'TEST_SAVE_FAILURE', message: '测试：保存失败', retryable: true } })
    })
  })

  const failed = projectPut(page, id)
  await paragraph(page).click()
  await page.keyboard.type('失败也要保住这段文字')
  expect((await failed).status()).toBe(500)

  await expect(saveState(page)).toHaveText('保存失败')
  await expect(paragraph(page)).toHaveText('失败也要保住这段文字')
  const errorBanner = page.locator('.mjp-editor .mjp-banner.danger').first()
  await expect(errorBanner).toBeVisible()
  await expect(errorBanner).toContainText('保存失败')
  await expect(errorBanner).toHaveAttribute('data-state', 'error')

  const retried = projectPut(page, id)
  await errorBanner.getByRole('button', { name: '重试保存' }).click()
  expect((await retried).status()).toBe(200)
  await expect(saveState(page)).toHaveText('已保存')
  expect(await storedText(page, origin, id, headers)).toBe('失败也要保住这段文字')
  console.log('[保存失败] 首次 PUT=500 → 未保存 + 错误提示；重试后 200 且内容落库')
})

test('真实断网导致保存失败：显示独立失败态、保留输入，恢复网络后重试成功', async ({ page }) => {
  // 与前一条不同：这条不伪造任何响应，直接把浏览器上下文断网，让保存请求真的发不出去。
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, origin, headers } = await openWritingWorkspace(page, '断网保存失败')

  await page.context().setOffline(true)
  const offlineProbe = await page.evaluate(async () => {
    try {
      await fetch('/api/novels', { method: 'GET' })
      return 'ok'
    } catch {
      return 'fail'
    }
  })
  expect(offlineProbe, '断网必须真的让 API 请求发不出去，否则这条用例就不是真实失败').toBe('fail')

  await paragraph(page).click()
  await page.keyboard.type('断网也要保住这段文字')

  await expect(saveState(page)).toHaveText('保存失败', { timeout: 20_000 })
  const errorBanner = page.locator('.mjp-editor [data-testid="save-error-banner"]')
  await expect(errorBanner).toBeVisible()
  await expect(page.locator('.mjp-toast.is-error'), '正文已有局部保存错误时不重复弹全局错误').toHaveCount(0)
  await expect(errorBanner).toHaveAttribute('data-state', 'error')
  await expect(errorBanner).toContainText('保存失败')
  // 失败只高亮错误区域，不碰作者的输入
  await expect(paragraph(page)).toHaveText('断网也要保住这段文字')
  await expect(errorBanner.getByRole('button', { name: '重试保存' })).toBeEnabled()

  await page.context().setOffline(false)
  const retried = projectPut(page, id)
  await errorBanner.getByRole('button', { name: '重试保存' }).click()
  expect((await retried).status()).toBe(200)
  await expect(saveState(page)).toHaveText('已保存')
  expect(await storedText(page, origin, id, headers)).toBe('断网也要保住这段文字')
  console.log('[断网保存失败] 断网后保存态=保存失败 → 恢复网络重试 PUT=200 → 已保存且内容落库')
})

test('保存期间再次输入：旧响应不覆盖新输入，最终以新 revision 保存最新内容', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, origin, headers } = await openWritingWorkspace(page, '旧响应晚到')
  const puts = collectPuts(page, id)

  // 只延迟真实 PUT 的返回，不伪造内容
  await page.route(`**/api/novels/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 900))
    await route.continue()
  })

  await paragraph(page).click()
  await page.keyboard.type('较早输入')
  await expect.poll(() => puts.length).toBe(1)
  await page.keyboard.type('较新输入')

  await expect.poll(() => puts.length, { timeout: 15_000 }).toBe(2)
  await expect(saveState(page)).toHaveText('已保存', { timeout: 15_000 })
  await expect(paragraph(page)).toHaveText('较早输入较新输入')
  expect(await storedText(page, origin, id, headers)).toBe('较早输入较新输入')
  console.log(`[旧响应晚到] 两次 PUT，baseRevision=${puts.map((body) => body.baseRevision).join('/')}，服务端最终=「较早输入较新输入」`)
})

test('刷新后可恢复未确认保存的本地草稿', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id, origin, headers } = await openWritingWorkspace(page, '草稿恢复')

  // 让保存一直失败，保证草稿停在「未保存」状态
  await page.route(`**/api/novels/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 500,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ error: { code: 'TEST_OFFLINE', message: '测试：离线', retryable: true } })
    })
  })
  page.on('dialog', (dialog) => void dialog.accept())

  const failed = projectPut(page, id)
  await paragraph(page).click()
  await page.keyboard.type('尚未确认保存的草稿')
  expect((await failed).status()).toBe(500)
  await expect(saveState(page)).toHaveText('保存失败')
  await page.waitForTimeout(600)   // 等容灾缓存写入

  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await page.locator('.mjp-snav').getByRole('button', { name: '正文创作', exact: true }).click()
  await page.locator('.mjp-snav').getByRole('button', { name: /正文编辑/ }).click()

  const banner = page.locator('.mjp-editor .mjp-banner.warn').first()
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('检测到未保存的本地草稿')
  await banner.getByRole('button', { name: '对比差异' }).click()
  await expect(page.getByText('本地草稿：尚未确认保存的草稿')).toBeVisible()

  // 恢复前放开真实保存通道，确保「恢复」确实落库
  await page.unroute(`**/api/novels/${id}`)
  const restored = projectPut(page, id)
  await banner.getByRole('button', { name: '恢复草稿' }).click()
  expect((await restored).status()).toBe(200)
  await expect(paragraph(page)).toHaveText('尚未确认保存的草稿')
  expect(await storedText(page, origin, id, headers)).toBe('尚未确认保存的草稿')
  console.log('[草稿恢复] 刷新后提示草稿 → 对比差异可见 → 恢复后内容回到正文并保存')
})
