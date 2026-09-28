import { expect, type Page } from '@playwright/test'

/**
 * M6 测试共用夹具：全 UI 建一个「有一章真实正文」的项目。
 *
 * 与其它 E2E 一样不使用 `page.route` 伪造数据：大厅建项目 → 建立空白大纲 →
 * 新增第一卷 → 建章纲 → 开始写作 → 在正文里真的敲字（触发真实保存）。
 */

export const title = (page: Page) => page.locator('.mjp-view-head .title')
export const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')

export function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

/** 232px 导航是手风琴：已展开时再点会收起。 */
export async function openModule(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(title(page)).toHaveText(itemLabel)
}

export type ManualFixture = { origin: string; id: string; headers: Record<string, string>; chapterId: string }

export async function buildWritableProject(page: Page, prefix: string, prose = '林砚在旧城发现古钟，古钟会改写记忆。'): Promise<ManualFixture> {
  let probe: Awaited<ReturnType<Page['waitForRequest']>> | undefined
  for (let attempt = 0; attempt < 2 && !probe; attempt += 1) {
    const firstApiRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname.startsWith('/api/'),
      { timeout: 30_000 }
    )
    await page.goto(attempt === 0 ? '/' : `/?api-probe=${Date.now()}`)
    try { probe = await firstApiRequest } catch (error) { if (attempt === 1) throw error }
  }
  if (!probe) throw new Error('页面启动后没有发出 API 请求。')
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const projectTitle = `${prefix}-${Date.now()}`
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(projectTitle)
  await page.getByLabel('最初的故事想法').fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  // 新项目首次进入工作区先展示项目概览；建立章纲前按真实产品导航进入总纲与卷纲。
  await openModule(page, '小说大纲', '总纲与卷纲')

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  const summary = ((await list.json()) as Array<{ id: string; title: string }>).find((entry) => entry.title === projectTitle)!
  const id = summary.id

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '创建空白大纲' }).click()
  await created
  const added = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  await added
  const named = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1卷 卷名' }).fill('旧城')
  await named

  await openModule(page, '小说大纲', '章节规划')
  const chapter = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await chapter
  const chapterNamed = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')
  await chapterNamed

  const body = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  await body
  const typed = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.type(prose)
  await typed

  const stored = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  const project = (await stored.json()) as { chapters: Array<{ id: string }> }
  return { origin, id, headers, chapterId: project.chapters[0]!.id }
}
