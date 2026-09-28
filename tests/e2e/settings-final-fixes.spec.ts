import { expect, test, type Page } from '@playwright/test'
import { ensureFreeCreation } from './helpers/workspace-ui'

test.beforeEach(async ({ page }) => {
  expect(process.env.MOJING_E2E_ISOLATED).toBe('memory')
  console.log('MOJING_E2E_ISOLATED=memory')
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }))
})

function rail(page: Page) {
  return page.getByRole('complementary', { name: '应用窄栏' }).getByRole('navigation')
}

async function settings(page: Page) {
  await rail(page).getByRole('button', { name: '设置', exact: true }).click()
}

async function pane(page: Page, name: string) {
  await page.locator('.mjp-settings > .mjp-snav').getByRole('button', { name, exact: true }).click()
}

test('I1 actionable settings panes converge and header actions track live state', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await settings(page)
  for (const name of ['项目与缓存路径', '导入与备份', '模型 API', '任务历史', '主题与字体', '缩放与可访问性 未校']) {
    await pane(page, name)
    await expect(page.locator('.mjp-page-head .actions button').first()).toBeVisible()
    // Observe a quiet interval: a visible DOM alone does not prove effect convergence.
    await page.waitForTimeout(200)
    expect(errors).toEqual([])
  }
  const reset = page.locator('.mjp-page-head').getByRole('button', { name: '恢复默认' })
  await expect(reset).toBeDisabled()
  await page.locator('.mjp-switch').click()
  await expect(reset).toBeEnabled()
  await reset.click()
  await expect(reset).toBeDisabled()
  await pane(page, '版本与日志')
  await expect(page.locator('.mjp-page-head .actions button')).toHaveCount(0)
  expect(errors).toEqual([])
})

async function createProject(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await dialog.getByLabel('小说名称', { exact: true }).fill(`最终修复-${Date.now()}`)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toBeVisible()
}

test('I2 open unsaved project cannot import or switch through Settings', async ({ page }) => {
  const imports: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/novels/import') imports.push(request.url()) })
  await createProject(page)
  await page.getByRole('button', { name: '正文创作', exact: true }).click()
  await page.getByRole('button', { name: '新建第一章', exact: true }).click()
  await page.route('**/api/novels/*', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 500, body: JSON.stringify({ error: '隔离保存失败' }), contentType: 'application/json' })
    else await route.continue()
  })
  const text = '未保存的内存正文必须保留'
  await page.locator('.mjp-prose .para[contenteditable="true"]').fill(text)
  await settings(page)
  await pane(page, '导入与备份')
  for (const button of await page.getByRole('button', { name: '选择文件…', exact: true }).all()) await expect(button).toBeDisabled()
  await expect(page.locator('.mjp-settings input[type=file]')).toBeDisabled()
  await expect(page.getByText(/请先安全返回项目大厅/)).toBeVisible()
  expect(imports).toEqual([])
  // The global Hall action must keep Settings and the live project on failed save.
  const failedSave = page.waitForResponse((response) => response.request().method() === 'PUT' && response.status() === 500)
  await rail(page).getByRole('button', { name: '项目大厅', exact: true }).click()
  await failedSave
  await expect(page.getByRole('button', { name: '返回工作区', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回工作区', exact: true }).click()
  await expect(page.locator('.mjp-prose .para[contenteditable="true"]')).toHaveText(text)
})

test('I3 settings round trip preserves assistant draft, chapter, tool and subnavigation', async ({ page }) => {
  await createProject(page)
  await page.getByRole('button', { name: '正文创作', exact: true }).click()
  await page.getByRole('button', { name: '新建第一章', exact: true }).click()
  await page.locator('.mjp-view-head').getByRole('button', { name: '新建章节', exact: true }).click()
  const editor = page.locator('.mjp-prose .para[contenteditable="true"]')
  await editor.fill('第二章的写作位置')
  const draft = '尚未发送的长助手指令'
  // 迁移说明（Task 7）：新项目在右栏首次进入时先显示模式选择页；先选一次「自由创作」（幂等、不发请求）再填草稿。
  await ensureFreeCreation(page)
  await page.getByRole('complementary', { name: /创作助手$/ }).getByRole('textbox').fill(draft)
  await settings(page)
  await expect(page.getByRole('complementary', { name: '项目导航' })).toHaveCount(0)
  await page.getByRole('button', { name: '返回工作区', exact: true }).click()
  await expect(page.getByRole('complementary', { name: /创作助手$/ }).getByRole('textbox')).toHaveValue(draft)
  await expect(editor).toHaveText('第二章的写作位置')
  await expect(page.locator('.mjp-settings')).toHaveCount(0)
  await page.getByRole('complementary', { name: '项目导航' }).getByRole('button', { name: '版本快照', exact: true }).click()
  await settings(page)
  await page.getByRole('button', { name: '返回工作区', exact: true }).click()
  await expect(page.locator('.mjp-view-head .title')).toHaveText('版本快照')
  await page.getByRole('button', { name: '小说大纲', exact: true }).click()
  await page.getByRole('button', { name: '总纲与卷纲', exact: true }).click()
  await settings(page)
  await page.getByRole('button', { name: '返回工作区', exact: true }).click()
  await expect(page.locator('.mjp-snav-item.is-active')).toContainText('总纲与卷纲')
})

test('I4 system theme rerenders labels and next toggle inverts latest theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await settings(page)
  await pane(page, '主题与字体')
  await page.getByRole('tab', { name: '跟随系统', exact: true }).click()
  await expect(page.getByText('data-theme=paper', { exact: true })).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await expect(page.getByText('data-theme=night', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换到暖纸', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
})

test('M1 consecutive system motion changes do not persist an explicit preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await settings(page)
  await pane(page, '主题与字体')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('data-motion=off', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('mojing.motion'))).toBeNull()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByText('data-motion=on', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('mojing.motion'))).toBeNull()
  // P1 合并了重复入口：「减少动效」开关现在只存在于「缩放与可访问性」一栏，
  // 「主题与字体」只保留 data-motion 只读读数。这里换到唯一入口再点，
  // 断言意图不变：显式切换后会写入显式偏好。
  await pane(page, '缩放与可访问性 未校')
  await page.locator('.mjp-switch').click()
  expect(await page.evaluate(() => localStorage.getItem('mojing.motion'))).toBe('off')
})

test('I5 settings pointer targets are 44px without overflow at 1120px', async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 940 })
  await page.goto('/')
  await settings(page)
  for (const name of ['项目与缓存路径', '导入与备份', '模型 API', '任务历史', '主题与字体', '缩放与可访问性 未校', '版本与日志']) {
    await pane(page, name)
    const targets = await page.locator('button:visible, .mjp-switch:visible').evaluateAll((elements) => elements.map((element) => {
      const { width, height } = element.getBoundingClientRect()
      return { label: element.getAttribute('aria-label') || element.textContent, width, height }
    }))
    expect(targets.filter(({ width, height }) => width < 44 || height < 44)).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})

test('M3 Settings global hall closes safely; back remains a workspace return', async ({ page }) => {
  await createProject(page)
  await settings(page)
  await rail(page).getByRole('button', { name: '项目大厅', exact: true }).click()
  await expect(page.getByRole('heading', { name: '项目大厅', exact: true })).toBeVisible()
  await settings(page)
  await pane(page, '导入与备份')
  await expect(page.getByRole('button', { name: '选择文件…', exact: true }).first()).toBeEnabled()
  await page.locator('.mjp-settings input[type=file]').setInputFiles({ name: '设置导入.md', mimeType: 'text/markdown', buffer: Buffer.from('# 第一章\n从设置真实导入的正文') })
  await expect(page.getByRole('button', { name: '返回工作区', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回工作区', exact: true }).click()
  await page.getByRole('button', { name: '正文创作', exact: true }).click()
  await expect(page.getByText('从设置真实导入的正文', { exact: true })).toBeVisible()
})

test('M2 usage totals preserve currencies instead of adding USD to yuan', async ({ page }) => {
  const records = [
    { id: 'cny-1', estimatedCost: 2, currency: 'CNY', costKnown: true },
    { id: 'usd-1', estimatedCost: 3, currency: 'USD', costKnown: true },
    { id: 'cny-2', estimatedCost: 4, currency: 'CNY', costKnown: true },
    { id: 'unknown', currency: 'USD', costKnown: false }
  ].map((record) => ({ providerId: 'isolated', model: 'test-model', operation: '测试', inputTokens: 10, outputTokens: 5, status: '成功', retryCount: 0, createdAt: '2026-09-12T00:00:00Z', ...record }))
  await page.route('**/api/usage', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(records) }))
  await page.goto('/')
  await settings(page)
  await pane(page, '任务历史')
  const cost = page.locator('.mjp-stat').filter({ hasText: '已知费用' })
  await expect(cost).toContainText('CNY 6.00')
  await expect(cost).toContainText('USD 3.00')
  await expect(cost).not.toContainText('9.00')
})
