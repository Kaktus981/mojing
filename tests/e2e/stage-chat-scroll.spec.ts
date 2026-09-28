import { expect, test } from '@playwright/test'
import { createWorkspaceProject, openStage } from './helpers/workspace-ui'

/**
 * 迁移说明（C-1：助手会话壳层重写）：
 *  - 旧 StageChatDock 的「自由/引导」模式标签、`对话记录` 入口、未读徽标、可折叠开合
 *    在新壳层里都已移除：WorkspaceDock 常驻、不可折叠，并按栏目（stage / scopeKey）读会话。
 *  - 旧用例还断言「滚动位置跨栏目保留」「新回复不打断阅读 + 未读徽标」——该交互已按新设计
 *    整体移除（新壳层在会话变化时自动定位到底部），故这几条不再等价，列退役候选（见报告）。
 *  - 会话内容级恢复（scopeKey 隔离、按栏目恢复具体消息）依赖服务端会话数据且需接口桩；
 *    E2E 下不发真实模型请求，因此这里只断言可观察的常驻壳层与作用域隔离。
 */
test('助手常驻且无对话记录/模式标签/未读入口，作用域随栏目隔离', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await createWorkspaceProject(page, '助手会话隔离')
  await openStage(page, '世界观')
  const dock = page.locator('.mjp-dock')
  await expect(dock).toBeVisible()

  // C-1：没有对话记录入口、没有模式标签、没有未读徽标、没有折叠按钮，助手常驻。
  await expect(dock.getByRole('button', { name: '对话记录' })).toHaveCount(0)
  await expect(dock.getByRole('tab')).toHaveCount(0)
  await expect(dock.getByRole('button', { name: /条新回复/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /收起.*创作对话助手/ })).toHaveCount(0)
  await expect(dock.locator('.mjp-tag.ai')).toHaveText('常驻')

  // 作用域（scopeKey）隔离的可见部分：席位与「当前页面」跟随栏目切换。
  await expect(dock.locator('.mjp-dock-hd .meta b')).toHaveText('世界观构建助手')
  await expect(dock.locator('.mjp-dock-scope').first().locator('.v')).toHaveText('世界总览')

  await openStage(page, '小说大纲')
  await expect(dock.locator('.mjp-dock-hd .meta b')).toHaveText('构思引导助手')
  await expect(dock.locator('.mjp-dock-scope').first().locator('.v')).toHaveText('创作起点')

  await openStage(page, '世界观')
  await expect(dock.locator('.mjp-dock-hd .meta b')).toHaveText('世界观构建助手')
})
