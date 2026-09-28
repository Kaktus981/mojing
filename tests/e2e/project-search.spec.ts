import { expect, test, type Page } from '@playwright/test'
import { buildWritableProject, openModule, projectPut, title } from './helpers/manual-workspace'

/**
 * G-17 · 当前项目内的只读搜索（Edge 隔离 E2E）。
 *
 *   node tests/e2e/run-e2e.mjs tests/e2e/project-search.spec.ts --output=test-results/<唯一名>
 *
 * 搜索框挂在工作区常驻工具条上，检索的是应用已加载的当前项目。
 * 本文件只做真实验证，全程走产品界面，不伪造数据：
 *   ① 命中真实内容（类型 + 标题 + 命中片段都来自真实项目数据），点击落点真的切到原页面；
 *   ② 空查询不出结果、无命中如实说明；
 *   ③ 全程 project.revision 不变 —— 证明搜索是只读的，不会顺带写库。
 */

type ServerProject = { revision: number; chapters: Array<{ id: string; title: string }> }

const searchInput = (page: Page) => page.getByTestId('project-search-input')
const searchResult = (page: Page) => page.getByTestId('project-search-result')

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

/** 通过界面建一条事件线，让「故事线」这一域也有真实可命中的数据。 */
async function createStoryline(page: Page, id: string, name: string): Promise<void> {
  await openModule(page, '小说大纲', '故事线')
  await page.getByLabel('事件线名称').fill(name)
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '建立事件线' }).click()
  expect((await created).status()).toBe(200)
  await expect(page.locator('.mjp-canvas-scroll')).toContainText(name)
}

test('G-17 项目内搜索：命中真实内容、点击落到原页面、全程不改动项目', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1500, height: 940 })

  // 真实造数据：一章带正文（正文里有「古钟」）+ 一条事件线（标题里有「潮汐」）。
  const { origin, id, headers } = await buildWritableProject(page, 'G17 搜索')
  await createStoryline(page, id, '潮汐调查线')

  const before = await readProject(page, origin, id, headers)

  // 1) 空查询：不出结果面板（约定：trim 为空返回 []，不返回全量）。
  await expect(searchResult(page)).toHaveCount(0)

  // 2) 真实命中：正文与章纲两域都该命中「古钟」。
  await searchInput(page).fill('古钟')
  await expect(searchResult(page)).toBeVisible()

  const kinds = await page.locator('.mjp-search-kind').allTextContents()
  expect(kinds, '正文里写了「古钟」，必须命中正文域').toContain('正文')
  expect(kinds, '章纲标题是「古钟初鸣」，必须命中章纲域').toContain('章纲')

  const bodyHit = page.locator('.mjp-search-hit').filter({ has: page.locator('.mjp-search-kind', { hasText: '正文' }) }).first()
  await expect(bodyHit).toBeVisible()
  // 标题与片段都来自真实项目数据，不是占位文案。
  await expect(bodyHit.locator('.mjp-search-title')).toContainText('古钟初鸣')
  await expect(bodyHit.locator('.mjp-search-snippet'), '命中片段必须是真实正文摘录').toContainText('古钟')

  // 3) 换一个只有事件线里才有的词，命中「故事线」域。
  await searchInput(page).fill('潮汐')
  await expect(searchResult(page)).toBeVisible()
  const lineHit = page.locator('.mjp-search-hit').filter({ has: page.locator('.mjp-search-kind', { hasText: '故事线' }) }).first()
  await expect(lineHit).toBeVisible()
  await expect(lineHit.locator('.mjp-search-title')).toHaveText('潮汐调查线')

  // 4) 点击落点真的切到原页面（不是只把输入框清空）。跳转本身不写库，故不等待任何 PUT。
  await lineHit.click()
  await expect(title(page), '点击故事线命中必须落到「故事线」页').toHaveText('故事线')
  await expect(searchResult(page), '落点后搜索面板收起').toHaveCount(0)

  // 5) 只读性：整个检索与跳转过程不会写库。
  const after = await readProject(page, origin, id, headers)
  expect(after.revision, '搜索是只读的，revision 不得变化').toBe(before.revision)
  expect(after.chapters).toHaveLength(before.chapters.length)

  console.log('[G-17] 搜索命中正文/章纲/故事线三域真实数据；点击落点切换页面；revision 全程不变')
})

test('G-17 项目内搜索：空查询不出结果、无命中如实说明', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1500, height: 940 })

  const { origin, id, headers } = await buildWritableProject(page, 'G17 无命中')
  const before = await readProject(page, origin, id, headers)

  // 无命中：如实说「没有找到」，不编造结果、不报错。
  await searchInput(page).fill('绝不存在的检索词zzz')
  await expect(searchResult(page)).toBeVisible()
  await expect(searchResult(page)).toContainText('没有找到')
  await expect(page.locator('.mjp-search-hit')).toHaveCount(0)

  // 清空即收起面板。
  await searchInput(page).fill('')
  await expect(searchResult(page)).toHaveCount(0)

  const after = await readProject(page, origin, id, headers)
  expect(after.revision, '空查询与无命中都不会写库').toBe(before.revision)

  console.log('[G-17] 空查询不出结果；无命中显示「没有找到」；revision 不变')
})
