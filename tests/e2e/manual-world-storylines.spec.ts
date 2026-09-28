import { expect, test, type Page } from '@playwright/test'

/**
 * M5 · 世界观与事件线手动维护（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-world-storylines.spec.ts
 *
 * 全部通过产品界面操作，不使用 `page.route` 伪造数据；每次断言都用 GET 复核落库结果。
 * 覆盖：空世界建立、手动术语、事件线手写（名称/目标/节点/章节关联/下一步）、
 * 暂停必须留下原因与返回条件、锁定项先解锁才能删、刷新重开保留。
 */

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')

type ServerProject = {
  revision: number
  worldConstraints: Array<{ id: string; term: string; definition: string; status: string; source: { excerpt: string } }>
  worldBible?: { entries: Array<{ id: string; name: string; type: string; locked: boolean; relations: Array<{ id: string; targetEntryId: string; type: string }> }> }
  storylines?: Array<{
    id: string; title: string; type: string; finalGoal: string; nextAction: string; status: string
    currentProgress: number
    keyNodes: Array<{ id: string; title: string; status: string }>
    chapterPlans: Array<{ chapterId: string; chapterNumber: number; subGoal: string; nextTrigger: string }>
    pause?: { reason: string; returnCondition: string; scope: string; expectedReturnPosition: string }
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

/** 232px 导航是手风琴：已展开时再点会收起。 */
async function openModule(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(title(page)).toHaveText(itemLabel)
}

/** 建项目 + 空白大纲 + 第一卷 + 一章（事件线的章节关联需要真实章纲）。 */
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

  return { origin, id, headers }
}

test('空项目建立世界观、手动术语与词条，刷新重开全部保留', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M5 世界观')

  // 1) 空世界：从空白世界开始
  await openModule(page, '世界观', '世界总览')
  const createdWorld = projectPut(page, id)
  await page.getByRole('button', { name: '从空白世界开始' }).click()
  expect((await createdWorld).status()).toBe(200)
  await expect(canvas(page), '建立后不再显示空态').not.toContainText('世界观尚未建立')

  // 2) 世界词条：新建一条
  await openModule(page, '世界观', '世界词条')
  await page.getByRole('button', { name: '新建词条' }).click()
  const entryNamed = projectPut(page, id)
  await page.getByLabel('名称', { exact: false }).first().fill('林砚')
  expect((await entryNamed).status()).toBe(200)

  // 3) 规则与边界：手动新增术语（名称 + 定义都由作者填写）
  await openModule(page, '世界观', '规则与边界')
  await page.getByLabel('新术语名称').fill('星纹古钟')
  await page.getByLabel('新术语定义').fill('旧城地底的计时装置，钟声会改写记忆。')
  const addedTerm = projectPut(page, id)
  await page.getByRole('button', { name: '新增术语' }).click()
  expect((await addedTerm).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries.map((entry) => entry.name)).toEqual(['林砚'])
  const term = stored.worldConstraints.find((item) => item.term === '星纹古钟')!
  expect(term).toBeTruthy()
  expect(term.definition).toBe('旧城地底的计时装置，钟声会改写记忆。')
  expect(term.status, '手动术语默认待确认').toBe('待确认')
  expect(term.source.excerpt, '人工来源必须如实标注').toBe('作者手动录入')

  // 4) 刷新重开后保留
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '世界观', '规则与边界')
  await expect(canvas(page)).toContainText('星纹古钟')
  await expect(page.getByLabel('定义 ' + term.id)).toHaveValue('旧城地底的计时装置，钟声会改写记忆。')

  console.log(`[M5 世界观] 空世界建立 → 词条「林砚」→ 手动术语「星纹古钟」（来源=${term.source.excerpt}）→ 刷新重开保留`)
})

test('锁定中的词条与术语必须先解锁才能删除', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M5 解锁')

  await openModule(page, '世界观', '世界总览')
  const world = projectPut(page, id)
  await page.getByRole('button', { name: '从空白世界开始' }).click()
  await world

  // 词条：先建后锁，再尝试删除
  await openModule(page, '世界观', '世界词条')
  await page.getByRole('button', { name: '新建词条' }).click()
  const named = projectPut(page, id)
  await page.getByLabel('名称', { exact: false }).first().fill('星纹古钟')
  await named

  const locked = projectPut(page, id)
  await page.locator('.mjp-switch input[type="checkbox"]').check({ force: true })
  await locked

  await page.getByRole('button', { name: '删除' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(canvas(page)).toContainText('先解锁')

  let stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries, '被拒绝时词条必须还在').toHaveLength(1)

  // 解锁后可以删除
  const unlocked = projectPut(page, id)
  await page.locator('.mjp-switch input[type="checkbox"]').uncheck({ force: true })
  await unlocked
  await page.getByRole('button', { name: '删除' }).click()
  const removed = projectPut(page, id)
  await page.getByRole('button', { name: '确认删除' }).click()
  expect((await removed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries).toHaveLength(0)

  // 术语：锁定状态同样先解锁
  await openModule(page, '世界观', '规则与边界')
  await page.getByLabel('新术语名称').fill('潮汐钟')
  await page.getByLabel('新术语定义').fill('会改写记忆的钟。')
  const termAdded = projectPut(page, id)
  await page.getByRole('button', { name: '新增术语' }).click()
  await termAdded
  await expect(canvas(page), '新建的术语应当出现在列表里').toContainText('潮汐钟')

  const toLocked = projectPut(page, id)
  await page.getByRole('button', { name: '标记已锁定' }).click()
  await toLocked

  await page.getByRole('button', { name: '删除术语 潮汐钟' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(canvas(page)).toContainText('明确解锁')

  stored = await readProject(page, origin, id, headers)
  expect(stored.worldConstraints.filter((item) => item.term === '潮汐钟')).toHaveLength(1)

  console.log('[M5 解锁] 锁定词条删除被拒（提示先解锁）→ 解锁后删除成功；锁定术语删除被拒（提示明确解锁）')
})

test('事件线手写：新建、改名、目标、节点、章节关联与下一步落库并保留', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M5 事件线')
  await openModule(page, '小说大纲', '故事线')

  // 没有名称就不建立
  await page.getByRole('button', { name: '建立事件线' }).click()
  await expect(canvas(page)).toContainText('请先填写事件线名称')

  await page.getByLabel('事件线名称').fill('潮汐调查线')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '建立事件线' }).click()
  expect((await created).status()).toBe(200)

  // 详情字段
  const renamed = projectPut(page, id)
  await page.getByLabel('事件线详情名称').fill('潮汐调查线（主线）')
  await renamed
  await page.getByLabel('最终目标').fill('查清记忆被改写的原因')
  const goal = projectPut(page, id)
  await page.getByLabel('下一步动作').fill('去找巡夜人问钟声的来历')
  await goal

  // 关键节点（名称必填）
  await page.getByRole('button', { name: '新增节点' }).click()
  await expect(canvas(page)).toContainText('请先填写节点名称')
  await page.getByLabel('新节点名称').fill('发现钟声规律')
  const node = projectPut(page, id)
  await page.getByRole('button', { name: '新增节点' }).click()
  expect((await node).status()).toBe(200)

  // 章节关联
  const linked = projectPut(page, id)
  await page.getByLabel('绑定章节').selectOption({ index: 1 })
  expect((await linked).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  let line = stored.storylines![0]!
  const plan = line.chapterPlans[0]!
  await page.getByLabel(`第${plan.chapterNumber}章 子目标`).fill('确认钟声真的改写了记忆')
  const trigger = projectPut(page, id)
  await page.getByLabel(`第${plan.chapterNumber}章 下一步触发`).fill('引出第二口钟')
  await trigger

  stored = await readProject(page, origin, id, headers)
  line = stored.storylines![0]!
  expect(line).toMatchObject({ title: '潮汐调查线（主线）', finalGoal: '查清记忆被改写的原因', nextAction: '去找巡夜人问钟声的来历', status: '未开始' })
  expect(line.keyNodes.map((item) => item.title)).toEqual(['发现钟声规律'])
  expect(line.chapterPlans[0]).toMatchObject({ subGoal: '确认钟声真的改写了记忆', nextTrigger: '引出第二口钟' })
  expect(line.chapterPlans[0]!.chapterNumber, '关联的是真实章纲的章号').toBe(1)
  expect(line.currentProgress, '不按章节数自动推算推进百分比').toBe(0)

  // 刷新重开保留
  await page.reload()
  await page.locator('.mjp-hall-project').first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '小说大纲', '故事线')
  await expect(page.getByLabel('事件线详情名称')).toHaveValue('潮汐调查线（主线）')
  await expect(page.getByLabel('下一步动作')).toHaveValue('去找巡夜人问钟声的来历')

  console.log(`[M5 事件线] 名称/目标/下一步/节点「发现钟声规律」/第 ${plan.chapterNumber} 章关联全部落库，刷新重开保留；currentProgress 保持 ${line.currentProgress}`)
})

test('暂停必须留下原因与返回条件才能改成「计划暂停」', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M5 暂停')
  await openModule(page, '小说大纲', '故事线')

  await page.getByLabel('事件线名称').fill('支线：失忆者')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '建立事件线' }).click()
  await created

  // 没有原因与返回条件，不能改成计划暂停
  await page.getByLabel('事件线状态').selectOption('计划暂停')
  await expect(canvas(page)).toContainText('请先填写暂停原因与返回条件')

  let stored = await readProject(page, origin, id, headers)
  expect(stored.storylines![0]!.status, '被拒绝时状态不得改变').toBe('未开始')
  expect(stored.storylines![0]!.pause, '被拒绝时不得留下半截暂停对象').toBeUndefined()

  // 先写原因，仍然不够
  await page.getByLabel('暂停原因').fill('与主线节奏冲突，先搁置')
  await page.getByLabel('事件线状态').selectOption('计划暂停')
  await expect(canvas(page)).toContainText('请先填写暂停原因与返回条件')

  // 补上返回条件与范围后才能改
  await page.getByLabel('返回条件').fill('主线进入第二卷后恢复')
  const paused = projectPut(page, id)
  await page.getByLabel('暂停范围').selectOption('本卷')
  await paused
  const changed = projectPut(page, id)
  await page.getByLabel('事件线状态').selectOption('计划暂停')
  expect((await changed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const line = stored.storylines![0]!
  expect(line.status).toBe('计划暂停')
  expect(line.pause).toMatchObject({
    reason: '与主线节奏冲突，先搁置',
    returnCondition: '主线进入第二卷后恢复',
    scope: '本卷'
  })

  console.log(`[M5 暂停] 无原因/返回条件时被拒（状态仍为未开始）→ 补齐后 status=${line.status}，pause.scope=${line.pause!.scope}、returnCondition=「${line.pause!.returnCondition}」`)
})

test('词条关系：真实引用会阻止删除，解除后即可安全删除', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M5 词条关系')

  await openModule(page, '世界观', '世界总览')
  const world = projectPut(page, id)
  await page.getByRole('button', { name: '从空白世界开始' }).click()
  await world

  await openModule(page, '世界观', '世界词条')
  await page.getByRole('button', { name: '新建词条' }).click()
  const firstNamed = projectPut(page, id)
  await page.getByLabel('名称', { exact: false }).first().fill('林砚')
  await firstNamed
  await page.getByRole('button', { name: '新建词条' }).click()
  const secondNamed = projectPut(page, id)
  await page.getByLabel('名称', { exact: false }).first().fill('旧钟')
  await secondNamed

  // 林砚 → 旧钟 建立真实关系
  await page.locator('.mjp-wcat-e', { hasText: '林砚' }).first().click()
  await page.getByLabel('关系目标词条').selectOption({ index: 1 })
  await page.getByLabel('关系类型').fill('看守')
  const related = projectPut(page, id)
  await page.getByRole('button', { name: '建立关系' }).click()
  expect((await related).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  const owner = stored.worldBible!.entries.find((entry) => entry.name === '林砚')!
  const target = stored.worldBible!.entries.find((entry) => entry.name === '旧钟')!
  expect(owner.relations.map((relation) => relation.targetEntryId)).toEqual([target.id])
  expect(owner.relations[0]!.type).toBe('看守')
  expect(target.relations, '关系只长在起点词条上，不得反向自动建立').toHaveLength(0)

  // 被引用 → 删除必须被拒绝，并说明是谁在引用
  await page.locator('.mjp-wcat-e', { hasText: '旧钟' }).first().click()
  await page.getByRole('button', { name: '删除' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(canvas(page)).toContainText('这个词条现在不能删除')
  await expect(canvas(page)).toContainText('林砚')

  stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries, '被引用时不得删除').toHaveLength(2)

  // 解除关系 → 再删就通过
  await page.locator('.mjp-wcat-e', { hasText: '林砚' }).first().click()
  const unlinked = projectPut(page, id)
  await page.getByRole('button', { name: '解除与旧钟的关系' }).click()
  expect((await unlinked).status()).toBe(200)

  await page.locator('.mjp-wcat-e', { hasText: '旧钟' }).first().click()
  await page.getByRole('button', { name: '删除' }).click()
  const removed = projectPut(page, id)
  await page.getByRole('button', { name: '确认删除' }).click()
  expect((await removed).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries.map((entry) => entry.name), '解除引用后可安全删除').toEqual(['林砚'])

  console.log('[M5 词条关系] 建立「林砚 → 旧钟(看守)」→ 删除被拒并指出引用方 → 解除后再删成功')
})

test('事件线关联世界词条：关联后阻止删除，解绑后即可删除', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await buildProject(page, 'M5 事件线关联')

  await openModule(page, '世界观', '世界总览')
  const world = projectPut(page, id)
  await page.getByRole('button', { name: '从空白世界开始' }).click()
  await world

  await openModule(page, '世界观', '世界词条')
  await page.getByRole('button', { name: '新建词条' }).click()
  const named = projectPut(page, id)
  await page.getByLabel('名称', { exact: false }).first().fill('星纹古钟')
  await named
  const storedEntry = (await readProject(page, origin, id, headers)).worldBible!.entries[0]!

  // 新建事件线并关联该词条
  await openModule(page, '小说大纲', '故事线')
  await page.getByLabel('事件线名称').fill('古钟调查线')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '建立事件线' }).click()
  expect((await created).status()).toBe(200)

  const linked = projectPut(page, id)
  await page.getByLabel('要关联的世界词条').selectOption({ index: 1 })
  await page.getByRole('button', { name: '关联', exact: true }).click()
  expect((await linked).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.storylines![0]!.entryIds, '关联只写 entryIds').toEqual([storedEntry.id])
  expect(stored.worldBible!.entries[0]!.relations, '不得改写词条自身').toHaveLength(0)

  // 被事件线引用 → 删除被拒绝
  await openModule(page, '世界观', '世界词条')
  await page.locator('.mjp-wcat-e', { hasText: '星纹古钟' }).first().click()
  await page.getByRole('button', { name: '删除' }).click()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(canvas(page)).toContainText('这个词条现在不能删除')
  await expect(canvas(page)).toContainText('古钟调查线')
  stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries).toHaveLength(1)

  // 解绑 → 删除成功
  await openModule(page, '小说大纲', '故事线')
  const unlinked = projectPut(page, id)
  await page.getByRole('button', { name: `解绑词条星纹古钟` }).click()
  expect((await unlinked).status()).toBe(200)
  stored = await readProject(page, origin, id, headers)
  expect(stored.storylines![0]!.entryIds).toEqual([])

  await openModule(page, '世界观', '世界词条')
  await page.locator('.mjp-wcat-e', { hasText: '星纹古钟' }).first().click()
  await page.getByRole('button', { name: '删除' }).click()
  const removed = projectPut(page, id)
  await page.getByRole('button', { name: '确认删除' }).click()
  expect((await removed).status()).toBe(200)
  stored = await readProject(page, origin, id, headers)
  expect(stored.worldBible!.entries, '解绑后可安全删除').toHaveLength(0)

  console.log('[M5 事件线关联] 事件线关联词条 → 删除被拒 → 解绑 → 删除成功（词条资料从未被改写）')
})
