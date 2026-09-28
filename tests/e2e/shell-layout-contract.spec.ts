import { expect, test } from '@playwright/test'
import { assertNoViewportOverflow, createWorkspaceProject, openStage } from './helpers/workspace-ui'

/**
 * 净新增壳层契约（补充，不替代任何既有断言）。
 *
 * 目的：把「68px 全局窄栏 + 232px 功能导航 + 自适应中央区 + 360px 常驻助手」这条四列不变量，
 * 以及 1120px 最小桌面宽度、后段栏目助手常驻，固化成独立可读的契约用例。
 * 与已迁移用例不重叠：这里只做几何/宽度/常驻不变量，不重复具体栏目内容断言。
 */

test('应用窄栏与工作区四列几何固定为 68 / 232 / 1fr / 360', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await createWorkspaceProject(page, '四列几何契约')
  await openStage(page, '正文创作')

  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('.mjp-rail')!.getBoundingClientRect()
    const body = document.querySelector<HTMLElement>('.mjp-body.is-docked')!
    const nav = body.querySelector<HTMLElement>(':scope > .mjp-snav')!.getBoundingClientRect()
    const canvas = body.querySelector<HTMLElement>(':scope > .mjp-canvas')!.getBoundingClientRect()
    const dock = body.querySelector<HTMLElement>(':scope > .mjp-dock')!.getBoundingClientRect()
    return {
      railWidth: Math.round(rail.width),
      navWidth: Math.round(nav.width),
      canvasWidth: Math.round(canvas.width),
      dockWidth: Math.round(dock.width),
      nonOverlapping: rail.right <= nav.left + 1 && nav.right <= canvas.left + 1 && canvas.right <= dock.left + 1,
      rightEdge: Math.round(dock.right)
    }
  })

  expect(geometry.railWidth).toBe(68)
  expect(geometry.navWidth).toBe(232)
  expect(geometry.dockWidth).toBe(360)
  // 1366 − 68 − 232 − 360 = 706，允许 ±12 的栅格间隙容差。
  expect(Math.abs(geometry.canvasWidth - 706)).toBeLessThanOrEqual(12)
  expect(geometry.nonOverlapping, '四列必须按 窄栏→导航→中央区→助手 顺序排列且不重叠').toBe(true)
  expect(geometry.rightEdge).toBeLessThanOrEqual(1367)
})

test('最小桌面宽度 1120 仍保持四列常驻且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 900 })
  await createWorkspaceProject(page, '最小桌面宽度')
  await openStage(page, '世界观')
  await assertNoViewportOverflow(page, '1120 像素最小桌面')
  expect(await page.locator('.mjp-body.is-docked > .mjp-snav').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(232)
  expect(await page.locator('.mjp-dock').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(360)
})

test('记忆与伏笔、审稿与导出栏目助手常驻 360 且不可折叠', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await createWorkspaceProject(page, '后段栏目助手常驻')
  for (const stage of ['记忆与伏笔', '审稿与导出'] as const) {
    await openStage(page, stage)
    const dock = page.locator('.mjp-dock')
    await expect(dock).toBeVisible()
    await expect(dock.locator('.mjp-tag.ai')).toHaveText('常驻')
    expect(await dock.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(360)
    await expect(page.getByRole('button', { name: /收起.*创作对话助手/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '打开创作导航' })).toHaveCount(0)
  }
})

test('项目大厅窄栏恒为 68px 且不因悬停或聚焦扩宽', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/')
  const rail = page.locator('.mjp-rail')
  const widthBeforeHover = await rail.evaluate((element) => element.getBoundingClientRect().width)
  expect(Math.round(widthBeforeHover)).toBe(68)
  await rail.getByRole('button', { name: '项目大厅' }).hover()
  await rail.getByRole('button', { name: '设置' }).focus()
  await expect.poll(() => rail.evaluate((element) => element.getBoundingClientRect().width)).toBe(widthBeforeHover)
})
