import { expect, test, type Page } from '@playwright/test'

/**
 * M4 收尾 · 结构调整的安全性验收（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-structure-safety.spec.ts
 *
 * 这些用例**全部通过产品界面**建项目与写正文（大厅 → 创作起点 → 总纲与卷纲 →
 * 章节规划 → 正文创作），不使用 `page.route` 伪造数据；结构操作走
 * 「预览影响 → 确认执行」的真实候选门禁，最后用 GET 复核服务端落库结果。
 *
 * 重点验证「确认应用之后」的项目状态，而不是只看候选与影响摘要：
 *   - 正文仍对应正确章纲（正文与章纲同身份、同阅读位置）；
 *   - 章号重排不串章（正文之间不共用章号，也不占用别人的章号）；
 *   - 正文内容不被删除，无章纲正文被如实标出；
 *   - 过期预览被拒绝、重复确认不执行两次、失败不留半完成数据；
 *   - 卷级操作：含内容的卷拒绝删除，空卷才允许删除。
 */

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')
const fold = (page: Page, label: string) => page.locator('.mjp-oi-fold-h', { hasText: label === '结构调整' ? '结构编织师' : label })

/** 幂等展开折叠区：已展开时不再点击（再点会收起，导致面板卸载）。 */
async function openFold(page: Page, label: string): Promise<void> {
  const header = fold(page, label)
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
}
const item = (page: Page, text: string) => page.locator('.mjp-oi-item', { hasText: text }).first()

type OutlineChapter = {
  id: string; volumeNumber: number; chapterNumber: number; title: string
  beats: Array<{ id: string }>; downstreamReviewStatus?: string
}
type ServerProject = {
  revision: number
  chapters: Array<{ id: string; volumeNumber: number; chapterNumber: number; title: string; blocks: Array<{ id: string; text: string }> }>
  outline?: { volumes: Array<{ id: string; volumeNumber: number; title: string; chapters: OutlineChapter[] }> }
  reviews: Array<{ id: string; chapterId?: string }>
}

function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

const waitPreview = (page: Page) => page.waitForResponse(
  (response) => response.request().method() === 'POST' && response.url().includes('/outline-structure/preview')
)
const waitApply = (page: Page) => page.waitForResponse(
  (response) => response.request().method() === 'POST' && response.url().includes('/api/revisions/') && response.url().includes('/apply')
)

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

const flatOutline = (project: ServerProject): OutlineChapter[] => (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
const bodyText = (project: ServerProject, bodyId: string): string =>
  project.chapters.find((chapter) => chapter.id === bodyId)?.blocks.map((block) => block.text).join('') ?? ''

/**
 * 每一章正文都必须与「同身份的章纲」处在同一阅读位置，且正文之间不共用章号。
 * 这是「结构调整后不串章」的核心口径：章号只是阅读顺序，身份才是关联。
 */
function assertBodiesAligned(project: ServerProject): void {
  const outlineNumber = new Map(flatOutline(project).map((chapter) => [chapter.id, chapter.chapterNumber]))
  const outlineNumbers = flatOutline(project).map((chapter) => chapter.chapterNumber)
  expect(new Set(outlineNumbers).size, '章纲之间不得共用章号').toBe(outlineNumbers.length)

  const bodyNumbers = project.chapters.map((chapter) => chapter.chapterNumber)
  expect(new Set(bodyNumbers).size, '正文之间不得共用章号').toBe(bodyNumbers.length)

  for (const body of project.chapters) {
    const expected = outlineNumber.get(body.id)
    if (expected === undefined) continue
    expect(body.chapterNumber, `正文 ${body.id} 必须与自己的章纲同号`).toBe(expected)
  }
}

/** 232px 导航是手风琴：已展开时再点会收起。 */
async function openModule(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(title(page)).toHaveText(itemLabel)
}

const openChapterPlanning = (page: Page) => openModule(page, '小说大纲', '章节规划')

/** 在正文创作里写一段文字并等它真实落库。 */
async function writeProse(page: Page, projectId: string, text: string): Promise<void> {
  const saved = projectPut(page, projectId)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.type(text)
  expect((await saved).status()).toBe(200)
}

/**
 * 全 UI 建一个「两卷 + 两章 + 两章都有正文」的项目：
 *   第 1 卷「旧城」：第 1 章「古钟初鸣」（带 2 个已确认剧情步骤，正文「第一章正文」）、
 *                    第 2 章「裂痕」（正文「第二章正文」）；
 *   第 2 卷「第二卷」：空卷。
 */
async function buildProject(page: Page, prefix: string): Promise<{ origin: string; id: string; headers: Record<string, string> }> {
  const firstApiRequest = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApiRequest
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const projectTitle = `${prefix}-${Date.now()}`
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(projectTitle)
  await page.getByLabel('最初的故事想法').fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '小说大纲', '创作起点')

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  const summary = ((await list.json()) as Array<{ id: string; title: string }>).find((entry) => entry.title === projectTitle)!
  const id = summary.id

  const createdOutline = projectPut(page, id)
  await page.getByRole('button', { name: '创建空白大纲' }).click()
  await createdOutline
  const addedVolume = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  await addedVolume
  const namedVolume = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1卷 卷名' }).fill('旧城')
  await namedVolume

  await openChapterPlanning(page)

  // 第 1 章：标题 + 两个剧情步骤 + 确认
  const firstChapter = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await firstChapter
  const firstTitle = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')
  await firstTitle
  await openFold(page, '剧情步骤')
  for (const label of ['第一步', '第二步']) {
    const step = projectPut(page, id)
    await page.getByRole('button', { name: '新增步骤' }).click()
    await step
    await page.getByRole('textbox', { name: /步 步骤名$/ }).last().fill(label)
  }
  const confirmed = projectPut(page, id)
  await page.getByRole('button', { name: '确认步骤' }).click()
  await confirmed

  // 第 2 章：标题
  const secondChapter = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await secondChapter
  const secondTitle = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('裂痕')
  await secondTitle

  // 两章各自「开始写作」并写下一段真实正文
  await item(page, '古钟初鸣').click()
  const firstBody = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  await firstBody
  await writeProse(page, id, '第一章正文')

  await openChapterPlanning(page)
  await item(page, '裂痕').click()
  const secondBody = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  await secondBody
  await writeProse(page, id, '第二章正文')

  // 第 2 卷（空卷）
  await openModule(page, '小说大纲', '总纲与卷纲')
  const secondVolume = projectPut(page, id)
  await page.getByRole('button', { name: '新增卷' }).click()
  await secondVolume
  const namedSecond = projectPut(page, id)
  await page.getByRole('textbox', { name: '第2卷 卷名' }).fill('第二卷')
  await namedSecond

  await openChapterPlanning(page)
  // 让最后一次编辑的 900ms 防抖保存落库，避免结构预览拿到半保存的项目
  await expect(page.locator('.mjp-save-state').first()).toContainText('已保存')
  return { origin, id, headers }
}

test('跨卷移动：确认后正文仍跟着自己那一张章纲，章号不串', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 跨卷')
  const before = await readProject(page, origin, id, headers)
  const secondOutlineId = flatOutline(before).find((chapter) => chapter.title === '裂痕')!.id

  await item(page, '裂痕').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '跨卷移动', exact: true }).click()
  await page.getByLabel('目标卷').selectOption({ index: 2 })

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)
  await expect(canvas(page)).toContainText('已有正文 1')

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  const volumeTwo = after.outline!.volumes.find((volume) => volume.volumeNumber === 2)!
  expect(volumeTwo.chapters.map((chapter) => chapter.title)).toEqual(['裂痕'])

  const movedBody = after.chapters.find((chapter) => chapter.id === secondOutlineId)!
  expect(movedBody, '正文必须仍然存在').toBeTruthy()
  expect(movedBody.volumeNumber, '正文的卷号必须跟着章纲').toBe(2)
  expect(movedBody.chapterNumber, '正文的章号必须跟着章纲').toBe(volumeTwo.chapters[0]!.chapterNumber)
  expect(bodyText(after, secondOutlineId), '正文内容不得被改写').toBe('第二章正文')
  assertBodiesAligned(after)

  // 界面上这一章仍然显示自己那一章正文
  await expect(item(page, '裂痕')).toContainText('正文：')
  console.log(`[结构·跨卷移动] 裂痕 → 第2卷；正文 id=${secondOutlineId} 卷号=2 章号=${movedBody.chapterNumber}，文字未变，正文/章纲同号`)
})

test('拆分章节：原正文归属「前半」，不产生无章纲正文也不被挪到末尾', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 拆分')
  const before = await readProject(page, origin, id, headers)
  const firstOutlineId = flatOutline(before).find((chapter) => chapter.title === '古钟初鸣')!.id

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '拆分章节', exact: true }).click()
  await page.getByLabel('拆分位置').fill('1')
  // 默认就是「归前半」：沿用原章纲稳定身份，是最小改动方案
  await expect(page.getByLabel('原正文归属')).toHaveValue('前半')

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)
  // 被拆章节自己 1 章正文 + 后面章节因编号后移也被牵动，共 2 章正文在影响范围内
  await expect(canvas(page)).toContainText('已有正文 2')
  // 影响摘要必须写明原正文归哪一半
  await expect(canvas(page)).toContainText('正文归属')
  await expect(canvas(page)).toContainText('归属「前半」')

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  const outline = flatOutline(after)
  const firstHalf = outline.find((chapter) => chapter.id === firstOutlineId)!
  const secondHalf = outline.find((chapter) => chapter.id !== firstOutlineId && chapter.title.includes('古钟初鸣'))!

  expect(outline, '拆成两半 + 原有第 2 章').toHaveLength(3)
  expect(firstHalf, '前半沿用原章纲身份').toBeTruthy()
  expect(secondHalf.title, '后半是新身份').toContain('（下）')

  const body = after.chapters.find((chapter) => chapter.id === firstOutlineId)!
  expect(body, '原正文必须保留').toBeTruthy()
  expect(bodyText(after, firstOutlineId), '正文内容不得被删除或改写').toBe('第一章正文')
  expect(body.chapterNumber, '正文跟随前半的章号，没有被挪到末尾').toBe(firstHalf.chapterNumber)
  expect(body.volumeNumber).toBe(firstHalf.volumeNumber)
  expect(after.chapters.some((chapter) => chapter.id === secondHalf.id), '后半是新章纲，还没有正文').toBe(false)

  assertBodiesAligned(after)
  const outlineNumbers = new Set(outline.map((chapter) => chapter.chapterNumber))
  expect(new Set(after.chapters.map((chapter) => chapter.chapterNumber)).size).toBe(after.chapters.length)
  expect(after.chapters.every((chapter) => outlineNumbers.has(chapter.chapterNumber))).toBe(true)

  // 界面不得再出现「有正文没有对应章纲」——拆分后不该有无章纲正文
  await openChapterPlanning(page)
  await expect(canvas(page).locator('.mjp-banner').filter({ hasText: '没有对应章纲' }), '拆分不得产生无对应章纲的正文').toHaveCount(0)
  console.log(`[结构·拆分] 章纲=${outline.length} 张（前半沿用原身份 ${firstOutlineId}）；原正文仍挂第 ${body.chapterNumber} 章，无章纲正文=0`)
})

test('拆分选「后半」时，原正文与关联改挂到后半', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 拆后半')
  const before = await readProject(page, origin, id, headers)
  const firstOutlineId = flatOutline(before).find((chapter) => chapter.title === '古钟初鸣')!.id

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '拆分章节', exact: true }).click()
  await page.getByLabel('拆分位置').fill('1')
  await page.getByLabel('原正文归属').selectOption('后半')

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)
  await expect(canvas(page)).toContainText('归属「后半」')

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  const body = after.chapters.find((chapter) => chapter.id === firstOutlineId)!
  const secondHalf = flatOutline(after).find((chapter) => chapter.id === firstOutlineId)!

  expect(body.chapterNumber, '原正文跟着后半走').toBe(secondHalf.chapterNumber)
  expect(bodyText(after, firstOutlineId)).toBe('第一章正文')
  expect(after.memories.every((memory) => after.chapters.some((chapter) => chapter.id === memory.chapterId))).toBe(true)
  assertBodiesAligned(after)
  console.log(`[结构·拆后半] 原正文改挂第 ${body.chapterNumber} 章（后半），内容未改写`)
})

test('合并章节：必须由作者选择正文如何保留，选「拼接」后两章段落并入同一份正文', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 合并')
  const before = await readProject(page, origin, id, headers)
  const firstOutlineId = flatOutline(before).find((chapter) => chapter.title === '古钟初鸣')!.id
  const secondOutlineId = flatOutline(before).find((chapter) => chapter.title === '裂痕')!.id

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '合并章节', exact: true }).click()
  await page.getByLabel('合并对象').selectOption({ index: 1 })

  // 后章已有正文：没选正文保留方式之前，预览按钮必须不可用
  await expect(page.getByLabel('正文保留方式')).toHaveValue('')
  await expect(page.getByRole('button', { name: '预览影响' })).toBeDisabled()

  await page.getByLabel('正文保留方式').selectOption('拼接')
  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)
  await expect(canvas(page)).toContainText('已有正文 2')
  await expect(canvas(page)).toContainText('正文归属')
  await expect(canvas(page)).toContainText('按顺序接上')

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  const outline = flatOutline(after)

  expect(outline, '合并后只剩一张章卡').toHaveLength(1)
  expect(outline[0]!.id, '合并后沿用先者的章纲身份').toBe(firstOutlineId)
  expect(after.chapters, '两份正文合成一份，不留无章纲正文').toHaveLength(1)
  expect(after.chapters[0]!.id).toBe(firstOutlineId)
  expect(after.chapters[0]!.blocks.map((block) => block.text), '段落按顺序拼接、内容不改写')
    .toEqual(['第一章正文', '第二章正文'])
  expect(after.chapters[0]!.chapterNumber).toBe(outline[0]!.chapterNumber)

  // 关联完整性：不得留下指向已消失身份（第二张章纲 / 第二份正文）的悬空引用
  const liveIds = new Set<string>([...after.chapters.map((chapter) => chapter.id), ...outline.map((chapter) => chapter.id)])
  const dangling = [
    ...(after.memories ?? []).map((memory) => memory.chapterId),
    ...(after.plotThreads ?? []).flatMap((thread) => [thread.setupChapterId, thread.resolutionChapterId, ...(thread.evidencePool ?? []).map((evidence) => evidence.chapterId)]),
    ...(after.reviews ?? []).map((review) => review.chapterId)
  ].filter((value): value is string => Boolean(value) && !liveIds.has(value))
  expect(dangling, '不得留下悬空引用').toEqual([])
  expect(after.chapters.some((chapter) => chapter.id === secondOutlineId), '后章正文身份已并入先者').toBe(false)

  assertBodiesAligned(after)
  await openChapterPlanning(page)
  await expect(canvas(page).locator('.mjp-banner').filter({ hasText: '没有对应章纲' }), '拼接后不得出现无对应章纲的正文').toHaveCount(0)
  console.log(`[结构·合并] 章纲=1 张（沿用 ${firstOutlineId}）；正文=1 份、段落=「${after.chapters[0]!.blocks.map((block) => block.text).join('|')}」，悬空引用=0`)
})

test('合并选「保留为无章纲」时，界面先说明后章正文会失去章纲再执行', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 合并保留')
  const before = await readProject(page, origin, id, headers)
  const secondOutlineId = flatOutline(before).find((chapter) => chapter.title === '裂痕')!.id

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '合并章节', exact: true }).click()
  await page.getByLabel('合并对象').selectOption({ index: 1 })
  await page.getByLabel('正文保留方式').selectOption('保留为无章纲')

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)
  await expect(canvas(page), '必须事先说明会失去对应章纲').toContainText('没有对应章纲')

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  expect(after.chapters, '两份正文都保留').toHaveLength(2)
  expect(after.chapters.some((chapter) => chapter.id === secondOutlineId), '这是作者明确选择的结果').toBe(true)
  expect(new Set(after.chapters.map((chapter) => chapter.chapterNumber)).size).toBe(after.chapters.length)
  assertBodiesAligned(after)
  await openChapterPlanning(page)
  await expect(canvas(page).locator('.mjp-banner').filter({ hasText: '没有对应章纲' }), '作者明确选择后目录如实提示').toHaveCount(1)
  console.log('[结构·合并保留] 作者明确选择后才出现无章纲正文，章号无重复')
})

test('过期预览不得无提示强制应用：预览后项目变化，确认会被拒绝且不留半完成数据', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 过期预览')

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '调序', exact: true }).click()
  await page.getByLabel('参照章节').selectOption({ index: 1 })

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)
  await expect(canvas(page)).toContainText('影响摘要')

  // 预览之后改一张章纲标题：项目版本前进，预览随即过期
  const edited = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣（改）')
  await edited
  const stale = await readProject(page, origin, id, headers)

  const refused = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await refused).status(), '过期预览必须被拒绝').toBe(409)

  const after = await readProject(page, origin, id, headers)
  expect(JSON.stringify(after), '被拒绝后项目必须原样不动（含版本号、章纲、正文与审稿）').toBe(JSON.stringify(stale))
  await expect(page.locator('.mjp-toast.is-error')).toBeVisible()

  console.log(`[结构·过期预览] 预览基于旧版本 → 确认返回 409，项目保持 revision=${after.revision} 原样不动，界面给出错误提示`)
})

test('重复确认不会执行两次：同一候选第二次应用被拒绝，项目只变一次', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 重复确认')

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '调序', exact: true }).click()
  await page.getByLabel('参照章节').selectOption({ index: 1 })

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  const proposalId = ((await (await preview).json()) as { proposal: { id: string } }).proposal.id

  const stale = await readProject(page, origin, id, headers)
  const first = await page.request.post(`${origin}/api/revisions/${proposalId}/apply`, {
    headers, data: { currentRevision: stale.revision, allowConflict: false, allowQualityConflict: false }
  })
  expect(first.status(), '第一次应用应当成功').toBe(200)
  const applied = await readProject(page, origin, id, headers)

  const second = await page.request.post(`${origin}/api/revisions/${proposalId}/apply`, {
    headers, data: { currentRevision: applied.revision, allowConflict: false, allowQualityConflict: false }
  })
  expect(second.status(), '重复应用必须被拒绝').toBe(409)
  expect(((await second.json()) as { error: { code: string } }).error.code).toBe('REVISION_ALREADY_APPLIED')

  const after = await readProject(page, origin, id, headers)
  expect(JSON.stringify(after), '第二次请求不得再改动项目').toBe(JSON.stringify(applied))
  assertBodiesAligned(after)

  console.log(`[结构·重复确认] 第一次 200 → 第二次 409 REVISION_ALREADY_APPLIED；项目只变一次（revision=${after.revision}）`)
})

test('基线版本不符属并发校验：整体拒绝且项目不变（真正的事务中途回滚见 core 注入用例）', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 事务')

  const before = await readProject(page, origin, id, headers)
  const preview = await page.request.post(`${origin}/api/novels/${id}/outline-structure/preview`, {
    headers,
    data: { baseRevision: before.revision, operation: '调序', chapterId: flatOutline(before)[0]!.id, relativeChapterId: flatOutline(before)[1]!.id, position: '之后' }
  })
  expect(preview.status()).toBe(201)
  const proposalId = ((await preview.json()) as { proposal: { id: string } }).proposal.id

  const failed = await page.request.post(`${origin}/api/revisions/${proposalId}/apply`, {
    headers, data: { currentRevision: 0, allowConflict: false, allowQualityConflict: false }
  })
  expect(failed.status(), '版本不符必须拒绝').toBe(409)
  expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('REVISION_CONFLICT')

  const after = await readProject(page, origin, id, headers)
  expect(JSON.stringify(after), '失败的候选不得留下任何半完成改动').toBe(JSON.stringify(before))
  assertBodiesAligned(after)

  console.log(`[结构·事务失败] 基线版本不符 → 409 REVISION_CONFLICT；项目与失败前逐字节一致（revision=${after.revision}）`)
})

test('卷级操作：含内容的卷拒绝删除，空卷才允许删除', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 删卷')

  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '删除卷', exact: true }).click()
  await page.getByLabel('要删除的卷').selectOption({ index: 1 })

  // 第 1 卷里有两章正文与两个剧情步骤：界面上先如实显示这一卷里有什么
  await expect(page.getByLabel('卷内容统计')).toHaveValue(/2 张章纲 · 2 个剧情步骤 · 2 章正文/)

  const refusedPreview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await refusedPreview).status(), '含内容的卷必须拒绝删除').toBe(409)
  await expect(page.locator('.mjp-toast.is-error')).toContainText('不会级联删除这些内容')

  const afterRefusal = await readProject(page, origin, id, headers)
  expect(afterRefusal.outline!.volumes, '被拒绝时不得删除任何卷').toHaveLength(2)
  expect(afterRefusal.chapters, '被拒绝时不得删除任何正文').toHaveLength(2)

  // 空卷可以直接删除
  await page.getByLabel('要删除的卷').selectOption({ index: 2 })
  const emptyPreview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await emptyPreview).status()).toBe(201)

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  expect(after.outline!.volumes.map((volume) => volume.title)).toEqual(['旧城'])
  expect(after.chapters, '删空卷不得影响正文').toHaveLength(2)
  assertBodiesAligned(after)

  console.log('[结构·删卷] 含内容卷 → 409 拒绝且项目不变；空卷 → 确认后删除，正文 2 章与章纲 2 张全部保留')
})

test('卷排序：确认后卷序与章号整体重排，正文仍与自己的章纲同号', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, '结构 卷序')

  // 先把第 2 章移到第 2 卷，让卷序变化真正影响章号
  await item(page, '裂痕').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '跨卷移动', exact: true }).click()
  await page.getByLabel('目标卷').selectOption({ index: 2 })
  const movedPreview = waitPreview(page)
  const movedApply = waitApply(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await movedPreview).status()).toBe(201)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await movedApply).status()).toBe(200)

  const beforeOrder = await readProject(page, origin, id, headers)
  const secondOutlineId = flatOutline(beforeOrder).find((chapter) => chapter.title === '裂痕')!.id
  expect(beforeOrder.outline!.volumes.map((volume) => volume.title)).toEqual(['旧城', '第二卷'])
  expect(flatOutline(beforeOrder).map((chapter) => [chapter.title, chapter.chapterNumber])).toEqual([['古钟初鸣', 1], ['裂痕', 2]])

  // 再把第 2 卷整体移到前面：章号会整体重排
  await item(page, '古钟初鸣').click()
  await openFold(page, '结构调整')
  await page.getByRole('button', { name: '卷排序', exact: true }).click()
  await page.getByLabel('要移动的卷').selectOption({ index: 2 })
  await page.getByLabel('参照卷').selectOption({ index: 1 })
  await page.getByLabel('卷位置').selectOption('之前')

  const preview = waitPreview(page)
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await preview).status()).toBe(201)

  const applied = waitApply(page)
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const after = await readProject(page, origin, id, headers)
  expect(after.outline!.volumes.map((volume) => [volume.volumeNumber, volume.title])).toEqual([[1, '第二卷'], [2, '旧城']])
  expect(flatOutline(after).map((chapter) => [chapter.title, chapter.chapterNumber])).toEqual([['裂痕', 1], ['古钟初鸣', 2]])

  const movedBody = after.chapters.find((chapter) => chapter.id === secondOutlineId)!
  expect(movedBody.chapterNumber, '正文必须跟着自己的章纲到新的阅读位置').toBe(1)
  expect(bodyText(after, secondOutlineId)).toBe('第二章正文')
  assertBodiesAligned(after)

  console.log(`[结构·卷排序] 卷序=第二卷/旧城；章号=裂痕1、古钟初鸣2；正文 id=${secondOutlineId} 同号跟随，文字未变`)
})
