import { expect, test } from '@playwright/test'

test('文学大厅保留山水与书封，精简重复操作和待办栏', async ({ page }) => {
  await page.goto('/')
  const hall = page.locator('.mjp-hall')
  await expect(hall.getByText('在文字里，构建属于你的世界。')).toBeVisible()
  await expect(hall.getByText('写下的，就是生活的另一种可能。')).toBeVisible()
  await expect(hall.getByText('需要你处理', { exact: true })).toHaveCount(0)
  await expect(hall.getByRole('button', { name: '查看项目主页' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '模型服务', exact: true })).toHaveCount(0)
  await hall.getByRole('button', { name: '新建项目选项', exact: true }).click()
  await expect(hall.locator('.mjp-hall-menu').getByRole('button', { name: '导入文稿', exact: true })).toBeVisible()
})

test('大厅读取失败后可重试，加载期间不误报空项目', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/novels', async (route) => {
    await gate
    await route.abort('failed')
  })
  await page.goto('/')
  const loading = page.locator('.mjp-hall-loading.is-illustrated')
  await expect(loading).toContainText('正在读取项目')
  await expect(loading.locator('.mjp-hall-state-art')).toBeVisible()
  await expect(page.getByText('还没有项目', { exact: true })).toHaveCount(0)
  release()
  await expect(page.getByText('项目列表未能加载，请重试。')).toBeVisible()
  await page.unroute('**/api/novels')
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByText('项目列表未能加载，请重试。')).toHaveCount(0)
  await expect(page.locator('.mjp-hall-grid, .mjp-hall-welcome')).toBeVisible()
})

test('创建小说后大厅展示真实故事种子简介', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.mjp-hall-grid, .mjp-hall-welcome')).toBeVisible()
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await dialog.getByLabel('小说名称', { exact: true }).fill('大厅简介接入验证')
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现城门每天少一块砖。')
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByRole('button', { name: '返回项目大厅', exact: true }).click()
  const card = page.getByRole('article', { name: '大厅简介接入验证', exact: true })
  await expect(card.locator('.mjp-hall-description')).toHaveText('巡夜人发现城门每天少一块砖。')
})
