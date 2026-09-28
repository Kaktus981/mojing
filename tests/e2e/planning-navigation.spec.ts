import { expect, test } from '@playwright/test'
import { createWorkspaceProject, openStage, openSubsection, assertNoViewportOverflow, ensureFreeCreation } from './helpers/workspace-ui'

/**
 * 迁移说明：
 *  - A：一级栏目切换由 232px 手风琴导航承载（`切换创作栏目` 下拉已按 D1 移除），
 *    大厅侧栏 `.hall-sidebar` → 68px 全局窄栏 `.mjp-rail`。
 *  - A：小说大纲正式显示项由十个旧入口收敛为四个模块（创作起点 / 总纲与卷纲 / 章节规划 / 故事线，
 *    见 outlineIntegrationModel 的 INTEGRATED_OUTLINE_MODULES）。
 *  - C：`助手` 一律常驻 360 且无折叠按钮（C-1）；窄屏不再有抽屉/遮罩/隐藏开关（97-workspace-views.css:705-707）。
 */
const SUBSECTIONS: Record<'世界观' | '小说大纲', string[]> = {
  世界观: ['世界总览', '规则与边界', '世界词条', '世界时间线', '扩展世界观'],
  小说大纲: ['创作起点', '总纲与卷纲', '章节规划', '故事线']
}

for (const stage of ['世界观', '小说大纲'] as const) {
  for (const width of [1920, 1366, 390]) {
    test(`${stage}合并导航与助手上下文 ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await createWorkspaceProject(page, '规划导航隔离回归')
      await openStage(page, stage)
      for (const label of SUBSECTIONS[stage]) await openSubsection(page, label)

      if (width >= 1120) {
        // D1：栏目切换不再是下拉选择器；一级栏目选中态落在手风琴分组上。
        await expect(page.locator('.mjp-snav-section.is-active')).toHaveText(stage)
        await expect(page.locator('.mjp-rail')).toBeVisible()
      }

      // C-1：助手常驻、不可折叠；窄档同样常驻 360，没有抽屉/遮罩。
      const dock = page.locator('.mjp-dock')
      await expect(dock).toBeVisible()
      await expect(page.getByRole('button', { name: /收起.*创作对话助手/ })).toHaveCount(0)
      await expect(page.locator('.mjp-overlay')).toHaveCount(0)
      expect(await dock.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(360)

      // 迁移说明（Task 7）：新项目在右栏首次进入时先显示模式选择页，自由创作输入框尚未挂载，
      // 因此按真实 UI 先选一次「自由创作」（幂等、不发任何请求），再填写规划问题。
      await ensureFreeCreation(page)
      await dock.locator('textarea').fill('保留规划问题，不发送。')
      await expect(dock.locator('textarea')).toHaveValue('保留规划问题，不发送。')
      if (width >= 1120) await assertNoViewportOverflow(page, `${stage}固定助手`)
    })
  }
}
