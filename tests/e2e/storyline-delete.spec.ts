import { expect, test, type Page } from '@playwright/test'
import { buildWritableProject, openModule, projectPut, title } from './helpers/manual-workspace'

/**
 * G-20 · 安全删除选中的事件线（Edge 隔离 E2E）。
 *
 * 事件线是 `project.storylines[]`（跨章延续的重要事件线），**不是**世界时间线，
 * 也不是「记忆与伏笔」里的伏笔。本文件只走产品界面，全部用 GET 复核落库结果：
 *   ① 删除前必须展示这条线真实的关联（章节/节点/章节计划/伏笔/词条/角色）；
 *   ② 点「删除事件线」只是展开二次确认，此时**不得**真的删掉；
 *   ③ 确认后只删这条线本身，正文 / 章纲 / 其它事件线不受影响，刷新后不复现；
 *   ④ 删除前会自动建立一个可恢复的检查点 —— 证明「可恢复」不是嘴上说说。
 */

type ServerProject = {
  revision: number
  chapters: Array<{ id: string; title: string }>
  storylines?: Array<{ id: string; title: string }>
  outline?: { volumes?: Array<{ chapters?: Array<{ id: string; title: string }> }> }
}

type VersionSummary = { id: string; revision: number; reason: string; source: string; createdAt: string }

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

async function readVersions(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<VersionSummary[]> {
  const response = await page.request.get(`${origin}/api/novels/${id}/versions`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as VersionSummary[]
}

test('G-20 删除事件线：展示真实关联、二次确认、只删该线、可恢复、刷新不复现', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1500, height: 940 })

  // 真实造数据：一章带正文 + 一条事件线。
  const { origin, id, headers } = await buildWritableProject(page, 'G20 删线')
  await openModule(page, '小说大纲', '故事线')
  await page.getByLabel('事件线名称').fill('潮汐调查线')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '建立事件线' }).click()
  expect((await created).status()).toBe(200)

  const seeded = await readProject(page, origin, id, headers)
  expect(seeded.storylines, '事件线必须真的落库').toHaveLength(1)
  const versionsBefore = await readVersions(page, origin, id, headers)

  // 1) 点「删除事件线」只展开二次确认，并展示这条线真实的关联统计。
  await page.getByTestId('storyline-delete').click()
  const references = page.getByTestId('storyline-delete-references')
  await expect(references).toBeVisible()
  await expect(references, '关联统计必须来自这条线自己的数据').toContainText('关联章节')
  await expect(references).toContainText('关键节点')
  await expect(references).toContainText('关联伏笔')
  await expect(references).toContainText('关联词条')
  // 这条线还没有关联任何章节与节点，真实计数就是 0（不是编出来的数字）。
  await expect(references).toContainText('0 章')
  await expect(references).toContainText('0 个')
  // 明确告知影响范围。
  await expect(page.locator('.mjp-canvas-scroll')).toContainText('不会删除正文、章纲、世界词条、记忆或伏笔')

  // 此时**尚未**删除：二次确认不是「点了就删」。
  const stillThere = await readProject(page, origin, id, headers)
  expect(stillThere.storylines, '展开二次确认不得删除任何东西').toHaveLength(1)
  expect(stillThere.revision, '展开确认不写库').toBe(seeded.revision)

  // 2) 确认删除：只删这一条事件线。
  const removed = projectPut(page, id)
  await page.getByTestId('storyline-delete-confirm').click()
  expect((await removed).status()).toBe(200)

  await expect(page.getByTestId('storyline-delete-references'), '删除后确认区关闭').toHaveCount(0)
  await expect(page.locator('.mjp-canvas-scroll')).not.toContainText('潮汐调查线')
  await expect(page.locator('.mjp-canvas-scroll'), '没有事件线时回到空态').toContainText('新建事件线')

  const stored = await readProject(page, origin, id, headers)
  expect(stored.storylines, '服务端这条线必须真的没了').toHaveLength(0)
  expect(stored.chapters, '正文不受牵连').toHaveLength(seeded.chapters.length)
  expect(stored.outline?.volumes?.[0]?.chapters, '章纲不受牵连').toHaveLength(
    seeded.outline?.volumes?.[0]?.chapters?.length ?? 1
  )

  // 3) 可恢复：删除前显式建立了检查点（常规保存不产生快照）。
  const versionsAfter = await readVersions(page, origin, id, headers)
  const checkpoint = versionsAfter.filter((version) => version.reason.includes('删除事件线前：潮汐调查线'))
  expect(checkpoint, '删除前必须留下一个可恢复的检查点').toHaveLength(1)
  expect(versionsAfter.length).toBeGreaterThan(versionsBefore.length)

  // 4) 刷新重进：删除结果保留，不会「复活」。
  await page.reload()
  await page.locator('.mjp-hall-project', { hasText: /G20 删线/ }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '小说大纲', '故事线')
  await expect(title(page)).toHaveText('故事线')
  await expect(page.locator('.mjp-canvas-scroll')).not.toContainText('潮汐调查线')

  console.log('[G-20] 关联统计真实（0 章/0 个）→ 二次确认不误删 → 确认后只删该线 → 检查点可恢复 → 刷新不复现')
})
