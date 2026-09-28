import { expect, test, type Page } from '@playwright/test'

/**
 * M2 · 旧恢复入口收口（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-restore-entry.spec.ts
 *
 * 验收目标：
 *   1. 「项目工具 · 历史记录」不再提供绕过预览与版本校验的直接恢复 / 删除；
 *   2. 它指向唯一的受控入口「审稿与导出 · 版本历史」；
 *   3. 受控入口必须先有差异预览才能提交（M8 接通后依然保持这条门禁）；
 *   4. 未预览时点「确认恢复」不会发出 /restore 请求，历史查看与检查点能力保留。
 */

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')

async function openProject(page: Page, prefix: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(`${prefix}-${Date.now()}`)
  await page.getByLabel('最初的故事想法').fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
}

test('历史记录不再直接恢复，改为指向唯一受控入口', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await openProject(page, 'M2 恢复入口')

  const restoreRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/restore')) restoreRequests.push(request.url())
  })

  // 本轮改名：项目工具入口「历史记录」→「版本快照」（只读快照浏览）。
  // 测试意图不变：该入口不再提供直接恢复 / 删除，只指向唯一受控入口。
  await page.locator('.mjp-snav').getByRole('button', { name: '版本快照', exact: true }).click()
  await expect(title(page)).toHaveText('版本快照')

  // 面板内不再有直接恢复 / 删除快照的按钮
  await expect(canvas(page).getByRole('button', { name: '恢复', exact: true })).toHaveCount(0)
  await expect(canvas(page).getByRole('link', { name: /^删除版本/ })).toHaveCount(0)
  await expect(canvas(page).getByRole('button', { name: /^删除版本/ })).toHaveCount(0)
  // 查看与检查点能力保留
  await expect(canvas(page).getByRole('button', { name: '创建检查点' })).toBeVisible()
  await expect(canvas(page).getByText('AI 任务历史')).toBeVisible()
  await expect(canvas(page)).toContainText('恢复与版本管理')

  // 唯一入口：跳到统一版本历史页
  await canvas(page).getByRole('button', { name: '前往版本历史' }).click()
  await expect(title(page)).toHaveText('版本历史')
  await expect(canvas(page)).toContainText('⑤ 受控恢复')
  // 旧直接恢复通道依然不接入；M8 起受控恢复可用，但必须先预览差异。
  // 断言意图不变（「是否存在绕过预览的恢复通道」+ 页面明确否掉），只是正文改为
  // 正式版本历史页真实渲染的问答应答文案。
  await expect(canvas(page).getByText('能否跳过预览直接恢复')).toBeVisible()
  await expect(canvas(page)).toContainText('不能：恢复必须先预览差异')
  await expect(canvas(page).getByRole('button', { name: '预览差异' })).toBeVisible()
  await expect(canvas(page).getByRole('button', { name: '确认恢复到此版本' }), '未预览前不得可点').toBeDisabled()

  expect(restoreRequests, `不得发出恢复请求：${restoreRequests.join(' , ')}`).toHaveLength(0)
  console.log('[M2] 历史面板无直接恢复按钮 → 受控入口保留「先预览差异」门禁；/restore 请求数=0')
})
