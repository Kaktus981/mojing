import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * M9 · 产品收口与完整用户流程（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-creation-flow.spec.ts
 *
 * 硬性验收项：**从大厅真实创建空小说，全程纯 UI**完成
 *   种子 → 总纲 → 世界设定（术语 / 词条 / 故事线）→ 首卷 → 章纲 → 正文 →
 *   伏笔 → 人工审稿问题 → 导出成稿（真实下载并解析）→ 检查点创建 → 差异预览 → 受控恢复。
 *
 * 测试数据约束：
 *   - 不注入已经填好的完整项目替代这条测试；不使用 `page.route` 伪造项目数据；
 *   - 只用真实大厅流程建项目（「新建小说」→「小说名称」+「最初的故事想法」→「创建项目」）；
 *   - 需要读服务端内容时复用应用自身请求的 `Authorization`，断言落在真实落库数据上；
 *   - 只在最后刷新重开，验证内容确实持久化到隔离内存库，不是前端假象。
 *
 * 每个阶段都以 `console.log('[M9 流程] ...')` 打出实测值，便于失败时定位。
 */

// —— 本流程用到的真实内容（全部由测试手写，非伪造） ——
const SEED = '巡夜人林砚发现旧城的潮汐钟能改写人们对昨天的记忆，他必须在揭穿真相与守护秩序之间做出选择。'
const SYNOPSIS = '旧城的潮汐钟会改写人们对昨天的记忆。'
const MAIN_CONFLICT = '记住真相与维持秩序的对立。'
const ENDING_DIRECTION = '林砚接手巡夜职责，守护这个秘密。'
const VOLUME_TITLE = '潮汐卷'
const VOLUME_GOAL = '确认记忆真的被钟声改写'
const TERM_NAME = '星纹古钟'
const TERM_DEFINITION = '旧城地底的计时装置，钟声会改写记忆。'
const ENTRY_NAME = '林砚'
const STORYLINE_NAME = '潮汐调查线'
const STORYLINE_GOAL = '查清记忆被改写的原因'
const CHAPTER_TITLE = '古钟初鸣'
const CHAPTER_OBJECTIVE = '确认钟声真的改写了记忆'
const CHAPTER_CONFLICT = '巡夜人要求他保密'
const CHAPTER_ENDING = '他决定先隐瞒这件事'
const PROSE_V1 = '林砚在旧城的钟楼下听见第一声钟鸣，发现被抹去的正是自己的昨天。'
const PROSE_V2 = '第二版：钟声之后，他决定把真相先藏在心里。'
const FORESHADOW_NAME = '古钟星纹'
const REVIEW_TITLE = '钟声规则前后矛盾'
const REVIEW_DESCRIPTION = '第一章说钟声改写记忆，同章又写成改写时间。'
const REVIEW_REASON = '有意保留的矛盾，会在第三卷解释。'
const CHECKPOINT_NAME = 'M9 流程检查点'

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')
const saveState = (page: Page) => page.locator('.mjp-save-state').first()

type ServerProject = {
  revision: number
  title: string
  seed: string
  outline?: {
    synopsis: string
    mainConflict: string
    endingDirection: string
    volumes: Array<{
      volumeNumber: number
      title: string
      goal: string
      chapters: Array<{ id: string; chapterNumber: number; title: string; objective: string; conflict: string; endingHook: string }>
    }>
  }
  worldConstraints: Array<{ id: string; term: string; definition: string }>
  worldBible?: { entries: Array<{ id: string; name: string }> }
  storylines?: Array<{ id: string; title: string; finalGoal: string; chapterPlans: Array<{ chapterId: string; chapterNumber: number }> }>
  chapters: Array<{ id: string; chapterNumber: number; title: string; blocks: Array<{ id: string; text: string }> }>
  plotThreads: Array<{ id: string; title: string; status: string; setupEvidence?: { excerpt: string } }>
  reviews: Array<{ id: string; title: string; status: string; resolution?: { method: string; reason: string } }>
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

/** 232px 导航是手风琴：已展开时再点会收起，所以先判断 aria-expanded。 */
async function openModule(page: Page, sectionLabel: string, itemLabel: string): Promise<void> {
  const section = page.locator('.mjp-snav').getByRole('button', { name: sectionLabel, exact: true })
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('.mjp-snav').getByRole('button', { name: new RegExp(`^${itemLabel}`) }).click()
  await expect(title(page)).toHaveText(itemLabel)
}

/** 三栏几何契约：宽度必须精确（±1px），与 four-stage-product-entry.spec.ts 同口径。 */
async function expectWidth(locator: ReturnType<Page['locator']>, expected: number): Promise<void> {
  const box = await locator.boundingBox()
  expect(box, '栏位必须可见').not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(expected - 1)
  expect(box!.width).toBeLessThanOrEqual(expected + 1)
}

/**
 * 走真实用户路径切主题：窄栏底部的 RailFooterButton。
 * 日间（paper）时按钮文案是「切换到夜墨」，夜间（night）时是「切换到暖纸」
 * （App.tsx:80-85 → useTheme.ts:162-166）。不直接写 dataset，那是 token 隔离手法。
 */
async function switchTheme(page: Page, target: 'paper' | 'night'): Promise<void> {
  const current = await page.evaluate(() => document.documentElement.dataset.theme)
  if (current !== target) {
    await page.getByRole('button', { name: current === 'night' ? '切换到暖纸' : '切换到夜墨' }).click()
  }
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe(target)
}

/** 真实大厅流程建一个空小说（不注入完整项目、不用 page.route 伪造）。 */
async function createProjectFromHall(page: Page, projectTitle: string): Promise<void> {
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await dialog.getByLabel('小说名称', { exact: true }).fill(projectTitle)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
}

test('M9 完整手动创作主线：从大厅空小说到导出与受控恢复（纯 UI）', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1500, height: 940 })

  // ============================================================
  // 阶段 1 · 大厅真实创建空小说
  // ============================================================
  const firstApiRequest = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/'))
  await page.goto('/')
  const probe = await firstApiRequest
  const origin = new URL(probe.url()).origin
  const headers = { Authorization: (await probe.allHeaders()).authorization ?? '' }

  const projectTitle = `M9 流程-${Date.now()}`
  await page.getByRole('button', { name: /新建(小说|项目)/ }).first().click()
  await page.getByLabel('小说名称').fill(projectTitle)
  await page.getByLabel('最初的故事想法').fill('巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
  await openModule(page, '小说大纲', '创作起点')

  const list = await page.request.get(`${origin}/api/novels`, { headers })
  const id = ((await list.json()) as Array<{ id: string; title: string }>).find((entry) => entry.title === projectTitle)!.id
  console.log(`[M9 流程] 阶段1 大厅建项目 id=${id}`)

  // ============================================================
  // 阶段 2 · 种子（创作起点）
  // ============================================================
  await expect(title(page)).toHaveText('创作起点')
  const seedSaved = projectPut(page, id)
  await page.getByRole('textbox', { name: '故事种子' }).fill(SEED)
  expect((await seedSaved).status()).toBe(200)
  console.log(`[M9 流程] 阶段2 种子写入 ${SEED.length} 字并落库`)

  // ============================================================
  // 阶段 3 · 总纲（创建空白大纲 → 总纲与卷纲）
  // ============================================================
  const createdOutline = projectPut(page, id)
  await page.getByRole('button', { name: '创建空白大纲' }).click()
  expect((await createdOutline).status()).toBe(200)
  await expect(title(page)).toHaveText('总纲与卷纲')

  await page.getByRole('textbox', { name: '总纲' }).fill(SYNOPSIS)
  await page.getByRole('textbox', { name: '主冲突' }).fill(MAIN_CONFLICT)
  const outlineSaved = projectPut(page, id)
  await page.getByRole('textbox', { name: '结局方向' }).fill(ENDING_DIRECTION)
  expect((await outlineSaved).status()).toBe(200)
  console.log(`[M9 流程] 阶段3 总纲/主冲突/结局方向已写`)

  // ============================================================
  // 阶段 4 · 世界设定（空世界 → 术语 → 词条）
  // ============================================================
  await openModule(page, '世界观', '世界总览')
  const createdWorld = projectPut(page, id)
  await page.getByRole('button', { name: '从空白世界开始' }).click()
  expect((await createdWorld).status()).toBe(200)

  await openModule(page, '世界观', '规则与边界')
  await page.getByLabel('新术语名称').fill(TERM_NAME)
  await page.getByLabel('新术语定义').fill(TERM_DEFINITION)
  const termSaved = projectPut(page, id)
  await page.getByRole('button', { name: '新增术语' }).click()
  expect((await termSaved).status()).toBe(200)

  await openModule(page, '世界观', '世界词条')
  await page.getByRole('button', { name: '新建词条' }).click()
  const entrySaved = projectPut(page, id)
  await page.getByLabel('名称', { exact: false }).first().fill(ENTRY_NAME)
  expect((await entrySaved).status()).toBe(200)

  let stored = await readProject(page, origin, id, headers)
  expect(stored.worldConstraints.map((item) => item.term)).toContain(TERM_NAME)
  expect(stored.worldBible!.entries.map((entry) => entry.name)).toEqual([ENTRY_NAME])
  console.log(`[M9 流程] 阶段4 世界已建立：术语「${TERM_NAME}」+ 词条「${ENTRY_NAME}」`)

  // ============================================================
  // 阶段 5 · 首卷
  // ============================================================
  await openModule(page, '小说大纲', '总纲与卷纲')
  const addedVolume = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  expect((await addedVolume).status()).toBe(200)
  const namedVolume = projectPut(page, id)
  await page.getByRole('textbox', { name: '第1卷 卷名' }).fill(VOLUME_TITLE)
  expect((await namedVolume).status()).toBe(200)
  console.log(`[M9 流程] 阶段5 首卷「${VOLUME_TITLE}」`)

  // ============================================================
  // 阶段 6 · 章纲（新建章节规划 + 七字段）
  // ============================================================
  await openModule(page, '小说大纲', '章节规划')
  const createdChapterPlan = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  expect((await createdChapterPlan).status()).toBe(200)

  const chapterFields: Record<string, string> = {
    章节标题: CHAPTER_TITLE,
    叙事视角: '林砚（限知）',
    目标: CHAPTER_OBJECTIVE,
    冲突: CHAPTER_CONFLICT,
    转折: '发现被抹去的是自己的昨天',
    揭示: '钟声来自地底更古老的东西'
  }
  for (const [label, value] of Object.entries(chapterFields)) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  }
  // 最后一次编辑触发 900ms 防抖保存，等它真正落库
  const chapterSaved = projectPut(page, id)
  await page.getByRole('textbox', { name: '结尾', exact: true }).fill(CHAPTER_ENDING)
  expect((await chapterSaved).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const plan = stored.outline!.volumes[0]!.chapters[0]!
  expect(plan).toMatchObject({ chapterNumber: 1, title: CHAPTER_TITLE, objective: CHAPTER_OBJECTIVE })
  expect(stored.chapters, '章纲不创建正文').toHaveLength(0)
  console.log(`[M9 流程] 阶段6 章纲「${plan.title}」第${plan.chapterNumber}章（正文尚未创建）`)

  // ============================================================
  // 阶段 7 · 正文（开始写作 → 保持焦点输入 → 真实保存）
  // ============================================================
  const startedWriting = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  expect((await startedWriting).status()).toBe(200)
  await expect(page.locator('.mjp-editor-bar .ch-title')).toHaveValue(CHAPTER_TITLE)

  const proseSaved = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.type(PROSE_V1)
  expect((await proseSaved).status()).toBe(200)
  await expect(saveState(page)).toHaveText('已保存')

  stored = await readProject(page, origin, id, headers)
  const chapter = stored.chapters[0]!
  const chapterId = chapter.id
  const chapterNumber = chapter.chapterNumber
  expect(chapter.blocks[0]!.text, '正文真实落库').toBe(PROSE_V1)
  console.log(`[M9 流程] 阶段7 正文第${chapterNumber}章已保存 ${PROSE_V1.length} 字`)

  // ============================================================
  // 阶段 8 · 故事线（世界设定的一条事件线 + 章节关联）
  // ============================================================
  await openModule(page, '小说大纲', '故事线')
  await page.getByLabel('事件线名称').fill(STORYLINE_NAME)
  const storylineCreated = projectPut(page, id)
  await page.getByRole('button', { name: '建立事件线' }).click()
  expect((await storylineCreated).status()).toBe(200)

  await page.getByLabel('最终目标').fill(STORYLINE_GOAL)
  const storylineGoal = projectPut(page, id)
  await page.getByLabel('下一步动作').fill('去找巡夜人问钟声的来历')
  expect((await storylineGoal).status()).toBe(200)

  await page.getByRole('button', { name: '新增节点' }).click()
  await page.getByLabel('新节点名称').fill('发现钟声规律')
  const nodeSaved = projectPut(page, id)
  await page.getByRole('button', { name: '新增节点' }).click()
  expect((await nodeSaved).status()).toBe(200)

  const linked = projectPut(page, id)
  await page.getByLabel('绑定章节').selectOption({ index: 1 })
  expect((await linked).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const storyline = stored.storylines![0]!
  expect(storyline.title, '建立时填写的名称落库').toBe(STORYLINE_NAME)
  expect(storyline.finalGoal).toBe(STORYLINE_GOAL)
  expect(storyline.chapterPlans[0]!.chapterId, '关联的是真实章节').toBe(chapterId)
  console.log(`[M9 流程] 阶段8 故事线「${storyline.title}」目标已写、关联第${storyline.chapterPlans[0]!.chapterNumber}章`)

  // ============================================================
  // 阶段 9 · 伏笔（新建 + 用真实段落记录埋设）
  // ============================================================
  await openModule(page, '记忆与伏笔', '伏笔中心')
  await page.getByRole('button', { name: '新建伏笔' }).click()
  await page.getByLabel('新伏笔名称').fill(FORESHADOW_NAME)
  const foreshadowCreated = projectPut(page, id)
  await page.getByRole('button', { name: '新建伏笔' }).click()
  expect((await foreshadowCreated).status()).toBe(200)

  await page.getByLabel('证据来源').selectOption('prose')
  await page.getByLabel('证据所在章').selectOption(chapterId)
  const foreshadowSetUp = projectPut(page, id)
  await page.getByRole('button', { name: '记录埋设' }).click()
  expect((await foreshadowSetUp).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const thread = stored.plotThreads[0]!
  expect(thread.title).toBe(FORESHADOW_NAME)
  expect(thread.status, '记录埋设后进入已埋设').toBe('已埋设')
  expect(thread.setupEvidence!.excerpt, '埋设证据取自真实段落').toBe(chapter.blocks[0]!.text.slice(0, 200))
  console.log(`[M9 流程] 阶段9 伏笔「${thread.title}」状态=${thread.status}，证据=${thread.setupEvidence!.excerpt.slice(0, 12)}…`)

  // ============================================================
  // 阶段 10 · 人工审稿问题（新建 + 处理意见）
  // ============================================================
  await openModule(page, '审稿与导出', '审稿问题')
  await page.getByLabel('问题标题').fill(REVIEW_TITLE)
  await page.getByLabel('问题描述').fill(REVIEW_DESCRIPTION)
  await page.getByLabel('关联章节').selectOption({ index: 1 })
  await page.getByLabel('证据段落').selectOption({ index: 1 })
  const reviewCreated = projectPut(page, id)
  await page.getByRole('button', { name: '记录这条问题' }).click()
  expect((await reviewCreated).status()).toBe(200)

  await page.getByRole('button', { name: '记录处理意见' }).click()
  await page.getByLabel(`${REVIEW_TITLE} 处理方式`).selectOption('风险已知仍忽略')
  await page.getByLabel(`${REVIEW_TITLE} 处理理由`).fill(REVIEW_REASON)
  const reviewResolved = projectPut(page, id)
  await page.getByRole('button', { name: '记录为已完成' }).click()
  expect((await reviewResolved).status()).toBe(200)

  stored = await readProject(page, origin, id, headers)
  const issue = stored.reviews[0]!
  expect(issue.title).toBe(REVIEW_TITLE)
  expect(issue.status).toBe('已完成')
  expect(issue.resolution).toMatchObject({ method: '风险已知仍忽略', reason: REVIEW_REASON })
  console.log(`[M9 流程] 阶段10 审稿问题「${issue.title}」状态=${issue.status}，处理意见已记录`)

  // ============================================================
  // 阶段 11 · 导出成稿（真实下载 TXT 并解析内容）
  // ============================================================
  await openModule(page, '审稿与导出', '导出成稿')
  await page.getByRole('button', { name: '运行本地预检' }).click()
  await expect(canvas(page)).toContainText('预检状态：')

  // 切到「纯文本」后重新预检，再真实导出并解析
  await page.getByRole('button', { name: /纯文本/ }).first().click()
  await page.getByRole('button', { name: '运行本地预检' }).click()
  const exportButton = page.getByRole('button', { name: /^导出 / })
  await expect(exportButton).toBeEnabled()
  const download = page.waitForEvent('download')
  await exportButton.click()
  const file = await download
  const text = readFileSync(await file.path(), 'utf8')

  expect(file.suggestedFilename()).toMatch(/\.txt$/)
  expect(text, '导出含中文正文').toContain(PROSE_V1)
  expect(text, '按章输出标题').toContain(CHAPTER_TITLE)
  console.log(`[M9 流程] 阶段11 导出 ${file.suggestedFilename()}（${text.length} 字符，含中文正文）`)

  // ============================================================
  // 阶段 12 · 检查点 → 差异预览 → 受控恢复
  // ============================================================
  await openModule(page, '审稿与导出', '版本历史')
  await page.getByLabel('检查点名称').fill(CHECKPOINT_NAME)
  const checkpoint = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/checkpoints')
  )
  await page.getByRole('button', { name: '以这个名称创建检查点' }).click()
  expect((await checkpoint).status()).toBe(201)

  // 改动正文，制造与快照的差异
  await openModule(page, '正文创作', '正文编辑')
  const edited = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(PROSE_V2)
  expect((await edited).status()).toBe(200)
  await expect(saveState(page)).toHaveText('已保存')

  const beforeRestore = await readProject(page, origin, id, headers)
  expect(beforeRestore.chapters[0]!.blocks[0]!.text).toBe(PROSE_V2)

  await openModule(page, '审稿与导出', '版本历史')
  await page.locator('.mjp-jump', { hasText: CHECKPOINT_NAME }).first().click()
  await expect(page.getByRole('button', { name: '确认恢复到此版本' }), '未预览前不得提交').toBeDisabled()

  const preview = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/restore-preview')
  )
  await page.getByRole('button', { name: '预览差异' }).click()
  expect((await preview).status()).toBe(200)
  await expect(canvas(page)).toContainText('差异预览')

  const restore = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/restore')
  )
  await page.getByRole('button', { name: '确认恢复到此版本' }).click()
  expect((await restore).status()).toBe(200)

  const afterRestore = await readProject(page, origin, id, headers)
  expect(afterRestore.chapters[0]!.blocks[0]!.text, '正文回到检查点内容').toBe(PROSE_V1)
  expect(afterRestore.revision, '恢复只前进版本号').toBe(beforeRestore.revision + 1)
  console.log(`[M9 流程] 阶段12 检查点「${CHECKPOINT_NAME}」→ 预览差异 → 恢复；正文回到第一版，revision ${beforeRestore.revision}→${afterRestore.revision}`)

  // ============================================================
  // 阶段 13 · 刷新重开：验证真实持久化到隔离内存库
  // ============================================================
  await page.reload()
  await page.locator('.mjp-hall-project', { hasText: projectTitle }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()

  await openModule(page, '正文创作', '正文编辑')
  await expect(page.locator('.mjp-prose .para').first(), '刷新重开后正文与恢复结果一致').toContainText(PROSE_V1)

  await openModule(page, '小说大纲', '创作起点')
  await expect(page.getByRole('textbox', { name: '故事种子' }), '刷新重开后种子保留').toHaveValue(SEED)

  await openModule(page, '世界观', '规则与边界')
  await expect(canvas(page), '刷新重开后世界术语保留').toContainText(TERM_NAME)

  console.log('[M9 流程] 阶段13 刷新重开：正文/种子/世界术语均与落库一致（真实持久化）')
  console.log(`[M9 流程] 完成：项目「${projectTitle}」从空小说到导出与受控恢复的全流程走通`)
})

/**
 * M9 第 ⑤ 条闸门：五个一级栏目在日夜两种主题、1500/1120 两种宽度下都不横向溢出。
 *
 * 与 four-stage-product-entry.spec.ts:155-199 的区别：那边只断言「进工作区那一刻」的
 * 壳层几何；这里把闸门落到五个栏目各自的**深页**上，并把「主题」这一维交叉进来
 * （主题经真实用户路径切换，不用 dataset 硬写）。1120 下真溢出即为缺陷 —— 断言不放宽。
 */
for (const viewport of [
  { name: '常规桌面 1500', width: 1500 },
  { name: '最小桌面宽度 1120', width: 1120 }
]) {
  test(`M9 布局闸门 · ${viewport.name}：五个栏目在日夜两种主题下都不横向溢出`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: viewport.width, height: 940 })
    await page.goto('/')
    await createProjectFromHall(page, `布局闸门-${viewport.width}-${Date.now()}`)

    // 五个一级栏目各自挑一个深页代表项（均为栏目内真实子页，非壳层）。
    const sections: ReadonlyArray<{ section: string; item: string }> = [
      { section: '小说大纲', item: '创作起点' },
      { section: '世界观', item: '世界总览' },
      { section: '正文创作', item: '正文编辑' },
      { section: '记忆与伏笔', item: '记忆工作台' },
      { section: '审稿与导出', item: '导出成稿' }
    ]

    const applicationRail = page.getByRole('complementary', { name: '应用窄栏' })
    const workspaceNavigation = page.getByRole('complementary', { name: '项目导航' })
    const assistant = page.getByRole('complementary', { name: /创作助手$/ })
    const main = page.locator('.mjp-main')

    for (const { section, item } of sections) {
      await openModule(page, section, item)

      for (const theme of ['paper', 'night'] as const) {
        await switchTheme(page, theme)

        // 1) 三栏仍在且宽度精确（68 / 232 / 360）。
        await expect(applicationRail, `${section}/${theme} 应用窄栏`).toBeVisible()
        await expect(workspaceNavigation, `${section}/${theme} 项目导航`).toBeVisible()
        await expect(assistant, `${section}/${theme} 创作助手`).toBeVisible()
        await expectWidth(applicationRail, 68)
        await expectWidth(workspaceNavigation, 232)
        await expectWidth(assistant, 360)

        // 2) 中央区非零宽。
        const mainWidth = await main.evaluate((el) => el.getBoundingClientRect().width)
        expect(mainWidth, `${section}/${theme} 中央区应非零宽`).toBeGreaterThan(0)

        // 3) 整页不横向溢出；若溢出，定位最外层越界元素供回报。
        const geometry = await page.evaluate(() => {
          const doc = document.documentElement
          const depth = (el: Element): number => {
            let d = 0
            let node: Element | null = el
            while (node.parentElement) {
              d += 1
              node = node.parentElement
            }
            return d
          }
          const offenders = Array.from(document.querySelectorAll('body *')).filter((el) => {
            const rect = el.getBoundingClientRect()
            return rect.width > 0 && el.getClientRects().length > 0 && rect.right > window.innerWidth + 1
          })
          offenders.sort((a, b) => depth(a) - depth(b))
          const top = offenders[0]
          return {
            clientWidth: doc.clientWidth,
            scrollWidth: doc.scrollWidth,
            overflow: top
              ? {
                  tag: top.tagName.toLowerCase(),
                  className: typeof (top as HTMLElement).className === 'string' ? (top as HTMLElement).className : '',
                  right: Math.round(top.getBoundingClientRect().right),
                  text: (top.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
                }
              : null
          }
        })

        const label = `${section} · ${theme === 'paper' ? '暖纸' : '夜墨'} · ${viewport.width}px`
        if (geometry.overflow) {
          console.log(
            `[M9 布局闸门] 溢出 ${label}: <${geometry.overflow.tag} class="${geometry.overflow.className}"> right=${geometry.overflow.right} 文本="${geometry.overflow.text}" (client=${geometry.clientWidth} scroll=${geometry.scrollWidth})`
          )
        }
        expect(geometry.scrollWidth, `${label} 不得横向溢出（scroll>client）`).toBeLessThanOrEqual(
          geometry.clientWidth + 1
        )

        console.log(
          `[M9 布局闸门] ${label}: 窄栏68 导航232 助手360 中央${Math.round(mainWidth)}px｜client=${geometry.clientWidth} scroll=${geometry.scrollWidth}`
        )
      }
    }
  })
}
