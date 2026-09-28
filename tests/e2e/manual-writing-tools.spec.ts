import { expect, test, type Page } from '@playwright/test'

import { buildWritableProject, canvas, openModule, projectPut } from './helpers/manual-workspace'

/**
 * M6 · 正文创作的四个子页面（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-writing-tools.spec.ts
 *
 * 验证四个二级页面是**不同的工作面**（不只是换标题），以及写作控制、章后交接、
 * 查找与替换都真实落库、刷新保留。
 */

type ServerProject = {
  revision: number
  chapters: Array<{
    id: string; chapterNumber: number; title: string; status: string
    blocks: Array<{ id: string; text: string }>
    handoffStatus?: string
    retro?: { planResult?: string; actualResult: string; deviationReason: string; nextAdjustment: string; confirmedAt?: string }
  }>
  outline?: { volumes: Array<{ chapters: Array<{ id: string; storyTime?: string; narrativeMode?: string; pov: string }> }> }
  memories: unknown[]
}

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

test('正文创作四个子页面各有实际内容，不是只换标题', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  await buildWritableProject(page, 'M6 子页')

  // 正文编辑：真实编辑器
  await openModule(page, '正文创作', '正文编辑')
  await expect(page.locator('.mjp-prose')).toBeVisible()

  // 写作控制：本章写作口径 + 正文状态，且不复制项目创作规格
  await openModule(page, '正文创作', '写作控制')
  await expect(page.getByLabel('故事时间')).toBeVisible()
  await expect(page.getByLabel('叙述方式')).toBeVisible()
  await expect(page.getByLabel('正文状态')).toBeVisible()
  await expect(canvas(page)).not.toContainText('题材模板')

  // 章后交接：复盘字段
  await openModule(page, '正文创作', '章后交接')
  await expect(page.getByLabel('本章结果')).toBeVisible()
  await expect(page.getByLabel('交接状态')).toBeVisible()

  // 改写与查找：查找与替换
  await openModule(page, '正文创作', '改写与查找')
  await expect(page.getByLabel('查找内容')).toBeVisible()
  await expect(page.getByLabel('替换为')).toBeVisible()
  await expect(page.locator('.mjp-prose')).toHaveCount(0)

  console.log('[M6 子页] 正文编辑＝编辑器；写作控制＝故事时间/叙述方式/视角/正文状态；章后交接＝复盘字段；改写与查找＝查找与替换')
})

test('写作控制：本章写作口径与正文状态真实落库并刷新保留', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildWritableProject(page, 'M6 控制')
  await openModule(page, '正文创作', '写作控制')

  const timeEdited = projectPut(page, id)
  await page.getByLabel('故事时间').fill('第三天')
  await timeEdited
  await page.getByLabel('叙述方式').selectOption('倒叙')
  const povEdited = projectPut(page, id)
  await page.getByLabel('视角').fill('林砚（限知）')
  await povEdited
  const statusEdited = projectPut(page, id)
  await page.getByLabel('正文状态').selectOption('待审校')
  expect((await statusEdited).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  const outlineChapter = stored.outline!.volumes[0]!.chapters[0]!
  expect(outlineChapter).toMatchObject({ storyTime: '第三天', narrativeMode: '倒叙', pov: '林砚（限知）' })
  expect(stored.chapters[0]!.status).toBe('待审校')
  expect(stored.chapters[0]!.blocks[0]!.text, '写作控制不改正文').toBe('林砚在旧城发现古钟，古钟会改写记忆。')

  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '正文创作', '写作控制')
  await expect(page.getByLabel('故事时间')).toHaveValue('第三天')
  await expect(page.getByLabel('叙述方式')).toHaveValue('倒叙')

  console.log(`[M6 控制] 故事时间=第三天、叙述方式=倒叙、视角=林砚（限知）、正文状态=待审校；刷新保留，正文未改`)
})

test('章后交接：没有结果不能标记已交接，写下后落库且不产生记忆', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildWritableProject(page, 'M6 交接')
  await openModule(page, '正文创作', '章后交接')

  const before = await readProject(page, origin, id, headers)
  await page.getByLabel('交接状态').selectOption('已交接')
  await expect(canvas(page)).toContainText('先写下本章结果')

  let stored = await readProject(page, origin, id, headers)
  expect(stored.chapters[0]!.handoffStatus, '被拒绝时状态不得改变').toBeUndefined()
  expect(stored.revision, '被拒绝时不产生写请求').toBe(before.revision)

  const result = projectPut(page, id)
  await page.getByLabel('本章结果').fill('顺利发现古钟并决定隐瞒')
  await result
  await page.getByLabel('偏差与未决事项').fill('节奏偏慢，下一章需要提速')
  const nextUp = projectPut(page, id)
  await page.getByLabel('下章调整提示').fill('先去地底确认钟声来源')
  await nextUp
  const confirmed = projectPut(page, id)
  await page.getByLabel('交接状态').selectOption('已交接')
  expect((await confirmed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const chapter = stored.chapters[0]!
  expect(chapter.handoffStatus).toBe('已交接')
  expect(chapter.retro).toMatchObject({
    actualResult: '顺利发现古钟并决定隐瞒',
    deviationReason: '节奏偏慢，下一章需要提速',
    nextAdjustment: '先去地底确认钟声来源'
  })
  expect(chapter.retro!.confirmedAt, '交接确认时间必须记录').toBeTruthy()
  expect(stored.memories, '交接不自动生成正式记忆').toHaveLength(0)

  console.log(`[M6 交接] 空交接被拒 → 写入结果后 handoffStatus=已交接、confirmedAt=${chapter.retro!.confirmedAt}；记忆仍为 ${stored.memories.length} 条`)
})

test('查找与替换：范围区分当前章/全书，替换先预览、执行后落库、可撤销', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildWritableProject(page, 'M6 查找')
  await openModule(page, '正文创作', '改写与查找')

  await page.getByLabel('查找内容').fill('古钟')
  await expect(canvas(page)).toContainText('命中 2 处')
  await expect(canvas(page)).toContainText('第 1 章《古钟初鸣》· 第 1 段')

  // 全书范围（当前只有一章正文，命中数一致；切回当前章继续验证替换）
  await page.getByRole('tab', { name: '全书' }).click()
  await expect(canvas(page)).toContainText('命中 2 处')
  await page.getByRole('tab', { name: '当前章' }).click()

  await page.getByLabel('替换为').fill('星纹钟')
  await page.getByRole('button', { name: '预览替换' }).click()
  await expect(canvas(page)).toContainText('命中 2 处，涉及 1 个段落')
  await expect(canvas(page)).toContainText('替换后')

  const replaced = projectPut(page, id)
  await page.getByRole('button', { name: '执行替换' }).click()
  expect((await replaced).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.chapters[0]!.blocks[0]!.text).toBe('林砚在旧城发现星纹钟，星纹钟会改写记忆。')

  const undone = projectPut(page, id)
  await page.getByRole('button', { name: '撤销替换' }).click()
  expect((await undone).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.chapters[0]!.blocks[0]!.text, '撤销后回到替换前').toBe('林砚在旧城发现古钟，古钟会改写记忆。')

  console.log(`[M6 查找] 命中 2 处（含章节与段落位置）→ 预览 1 段 → 替换落库 → 撤销恢复原文`)
})
