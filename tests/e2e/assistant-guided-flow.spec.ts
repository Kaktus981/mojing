import { expect, test, type Page } from '@playwright/test'
import { guideActionOf, guideResponder, guideUserOf } from './helpers/guide-stub'
import { buildWritableProject, openModule, projectPut, type ManualFixture } from './helpers/manual-workspace'
import { assertNoViewportOverflow, ensureFreeCreation } from './helpers/workspace-ui'
import { configureProvider, startStubModel, type StubModel } from './helpers/stub-model'

/**
 * Task 9：**五个引导领域的端到端验收**（真实 API + 隔离内存库 + 受控模型，不接任何外部模型）。
 *
 * 这里守的不是「桩能返回什么」，而是产品自己的链路：
 *   1. 五个栏目（大纲 / 世界观 / 正文 / 记忆 / 交付）各自走完一段引导，落到**已有的**结果层
 *      （工作草稿 / 设定提案 / 修改候选 / 章节分析任务 / 审稿候选或导出预检），
 *      且**正式内容在显式预览 + 采用之前一个字都不动**；
 *   2. 每一次出站请求体里到底带了什么 —— 尤其交付审稿必须拿到**有界的真实正文摘录 +
 *      总纲 + 世界事实 + 已确认记忆**，而不是只有章节 ID 与计数（光有桩生成的结论不算证据）；
 *   3. 请求次数口径：选模式 0 次、开始引导恰好 1 次、每答一题恰好 1 次、刷新不重复分析；
 *   4. 隔离与冲突：跨项目 / 跨领域 / 换目标 / 重复生成 / 版本过期；
 *   5. 失败保留视图与未发送文本，重试是显式的；「永不发送」的词条绝不进出站请求；
 *   6. 1120 / 1500 × 暖纸 / 夜墨：助手常驻 360、无横向溢出、长文案换行、按钮可达、键盘焦点有意义。
 *
 * 桩只证明**链路**：题目文本由桩产出，因此「同一答被下一问引用」只证明答案确实进了出站上下文
 * 并被渲染，不证明真实模型的智能 —— 真正的业务证据是下面每一条对**出站请求体**的断言。
 */

const OUTLINE_CANDIDATE = {
  core: '一座会改写记忆的钟，逼一个巡夜人选择记住还是遗忘。',
  skeleton: { 开端: '钟声第一次异常', 发展: '追查钟的来源', 转折: '巡夜人发现自己也被改写过', 高潮: '在钟前做出取舍', 结局: '城市记住了代价' },
  volumes: [{ volumeNumber: 1, title: '旧城', goal: '确认钟真的在改写记忆' }],
  storylines: [{ title: '潮汐钟的真相', why: '全书的悬念主线' }],
  pending: []
}

/** 世界观领域：一条真实条目形状的设定提案（`details` 是按类型必填的字段容器）。 */
const WORLD_PAYLOAD = {
  evidence: null,
  title: '把潮汐钟的规则补全',
  reason: '正文里已经出现钟会改写记忆，先把可核对的规则写清楚。',
  proposedEntries: [{
    type: '物品',
    name: '潮汐钟',
    aliases: [],
    tags: [],
    summary: '一座会改写旧城记忆的古钟，钟声每响一次就抹掉一段昨天。',
    notes: '',
    relations: [],
    customFields: {},
    details: { fields: {}, lists: {} }
  }],
  sourceChapterIds: [],
  plannedChapterNumbers: [],
  transitionPlan: []
}

/**
 * 同上，但桩故意多塞一个 `id`。
 *
 * 引导契约里的 `proposedEntries` 是 **strict** 且不接受 `id`：词条身份只能由服务端分配，
 * 模型给的主键必须被直接拒掉，而不是被静默采信或静默忽略。
 */
const FORGED_ENTRY_ID = '伪造的词条-id-0001'
const WORLD_PAYLOAD_WITH_FORGED_ID = {
  ...WORLD_PAYLOAD,
  proposedEntries: [{ ...WORLD_PAYLOAD.proposedEntries[0], id: FORGED_ENTRY_ID }]
}

const WRITING_PAYLOAD = {
  title: '古钟初鸣',
  paragraphs: ['改写候选的第一段：林砚在旧城听见钟声，发现自己忘了昨天的路。', '第二段：他把这件事记在随身本子上，防着自己再被改写。'],
  summary: '按引导改写本章正文'
}

/** 记忆领域：载荷按契约是空对象（服务端只排任务，结果由作者逐条确认）。 */
const MEMORY_PAYLOAD = {}

const DELIVERY_REVIEW_PAYLOAD = {
  summary: '整稿连续性预检',
  finding: {
    title: '钟声的生效范围前后不一致',
    detail: '第一章说钟只改写旧城的人，第三章却写到了城外驿站，建议统一说法。',
    severity: '中',
    category: '连续性',
    recommendation: '在第一章补一句钟的作用范围，或把第三章的驿站改回城内。'
  }
}

/** 本轮补齐的交付审稿集成缺口：它必须真的带上有界证据，光有 ID 与计数不够。 */
const DELIVERY_EVIDENCE = {
  manuscriptChapterLimit: 12,
  excerptCharsPerChapter: 1_200,
  memoryLimit: 40
}

/**
 * G-2 的伏笔探针：以**真实段落**埋设在第 1 章，锚点指向本项目真实章节，
 * 所以它在「第 1 章」的审稿范围里**确实相关**（章节锚点缺失的伏笔按设计不参与猜测）。
 */
const FORESHADOW_TITLE = '古钟星纹探针'
/** G-2 的禁止内容标记：一条 AI 可见范围为「永不发送」的词条，一个字都不该出站。 */
const FORBIDDEN_ENTRY = '禁发词条·投影探针'
const FORBIDDEN_SUMMARY = '这条摘要只用于验证「永不发送」的词条不会进入任何一次出站请求。'

const LONG_REASON = '这一条理由故意写得很长，用来验证选项在窄栏里会换行而不是把助手栏撑出横向滚动条；'.repeat(3)

const readProject = async (fixture: ManualFixture, page: Page): Promise<Record<string, any>> =>
  (await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json()) as Record<string, any>

/** 世界事实：真实保存进项目文档，用来验证「出站上下文带的是真事实，不是 ID 与计数」。 */
const WORLD_FACT_NAME = '潮汐钟'
const WORLD_FACT_SUMMARY = '旧城的古钟每响一次就抹掉城里人对昨天的记忆；巡夜人靠随身本子记下被抹掉的事。'

/**
 * 用**真实界面**把项目补成「有世界事实」：世界总览建空白世界 → 世界词条建一条物品。
 *
 * 不手写文档：这段夹具本身就是「作者真的录了一条设定」，而世界观与交付两个领域的
 * 出站上下文断言都依赖它。词条编辑走 900ms 防抖保存，所以这里等的是
 * **项目文档里真的出现了这条词条**，而不是等某一次 PUT —— 两次编辑可能被合并成一次保存。
 */
async function buildWorldFacts(
  page: Page,
  fixture: ManualFixture,
  options: { name?: string; summary?: string; visibility?: string } = {}
): Promise<void> {
  const name = options.name ?? WORLD_FACT_NAME
  const summary = options.summary ?? WORLD_FACT_SUMMARY
  await openModule(page, '世界观', '世界总览')
  const emptyWorld = page.getByRole('button', { name: '从空白世界开始' })
  if (await emptyWorld.isVisible()) {
    const saved = projectPut(page, fixture.id)
    await emptyWorld.click()
    await saved
  }
  await openModule(page, '世界观', '世界词条')
  await page.getByRole('combobox', { name: '新词条类型' }).selectOption('物品')
  await page.getByRole('button', { name: '新建词条' }).click()
  /*
   * 用 role + 名称定位，而不是 `getByLabel(..., { exact: true })`：
   * 「AI 可见范围」这几个字段的 label 是**包裹式**的，里面套着 select，
   * 精确匹配按包裹 label 的文本算，会把选项文本一起算进去而永远匹配不上。
   */
  await expect(page.getByRole('textbox', { name: '名称' })).toBeVisible()
  await page.getByRole('textbox', { name: '名称' }).fill(name)
  await page.getByRole('textbox', { name: '摘要' }).fill(summary)
  if (options.visibility) await page.getByRole('combobox', { name: 'AI 可见范围' }).selectOption(options.visibility)
  await expect.poll(async () => {
    const response = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })
    const project = (await response.json()) as { worldBible?: { entries?: Array<{ name: string; summary: string; aiVisibility: string }> } }
    return (project.worldBible?.entries ?? []).some((entry) =>
      entry.name === name && entry.summary === summary && (!options.visibility || entry.aiVisibility === options.visibility))
  }, { message: '世界词条必须真的保存进项目文档', timeout: 15_000 }).toBe(true)
}

/**
 * 进入右栏的引导构建（幂等）。
 *
 * 三种可能的状态都要走对：已经在引导里、还没选过模式（选择页）、已经选了自由创作
 * （面板上有「切到引导构建」）。选模式本身不发任何请求。
 */
async function openGuide(page: Page): Promise<void> {
  const panel = page.getByTestId('guided-assistant-panel')
  if (await panel.isVisible()) return
  const chooser = page.getByTestId('assistant-mode-chooser')
  const freeSwitch = page.getByTestId('free-switch-guide')
  // 先等这三者里出现任意一个，再去点：避免读到「模式还没恢复完」的中间态。
  await expect(chooser.or(panel).or(freeSwitch)).toBeVisible({ timeout: 15_000 })
  if (await panel.isVisible()) return
  if (await chooser.isVisible()) await chooser.getByTestId('assistant-mode-guide').click()
  else await freeSwitch.click()
  await expect(panel).toBeVisible()
}

/** 「开始引导」并确认只问了一题。 */
async function startGuide(page: Page): Promise<void> {
  await page.getByTestId('guide-start').click()
  await expect(page.getByTestId('guide-question')).toBeVisible()
}

/** 逐题跳过推进到「可生成」。每跳一题都是一次真实模型调用。 */
async function skipToReady(page: Page, times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await expect(page.getByTestId('guide-question')).toBeVisible()
    const before = await page.getByTestId('guide-progress').innerText()
    await page.getByTestId('guide-skip').click()
    // 等进度真的前进：问题区在请求在途时仍在，直接往下读会读到上一题。
    await expect(page.getByTestId('guide-progress')).not.toHaveText(before)
  }
  await expect(page.getByTestId('guide-ready')).toBeVisible()
}

/** 取出某一次 action 的出站请求体里，服务端交给模型的那段 JSON。 */
function outbound(stub: StubModel, action: string): Record<string, any> {
  const body = stub.calls.find((raw) => guideActionOf(raw) === action)
  expect(body, `必须真的发过 action=${action} 的引导请求`).toBeDefined()
  return guideUserOf(body!) as Record<string, any>
}

/** 同上，但取**最后一次**该 action —— 同一 action 会发多次时用它看最新那一份。 */
function lastOutbound(stub: StubModel, action: string): Record<string, any> {
  const body = [...stub.calls].reverse().find((raw) => guideActionOf(raw) === action)
  expect(body, `必须真的发过 action=${action} 的引导请求`).toBeDefined()
  return guideUserOf(body!) as Record<string, any>
}

function contextOf(stub: StubModel, action: string): Record<string, any> {
  const context = outbound(stub, action).context
  expect(context, `action=${action} 的请求必须带上下文`).toBeTruthy()
  return context as Record<string, any>
}

/**
 * 按**领域 + 目标种类**取出站上下文，而不是按 `action`。
 *
 * G-2 的用例要在同一段受控记录里同时看「大纲领域发了什么」「交付领域的章节范围发了什么」
 * 「交付领域的整稿范围又发了什么」，三者的 `action` 都是 `start`；按 action 取只会拿到最先发的
 * 那一次，跨领域 / 跨范围的断言就会假通过。
 */
function contextOfDomain(stub: StubModel, domain: string, targetKind: string): Record<string, any> {
  const matched = stub.calls
    .map((raw) => guideUserOf(raw))
    .filter((user) => {
      const context = user.context as Record<string, unknown> | undefined
      const target = user.target as { kind?: string } | undefined
      return context?.domain === domain && target?.kind === targetKind
    })
  expect(matched.length, `必须真的发过 ${domain} 领域 / ${targetKind} 目标的引导请求`).toBeGreaterThan(0)
  return matched[0]!.context as Record<string, any>
}

/** 同上，但直接取出那次出站里的**有界伏笔台账**，并先校验它真的存在。 */
function ledgerOf(stub: StubModel, domain: string, targetKind: string): {
  scope: string
  scopeNote: string
  limit: number
  total: number
  truncated: boolean
  threads: Array<{ title: string; status: string; evidence: Array<{ phase: string; chapterNumber?: number; excerpt: string }> }>
} {
  const ledger = contextOfDomain(stub, domain, targetKind).foreshadowLedger
  expect(ledger, '交付引导的出站上下文必须带上伏笔台账').toBeTruthy()
  return ledger as never
}

/** 系统提示词里声明的允许引用范围（证据引用只允许取自这里）。 */
function allowedRefs(stub: StubModel): string[] {
  const parsed = JSON.parse(stub.calls[0]!) as { messages: Array<{ role: string; content: string }> }
  const system = parsed.messages.find((item) => item.role === 'system')!.content
  const block = system.split('允许的 evidenceRefs：')[1] ?? ''
  return block.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('本次已装载'))
}

/** 把整段请求体拼起来，用于「某个词条绝不能出现在任何一次出站请求里」这类断言。 */
const allOutbound = (stub: StubModel): string => stub.calls.join('\n')

test.describe('五领域引导端到端', () => {
  test('大纲：选模式 0 次调用、开始恰好 1 次、每答一题恰好 1 次；结果只落草稿，采用前正式内容不动', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导大纲领域')
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 3 }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '小说大纲', '创作起点')

      // 1) 选择模式本身不调用模型。
      await openGuide(page)
      expect(stub.calls.length, '选择「引导构建」不发任何模型请求').toBe(0)

      // 2) 开始引导恰好一次；出站上下文带的是**真实的故事种子**。
      await page.getByTestId('guide-start').click()
      await expect(page.getByTestId('guide-question')).toBeVisible()
      expect(stub.calls.length, '开始引导只发一次真实请求').toBe(1)
      expect(guideActionOf(stub.calls[0]!), '第一次请求的 action 是 start').toBe('start')
      expect(contextOf(stub, 'start').target.seed, '出站上下文带的是项目真实种子').toBe(before.seed)
      expect(allowedRefs(stub), '允许引用里包含服务端真正读过的上下文键').toContain('context.target')

      // 3) 作答：每答一题恰好一次调用，且下一问建立在作者刚选的那一条上。
      const option = page.getByTestId('guide-option').first()
      const chosenLabel = (await option.locator('.t').innerText()).trim()
      expect(chosenLabel.length).toBeGreaterThan(0)
      await option.locator('input[type="radio"]').check()
      await page.getByTestId('guide-submit-option').click()
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')
      expect(stub.calls.length, '一次回答只发一次请求').toBe(2)
      const answered = outbound(stub, 'answer')
      expect(answered.confirmedAnswers, '已确认回答随请求出站').toHaveLength(1)
      expect(answered.confirmedAnswers[0].selectedOptionLabel, '出站的就是作者选的那一条').toBe(chosenLabel)
      await expect(page.getByTestId('guide-question')).toContainText(chosenLabel)

      // 作者自己写一句（不是选项）：同样原样出站，并被下一问引用 —— 动态追问不是固定文案。
      const customText = `除了「${chosenLabel}」，我还在意钟声对城里人的代价。`
      await page.getByTestId('guide-custom-input').fill(customText)
      await page.getByTestId('guide-submit-custom').click()
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 2 个回答')
      expect(stub.calls.length, '自定义回答同样只发一次请求').toBe(3)
      const customAnswered = lastOutbound(stub, 'answer')
      expect(customAnswered.confirmedAnswers, '两次回答都随请求出站').toHaveLength(2)
      expect(customAnswered.confirmedAnswers[1].customText, '自定义回答原样出站').toBe(customText)
      await expect(page.getByTestId('guide-question')).toContainText(customText)

      await skipToReady(page, 1)
      expect(stub.calls.length, '跳过一题再发一次请求').toBe(4)

      // 4) 生成结果：只落草稿。
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      expect(stub.calls.length, '生成结果恰好再发一次请求').toBe(5)
      const complete = outbound(stub, 'complete')
      expect(complete.allowedResultKinds, '生成阶段把允许的结果类型一起交给模型').toEqual(['assistant-draft'])
      expect(complete.confirmedAnswers.length, '生成时带上全部已确认回答').toBe(3)
      await expect(page.getByTestId('guide-result-ref')).toContainText('草稿')
      expect((await readProject(fixture, page)).outline.synopsis, '引导生成不得直接改正式大纲').toBe(before.outline.synopsis)

      // 5) 草稿确实存在，且必须显式查看差异后才能采用 —— 采用之后正式内容才变化。
      await page.getByTestId('guide-result-navigate').click()
      const panel = page.getByTestId('candidate-panel')
      await expect(panel).toBeVisible()
      await expect(page.getByTestId('candidate-adopt')).toBeDisabled()
      await page.getByTestId('candidate-preview').click()
      await expect(page.getByTestId('candidate-adopt')).toBeEnabled()
      await page.getByTestId('candidate-adopt').click()
      await expect(panel).toHaveCount(0)
      expect((await readProject(fixture, page)).outline.synopsis.length).toBeGreaterThan(before.outline.synopsis.length)
    } finally {
      await stub.close()
    }
  })

  test('世界观：设定提案只落提案层；出站上下文带真实世界事实', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导世界观领域')
    const stub = await startStubModel(guideResponder({
      resultKind: 'world-setting-proposal',
      payload: WORLD_PAYLOAD,
      readyAfter: 1,
      questions: [{ id: 'w-1', focus: '世界规则的兜底', text: '这座钟的代价由谁承担？', options: ['由城市承担', '由巡夜人承担', '由后来读到这段记录的人承担'] }]
    }))
    try {
      await buildWorldFacts(page, fixture)
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '世界观', '世界总览')
      await openGuide(page)
      await startGuide(page)

      const context = contextOf(stub, 'start')
      expect(context.domain, '出站上下文声明的是世界观领域').toBe('world')
      expect(context.worldBible, '世界观上下文必须带世界事实本身，而不是只有 ID').toBeTruthy()
      const sentEntries = (context.worldBible as { entries: Array<{ name: string }> }).entries
      expect(sentEntries.map((entry) => entry.name), '出站的是刚录进去的真实词条').toContain(WORLD_FACT_NAME)

      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('提案')

      // 提案落提案层：正式世界观词条一个字没动。
      // （注：提案本身存在项目文档里，所以 revision 会正常前进 —— 这里不能拿 revision 当作「没写正式内容」的证据。）
      const after = await readProject(fixture, page)
      expect(after.worldBible.entries, '生成设定提案不得直接写进正式世界观').toEqual(before.worldBible.entries)
      expect(after.worldBible.status, '正式世界观的定稿状态也不该被提案改掉').toBe(before.worldBible.status)
      const proposals = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/setting-proposals`, { headers: fixture.headers })).json() as Array<{ title: string; proposedEntries: Array<{ id: string; name: string }> }>
      expect(proposals.map((item) => item.title), '提案确实进入了作者要逐条确认的提案层').toContain(WORLD_PAYLOAD.title)
      const proposal = proposals.find((item) => item.title === WORLD_PAYLOAD.title)!
      expect(proposal.proposedEntries[0]!.name).toBe('潮汐钟')
      expect(proposal.proposedEntries[0]!.id, '词条身份由服务端分配').toBeTruthy()
    } finally {
      await stub.close()
    }
  })

  test('正文：修改候选只落候选层；出站上下文带本章真实正文与章纲', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导正文领域')
    const stub = await startStubModel(guideResponder({
      resultKind: 'revision-proposal',
      payload: WRITING_PAYLOAD,
      readyAfter: 1
    }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '正文创作', '正文编辑')
      await openGuide(page)
      await startGuide(page)

      const context = contextOf(stub, 'start')
      expect(context.domain).toBe('writing')
      expect(context.chapter.id, '正文上下文指向的必须是作者正在写的那一章').toBe(fixture.chapterId)
      const blocks = context.chapter.blocks as Array<{ text: string }>
      expect(blocks.map((block) => block.text).join(''), '出站的是真实正文，不是占位文本').toContain('林砚在旧城发现古钟')
      expect(context.outline, '正文引导同时带上章纲').toBeTruthy()
      expect(allowedRefs(stub), '允许引用里包含本章正文与关联章纲').toEqual(expect.arrayContaining([`chapter:${fixture.chapterId}`]))

      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('候选')

      const after = await readProject(fixture, page)
      expect(after.chapters[0].blocks[0].text, '修改候选不得直接改正式正文').toBe(before.chapters[0].blocks[0].text)
      const proposals = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/revision-proposals`, { headers: fixture.headers })).json() as Array<{ kind: string; status: string; summary: string }>
      expect(proposals.filter((item) => item.kind === 'chapter-revision').map((item) => item.summary)).toContain(WRITING_PAYLOAD.summary)
      expect(proposals.every((item) => item.status === '待处理'), '候选默认都是待处理，等作者确认').toBe(true)
    } finally {
      await stub.close()
    }
  })

  test('记忆：章节分析只排队不写正式记忆；出站上下文带本章与已确认记忆', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导记忆领域')
    const stub = await startStubModel(guideResponder({
      resultKind: 'chapter-analysis',
      payload: MEMORY_PAYLOAD,
      readyAfter: 1
    }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '记忆与伏笔', '记忆工作台')
      await openGuide(page)
      await startGuide(page)

      const context = contextOf(stub, 'start')
      expect(context.domain).toBe('memory')
      expect(context.chapter.id, '记忆上下文指向的必须是目标正文章节').toBe(fixture.chapterId)
      expect(Array.isArray(context.formalMemory), '出站带上已有的正式记忆（可能为空数组，但不能缺）').toBe(true)
      /*
       * G-3：出站带的是**有界的线程投影**（对象，含上限 / 计数 / 截断标记），
       * 而不是整条 `plotThreads`。这条断言相对旧版**只加强**：形状、条数上限、
       * 整份字符上限、内部字段名一律不出站。
       */
      expect(Object.hasOwn(context, 'threads'), '旧的裸数组键 threads 必须被替换').toBe(false)
      const ledger = context.threadLedger as {
        scope: string; limit: number; total: number; truncated: boolean
        threads: Array<{ title: string; status: string; evidence: Array<{ status: string }> }>
      }
      expect(ledger && !Array.isArray(ledger), '出站带上的是有界线程投影（对象，不是裸数组）').toBeTruthy()
      expect(ledger.scope, '记忆投影恒定本章范围').toBe('chapter')
      expect(ledger.limit, '上限必须在出站上下文里声明').toBe(10)
      expect(Array.isArray(ledger.threads), '投影条目是数组').toBe(true)
      expect(ledger.threads.length, '条数不超过声明上限').toBeLessThanOrEqual(ledger.limit)
      expect(typeof ledger.total, '计数必须如实给出').toBe('number')
      expect(typeof ledger.truncated, '截断标记必须如实给出').toBe('boolean')
      const ledgerSerialized = JSON.stringify(ledger)
      expect(ledgerSerialized.length, '整份投影（含外壳）必须始终有界').toBeLessThanOrEqual(6_000)
      for (const field of ['evidencePool', 'revisionHistory', 'otherCharacters', 'assessedAt']) {
        expect(ledgerSerialized, `投影不得含内部字段名 ${field}`).not.toContain(field)
      }

      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('任务')

      const after = await readProject(fixture, page)
      expect(after.memories, '排队章节分析不得直接写正式记忆').toEqual(before.memories)
      const tasks = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/chapter-analyses?chapterId=${fixture.chapterId}`, { headers: fixture.headers })).json() as Array<{ status: string }>
      expect(tasks.length, '分析任务确实入队了一条').toBe(1)
      expect(tasks[0]!.status, '任务只是排队，结果还要作者逐条确认').toBe('等待')
    } finally {
      await stub.close()
    }
  })

  test('交付审稿：出站上下文必须带上有界的真实正文摘录、总纲、世界事实与已确认记忆', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导交付领域')
    const stub = await startStubModel(guideResponder({
      resultKind: 'revision-proposal',
      payload: DELIVERY_REVIEW_PAYLOAD,
      readyAfter: 1
    }))
    try {
      await buildWorldFacts(page, fixture)
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '审稿与导出', '导出成稿')
      await openGuide(page)
      await startGuide(page)

      const context = contextOf(stub, 'start')
      expect(context.domain).toBe('delivery')
      // 有界证据：正文摘录必须是**本章真实文字**，且带上限说明，不假装读过全书。
      const manuscript = context.manuscript as Array<{ id: string; chapterNumber: number; excerpt: string; excerptTruncated: boolean }>
      expect(manuscript.length, '审稿范围里的章节都要给到摘录').toBe(1)
      expect(manuscript[0]!.id).toBe(fixture.chapterId)
      expect(manuscript[0]!.excerpt, '摘录必须是真实正文原文，模型才有可引用的话').toContain('林砚在旧城发现古钟')
      expect(manuscript[0]!.excerptTruncated, '没超上限就不要谎报截断').toBe(false)
      expect(context.manuscriptTruncated).toBe(false)
      // 总纲不是「有就行」：逐字段等于项目里的真实总纲。
      expect(context.outline, '交付审稿必须看得到总纲').toEqual({
        synopsis: before.outline.synopsis,
        mainConflict: before.outline.mainConflict,
        endingDirection: before.outline.endingDirection
      })
      expect(context.worldFacts, '交付审稿必须看得到已批准的世界事实').toBeTruthy()
      const deliveredFacts = (context.worldFacts as { entries: Array<{ name: string }> }).entries
      expect(deliveredFacts.map((entry) => entry.name), '交付审稿拿到的是真实世界设定，而不是 ID 清单').toContain(WORLD_FACT_NAME)
      /*
       * 已确认记忆同样必须是真内容、且受上限约束。
       * 这个夹具还没有走「章节分析 → 作者逐条确认」那条路，所以这里如实是空数组：
       * 断言的是「有几条就带几条，**不许凭空编**」与上限，而不是"有就行"。
       * （非空记忆的投影形状由 `packages/core/src/assistantGuideAdapters.test.ts` 里
       *   「delivery 上下文把已确认记忆投影成可读内容…」那条单测守着 —— 它注入真实形状的
       *   已确认记忆，钉住"只取最近 40 条、带可读内容、不泄漏主键"。
       *   本文件不造假记忆去凑端到端。）
       */
      const memoryFacts = context.memoryFacts as Array<{ chapterNumber: number; summary: string }>
      expect(Array.isArray(memoryFacts), '交付审稿必须看得到已确认记忆').toBe(true)
      expect(memoryFacts.length, '没有已确认记忆时不得凭空编出').toBe(before.memories.length)
      expect(memoryFacts.length, '已确认记忆受上限约束').toBeLessThanOrEqual(DELIVERY_EVIDENCE.memoryLimit)
      expect(context.evidenceBounds, '上限必须如实声明，不能让模型以为读了全书').toMatchObject(DELIVERY_EVIDENCE)
      expect(context.reviewRange, '审稿范围仍然如实报告').toEqual([fixture.chapterId])

      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('候选')

      const after = await readProject(fixture, page)
      expect(after.reviews, '审稿候选不得直接写进正式审稿问题').toEqual(before.reviews)
      const proposals = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/revision-proposals`, { headers: fixture.headers })).json() as Array<{ kind: string }>
      expect(proposals.map((item) => item.kind), '落的是连续性审稿候选').toContain('continuity-audit')
      expect(after.revision, '候选层之外，正式项目版本不动').toBe(before.revision)
    } finally {
      await stub.close()
    }
  })

  test('交付导出预检：只读预检，不代表已经允许导出', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导导出预检')
    const stub = await startStubModel(guideResponder({
      resultKind: 'export-precheck',
      payload: { format: 'md' },
      readyAfter: 1
    }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '审稿与导出', '导出成稿')
      await openGuide(page)
      await startGuide(page)
      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('预检')
      await expect(page.getByTestId('guide-result')).toContainText('不代表已经允许导出')
      expect((await readProject(fixture, page)).revision, '只读预检不得改动正式项目').toBe(before.revision)
    } finally {
      await stub.close()
    }
  })

  test('刷新与重进只读进度，不重复分析：GET current 不发模型请求，已确认回答仍在', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导刷新恢复')
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 3 }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      await openModule(page, '小说大纲', '创作起点')
      await openGuide(page)
      await startGuide(page)
      await page.getByTestId('guide-option').first().locator('input[type="radio"]').check()
      await page.getByTestId('guide-submit-option').click()
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')
      const callsAfterAnswer = stub.calls.length

      // 刷新：右栏回到这个作用域时读的是服务端进度，不是重新分析一遍。
      await page.reload()
      await page.locator('.mjp-hall-project').filter({ hasText: '引导刷新恢复' }).first().getByRole('button', { name: /^打开：/ }).click()
      await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
      await openModule(page, '小说大纲', '创作起点')
      await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')
      expect(stub.calls.length, '刷新只读进度，一次模型请求都不发').toBe(callsAfterAnswer)

      // 继续作答接着往下走（不是从头开始）。
      await skipToReady(page, 2)
      expect(stub.calls.length, '两次跳过仍然各一次').toBe(callsAfterAnswer + 2)
    } finally {
      await stub.close()
    }
  })

  test('隔离与冲突：跨项目、跨领域各自一份会话；版本过期 409；重复生成不产生第二份结果', async ({ page }) => {
    test.setTimeout(180_000)
    const first = await buildWritableProject(page, '引导隔离甲')
    const second = await buildWritableProject(page, '引导隔离乙')
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 1 }))
    try {
      await configureProvider(page, first.origin, first.headers, stub.baseUrl)
      const jsonHeaders = { ...first.headers, 'Content-Type': 'application/json' }
      const sessionOf = async (fixture: ManualFixture): Promise<Record<string, any>> => {
        const response = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-guides/start`, {
          headers: jsonHeaders,
          data: { domain: 'outline', target: { kind: 'outline', projectId: fixture.id } }
        })
        expect(response.status(), await response.text()).toBe(201)
        return response.json() as Promise<Record<string, any>>
      }

      const firstSession = await sessionOf(first)
      const secondSession = await sessionOf(second)
      expect(firstSession.id, '两个项目各自一段会话，绝不共用').not.toBe(secondSession.id)
      expect(firstSession.projectId).toBe(first.id)
      expect(secondSession.projectId).toBe(second.id)

      // 跨项目：拿甲的项目去读乙的会话，读不到。
      const crossRead = await page.request.put(`${first.origin}/api/novels/${first.id}/assistant-guides/${secondSession.id}/answer`, {
        headers: jsonHeaders,
        data: { expectedVersion: secondSession.version, questionId: 'x', skip: true }
      })
      expect(crossRead.status(), '跨项目的会话既读不到也答不了').toBe(404)

      // 版本过期：拿旧版本作答，服务端 409，且回答一个字都没落进去。
      const stale = await page.request.put(`${first.origin}/api/novels/${first.id}/assistant-guides/${firstSession.id}/answer`, {
        headers: jsonHeaders,
        data: { expectedVersion: 1, questionId: firstSession.turn.question.id, skip: true }
      })
      expect(stale.status(), '版本对不上必须 409，而不是覆盖').toBe(409)

      // 同一作用域再 start：恢复同一段会话，不新建、不额外分析。
      const again = await page.request.post(`${first.origin}/api/novels/${first.id}/assistant-guides/start`, {
        headers: jsonHeaders,
        data: { domain: 'outline', target: { kind: 'outline', projectId: first.id } }
      })
      expect(again.status(), '已有会话时是恢复而不是新建').toBe(200)
      expect(((await again.json()) as { id: string }).id).toBe(firstSession.id)
      expect(stub.calls.length, '重复开始不得再发一次分析请求').toBe(2)

      // 跨领域：同一项目、同一作用域键前缀，结论各归各位。
      const world = await page.request.post(`${first.origin}/api/novels/${first.id}/assistant-guides/start`, {
        headers: jsonHeaders,
        data: { domain: 'world', target: { kind: 'world', projectId: first.id } }
      })
      expect(world.status(), '世界观领域是另一段会话').toBe(201)
      expect(((await world.json()) as { id: string }).id).not.toBe(firstSession.id)

      // 生成：答满一题后生成一次，重复生成不再产生第二份结果。
      const answered = await (await page.request.put(`${first.origin}/api/novels/${first.id}/assistant-guides/${firstSession.id}/answer`, {
        headers: jsonHeaders,
        data: { expectedVersion: firstSession.version, questionId: firstSession.turn.question.id, skip: true }
      })).json() as Record<string, any>
      expect(answered.turn.readyToComplete).toBe(true)
      const completed = await (await page.request.post(`${first.origin}/api/novels/${first.id}/assistant-guides/${firstSession.id}/complete`, {
        headers: jsonHeaders,
        data: { expectedVersion: answered.version }
      })).json() as Record<string, any>
      expect(completed.resultRef.kind).toBe('assistant-draft')
      /*
       * 草稿的存放作用域**不等于**会话作用域：会话是「整稿引导」（`outline:`），
       * 而落盘结果绑定的是它改写的那块内容（`story-core:`）。所以这里按项目查全部草稿，
       * 而不是拿会话的作用域键去查 —— 查错了会把「落盘了」误判成「没落盘」。
       */
      const draftsOf = async (fixture: ManualFixture): Promise<unknown[]> => {
        const response = await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, { headers: fixture.headers })
        return (await response.json()) as unknown[]
      }
      const afterComplete = await draftsOf(first)
      expect(afterComplete).toHaveLength(1)
      expect(await draftsOf(second), '另一个项目不该因为这段引导多出草稿').toHaveLength(0)
      const repeat = await page.request.post(`${first.origin}/api/novels/${first.id}/assistant-guides/${firstSession.id}/complete`, {
        headers: jsonHeaders,
        data: { expectedVersion: answered.version }
      })
      expect(repeat.status(), '拿旧版本重复生成必须被拒').toBe(409)
      expect(await draftsOf(first), '重复生成不产生第二份草稿').toHaveLength(1)
    } finally {
      await stub.close()
    }
  })

  test('引用的内容变了要重新分析：回答与重新分析都要保留已经确认的回答', async ({ page }) => {
    test.setTimeout(120_000)
    const fixture = await buildWritableProject(page, '引导内容变化')
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 3 }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      await openModule(page, '小说大纲', '创作起点')
      await openGuide(page)
      await startGuide(page)
      await page.getByTestId('guide-option').first().locator('input[type="radio"]').check()
      await page.getByTestId('guide-submit-option').click()
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')

      // 作者在同一项目的别处真实保存了一次：引导引用的上下文变了。
      const current = await readProject(fixture, page)
      const saved = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}`, {
        headers: { ...fixture.headers, 'Content-Type': 'application/json' },
        data: { document: { ...current, seed: `${current.seed} 又要多记一件事。` }, baseRevision: current.revision }
      })
      expect(saved.status()).toBe(200)

      // 再回答：服务端要求重新分析，而不是拿着过期上下文继续。
      await expect(page.getByTestId('guide-question')).toBeVisible()
      await page.getByTestId('guide-skip').click()
      await expect(page.getByTestId('guide-needs-review')).toBeVisible()
      await expect(page.getByTestId('guide-needs-review')).toContainText('已经确认的回答会保留')
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')

      // 重新分析：恰好一次调用，且回答没有被清掉。
      const beforeReanalyze = stub.calls.length
      await page.getByTestId('guide-reanalyze').click()
      await expect(page.getByTestId('guide-question')).toBeVisible()
      expect(stub.calls.length, '重新分析恰好发一次请求').toBe(beforeReanalyze + 1)
      expect(guideActionOf(stub.calls[stub.calls.length - 1]!), '最后这次请求的 action 是 reanalyze').toBe('reanalyze')
      const outboundAnswers = outbound(stub, 'reanalyze').confirmedAnswers as unknown[]
      expect(outboundAnswers.length, '重新分析时把已经确认的回答原样带上').toBe(1)
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 1 个回答')
    } finally {
      await stub.close()
    }
  })

  test('失败保留视图与未发送文本，重试是显式的；「永不发送」的词条绝不进出站请求', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = await buildWritableProject(page, '引导失败保留')
    // 每个回合都回绝：用来观察失败时界面与作者输入的去向。
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 3 }), {
      reject: () => `模型服务暂时不可用（受控注入）：${LONG_REASON}`
    })
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

      // 先真的录一条 AI 可见范围为「永不发送」的词条，里面放一个绝不会出现在请求里的记号。
      const forbidden = '绝密档案-只在本地'
      await buildWorldFacts(page, fixture, {
        name: forbidden,
        summary: '这条设定不允许发送给模型，任何一次出站请求都不该出现它。',
        visibility: '永不发送'
      })

      await openModule(page, '世界观', '世界总览')
      await openGuide(page)
      await page.getByTestId('guide-start').click()

      // 这一次连会话都没建起来：如实报错、视图留在引导里，恢复入口是显式的「开始引导」而不是自动重发。
      await expect(page.getByTestId('guide-error')).toBeVisible()
      await expect(page.getByTestId('guide-error')).not.toBeEmpty()
      // 超长错误文案必须换行，不能把助手栏撑出横向滚动。
      const failedDock = page.locator('.mjp-dock')
      expect(
        await failedDock.evaluate((element) => element.scrollWidth <= element.clientWidth + 2),
        '长错误文案把助手栏撑出了横向滚动'
      ).toBe(true)
      await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
      await expect(page.getByTestId('guide-waiting')).toBeVisible()
      await expect(page.getByTestId('guide-retry'), '没有会话时重试无从谈起，入口只能是「开始引导」').toHaveCount(0)
      expect(stub.calls.length, '失败之后不得自动重发').toBe(1)
      await page.getByTestId('guide-start').click()
      await expect.poll(() => stub.calls.length, { message: '再次开始必须是作者点击才发生的' }).toBe(2)

      // 自由创作那边没发出去的输入不能被引导的失败冲掉。
      await page.getByTestId('guide-switch-free').click()
      await expect(page.locator('#mojing-dock-input')).toBeVisible()
      await page.locator('#mojing-dock-input').fill('这段字还没发送，不能被冲掉。')
      await page.getByTestId('free-switch-guide').click()
      await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
      await page.getByTestId('guide-switch-free').click()
      await expect(page.locator('#mojing-dock-input')).toHaveValue('这段字还没发送，不能被冲掉。')

      // 「永不发送」的词条一次都不能出现在出站请求里。
      expect(allOutbound(stub), '永不发送的词条绝不能进入发给模型的请求').not.toContain(forbidden)
    } finally {
      await stub.close()
    }
  })

  test('已开始的引导里作答失败：如实报错、不吞掉这一题、不自动重发', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = await buildWritableProject(page, '引导会话内失败')
    // 第 1 次（开始引导）成功出题，之后每次作答都失败。
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 3 }), {
      reject: (_body, index) => (index === 0 ? undefined : '模型服务暂时不可用（受控注入）')
    })
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      await openModule(page, '小说大纲', '创作起点')
      await openGuide(page)
      await startGuide(page)
      expect(stub.calls.length, '开始引导一次').toBe(1)

      await page.getByTestId('guide-skip').click()
      await expect(page.getByTestId('guide-error')).toBeVisible()
      await expect(page.getByTestId('guide-error')).not.toBeEmpty()
      /*
       * 失败不得吞掉这一题：问题和它的动作都留在界面上，作者可以**显式**再答一次。
       * （服务端在作答失败时不会把会话置为「失败」，所以这里没有独立的「重试」按钮 ——
       * 恢复入口就是这一题自己的动作，视图与已确认回答都不丢。）
       */
      await expect(page.getByTestId('guide-question')).toBeVisible()
      await expect(page.getByTestId('guide-skip')).toBeEnabled()
      await expect(page.getByTestId('guide-progress')).toContainText('已确认 0 个回答')
      expect(stub.calls.length, '失败之后不得自动重发').toBe(2)

      await page.getByTestId('guide-skip').click()
      await expect.poll(() => stub.calls.length, { message: '再答一次必须是作者点击才发生的' }).toBe(3)
      await expect(page.getByTestId('guide-error'), '仍然失败就如实继续报错，不假装成功').toBeVisible()
    } finally {
      await stub.close()
    }
  })

  test('换目标后，旧作用域迟到的引导响应不落到新作用域上', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = await buildWritableProject(page, '引导迟到响应')
    const stub = await startStubModel(guideResponder({
      resultKind: 'world-setting-proposal',
      payload: WORLD_PAYLOAD,
      readyAfter: 3,
      questions: [{ id: 'w-1', focus: '世界规则的兜底', text: '这座钟的代价由谁承担？', options: ['由城市承担', '由巡夜人承担', '由后来读到这段记录的人承担'] }]
    }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      await openModule(page, '小说大纲', '创作起点')
      await openGuide(page)

      /*
       * 把「开始引导」这一次**浏览器 → 本项目 API** 的往返拖慢，作者不等它回来就换栏目。
       *
       * 注意延迟点在前端这一跳：模型调用是 API 进程直接发给桩的，页面上的
       * `chat/completions` 路由根本不会命中，拖它等于什么都没拖。
       */
      let releaseStart: () => void = () => {}
      const startDelivered = new Promise<void>((resolve) => { releaseStart = resolve })
      await page.route('**/assistant-guides/start', async (route) => {
        const response = await route.fetch()
        await new Promise((resolve) => setTimeout(resolve, 1500))
        await route.fulfill({ response })
        releaseStart()
      })
      await page.getByTestId('guide-start').click()
      await openModule(page, '世界观', '世界总览')
      // 换到新作用域：它是一个全新的首次进入（选择页），不会把大纲那一问带过来。
      await expect(page.getByTestId('assistant-mode-chooser')).toBeVisible()
      await expect(page.getByTestId('guide-question')).toHaveCount(0)
      // 迟到的大纲响应也不能在世界观作用域上建出一段会话。
      await expect.poll(async () => stub.calls.length).toBe(1)
      const worldScope = encodeURIComponent(`world:${fixture.id}:world:`)
      const worldSession = await (await page.request.get(
        `${fixture.origin}/api/novels/${fixture.id}/assistant-guides/current?domain=world&scopeKey=${worldScope}`,
        { headers: fixture.headers }
      )).json()
      expect(worldSession, '世界总览作用域不该被旧作用域的响应写进一段会话').toBeNull()

      // 对照：回到创作起点，大纲那一问确实在（上面的「没有」是作用域隔离，不是响应丢了）。
      await startDelivered
      await openModule(page, '小说大纲', '创作起点')
      await openGuide(page)
      await expect(page.getByTestId('guide-question')).toBeVisible()
    } finally {
      await stub.close()
    }
  })

  /**
   * G-2：交付引导必须真的拿到**有界伏笔台账**，而这份材料**只属于交付领域**。
   *
   * 每一条断言读的都是**受控桩记录的原始出站请求体**（`stub.calls`）——
   * 不是卡片显示、不是接口里的 `taskScopes`、也不是任何纯函数推算的结果。
   * 反向控制有三重：大纲领域的出站上下文**不许多出**该投影；章节范围的交付引导**只带**与该审稿章
   * 相关的伏笔；「永不发送」的词条一个字都不许出站。
   */
  test('交付引导出站带上有界伏笔台账：其他领域不发，禁发词条一个字都不出站', async ({ page }) => {
    test.setTimeout(180_000)
    const fixture = await buildWritableProject(page, 'G2 伏笔投影')
    const stub = await startStubModel(guideResponder({
      resultKind: 'revision-proposal',
      payload: DELIVERY_REVIEW_PAYLOAD,
      readyAfter: 1
    }))
    try {
      // 1) 用真实界面把一条伏笔「以真实段落埋设」在第 1 章：它才与本章审稿范围真的相关。
      await openModule(page, '记忆与伏笔', '伏笔中心')
      await page.getByRole('button', { name: '新建伏笔' }).click()
      await page.getByLabel('新伏笔名称').fill(FORESHADOW_TITLE)
      const created = projectPut(page, fixture.id)
      await page.getByRole('button', { name: '新建伏笔' }).click()
      expect((await created).status()).toBe(200)
      await page.getByLabel('证据来源').selectOption('prose')
      await page.getByLabel('证据所在章').selectOption(fixture.chapterId)
      const recorded = projectPut(page, fixture.id)
      await page.getByRole('button', { name: '记录埋设' }).click()
      expect((await recorded).status()).toBe(200)
      await expect.poll(async () => {
        const project = await readProject(fixture, page)
        return (project.plotThreads as Array<{ title: string; status: string }> ?? [])
          .some((thread) => thread.title === FORESHADOW_TITLE && thread.status === '已埋设')
      }, { message: '伏笔必须以真实段落埋设进项目文档', timeout: 15_000 }).toBe(true)

      // 2) 再录一条「永不发送」的词条作为禁止内容标记。
      await buildWorldFacts(page, fixture, { name: FORBIDDEN_ENTRY, summary: FORBIDDEN_SUMMARY, visibility: '永不发送' })

      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)

      // 3) 反向控制一：其他领域（大纲）先真的发一次，它的上下文不得多出伏笔台账。
      const jsonHeaders = { ...fixture.headers, 'Content-Type': 'application/json' }
      const outlineStart = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-guides/start`, {
        headers: jsonHeaders,
        data: { domain: 'outline', target: { kind: 'outline', projectId: fixture.id } }
      })
      expect(outlineStart.status(), await outlineStart.text()).toBe(201)
      const outlineContext = contextOfDomain(stub, 'outline', 'outline')
      expect(
        Object.hasOwn(outlineContext, 'foreshadowLedger'),
        '非交付领域不得因为本轮的交付投影而多出伏笔台账'
      ).toBe(false)

      // 4) 反向控制二：**章节范围**的交付引导只带与该章相关的伏笔（范围即权限）。
      //    UI 上的「导出成稿」发的是**整稿**目标（`WorkspacePage.tsx` 的 `case 'delivery'` 固定
      //    返回 `{ kind: 'outline' }`），所以章节范围这条必须用真实 API 走一次，
      //    两种范围在**出站请求体**上的差别才有据可查。
      const scopedStart = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-guides/start`, {
        headers: jsonHeaders,
        data: { domain: 'delivery', target: { kind: 'chapter', projectId: fixture.id, objectId: fixture.chapterId } }
      })
      expect(scopedStart.status(), await scopedStart.text()).toBe(201)
      const scopedLedger = ledgerOf(stub, 'delivery', 'chapter')
      expect(scopedLedger.scope, '章节目标的审稿范围要如实标注').toBe('chapter')
      expect(
        scopedLedger.threads.map((item) => item.title),
        '章节范围只带与本审稿章相关的伏笔 —— 第 1 章埋设的那一条'
      ).toEqual([FORESHADOW_TITLE])

      // 5) 交付领域：走真实界面完成一段引导（整稿范围）。
      await openModule(page, '审稿与导出', '导出成稿')
      await openGuide(page)
      await startGuide(page)

      const ledger = ledgerOf(stub, 'delivery', 'outline')
      expect(ledger.scope, '整稿目标的审稿范围要如实标注').toBe('whole-project')
      expect(ledger.limit, '上限必须在出站上下文里声明，不能让模型以为看过全部伏笔').toBe(10)
      expect(ledger.truncated, '只有一条伏笔时不得谎报截断').toBe(false)
      expect(ledger.total, '范围判定通过的条数要与项目里真实的伏笔数一致').toBe(1)
      expect(
        ledger.threads.map((item) => item.title),
        '真实伏笔必须出现在审稿材料里，且不许凭空多出别的'
      ).toEqual([FORESHADOW_TITLE])

      const projected = ledger.threads.find((item) => item.title === FORESHADOW_TITLE)!
      expect(projected.status).toBe('已埋设')
      expect(projected.evidence.length, '有界：每条伏笔最多两条证据').toBeLessThanOrEqual(2)
      expect(projected.evidence[0]!.phase).toBe('埋设')
      expect(projected.evidence[0]!.chapterNumber, '证据锚点投影成章号，而不是内部章节 ID').toBe(1)
      expect(projected.evidence[0]!.excerpt, '证据必须是正文真实摘录，模型才有话可引').toContain('林砚在旧城发现古钟')

      // 6) 反向控制三：禁止内容一个字都不出站（整份记录，不只这一段上下文）。
      expect(allOutbound(stub), '「永不发送」的词条绝不能进入任何一次出站请求').not.toContain(FORBIDDEN_ENTRY)
      expect(allOutbound(stub), '「永不发送」的词条摘要同样不出站').not.toContain(FORBIDDEN_SUMMARY)

      // 7) 结果写入边界不变：仍然只落审稿候选，正式内容在采用前一个字不动。
      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('候选')

      const after = await readProject(fixture, page)
      expect(after.reviews, '审稿候选不得直接写进正式审稿问题').toEqual(before.reviews)
      const proposals = await (await page.request.get(
        `${fixture.origin}/api/novels/${fixture.id}/revision-proposals`,
        { headers: fixture.headers }
      )).json() as Array<{ kind: string }>
      expect(proposals.map((item) => item.kind), '落的是连续性审稿候选').toContain('continuity-audit')
      expect(after.revision, '候选层之外，正式项目版本不动').toBe(before.revision)
    } finally {
      await stub.close()
    }
  })

  /**
   * G-3：记忆引导必须真的拿到**有界的本章线程投影**，而这份材料只属于记忆领域。
   *
   * 与 G-2 交付台账用例同一口径：唯一证据是受控桩记录的**原始出站请求体**（`stub.calls`）——
   * 不是卡片显示、不是纯函数输出、也不是接口返回值。反向控制三重：大纲领域的出站上下文
   * **不许多出**该键；投影**有界**且不含内部字段名；「永不发送」的词条一个字都不许出站。
   * 本章范围内确实有相关伏笔，由**真实界面**埋设的那一条作证。
   */
  test('记忆引导出站带上本线程投影：有界、不含内部字段，其他领域不发', async ({ page }) => {
    test.setTimeout(180_000)
    const fixture = await buildWritableProject(page, 'G3 记忆线程投影')
    const stub = await startStubModel(guideResponder({
      resultKind: 'chapter-analysis',
      payload: MEMORY_PAYLOAD,
      readyAfter: 1
    }))
    try {
      // 1) 用真实界面在第 1 章「以真实段落埋设」一条伏笔：它才与本章范围真的相关。
      await openModule(page, '记忆与伏笔', '伏笔中心')
      await page.getByRole('button', { name: '新建伏笔' }).click()
      await page.getByLabel('新伏笔名称').fill(FORESHADOW_TITLE)
      const created = projectPut(page, fixture.id)
      await page.getByRole('button', { name: '新建伏笔' }).click()
      expect((await created).status()).toBe(200)
      await page.getByLabel('证据来源').selectOption('prose')
      await page.getByLabel('证据所在章').selectOption(fixture.chapterId)
      const recorded = projectPut(page, fixture.id)
      await page.getByRole('button', { name: '记录埋设' }).click()
      expect((await recorded).status()).toBe(200)
      await expect.poll(async () => {
        const project = await readProject(fixture, page)
        return (project.plotThreads as Array<{ title: string; status: string }> ?? [])
          .some((thread) => thread.title === FORESHADOW_TITLE && thread.status === '已埋设')
      }, { message: '伏笔必须以真实段落埋设进项目文档', timeout: 15_000 }).toBe(true)

      // 2) 再录一条「永不发送」的词条作为禁止内容标记。
      await buildWorldFacts(page, fixture, { name: FORBIDDEN_ENTRY, summary: FORBIDDEN_SUMMARY, visibility: '永不发送' })

      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

      // 3) 反向控制一：先真的发一次**其他领域**（大纲）的请求，它的上下文不得多出线程投影。
      const jsonHeaders = { ...fixture.headers, 'Content-Type': 'application/json' }
      const outlineStart = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-guides/start`, {
        headers: jsonHeaders,
        data: { domain: 'outline', target: { kind: 'outline', projectId: fixture.id } }
      })
      expect(outlineStart.status(), await outlineStart.text()).toBe(201)
      const outlineContext = contextOfDomain(stub, 'outline', 'outline')
      expect(Object.hasOwn(outlineContext, 'threadLedger'), '非记忆领域不得多出记忆线程投影').toBe(false)

      // 4) 记忆领域：走真实界面完成一段引导（恒定本章范围）。
      await openModule(page, '记忆与伏笔', '记忆工作台')
      await openGuide(page)
      await startGuide(page)

      const context = contextOfDomain(stub, 'memory', 'chapter')
      expect(context.domain, '出站上下文确实来自记忆领域').toBe('memory')
      expect(context.chapter.id, '记忆上下文指向的必须是目标正文章节').toBe(fixture.chapterId)

      const ledger = context.threadLedger as {
        scope: string
        scopeNote: string
        limit: number
        total: number
        truncated: boolean
        threads: Array<{ title: string; status: string; evidence: Array<{ phase: string; chapterNumber?: number; excerpt: string; status: string }> }>
      }
      expect(ledger && !Array.isArray(ledger), '出站带上的是有界对象投影，不是裸数组').toBeTruthy()
      expect(ledger.scope, '记忆投影恒定本章范围').toBe('chapter')
      expect(ledger.limit, '上限必须在出站上下文里声明，不能让模型以为看过全部伏笔').toBe(10)
      expect(Array.isArray(ledger.threads), '投影条目是数组').toBe(true)
      expect(ledger.threads.length, '条数不超过声明上限').toBeLessThanOrEqual(ledger.limit)
      expect(typeof ledger.total, '计数必须如实给出').toBe('number')
      expect(typeof ledger.truncated, '截断标记必须如实给出').toBe('boolean')

      const serialized = JSON.stringify(ledger)
      expect(serialized.length, '整份投影（含外壳）必须始终有界').toBeLessThanOrEqual(6_000)
      for (const field of ['evidencePool', 'revisionHistory', 'otherCharacters', 'assessedAt']) {
        expect(serialized, `投影不得含内部字段名 ${field}`).not.toContain(field)
      }

      // 本章真实埋设的伏笔必须出现在投影里，且证据带生效 / 失效状态与真实摘录。
      expect(ledger.threads.map((item) => item.title), '本章真实埋设的伏笔必须出现在投影里').toEqual([FORESHADOW_TITLE])
      const projected = ledger.threads.find((item) => item.title === FORESHADOW_TITLE)!
      expect(projected.evidence.length, '有界：每条最多三条证据').toBeLessThanOrEqual(3)
      expect(projected.evidence[0]!.phase).toBe('埋设')
      expect(projected.evidence[0]!.status, '证据必须携带生效 / 失效状态').toBeTruthy()
      expect(projected.evidence[0]!.excerpt, '证据必须是正文真实摘录').toContain('林砚在旧城发现古钟')

      // 5) 反向控制二：禁止内容一个字都不出站（整份记录，不只这一段上下文）。
      expect(allOutbound(stub), '「永不发送」的词条绝不能进入任何一次出站请求').not.toContain(FORBIDDEN_ENTRY)
      expect(allOutbound(stub), '「永不发送」的词条摘要同样不出站').not.toContain(FORBIDDEN_SUMMARY)

      // 6) 结果写入边界不变：仍然只排章节分析任务。
      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()
      await expect(page.getByTestId('guide-result')).toBeVisible()
      await expect(page.getByTestId('guide-result-ref')).toContainText('任务')
    } finally {
      await stub.close()
    }
  })
})

/** 越权载荷与旧路由：模型给什么、结果落到哪里，最终由服务端说了算。 */
test.describe('安全边界与旧路由兼容', () => {
  test('模型伪造词条主键会被直接拒：身份只能由服务端分配，正式世界观一个字不动', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = await buildWritableProject(page, '引导伪造主键')
    const stub = await startStubModel(guideResponder({
      resultKind: 'world-setting-proposal',
      payload: WORLD_PAYLOAD_WITH_FORGED_ID,
      readyAfter: 1,
      questions: [{ id: 'w-1', focus: '世界规则的兜底', text: '这座钟的代价由谁承担？', options: ['由城市承担', '由巡夜人承担', '由后来读到这段记录的人承担'] }]
    }))
    try {
      await buildWorldFacts(page, fixture)
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '世界观', '世界总览')
      await openGuide(page)
      await startGuide(page)
      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()

      await expect(page.getByTestId('guide-error')).toBeVisible()
      await expect(page.getByTestId('guide-result')).toHaveCount(0)
      const proposals = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/setting-proposals`, { headers: fixture.headers })).json()
      expect(proposals, '带伪造主键的提案不得落盘').toHaveLength(0)
      const after = await readProject(fixture, page)
      expect(after.worldBible.entries, '正式世界观一个字都不动').toEqual(before.worldBible.entries)
      expect(after.revision, '被拒的生成不得改动正式项目版本').toBe(before.revision)
    } finally {
      await stub.close()
    }
  })

  test('越权结果类型：模型回了不属于本领域的结果，服务端拒绝且正式内容一个字不动', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = await buildWritableProject(page, '引导越权结果')
    // 桩故意在「大纲」领域回一个只有交付领域才允许的结果类型。
    const stub = await startStubModel(guideResponder({
      resultKind: 'export-precheck',
      payload: { format: 'md' },
      readyAfter: 1
    }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      const before = await readProject(fixture, page)
      await openModule(page, '小说大纲', '创作起点')
      await openGuide(page)
      await startGuide(page)
      await skipToReady(page, 1)
      await page.getByTestId('guide-complete').click()

      // 如实报错，并且什么都不落：既没有结果视图，也没有草稿、候选或正式内容变化。
      await expect(page.getByTestId('guide-error')).toBeVisible()
      await expect(page.getByTestId('guide-result')).toHaveCount(0)
      const drafts = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, { headers: fixture.headers })).json()
      expect(drafts, '越权结果不得落成草稿').toHaveLength(0)
      const proposals = await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}/revision-proposals`, { headers: fixture.headers })).json()
      expect(proposals, '越权结果不得落成候选').toHaveLength(0)
      const after = await readProject(fixture, page)
      expect(after.outline.synopsis, '越权结果不得写进正式大纲').toBe(before.outline.synopsis)
      expect(after.revision, '越权结果不得改动正式项目版本').toBe(before.revision)
    } finally {
      await stub.close()
    }
  })

  test('自由创作仍然走旧的创作对话路由：发送是真实请求，切到引导再切回来未发送的草稿不丢', async ({ page }) => {
    test.setTimeout(150_000)
    const fixture = await buildWritableProject(page, '引导自由创作路由')
    const stub = await startStubModel(guideResponder({ candidate: OUTLINE_CANDIDATE, readyAfter: 3 }))
    try {
      await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
      await openModule(page, '小说大纲', '创作起点')
      await ensureFreeCreation(page)

      // 切到引导构建再切回来：没发送的草稿还在（两种模式共用同一块输入区，但状态各归各的）。
      const input = page.locator('#mojing-dock-input')
      await input.fill('这段还没发送，切模式不能丢。')
      await page.getByTestId('free-switch-guide').click()
      await expect(page.getByTestId('guided-assistant-panel')).toBeVisible()
      await page.getByTestId('guide-switch-free').click()
      await expect(page.locator('#mojing-dock-input')).toHaveValue('这段还没发送，切模式不能丢。')

      // 发送：走的仍是旧的创作对话接口，而不是引导协议。
      await input.fill('帮我把第三幕的冲突再收紧一点。')
      const sent = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/creative-chat'))
      const responded = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/creative-chat'))
      await page.getByRole('button', { name: '发送' }).click()
      const request = await sent
      expect(new URL(request.url()).pathname, '自由创作走的仍是旧的创作对话接口').toBe(`/api/novels/${fixture.id}/creative-chat`)
      await responded
      // 发送真的走到了模型（失败重发之类的次数不在这里钉死），而且**没有一次**是引导协议。
      await expect.poll(() => stub.calls.length, { message: '自由创作的发送真的到了模型' }).toBeGreaterThan(0)
      expect(
        stub.calls.map((raw) => guideActionOf(raw)).filter((action) => action !== undefined),
        '自由创作的模型请求都不是引导协议'
      ).toEqual([])
    } finally {
      await stub.close()
    }
  })
})

test.describe('右栏布局与可达性（1120 / 1500 × 暖纸 / 夜墨）', () => {
  for (const viewport of [{ width: 1120, height: 900 }, { width: 1500, height: 940 }]) {
    test(`${viewport.width}×${viewport.height}：助手常驻 360、不横向溢出、长文案换行、按钮可达、键盘可用`, async ({ page }) => {
      test.setTimeout(150_000)
      const fixture = await buildWritableProject(page, `引导布局${viewport.width}`)
      const stub = await startStubModel(guideResponder({
        candidate: OUTLINE_CANDIDATE,
        readyAfter: 3,
        questions: [{
          id: 'q-1',
          focus: '一个很长的问题焦点，用来验证助手栏里的长文案会换行而不是把整页撑开',
          text: `第一个问题故意写得比较长：${LONG_REASON}`,
          options: [`选项甲：${LONG_REASON}`, `选项乙：${LONG_REASON}`, `选项丙：${LONG_REASON}`]
        }]
      }))
      try {
        await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)
        await page.setViewportSize(viewport)
        await openModule(page, '小说大纲', '创作起点')

        for (const theme of ['暖纸', '夜墨'] as const) {
          if (theme === '夜墨') await page.locator('.mjp-rail').getByRole('button', { name: '切换到夜墨' }).click()
          await openGuide(page)
          const dock = page.locator('.mjp-dock')
          await expect(dock).toBeVisible()
          expect(Math.round(await dock.evaluate((element) => element.getBoundingClientRect().width)), `${theme}：助手固定 360`).toBe(360)

          // 第一次循环里已经把引导推进到提问态；第二次循环直接复用同一段会话。
          if (theme === '暖纸') {
            await startGuide(page)
          } else {
            await expect(page.getByTestId('guide-question')).toBeVisible()
          }

          // 长问题、长选项、长理由都必须换行，不能让助手栏自己出现横向滚动。
          await expect(page.getByTestId('guide-question')).toBeVisible()
          expect(await dock.evaluate((element) => element.scrollWidth <= element.clientWidth + 2), `${theme}：助手栏内部不横向滚动`).toBe(true)
          for (const option of await page.getByTestId('guide-option').all()) {
            expect(await option.evaluate((element) => element.scrollWidth <= element.clientWidth + 2), `${theme}：长选项换行`).toBe(true)
          }

          /*
           * 开始/继续/跳过三个动作必须**可达**，不是「零滚动可见」：
           * 三行各 140 多字的超长选项本来就会把动作推到折叠线下方，
           * 助手栏该做的是能纵向滚到它们（下面是 `overflow:hidden` 就会失败），而不是把内容压扁。
           */
          const submitAction = page.getByTestId('guide-submit-option')
          await submitAction.scrollIntoViewIfNeeded()
          await expect(submitAction).toBeInViewport()
          await expect(page.getByTestId('guide-skip')).toBeInViewport()
          await expect(page.getByTestId('guide-skip')).toBeEnabled()

          // 键盘可达且**有意义**：用键盘选中一个选项后，「确认这个方向」才可用。
          const submit = page.getByTestId('guide-submit-option')
          // 第一次循环时还没选过，提交必须是禁用的（换主题不会把作者的选择弄丢，所以只断言一次）。
          if (theme === '暖纸') expect(await submit.isDisabled(), `${theme}：没选之前不能提交`).toBe(true)
          const radio = page.getByTestId('guide-option').first().locator('input[type="radio"]')
          await radio.focus()
          await expect.poll(() => radio.evaluate((element) => element === document.activeElement), { message: `${theme}：选项可以通过键盘获得焦点` }).toBe(true)
          await page.keyboard.press('Space')
          await expect(radio).toBeChecked()
          await expect(submit, `${theme}：键盘选中之后就能提交`).toBeEnabled()

          await assertNoViewportOverflow(page, `${theme} 引导提问态`)
        }
      } finally {
        await stub.close()
      }
    })
  }
})
