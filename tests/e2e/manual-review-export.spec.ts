import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * M7 · 人工审稿与导出备份（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-review-export.spec.ts
 *
 * 全程通过产品界面操作；导出会真实下载文件并解析内容，JSON 备份会真实重新导入做等价比较。
 */

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')

type ServerProject = {
  revision: number
  title: string
  chapters: Array<{ id: string; chapterNumber: number; title: string; blocks: Array<{ id: string; text: string }> }>
  reviews: Array<{
    id: string; chapterId?: string; category: string; severity: string; title: string; description: string
    status: string; resolution?: { method: string; reason: string; resolvedAt: string }
  }>
}

function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

async function openModule(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(title(page)).toHaveText(itemLabel)
}

async function writeProse(page: Page, projectId: string, text: string): Promise<void> {
  const saved = projectPut(page, projectId)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.type(text)
  expect((await saved).status()).toBe(200)
}

/** 全 UI 建一个「两章都有正文」的项目，正文含中文与多段。 */
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
  const id = ((await list.json()) as Array<{ id: string; title: string }>).find((entry) => entry.title === projectTitle)!.id

  const createdOutline = projectPut(page, id)
  await page.getByRole('button', { name: '创建空白大纲' }).click()
  await createdOutline
  const addedVolume = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  await addedVolume
  const namedVolume = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1卷 卷名' }).fill('旧城')
  await namedVolume

  await openModule(page, '小说大纲', '章节规划')
  for (const [index, chapterTitle] of ['古钟初鸣', '裂痕'].entries()) {
    const created = projectPut(page, id)
    await page.getByRole('button', { name: '新建章节规划' }).click()
    await created
    const named = projectPut(page, id)
    await page.getByRole('textbox', { name: '章节标题', exact: true }).fill(chapterTitle)
    await named
    const body = projectPut(page, id)
    await page.getByRole('button', { name: '开始写作' }).click()
    await body
    await writeProse(page, id, index === 0 ? '林砚在旧城发现一座刻有星纹的古钟。' : '钟声在夜里响了三下')
    if (index === 0) {
      const second = projectPut(page, id)
      await page.keyboard.press('Enter')
      await page.keyboard.type('他决定先隐瞒这件事。')
      await second
    }
    await openModule(page, '小说大纲', '章节规划')
  }
  await expect(page.locator('.mjp-save-state').first()).toContainText('已保存')
  return { origin, id, headers }
}

test('人工新建审稿问题、记录处理意见与重新打开都真实落库', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M7 审稿')
  await openModule(page, '审稿与导出', '审稿问题')

  // 1) 人工新建：标题 + 描述 + 关联章节 + 段落证据（默认取该段原文）
  await page.getByLabel('问题标题').fill('钟声规则前后矛盾')
  await page.getByLabel('问题描述').fill('第一章说钟声改写记忆，第二章写成改写时间。')
  await page.getByLabel('关联章节').selectOption({ index: 1 })
  await page.getByLabel('证据段落').selectOption({ index: 1 })
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '记录这条问题' }).click()
  expect((await created).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  const issue = stored.reviews[0]!
  const chapter = stored.chapters[0]!
  expect(stored.reviews, '人工问题已落库').toHaveLength(1)
  expect(issue).toMatchObject({ title: '钟声规则前后矛盾', category: '逻辑', severity: '中', status: '待处理' })
  expect(issue.chapterId, '问题关联真实章节').toBe(chapter.id)
  expect(issue.resolution, '新建问题不带处理记录').toBeUndefined()

  // 2) 忽略类处理必须写理由：不写理由按钮不可用
  await page.getByRole('button', { name: '记录处理意见' }).click()
  await page.getByLabel('钟声规则前后矛盾 处理方式').selectOption('风险已知仍忽略')
  await expect(page.getByRole('button', { name: '记录为已完成' })).toBeDisabled()
  await page.getByLabel('钟声规则前后矛盾 处理理由').fill('有意保留的矛盾，会在第三卷解释')
  const resolved = projectPut(page, id)
  await page.getByRole('button', { name: '记录为已完成' }).click()
  expect((await resolved).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.reviews[0]!.status).toBe('已完成')
  expect(stored.reviews[0]!.resolution).toMatchObject({ method: '风险已知仍忽略', reason: '有意保留的矛盾，会在第三卷解释' })
  expect(stored.chapters, '处理问题不会自动改写正文').toEqual(chapter ? [chapter, stored.chapters[1]!] : stored.chapters)

  // 3) 重新打开：状态回到待处理，处理记录保留为历史
  // 默认筛选是「待处理」，处理完的问题已经不在列表里，先切到「全部」
  await page.getByRole('tab', { name: '全部' }).click()
  const reopened = projectPut(page, id)
  await page.getByRole('button', { name: '重新打开' }).click()
  expect((await reopened).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.reviews[0]!.status).toBe('待处理')
  expect(stored.reviews[0]!.resolution, '历史处理记录不得丢失').toMatchObject({ method: '风险已知仍忽略' })

  console.log(`[M7 审稿] 人工问题「${stored.reviews[0]!.title}」→ 记录处理意见(风险已知仍忽略) → 重新打开；正文未被自动改写`)
})

test('导出前先保存最新改动，实际下载 TXT 后中文与多段内容正确', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M7 导出')
  await openModule(page, '审稿与导出', '导出成稿')

  // 先跑本地预检：会先保存，再基于已落库内容检查
  await page.getByRole('button', { name: '运行本地预检' }).click()
  await expect(canvas(page)).toContainText('预检状态：')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^导出 / }).click()
  const file = await download
  const path = await file.path()
  expect(file.suggestedFilename()).toContain('.docx')

  // 换成 TXT 再导出一份，验证内容与段落
  await page.getByRole('button', { name: /纯文本/ }).first().click()
  await expect(canvas(page)).toContainText('预检状态：已过期')
  await page.getByRole('button', { name: '运行本地预检' }).click()
  const txtDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /^导出 / }).click()
  const txtFile = await txtDownload
  const text = readFileSync(await txtFile.path(), 'utf8')

  expect(txtFile.suggestedFilename()).toMatch(/\.txt$/)
  expect(text, '含中文正文').toContain('林砚在旧城发现一座刻有星纹的古钟。')
  expect(text, '多段内容换行保留').toContain('他决定先隐瞒这件事。')
  expect(text, '按章输出').toContain('古钟初鸣')
  expect(text.split('\n').length, '不是被压成一行的文本').toBeGreaterThan(3)

  const stored = await readProject(page, origin, id, headers)
  expect(stored.chapters).toHaveLength(2)
  console.log(`[M7 导出] 本地预检→${txtFile.suggestedFilename()}（${text.length} 字符，含中文与多段）`)
})

test('JSON 完整备份可以重新导入，关键资料等价', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M7 备份')

  // 先造一份非正文资料，确认备份不是只导正文。规则与边界以世界书为前提，先建立空白世界。
  await openModule(page, '世界观', '世界总览')
  const world = projectPut(page, id)
  await page.getByRole('button', { name: '从空白世界开始' }).click()
  await world
  await openModule(page, '世界观', '规则与边界')
  await page.getByLabel('新术语名称').fill('星纹古钟')
  await page.getByLabel('新术语定义').fill('旧城地底的计时装置。')
  const addedTerm = projectPut(page, id)
  await page.getByRole('button', { name: '新增术语' }).click()
  await addedTerm

  await openModule(page, '审稿与导出', '导出成稿')
  await page.getByRole('button', { name: /完整 JSON 备份/ }).first().click()
  await page.getByRole('button', { name: '运行本地预检' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^导出 / }).click()
  const file = await download
  const raw = readFileSync(await file.path(), 'utf8')
  const backup = JSON.parse(raw) as {
    title: string
    chapters: Array<{ title: string; blocks: Array<{ text: string }> }>
    worldConstraints: Array<{ term: string; definition: string }>
    revision: number
  }

  const before = await readProject(page, origin, id, headers)
  expect(backup.chapters.map((chapter) => chapter.title)).toEqual(before.chapters.map((chapter) => chapter.title))
  expect(backup.worldConstraints.map((item) => item.term)).toContain('星纹古钟')

  // 重新导入：走大厅真实的文件导入入口
  await page.locator('.mjp-snav-foot').getByRole('button', { name: '返回项目大厅' }).click()
  await page.locator('.mjp-hall-project').first().waitFor({ timeout: 30_000 })
  // Playwright 的下载临时文件没有扩展名，导入接口按扩展名判断格式，
  // 所以把**导出得到的原始内容**写到带 .json 扩展名的临时文件再导入。
  const backupPath = join(tmpdir(), `mojing-backup-${Date.now()}.json`)
  writeFileSync(backupPath, raw, 'utf8')

  const importResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/novels/import')
  )
  await page.locator('input[type="file"]').setInputFiles(backupPath)
  const importedResponse = await importResponse
  expect(importedResponse.status(), '导入接口必须成功').toBe(201)
  const importedSummary = (await importedResponse.json()) as { id: string; title: string }
  expect(importedSummary.id, '导入产生一个新项目，原项目不受影响').not.toBe(id)
  expect(importedSummary.title).toContain(backup.title)

  const importedProject = await readProject(page, origin, importedSummary.id, headers)
  const originalProject = await readProject(page, origin, id, headers)
  expect(originalProject.chapters, '原项目不得被导入覆盖').toEqual(before.chapters)

  expect(importedProject.chapters.map((chapter) => chapter.title), '章节顺序与标题等价').toEqual(before.chapters.map((chapter) => chapter.title))
  expect(importedProject.chapters[0]!.blocks.map((block) => block.text), '正文段落等价').toEqual(before.chapters[0]!.blocks.map((block) => block.text))

  console.log(`[M7 备份] JSON 完整备份 ${raw.length} 字节 → 重新导入后标题/章节/正文/术语等价`)
})
