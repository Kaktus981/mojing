import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule } from './helpers/manual-workspace'

test('入口收口：工具区标签与唯一写入口一致，且每个入口都落到真实页面', async ({ page }) => {
  const fixture = await buildWritableProject(page, '入口收口验收')
  expect(fixture.id).toBeTruthy()

  const tools = page.locator('.mjp-snav')
  for (const label of ['助手与技能', '任务中心', '文笔工坊', '版本快照']) {
    await expect(tools.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  // P11：同一个页面只留一个正式入口 —— 「自动流程」按钮必须已经移除，旧命名也不在。
  for (const stale of ['技能中心', 'AI 工作台', '自动流程']) {
    await expect(tools.getByRole('button', { name: stale, exact: true })).toHaveCount(0)
  }

  // 每个工具入口都渲染真实内容，不是空白页。
  await tools.getByRole('button', { name: '助手与技能', exact: true }).click()
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('技能库')

  await tools.getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('章后分析')

  await tools.getByRole('button', { name: '文笔工坊', exact: true }).click()
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('添加样文')

  await tools.getByRole('button', { name: '版本快照', exact: true }).click()
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('版本快照')
})

test('五栏目与二级页面仍可直达，默认子页没有被收口改动破坏', async ({ page }) => {
  await buildWritableProject(page, '栏目直达验收')
  for (const [section, item] of [
    ['小说大纲', '创作起点'],
    ['小说大纲', '故事线'],
    ['世界观', '规则与边界'],
    ['世界观', '扩展世界观'],
    ['正文创作', '写作控制'],
    ['记忆与伏笔', '伏笔中心'],
    ['审稿与导出', '版本历史']
  ] as const) {
    await openModule(page, section, item)
  }
  // 版本恢复只有「审稿与导出 · 版本历史」一条通道：工具区的版本历史不做恢复。
  await page.locator('.mjp-snav').getByRole('button', { name: '版本快照', exact: true }).click()
  const canvas = page.locator('.mjp-canvas-scroll')
  await expect(canvas).toContainText('前往版本历史')
  await expect(canvas).not.toContainText('恢复到这个版本')
})
