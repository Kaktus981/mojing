import { expect, test, type Page } from '@playwright/test'

/**
 * M4 · 章纲到正文与结构一致性（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-chapter-planning.spec.ts
 *
 * 全流程纯 UI：大厅真实创建空项目 → 建立空白大纲 → 新增首卷 → 进「章节规划」
 * 建章纲、写字段、写剧情步骤、开始写作、结构调整预览后确认。
 * **不使用 `page.route` 伪造项目数据**；每次断言都用 GET 复核服务端真实落库内容。
 */

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')

function projectPut(page: Page, projectId: string) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/novels/${projectId}`
  )
}

type ServerProject = {
  revision: number
  chapters: Array<{ id: string; chapterNumber: number; volumeNumber: number; title: string }>
  outline?: {
    volumes: Array<{
      volumeNumber: number
      title: string
      chapters: Array<{
        id: string
        chapterNumber: number
        volumeNumber: number
        title: string
        pov: string
        objective: string
        conflict: string
        turningPoint: string
        reveal: string
        endingHook: string
        beatStatus: string
        downstreamReviewStatus?: string
        beats: Array<{ id: string; order: number; title: string; purpose: string }>
      }>
    }>
  }
}

async function readProject(page: Page, origin: string, id: string, headers: Record<string, string>): Promise<ServerProject> {
  const response = await page.request.get(`${origin}/api/novels/${id}`, { headers })
  expect(response.status()).toBe(200)
  return (await response.json()) as ServerProject
}

/** 大厅建空项目 + 建立空白大纲与首卷（全部走 UI），并停在「总纲与卷纲」。 */
async function createProjectWithVolume(page: Page, prefix: string): Promise<{ origin: string; id: string; headers: Record<string, string> }> {
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
  await openModule(page, '小说大纲', '总纲与卷纲')

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  const summaries = (await list.json()) as Array<{ id: string; title: string }>
  const summary = summaries.find((item) => item.title === projectTitle)!
  const id = summary.id

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '创建空白大纲' }).click()
  expect((await created).status()).toBe(200)

  const added = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  expect((await added).status()).toBe(200)

  const titled = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1卷 卷名' }).fill('潮汐卷')
  expect((await titled).status()).toBe(200)

  return { origin, id, headers }
}

/** 232px 导航是手风琴：已展开时再点会收起，所以先判断状态。 */
async function openModule(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(title(page)).toHaveText(itemLabel)
}

const fold = (page: Page, label: string) => page.locator('.mjp-oi-fold-h', { hasText: label === '结构调整' ? '结构编织师' : label })

test('「新建章节规划」只建立章纲，章纲七字段可手写并落库，刷新重开保留', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createProjectWithVolume(page, 'M4 章纲')
  await openModule(page, '小说大纲', '章节规划')

  // 1) 只有卷、没有章纲
  await expect(canvas(page)).toContainText('当前筛选下没有章纲')
  await expect(page.getByRole('button', { name: '新建章节规划' })).toBeEnabled()

  // 2) 新建章纲：只建章纲，不建正文
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  expect((await created).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes[0]!.chapters, '新建章节规划必须只建立章纲').toHaveLength(1)
  expect(stored.chapters, '新建章节规划不得创建正文').toHaveLength(0)
  expect(stored.outline!.volumes[0]!.chapters[0]).toMatchObject({
    chapterNumber: 1,
    volumeNumber: 1,
    title: '',
    objective: '',
    conflict: '',
    turningPoint: '',
    reveal: '',
    endingHook: '',
    beats: []
  })

  // 3) 七个章纲字段可手写
  const values: Record<string, string> = {
    章节标题: '古钟初鸣',
    叙事视角: '林砚（限知）',
    目标: '确认钟声真的改写了记忆',
    冲突: '巡夜人要求他保密',
    转折: '发现被抹去的是自己的昨天',
    揭示: '钟声来自地底更古老的东西',
    结尾: '他决定先隐瞒这件事'
  }
  for (const [label, value] of Object.entries(values)) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  }
  // 最后一次编辑触发 900ms 防抖保存，等它真正落库
  const saved = projectPut(page, id)
  await page.getByRole('textbox', { name: '结尾', exact: true }).fill(values['结尾']!)
  expect((await saved).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const card = stored.outline!.volumes[0]!.chapters[0]!
  expect(card.title).toBe(values['章节标题'])
  expect(card.pov).toBe(values['叙事视角'])
  expect(card.objective).toBe(values['目标'])
  expect(card.conflict).toBe(values['冲突'])
  expect(card.turningPoint).toBe(values['转折'])
  expect(card.reveal).toBe(values['揭示'])
  expect(card.endingHook).toBe(values['结尾'])

  // 4) 刷新重开后内容保留
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '小说大纲', '章节规划')
  await expect(page.getByRole('textbox', { name: '章节标题', exact: true })).toHaveValue(values['章节标题']!)
  await expect(page.getByRole('textbox', { name: '叙事视角', exact: true })).toHaveValue(values['叙事视角']!)
  await expect(page.getByRole('textbox', { name: '结尾', exact: true })).toHaveValue(values['结尾']!)

  console.log(`[M4 章纲] 新建章纲→七字段落库→刷新重开保留；服务端 章纲=${stored.outline!.volumes[0]!.chapters.length} 正文=${stored.chapters.length}`)
})

test('剧情步骤可增改、排序、删除与确认，改动已确认步骤会退回待确认并标记复核', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createProjectWithVolume(page, 'M4 步骤')
  await openModule(page, '小说大纲', '章节规划')

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')

  await fold(page, '剧情步骤').click()

  // 1) 新增两步
  const first = projectPut(page, id)
  await page.getByRole('button', { name: '新增步骤' }).click()
  await first
  await page.getByRole('textbox', { name: '第1步 步骤名' }).fill('入城')
  await page.getByRole('textbox', { name: '第1步 目标', exact: true }).fill('确认钟声改写记忆')
  await page.getByRole('textbox', { name: '第1步 结果', exact: true }).fill('发现被抹去的昨天')

  const second = projectPut(page, id)
  await page.getByRole('button', { name: '新增步骤' }).click()
  await second
  await page.getByRole('textbox', { name: '第2步 步骤名' }).fill('对峙')

  // 2) 排序：把第 2 步上移
  const moved = projectPut(page, id)
  await page.getByRole('button', { name: '第2步上移' }).click()
  expect((await moved).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  let beats = stored.outline!.volumes[0]!.chapters[0]!.beats
  expect(beats.map((beat) => beat.title)).toEqual(['对峙', '入城'])
  expect(beats.map((beat) => beat.order)).toEqual([1, 2])

  // 3) 删除：现在第 2 步是「入城」
  const removed = projectPut(page, id)
  await page.getByRole('button', { name: '删除第2步' }).click()
  expect((await removed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  beats = stored.outline!.volumes[0]!.chapters[0]!.beats
  expect(beats).toHaveLength(1)
  expect(beats[0]!.title).toBe('对峙')
  expect(beats[0]!.order).toBe(1)

  // 4) 确认步骤
  const confirmed = projectPut(page, id)
  await page.getByRole('button', { name: '确认步骤' }).click()
  expect((await confirmed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes[0]!.chapters[0]!.beatStatus).toBe('已确认')
  await expect(canvas(page)).toContainText('已确认')

  // 5) 改动已确认步骤 → 退回「待确认」并标记复核
  const edited = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1步 目标', exact: true }).fill('改过的目标')
  expect((await edited).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const afterEdit = stored.outline!.volumes[0]!.chapters[0]!
  expect(afterEdit.beatStatus, '改动已确认步骤必须退回待确认').toBe('待确认')
  expect(afterEdit.downstreamReviewStatus, '必须标记下游待复核').toBe('待复核')
  await expect(canvas(page)).toContainText('待复核')

  console.log(`[M4 步骤] 步骤增改排序删确认→已确认；改已确认步骤后 beatStatus=待确认、下游=待复核（服务端复核通过）`)
})

test('开始写作只建立唯一正文并进入正文，重复点击不会产生第二份；新章编号同时考虑章纲与正文', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createProjectWithVolume(page, 'M4 正文')
  await openModule(page, '小说大纲', '章节规划')

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')

  // 1) 开始写作：建立唯一正文并进入正文创作
  const writing = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  expect((await writing).status()).toBe(200)
  await expect(page.locator('.mjp-editor-bar .ch-title')).toHaveValue('古钟初鸣')

  let stored = await readProject(page, origin, id, headers)
  expect(stored.chapters, '开始写作必须建立一章正文').toHaveLength(1)
  expect(stored.chapters[0]).toMatchObject({ volumeNumber: 1, chapterNumber: 1, title: '古钟初鸣' })

  // 2) 回到章节规划：按钮变为「继续写作」，重复点击不产生第二份
  await openModule(page, '小说大纲', '章节规划')
  const continueWriting = page.getByRole('button', { name: '继续写作' })
  await expect(continueWriting).toBeVisible()
  await expect(page.getByRole('button', { name: '开始写作' })).toHaveCount(0)

  await continueWriting.click()
  await expect(page.locator('.mjp-editor-bar .ch-title')).toHaveValue('古钟初鸣')
  await page.waitForTimeout(1200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.chapters, '重复进入正文不得产生第二份正文').toHaveLength(1)

  // 3) 新章编号：已有章纲 1 与正文 1 → 下一张章纲是第 2 章
  await openModule(page, '小说大纲', '章节规划')
  const second = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  expect((await second).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const numbers = stored.outline!.volumes[0]!.chapters.map((chapter) => chapter.chapterNumber)
  expect(numbers).toEqual([1, 2])

  console.log(`[M4 正文] 开始写作→正文=${stored.chapters.length} 章（第${stored.chapters[0]!.chapterNumber}章）；「继续写作」不重复建正文；新章纲编号=${numbers.join('/')}`)
})

test('结构调整先预览影响再确认；放弃候选不改变正式大纲', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createProjectWithVolume(page, 'M4 结构')
  await openModule(page, '小说大纲', '章节规划')

  // 准备两章：第 1 章「古钟初鸣」、第 2 章「裂痕」
  const first = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await first
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')

  const second = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await second
  // 标题编辑走 900ms 防抖，必须等它真正落库再复核服务端内容
  const secondTitled = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('裂痕')
  await secondTitled

  let stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes[0]!.chapters.map((chapter) => chapter.title)).toEqual(['古钟初鸣', '裂痕'])
  const beforeRevision = stored.revision

  // 选中第 1 章，打开结构调整
  await page.locator('.mjp-oi-item', { hasText: '古钟初鸣' }).first().click()
  await fold(page, '结构调整').click()
  await page.getByRole('button', { name: '调序', exact: true }).click()
  // 参照章节下拉的第一项是「请选择」，所以取 index 1
  await page.getByLabel('参照章节').selectOption({ index: 1 })

  // 1) 预览影响：只出候选项，不改正式大纲
  const previewResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/outline-structure/preview')
  )
  await page.getByRole('button', { name: '预览影响' }).click()
  expect((await previewResponse).status()).toBe(201)
  await expect(canvas(page)).toContainText('影响摘要')
  await expect(canvas(page)).toContainText('章卡 2')

  stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes[0]!.chapters.map((chapter) => chapter.title), '预览不得改动正式大纲').toEqual(['古钟初鸣', '裂痕'])
  expect(stored.revision, '预览不得改变项目版本').toBe(beforeRevision)

  // 2) 放弃候选：仍然不改正式大纲
  const rejected = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/api/revisions/')
  )
  await page.getByRole('button', { name: '放弃这次候选' }).click()
  expect((await rejected).status()).toBe(204)
  await expect(canvas(page)).not.toContainText('影响摘要')

  stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes[0]!.chapters.map((chapter) => chapter.title)).toEqual(['古钟初鸣', '裂痕'])

  // 3) 重新预览并确认执行：大纲顺序变化且版本递增
  await page.getByLabel('参照章节').selectOption({ index: 1 })
  const secondPreview = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/outline-structure/preview')
  )
  await page.getByRole('button', { name: '预览影响' }).click()
  await secondPreview

  // 结构候选的应用走既有候选门禁（POST /api/revisions/:id/apply），不是整项目 PUT
  const applied = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/apply')
  )
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes[0]!.chapters.map((chapter) => chapter.title), '确认后顺序必须真的改变').toEqual(['裂痕', '古钟初鸣'])
  expect(stored.revision, '结构变更必须递增版本').toBeGreaterThan(beforeRevision)

  console.log(`[M4 结构] 预览不动正式大纲（revision 仍 ${beforeRevision}）→ 放弃候选不变 → 确认后顺序=裂痕/古钟初鸣、revision=${stored.revision}`)
})

test('已保存状态下切换模块、折叠、筛选、选中章纲都不产生项目写请求', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await createProjectWithVolume(page, 'M4 零写入')
  await openModule(page, '小说大纲', '章节规划')

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  const titled = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')
  await titled

  // 从「已保存」开始计数：导航类交互不得触发任何写请求
  const puts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/novels/${id}`) puts.push(request.url())
  })

  await fold(page, '剧情步骤').click()
  await fold(page, '剧情步骤').click()
  await fold(page, '结构调整').click()
  await page.getByRole('button', { name: '跨卷移动', exact: true }).click()
  await fold(page, '结构调整').click()
  // 「全部章节 / 当前附近 5 章」是 Segmented，渲染为 role=tab
  await page.getByRole('tab', { name: '当前附近 5 章' }).click()
  await page.getByRole('tab', { name: '全部章节' }).click()
  await page.locator('.mjp-oi-item').first().click()
  await page.getByLabel('按卷筛选章节').selectOption('all')
  await page.locator('.mjp-snav').getByRole('button', { name: '小说大纲', exact: true }).click()

  // 等足一个完整的 900ms 防抖窗口，确认没有迟到的写请求
  await page.waitForTimeout(1400)
  expect(puts, '导航与折叠类操作不得产生项目写请求').toHaveLength(0)

  console.log('[M4 零写入] 折叠 / 切换结构操作 / 切近 5 章 / 选章 / 卷筛选 / 收起栏目 → PUT=0')
})

test('正文没有章纲时补建作者确认的空规划，标题取自正文、不猜正文摘要', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createProjectWithVolume(page, 'M4 补建')
  await openModule(page, '小说大纲', '章节规划')

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  const titled = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')
  await titled

  // 从正文侧建一章：此时章纲最大编号是 1，所以新正文是第 2 章，而它没有章纲
  const section = page.locator('.mjp-snav').getByRole('button', { name: '正文创作', exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: /^正文编辑/ }).click()
  const bodyPut = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节' }).click()
  expect((await bodyPut).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.chapters.map((chapter) => chapter.chapterNumber), '章号必须避开已有章纲').toEqual([2])

  await openModule(page, '小说大纲', '章节规划')
  await expect(canvas(page)).toContainText('有 1 章正文没有对应章纲')

  const repaired = projectPut(page, id)
  await page.getByRole('button', { name: '为第 2 章补建章纲' }).click()
  expect((await repaired).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const chapters = stored.outline!.volumes[0]!.chapters
  const numbers = chapters.map((chapter) => chapter.chapterNumber)
  expect(numbers).toEqual([1, 2])
  expect(chapters[1]).toMatchObject({ chapterNumber: 2, title: '第2章', objective: '', conflict: '', beats: [] })

  console.log('[M4 补建] 正文第2章无章纲 → 补建后章纲编号=' + numbers.join('/') + '、规划字段为空（未猜正文摘要）')
})

test('删除章节先预览影响（含已有正文）再确认，且不级联删除正文', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await createProjectWithVolume(page, 'M4 删除')
  await openModule(page, '小说大纲', '章节规划')

  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  const titled = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')
  await titled
  const writing = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  await writing
  await openModule(page, '小说大纲', '章节规划')

  await fold(page, '结构调整').click()
  await page.getByRole('button', { name: '删除章节', exact: true }).click()
  const previewResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/outline-structure/preview')
  )
  await page.getByRole('button', { name: '预览影响' }).click()
  await previewResponse

  // 影响摘要必须如实报出「有 1 章已有正文」，风险为高，并说明不会删除正文
  await expect(canvas(page)).toContainText('已有正文 1')
  await expect(canvas(page)).toContainText('风险：高')
  await expect(canvas(page)).toContainText('不会自动重写或删除这些正文')

  const applied = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/apply')
  )
  await page.getByRole('button', { name: '确认执行结构变更' }).click()
  expect((await applied).status()).toBe(200)

  const stored = await readProject(page, origin, id, headers)
  expect(stored.outline!.volumes.flatMap((volume) => volume.chapters), '删除后大纲里没有这张章纲').toHaveLength(0)
  expect(stored.chapters, '删章不得级联删除正文').toHaveLength(1)

  console.log('[M4 删除] 预览影响=已有正文 1 / 风险高 → 确认后章纲=0 且正文仍为 1 章（未级联删除）')
})
