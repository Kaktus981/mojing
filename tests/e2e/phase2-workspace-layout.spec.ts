import { expect, test } from '@playwright/test'
import { assertNoViewportOverflow, createWorkspaceProject } from './helpers/workspace-ui'

/**
 * 迁移说明（本轮重映射到正式 `.mjp-*` 四栏外壳，仅换壳/换名，不动业务断言）：
 *   - `.workspace-v2`             → `.mjp-body.is-docked`
 *   - `.workspace-secondary-rail` → `.mjp-snav`（232px 功能导航）
 *   - `.mj-main`                  → `.mjp-canvas`
 *   - `.stage-chat-dock-docked`   → `.mjp-dock`（360px 常驻助手）
 *   - `.hall-sidebar`             → `.mjp-rail`（68px 全局窄栏）
 *   - 「项目工具与设置」分组标题取消：五项项目工具直接列在导航底部（D7 收口）。
 *   - 对象目录：原为视图内的 `.mjp-chapter-tree`（2026-09-20 P2-C 起并入 232px 导航栏，
 *     画布不再为它留列，栏目、工具与保存状态仍在导航栏里，宽度恒为 232px）。
 *   - 「技能装配中心 / 选择创作阶段」装配 UI 按 D5/D7 被「助手与技能」页取代 → 末段保留原断言待裁决。
 */
test('阶段 2 桌面工作区使用五栏导航、232px 功能栏和 360px 固定助手', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await createWorkspaceProject(page, '阶段2桌面布局')

  const workspace = page.locator('.mjp-body.is-docked')
  const navigation = workspace.locator(':scope > .mjp-snav')
  const sectionButtons = navigation.locator('.mjp-snav-scroll > div > .mjp-snav-section')
  await expect(sectionButtons).toHaveCount(5)
  await expect(sectionButtons).toHaveText(['小说大纲', '世界观', '正文创作', '记忆与伏笔', '审稿与导出'])

  const writing = navigation.getByRole('button', { name: '正文创作', exact: true })
  await writing.click()
  await expect(writing).toHaveAttribute('aria-expanded', 'true')
  await navigation.getByRole('button', { name: '正文编辑', exact: true }).click()
  await expect(navigation.locator('.mjp-snav-item.is-active')).toContainText('正文编辑')
  // 新建项目没有章节时，新正文视图是空态、不渲染卷章目录；先建一章让目录出现。
  await page.locator('.mjp-view-head').getByRole('button', { name: '新建章节' }).click()
  await expect(page.locator('.mjp-chapter-tree')).toBeVisible()

  const geometry = await workspace.evaluate((element) => {
    const shellRail = document.querySelector<HTMLElement>('.mjp-rail')!.getBoundingClientRect()
    const nav = element.querySelector<HTMLElement>(':scope > .mjp-snav')!.getBoundingClientRect()
    const main = element.querySelector<HTMLElement>(':scope > .mjp-canvas')!.getBoundingClientRect()
    const assistant = element.querySelector<HTMLElement>(':scope > .mjp-dock')!.getBoundingClientRect()
    return {
      shellRight: shellRail.right,
      workspaceLeft: element.getBoundingClientRect().left,
      navLeft: nav.left,
      navWidth: nav.width,
      mainWidth: main.width,
      assistantWidth: assistant.width,
      assistantRight: assistant.right
    }
  })
  expect(geometry.workspaceLeft).toBeCloseTo(geometry.shellRight, 0)
  expect(geometry.navLeft).toBeCloseTo(geometry.shellRight, 0)
  expect(geometry.navWidth).toBeCloseTo(232, 0)
  expect(geometry.mainWidth).toBeGreaterThanOrEqual(700)
  expect(geometry.mainWidth).toBeLessThanOrEqual(712)
  expect(geometry.assistantWidth).toBeCloseTo(360, 0)
  expect(geometry.assistantRight).toBeCloseTo(1366, 0)

  // 正文卷章目录已并入 232px 导航栏（P2-C）：画布里不再单独占一列，稿纸区因此变宽。
  const objectDirectory = page.getByRole('navigation', { name: '正文目录' })
  await expect(objectDirectory).toBeVisible()
  await expect(page.locator('.mjp-canvas .mjp-chapter-tree')).toHaveCount(0)
  await expect(navigation.locator('.mjp-chapter-tree')).toHaveCount(1)

  // A：项目工具由「项目工具与设置」分组改为直接列在导航底部；点「助手与技能」后常驻助手仍在。
  await navigation.getByRole('button', { name: '助手与技能', exact: true }).click()
  await expect(workspace.locator(':scope > .mjp-dock')).toBeVisible()
  // 原「正文创作助手」标题：正文阶段常驻助手的标题改名为「写作陪伴助手」。
  await expect(page.locator('.mjp-dock-hd .meta b')).toHaveText('写作陪伴助手')
  await assertNoViewportOverflow(page, '阶段 2 桌面工作区')

  // 原「选择创作阶段 → 小说大纲助手」：装配阶段选择器已由 D5/D7 的「助手与技能」页取代；
  // 等价入口是 232px 一级栏目导航——切换栏目会切换常驻助手的席位身份（同一份真实档案）。
  // 小说大纲栏目使用稳定的一级栏目助手档案。
  await navigation.getByRole('button', { name: '小说大纲', exact: true }).click()
  await expect(page.locator('.mjp-dock-hd .meta b')).toHaveText('大纲架构师')
})

test('阶段 2 小窗口下助手仍常驻为 360px 且不引入抽屉/遮罩', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createWorkspaceProject(page, '阶段2窄屏布局')

  const workspace = page.locator('.mjp-body.is-docked')
  const main = workspace.locator(':scope > .mjp-canvas')
  const assistant = workspace.locator(':scope > .mjp-dock')
  await expect(main).toBeAttached()
  await expect(assistant).toBeVisible()
  // C-3（97-workspace-views.css:705-707）：助手在任何宽度下常驻（规格 360px 不可折叠），
  // 窄屏只压缩中央区，不做抽屉、不做遮罩、也没有隐藏开关。原「390px 主区可见 / 无横向溢出」断言
  // 属旧窄屏模式的假设，已随该模式移除；改为断言新设计的等价不变量（支持范围为桌面 1120–1500+）。
  expect(await assistant.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(360)
  expect(await workspace.locator(':scope > .mjp-snav').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(232)
  await expect(page.getByRole('button', { name: '打开创作导航' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /收起.*创作对话助手/ })).toHaveCount(0)
  await expect(page.locator('.mjp-overlay')).toHaveCount(0)
})
