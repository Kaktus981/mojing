import { expect, test, type Locator } from '@playwright/test'

async function expectBox(locator: Locator, expected: { x?: number; width?: number }): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (expected.x !== undefined) expect(box!.x).toBeGreaterThanOrEqual(expected.x - 1)
  if (expected.x !== undefined) expect(box!.x).toBeLessThanOrEqual(expected.x + 1)
  if (expected.width !== undefined) expect(box!.width).toBeGreaterThanOrEqual(expected.width - 1)
  if (expected.width !== undefined) expect(box!.width).toBeLessThanOrEqual(expected.width + 1)
}

async function expectThreeColumns(locator: Locator): Promise<void> {
  const columns = await locator.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length)
  expect(columns).toBe(3)
}

async function createProjectAndReturnToHall(page: import('@playwright/test').Page, title: string): Promise<Locator> {
  const hall = page.locator('.mjp-hall')
  await hall.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('小说名称', { exact: true }).fill(title)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现城门每天少一块砖。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回项目大厅', exact: true }).click()
  await expect(hall).toBeVisible()
  return hall
}

test('正式大厅移除全局顶栏和原型入口，并从 68px 应用窄栏后开始', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await page.goto('/')

  await expect(page.locator('.mjp-topbar')).toHaveCount(0)
  await expect(page.getByTitle('原型阶段（仅本演示）')).toHaveCount(0)
  await expect(page.getByText('UI 验收', { exact: true })).toHaveCount(0)

  await expectBox(page.getByRole('complementary', { name: '应用窄栏' }), { width: 68 })
  await expectBox(page.locator('.mjp-hall'), { x: 68 })
})

test('正式大厅按页面头部、继续上次、工具条和完整项目库的顺序呈现', async ({ page }) => {
  await page.goto('/')

  const hall = page.locator('.mjp-hall')
  await expect(hall.getByRole('heading', { name: '项目大厅', exact: true })).toBeVisible()
  await expect(hall.getByRole('button', { name: '新建项目选项', exact: true })).toBeVisible()
  await createProjectAndReturnToHall(page, '布局顺序验证')
  await expect(hall.getByRole('button', { name: '新建项目', exact: true })).toBeVisible()

  const positions = await Promise.all([
    hall.locator('.mjp-hall-continue').boundingBox(),
    hall.locator('.mjp-hall-tools').boundingBox(),
    hall.locator('.mjp-hall-grid').boundingBox()
  ])
  expect(positions.every((box) => box !== null)).toBe(true)
  expect(positions[0]!.y).toBeLessThan(positions[1]!.y)
  expect(positions[1]!.y).toBeLessThan(positions[2]!.y)
})

test('1500px 大厅遵守静态基线的内边距、标题和三列布局且不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await page.goto('/')

  const hall = page.locator('.mjp-hall')
  await expect(hall).toBeVisible()
  const geometry = await hall.evaluate((element) => {
    const styles = getComputedStyle(element)
    return {
      paddingLeft: Number.parseFloat(styles.paddingLeft),
      paddingRight: Number.parseFloat(styles.paddingRight),
      paddingTop: Number.parseFloat(styles.paddingTop)
    }
  })
  expect(geometry).toEqual({ paddingLeft: 32, paddingRight: 32, paddingTop: 32 })
  await expect(hall.getByRole('heading', { name: '项目大厅', exact: true })).toHaveCSS('font-size', '38px')
  await createProjectAndReturnToHall(page, '三列布局验证')
  await expectThreeColumns(hall.locator('.mjp-hall-grid'))

  const pageWidth = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth + 1)
})

test('书封、山水主卡和标题操作遵循新版桌面布局', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await page.goto('/')
  const title = '书封项目-' + Date.now()
  const hall = await createProjectAndReturnToHall(page, title)
  const feature = hall.locator('.mjp-hall-continue')
  expect((await feature.boundingBox())!.height).toBeGreaterThanOrEqual(308)
  await expect(feature.locator('.mjp-book-cover')).toBeVisible()
  expect(await feature.evaluate((el) => getComputedStyle(el, '::before').backgroundImage)).toContain('landscape.png')
  const card = hall.getByRole('article', { name: title, exact: true })
  expect(await card.locator('.mjp-book-cover').boundingBox()).toMatchObject({ width: 116, height: 174 })
  const open = card.getByRole('button', { name: '打开：' + title, exact: true })
  await expect(open).toHaveText(title)
  await expect(open).not.toHaveCSS('position', 'absolute')
  await card.getByRole('button', { name: '更多操作：' + title, exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(open).toBeFocused()
  await expect(card).toHaveCSS('outline-style', 'solid')
})

test('拖拽选中项目卡文本不会打开项目', async ({ page }) => {
  const title = `可选文本项目-${Date.now()}`
  await page.goto('/')
  const hall = await createProjectAndReturnToHall(page, title)
  const card = hall.getByRole('article', { name: title, exact: true })
  const titleText = card.locator('.mjp-hall-description')
  await titleText.dblclick()

  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBeTruthy()
  await expect(hall).toBeVisible()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toHaveCount(0)

  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await card.getByRole('button', { name: `打开：${title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toBeVisible()
})

test('保留拖选文本时项目标题仍支持 Enter 和 Space 打开真实工作区', async ({ page }) => {
  const title = `键盘选区项目-${Date.now()}`
  await page.goto('/')
  const hall = await createProjectAndReturnToHall(page, title)
  const card = hall.getByRole('article', { name: title, exact: true })
  const open = card.locator('.mjp-hall-project-title')
  const back = page.getByRole('button', { name: '返回项目大厅', exact: true })

  for (const key of ['Enter', 'Space']) {
    await card.locator('.mjp-hall-description').evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await expect(hall).toBeVisible()
    await open.focus()
    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBeTruthy()
    await page.keyboard.press(key)
    await expect(back).toBeVisible()
    await back.click()
    await expect(hall).toBeVisible()
  }
  await expect(open).toHaveAccessibleName(`打开：${title}`)
})

test('新建项目走真实创建链路进入工作区，导入仍连接隐藏文件输入', async ({ page }) => {
  const title = `大厅契约项目-${Date.now()}`
  await page.goto('/')

  const hall = page.locator('.mjp-hall')
  await expect(hall).toBeVisible()
  await hall.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('小说名称', { exact: true }).fill(title)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现城门每天少一块砖。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toBeVisible()
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '返回项目大厅', exact: true }).click()
  await expect(hall.locator('.mjp-hall-grid').getByText(title, { exact: true }).first()).toBeVisible()
  const fileInput = hall.locator('input[type=file]')
  await expect(fileInput).toHaveCount(1)
  await expect(fileInput).toBeHidden()
  const fileChooser = page.waitForEvent('filechooser', { timeout: 5_000 })
  await hall.getByRole('button', { name: '新建项目选项', exact: true }).click()
  await hall.locator('.mjp-hall-menu').getByRole('button', { name: '导入文稿', exact: true }).click()
  const chosenInput = await (await fileChooser).element()
  expect(await chosenInput.evaluate((input) => input === document.querySelector('.mjp-hall input[type="file"]') && getComputedStyle(input).display === 'none')).toBe(true)
})

test('导入入口说明真实格式并在请求前拒绝无效文件', async ({ page }) => {
  let importRequests = 0
  await page.route('**/api/novels/import', async (route) => { importRequests += 1; await route.continue() })
  await page.goto('/')
  const hall = page.locator('.mjp-hall')
  await hall.getByRole('button', { name: '新建项目选项', exact: true }).click()
  const menu = hall.locator('.mjp-hall-create .mjp-hall-menu')
  await expect(menu).toContainText('TXT、Markdown、DOCX 与墨境 JSON')
  await expect(menu).toContainText('最大 20 MB')
  const input = hall.locator('input[type=file]')
  await expect(input).toHaveAttribute('accept', '.txt,.md,.markdown,.docx,.json')

  await input.setInputFiles({ name: '不支持.rtf', mimeType: 'application/rtf', buffer: Buffer.from('正文') })
  const error = hall.getByRole('alert').filter({ hasText: '无法导入这个文件' })
  await expect(error).toContainText('仅支持 TXT、Markdown、DOCX 和“墨境”JSON。')
  await expect(error.getByRole('button', { name: '重新选择', exact: true })).toBeVisible()
  expect(importRequests).toBe(0)
})

test('导入请求进行中只提交第一个文件', async ({ page }) => {
  let release!: () => void
  let importRequests = 0
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/novels/import', async (route) => {
    importRequests += 1
    await gate
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试导入失败' } }) })
  })
  await page.goto('/')
  const input = page.locator('.mjp-hall input[type=file]')
  await input.setInputFiles({ name: '第一份.txt', mimeType: 'text/plain', buffer: Buffer.from('第一份正文') })
  await input.setInputFiles({ name: '第二份.txt', mimeType: 'text/plain', buffer: Buffer.from('第二份正文') })
  await expect.poll(() => importRequests).toBe(1)
  release()
})

test('非墨境 JSON 的服务端错误回到导入入口且不重复显示', async ({ page }) => {
  await page.goto('/')
  const hall = page.locator('.mjp-hall')
  await hall.locator('input[type=file]').setInputFiles({
    name: '旧项目.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, episodes: [] }))
  })

  const error = hall.getByRole('alert').filter({ hasText: '无法导入这个文件' })
  await expect(error).toContainText('该 JSON 不是“墨境”小说项目')
  await expect(page.getByText(/该 JSON 不是“墨境”小说项目/)).toHaveCount(1)
  await error.getByRole('button', { name: '关闭导入错误', exact: true }).click()
  await expect(error).toHaveCount(0)
  await expect(page.getByText(/该 JSON 不是“墨境”小说项目/)).toHaveCount(0)
})

test('真实创建后继续上次区显示新项目', async ({ page }) => {
  const title = `继续区项目-${Date.now()}`
  await page.goto('/')

  const hall = await createProjectAndReturnToHall(page, title)

  await expect(hall.locator('.mjp-hall-continue').getByRole('heading', { name: title, exact: true })).toBeVisible()
  const continueActions = hall.locator('.mjp-hall-continue-actions')
  const primary = continueActions.getByRole('button', { name: '继续创作', exact: true })
  await expect(primary).toHaveCSS('height', '46px')
  await expect(primary.locator('svg')).toHaveCount(1)
  const card = hall.getByRole('article', { name: title, exact: true })
  await expect(card).not.toHaveAttribute('tabindex')
  await expect(card.getByRole('button', { name: `打开：${title}`, exact: true })).toBeVisible()
})

test('创建结果返回大厅后保留可关闭的成功状态条', async ({ page }) => {
  const title = `成功反馈-${Date.now()}`
  await page.goto('/')

  const hall = await createProjectAndReturnToHall(page, title)
  const result = hall.getByRole('status', { name: '大厅操作结果', exact: true })
  await expect(result).toContainText('小说项目已创建。')
  await expect(page.getByText('小说项目已创建。', { exact: true })).toHaveCount(1)
  await result.getByRole('button', { name: '关闭操作结果', exact: true }).click()
  await expect(result).toHaveCount(0)
  await expect(page.getByText('小说项目已创建。', { exact: true })).toHaveCount(0)
})

test('创建已成功但列表刷新失败时显示同步警告并可重试', async ({ page }) => {
  const title = `刷新警告-${Date.now()}`
  let failListRefresh = false
  await page.route('**/api/novels', async (route) => {
    if (route.request().method() === 'POST') {
      const response = await route.fetch()
      failListRefresh = true
      await route.fulfill({ response })
      return
    }
    if (route.request().method() === 'GET' && failListRefresh) {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await dialog.getByLabel('小说名称', { exact: true }).fill(title)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('一封退回二十年的信，在雨夜重新抵达。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await page.getByRole('button', { name: '返回项目大厅', exact: true }).click()

  const hall = page.locator('.mjp-hall')
  const warning = hall.getByRole('alert').filter({ hasText: '操作已完成，列表尚未同步' })
  await expect(warning).toContainText('当前变更已经保存')
  await expect(hall.getByRole('status', { name: '大厅操作结果', exact: true })).toHaveCount(0)
  expect(await warning.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(100)
  await expect(hall.getByRole('article', { name: title, exact: true })).toBeVisible()
  failListRefresh = false
  await warning.getByRole('button', { name: '重新同步', exact: true }).click()
  await expect(warning).toHaveCount(0)
})

test('搜索会过滤活动项目并在清空后恢复', async ({ page }) => {
  const title = `搜索项目-${Date.now()}`
  await page.goto('/')

  const hall = await createProjectAndReturnToHall(page, title)
  const library = hall.locator('.mjp-hall-grid')
  const search = hall.getByRole('searchbox', { name: '搜索项目', exact: true })
  await expect(library.getByRole('article', { name: title, exact: true })).toBeVisible()

  await search.fill('完全不匹配的项目名')
  await expect(library.getByRole('article', { name: title, exact: true })).toHaveCount(0)
  await expect(library.getByText('没有匹配的项目', { exact: true })).toBeVisible()
  const noMatch = library.locator('.mjp-hall-grid-empty.is-search')
  await expect(noMatch.locator('.mjp-hall-state-art')).toBeVisible()
  await noMatch.getByRole('button', { name: '清除搜索和筛选', exact: true }).click()

  await expect(search).toHaveValue('')
  await expect(library.getByRole('article', { name: title, exact: true })).toBeVisible()
})

test('归档会移出活动项目且可以从已归档区恢复', async ({ page }) => {
  const title = `归档项目-${Date.now()}`
  await page.goto('/')

  const hall = await createProjectAndReturnToHall(page, title)
  const activeLibrary = hall.locator('.mjp-hall-grid')
  const activeCard = hall.getByRole('article', { name: title, exact: true })
  await activeCard.getByRole('button', { name: `更多操作：${title}`, exact: true }).click()
  await activeCard.getByRole('button', { name: '归档', exact: true }).click()

  await expect(activeLibrary.getByRole('article', { name: title, exact: true })).toHaveCount(0)
  const archiveView = hall.getByRole('button', { name: '已归档', exact: true })
  await expect(archiveView).toBeFocused()
  await archiveView.click()
  const archived = hall.getByRole('region', { name: '已归档项目', exact: true })
  const archivedCard = archived.getByRole('article', { name: title, exact: true })
  await expect(archivedCard).toBeVisible()
  await archivedCard.getByRole('button', { name: `更多操作：${title}`, exact: true }).click()
  await archivedCard.getByRole('button', { name: '恢复', exact: true }).click()

  await expect(archived.getByRole('article', { name: title, exact: true })).toHaveCount(0)
  const archivedEmpty = archived.locator('.mjp-hall-grid-empty.is-archived')
  await expect(archivedEmpty.locator('.mjp-hall-state-art')).toBeVisible()
  const activeView = hall.getByRole('button', { name: '返回在写', exact: true })
  await expect(activeView).toBeFocused()
  await activeView.click()
  await expect(activeLibrary.getByRole('article', { name: title, exact: true })).toBeVisible()
})

test('归档失败保留项目、就近显示错误并恢复卡片操作焦点', async ({ page }) => {
  const title = `归档失败-${Date.now()}`
  await page.goto('/')
  const hall = await createProjectAndReturnToHall(page, title)
  await page.route('**/api/novels/*/archive', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试归档失败' } }) })
  })
  const card = hall.getByRole('article', { name: title, exact: true })
  const trigger = card.getByRole('button', { name: `更多操作：${title}`, exact: true })
  await trigger.click()
  await card.getByRole('button', { name: '归档', exact: true }).click()

  const error = hall.getByRole('alert').filter({ hasText: '无法归档项目' })
  await expect(error).toContainText('测试归档失败')
  await expect(card).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(page.getByText('测试归档失败', { exact: true })).toHaveCount(1)
})

test('新建对话框圈定焦点，Escape 和取消不写入并恢复触发焦点', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '新建项目', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  const title = dialog.getByLabel('小说名称', { exact: true })
  const close = dialog.getByRole('button', { name: '关闭新建小说', exact: true })
  const cancel = dialog.getByRole('button', { name: '取消', exact: true })
  await expect(title).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await dialog.getByLabel('小说名称', { exact: true }).fill('不应创建的项目')
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('取消后不应写入。')
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.getByText('不应创建的项目', { exact: true })).toHaveCount(0)
})

test('新建表单就近说明名称上限和空白故事想法', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  const title = dialog.getByLabel('小说名称', { exact: true })
  const seed = dialog.getByLabel('最初的故事想法', { exact: true })
  const submit = dialog.getByRole('button', { name: '创建项目', exact: true })

  await title.fill('书'.repeat(121))
  await title.blur()
  await expect(title).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByText('小说名称不能超过 120 个字符。', { exact: true })).toBeVisible()
  await seed.fill('   ')
  await seed.blur()
  await expect(seed).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByText('请写下最初的故事想法。', { exact: true })).toBeVisible()
  await expect(submit).toBeDisabled()
})

test('新建请求失败保留输入并解除 busy，不进入工作区', async ({ page }) => {
  const title = `失败保留-${Date.now()}`
  await page.route('**/api/novels', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试创建失败' } }) })
      return
    }
    await route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  const titleInput = dialog.getByLabel('小说名称', { exact: true })
  const seedInput = dialog.locator('textarea')
  const submit = dialog.getByRole('button', { name: /^创建/ })
  await titleInput.fill(title)
  await seedInput.fill('失败后也要保留的故事想法。')
  await submit.click()

  await expect(dialog).toBeVisible()
  await expect(titleInput).toHaveValue(title)
  await expect(seedInput).toHaveValue('失败后也要保留的故事想法。')
  const error = dialog.getByRole('alert').filter({ hasText: '无法创建小说' })
  await expect(error).toContainText('测试创建失败')
  await expect(page.getByText('测试创建失败', { exact: true })).toHaveCount(1)
  await expect(submit).toBeEnabled()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toHaveCount(0)
})

test('新建 busy 保持焦点边界并在失败后恢复编辑和关闭', async ({ page }) => {
  let finish!: () => void
  let requests = 0
  const pending = new Promise<void>((resolve) => { finish = resolve })
  await page.route('**/api/novels', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    requests += 1
    await pending
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '测试创建失败' }) })
  })
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '新建项目', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  const title = dialog.getByLabel('小说名称', { exact: true })
  const seed = dialog.locator('textarea')
  const submit = dialog.getByRole('button', { name: /^创建/ })
  await title.fill('忙碌焦点项目')
  await seed.fill('失败后保留的故事。')
  await submit.click()
  try {
    await expect(submit).toBeDisabled()
    expect.soft(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      expect.soft(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.getByRole('button', { name: '项目大厅', exact: true }).focus()
    expect.soft(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await title.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(submit).toBeDisabled()
    expect(requests).toBe(1)
  } finally {
    finish()
    await expect(submit).toBeEnabled()
  }
  await expect(title).toHaveValue('忙碌焦点项目')
  await expect(seed).toHaveValue('失败后保留的故事。')
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toHaveCount(0)
  await title.fill('失败后仍可编辑')
  await expect(title).toHaveValue('失败后仍可编辑')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('项目菜单支持 Escape 和外部点击关闭并恢复触发焦点', async ({ page }) => {
  const title = `菜单焦点-${Date.now()}`
  await page.goto('/')
  const hall = await createProjectAndReturnToHall(page, title)
  const card = hall.getByRole('article', { name: title, exact: true })
  const trigger = card.getByRole('button', { name: `更多操作：${title}`, exact: true })

  await trigger.click()
  await expect(card.getByRole('button', { name: '归档', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card.getByRole('button', { name: '归档', exact: true })).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await hall.locator('.mjp-hall-tools').click()
  await expect(card.getByRole('button', { name: '归档', exact: true })).toHaveCount(0)
})

test('永久删除使用带项目名的大厅确认弹窗，取消不会改变项目', async ({ page }) => {
  const title = `删除确认-${Date.now()}`
  await page.goto('/')
  const hall = await createProjectAndReturnToHall(page, title)
  const card = hall.getByRole('article', { name: title, exact: true })
  const menuTrigger = card.getByRole('button', { name: `更多操作：${title}`, exact: true })

  await menuTrigger.click()
  await card.getByRole('button', { name: '删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认永久删除？', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(title)
  await dialog.getByRole('button', { name: '暂不删除', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(card).toBeVisible()
  await expect(menuTrigger).toBeFocused()

  await menuTrigger.click()
  await card.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('dialog', { name: '确认永久删除？', exact: true }).getByRole('button', { name: '永久删除', exact: true }).click()
  await expect(card).toHaveCount(0)
})

test('永久删除失败时保留确认上下文、项目和重试焦点', async ({ page }) => {
  const title = `删除失败-${Date.now()}`
  await page.goto('/')
  const hall = await createProjectAndReturnToHall(page, title)
  const card = hall.getByRole('article', { name: title, exact: true })
  const menuTrigger = card.getByRole('button', { name: `更多操作：${title}`, exact: true })
  await page.route('**/api/novels/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试删除失败' } }) })
      return
    }
    await route.continue()
  })

  await menuTrigger.click()
  await card.getByRole('button', { name: '删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认永久删除？', exact: true })
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click()

  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText('测试删除失败')
  await expect(card).toBeVisible()
  await expect(dialog.getByRole('button', { name: '永久删除', exact: true })).toBeFocused()
  await expect(page.getByText('测试删除失败', { exact: true })).toHaveCount(1)

  await dialog.getByRole('button', { name: '暂不删除', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(menuTrigger).toBeFocused()
})
