import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule, type ManualFixture } from './helpers/manual-workspace'
import { ensureFreeCreation } from './helpers/workspace-ui'

/**
 * P01 隔离验收（D1/D5）：作用域是服务端重算的，不是客户端声明的。
 *
 * 全部走真实隔离 API：项目用 UI 建立，不用 `page.route` 伪造项目数据。
 * 本文件所在的 `shared` 批次共用一个库，而套件里的 `assistant-capability-mounting.spec.ts`
 * 会向该库写入模型服务配置（产品只有新增/覆盖、没有删除通道）。因此原先两条「必须没有模型服务」
 * 的断言**已迁到 `assistant-scope-empty-config.spec.ts`**，跑在独立 project `scope` 的独立空库上；
 * 本文件剩下的用例不依赖模型配置的有无。两条用例的断言与文案一字未改，只换了所属 project。
 *
 * 2026-09-17 Task 9 迁移：右栏按「引导构建 / 自由创作」分流后，**有精确目标**的作用域
 * 第一次进入会出现模式选择页，自由创作的面板此时不渲染。需要聊天 / 准备度 / 候选面板的
 * 断言，一律先用 `ensureFreeCreation(page)` 走一次真实选择（选择本身不发送任何请求）。
 * 业务断言一条都没有删除。
 */

/**
 * 走真实接口在「创作起点」作用域建一份草稿（服务端同时会追加一条候选记录）。
 *
 * 草稿 ID 是全局唯一的随机串（`assistantCandidates.saveAssistantDraft`），归属只由
 * 「项目 + 作用域 + 任务类型」决定。所以同一隔离库里**两个不同项目**用同一个作用域、
 * 同一个任务类型建草稿是正常业务输入，不需要换任务类型来绕开。
 */
async function createStoryCoreDraft(fixture: ManualFixture, page: import('@playwright/test').Page, summary: string): Promise<void> {
  const created = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      target: { kind: 'story-core', projectId: fixture.id },
      taskType: '引导构建', stage: 'outline', sourceDigest: 'e2e-late-response', summary,
      changes: [{ kind: 'story-core', seed: '巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。', direction: '旧城记忆线' }]
    }
  })
  expect(created.status(), await created.text()).toBe(201)
}

/**
 * P01 直证：迟到的旧作用域响应必须被令牌丢掉（`stillCurrent`），不得落到新目标上。
 *
 * 这里不是「切换时不发请求」，而是**让请求发出去、再故意拖慢**：
 * 作者在响应回来之前就换了目标，旧响应回来时已经不属于当前作用域。
 */
test('旧作用域的迟到草稿响应不落到新作用域上', async ({ page }) => {
  const fixture = await buildWritableProject(page, '助手迟到草稿')
  await createStoryCoreDraft(fixture, page, '故事核心候选：旧城记忆线')

  // 先站在新作用域（世界总览）：这一刻它确实什么都没有。
  await openModule(page, '世界观', '世界总览')
  await ensureFreeCreation(page)
  const panel = page.getByTestId('candidate-panel')
  await expect(panel).toHaveCount(0)

  // 把「创作起点」作用域上的草稿与候选记录读取人为拖慢。
  //
  // ⚠️ 这里用**开关**而不是 `page.unroute` 结束拖慢：`unroute` 会把仍在延迟中的路由兜底放行
  // （`Route.removeHandler` → `continue({isFallback:true})`），随后这个 handler 再 `fulfill`
  // 就是二次处理，会抛 "Route is already handled!" 并把用例判成失败（虽然断言其实都过了）。
  // 换成开关后，已经发出的请求照常延迟返回，之后的新请求不再延迟，收尾干净。
  const slowScope = /assistant-(drafts|candidate-records)/
  let delayStoryCore = true
  await page.route(slowScope, async (route) => {
    const url = new URL(route.request().url())
    if (delayStoryCore && route.request().method() === 'GET' && url.searchParams.get('scopeKey') === 'story-core:') {
      const response = await route.fetch()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.fulfill({ response })
      return
    }
    await route.continue()
  })

  // 切到旧作用域（请求已发出但被拖慢），响应没回来就切回世界总览。
  const lateDraftList = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/assistant-drafts') && url.searchParams.get('scopeKey') === 'story-core:'
  })
  await openModule(page, '小说大纲', '创作起点')
  await ensureFreeCreation(page)
  // 换回世界总览：这是一次作用域变化，按批准方案在新作用域重新选一次模式（0 次请求），
  // 否则右栏停在首次选择页，「迟到草稿没串过来」会因为面板压根没渲染而变成空断言。
  await openModule(page, '世界观', '世界总览')
  await ensureFreeCreation(page)
  await lateDraftList

  // 迟到的旧作用域草稿不得挂到新作用域上，历史候选记录也不得串过来。
  await expect(panel, '旧作用域的迟到草稿不能出现在新作用域').toHaveCount(0)
  await page.locator('[data-testid="dock-history-candidates"] summary').click()
  await expect(page.getByTestId('dock-history-list')).toContainText('这个作用域还没有历史候选记录')

  // 对照：回到创作起点，这份草稿确实存在 —— 上面的「没有」是令牌拦截，不是草稿不存在。
  delayStoryCore = false
  await openModule(page, '小说大纲', '创作起点')
  await ensureFreeCreation(page)
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('故事核心候选：旧城记忆线')
})

/** 在「总纲与卷纲」作用域（scopeKey = `outline:`）建一份草稿：与故事核心是两个不同的作用域。 */
async function createOutlineScopeDraft(fixture: ManualFixture, page: import('@playwright/test').Page, summary: string): Promise<void> {
  const created = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts`, {
    headers: { ...fixture.headers, 'Content-Type': 'application/json' },
    data: {
      target: { kind: 'outline', projectId: fixture.id },
      taskType: '局部修改', stage: 'outline', sourceDigest: 'e2e-late-preview', summary,
      changes: [{
        kind: 'outline',
        synopsis: '总纲：巡夜人发现旧城的潮汐钟正在改写人们对昨天的记忆。',
        mainConflict: '记忆可以被改写，但潮位记录不会',
        endingDirection: '修好预警体系，代价是有人必须记得全部真相'
      }]
    }
  })
  expect(created.status(), await created.text()).toBe(201)
}

/**
 * P01 直证（差异预览这一路，与上面的草稿列表、本次使用配置是三条不同的请求）：
 * 旧作用域那份**差异预览**还在飞的时候作者换了目标，迟到的响应不得：
 * 把旧差异挂到新作用域的草稿上、把新作用域的采用按钮点亮、或改写作者当前输入。
 *
 * 两个作用域**各自都有一份真实草稿**，所以「没有串过来」不是因为新作用域本来就没草稿。
 */
test('旧作用域迟到的差异预览不落到新作用域的草稿上，目标、预览与输入都不被污染', async ({ page }) => {
  const fixture = await buildWritableProject(page, '助手迟到差异预览')
  // 正常业务输入：与上一用例（不同项目）同作用域、同任务类型，草稿 ID 全局唯一所以不会撞。
  await createStoryCoreDraft(fixture, page, '故事核心作用域的草稿')
  await createOutlineScopeDraft(fixture, page, '总纲作用域的草稿')

  // 旧作用域：创作起点（story-core:），它自己就有一份草稿。
  await openModule(page, '小说大纲', '创作起点')
  await ensureFreeCreation(page)
  await expect(page.getByTestId('candidate-panel')).toContainText('故事核心作用域的草稿')

  // 拖慢这一份草稿的差异预览读取。
  await page.route('**/assistant-drafts/*/preview', async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({ response })
  })

  await page.locator('#mojing-dock-input').fill('作者在当前作用域打的字')
  const latePreview = page.waitForResponse(
    (response) => response.url().includes('/assistant-drafts/') && response.url().endsWith('/preview')
  )
  await page.getByTestId('candidate-preview').click()

  // 响应还在飞，作者就换到「总纲与卷纲」（outline:）——这一页自己也有一份草稿。
  await openModule(page, '小说大纲', '总纲与卷纲')
  await ensureFreeCreation(page)
  await latePreview

  // 1) 草稿没串：新作用域显示的是它自己的那一份。
  const panel = page.getByTestId('candidate-panel')
  await expect(panel).toContainText('总纲作用域的草稿')
  await expect(panel).not.toContainText('故事核心作用域的草稿')
  // 2) 预览没串：迟到的旧差异没有被接纳，所以采用仍然是「没有有效预览」的不可用状态。
  await expect(page.getByTestId('candidate-adopt')).toBeDisabled()
  // 3) 当前目标与 4) 作者输入都没有被旧响应改写。
  await expect(page.getByTestId('assistant-target'), '当前目标仍是新作用域，没被旧响应改回去').toHaveText('总纲与卷纲')
  await expect(page.locator('#mojing-dock-input')).toHaveValue('作者在当前作用域打的字')

  // 对照：新作用域自己点一次「查看差异」就能拿到自己的预览——上面的「不可用」是令牌拦截，不是能力缺失。
  await page.unroute('**/assistant-drafts/*/preview')
  await page.getByTestId('candidate-preview').click()
  await expect(page.getByTestId('candidate-adopt')).toBeEnabled()
})

/** P01 直证：旧作用域那条还在飞的「本次使用」读取，不得把新作用域卡在加载态。 */
test('在途的配置读取不会把新作用域卡在「正在读取」上', async ({ page }) => {
  await buildWritableProject(page, '助手在途配置')
  await openModule(page, '小说大纲', '创作起点')
  // 「本次使用」只属于自由创作这一路，引导态不渲染它：先按真实 UI 选一次自由创作。
  await ensureFreeCreation(page)

  // 拖慢「本次使用」的读取：作者不等它回来就换目标。
  await page.route('**/assistant-runs/preview', async (route) => {
    const response = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({ response })
  })
  const latePreview = page.waitForResponse((response) => response.url().includes('/assistant-runs/preview'))
  const usageToggle = page.getByRole('button', { name: /本次使用/ })
  await usageToggle.click()
  await expect(page.getByTestId('assistant-usage')).toContainText('正在读取本次配置')

  await openModule(page, '世界观', '世界总览')
  await latePreview
  /**
   * Task 9 迁移：换栏目就是换了一个精确作用域，右栏按批准方案重新选一次模式
   * （上一个作用域的选择不跨域沿用）。先走完这一步，再断言「本次使用」没有被旧作用域
   * 的读取继续撑着 —— 业务意图（切了作用域必须收起、且不能停在加载态）一字未改。
   */
  await ensureFreeCreation(page)

  // 新作用域既不能显示旧作用域的读取中，也不能停在展开的空面板上。
  await expect(page.getByTestId('assistant-usage')).toHaveCount(0)
  await expect(usageToggle, '切了作用域就要收起本次使用，让作者按需重新读取').toHaveAttribute('aria-expanded', 'false')

  // 重新读取拿到的是新作用域自己的配置，不是旧作用域的残留。
  await usageToggle.click()
  const usage = page.getByTestId('assistant-usage')
  await expect(usage).toContainText('读取')
  await expect(usage).toContainText('可写')
  await expect(usage).not.toContainText('正在读取本次配置')
})

/**
 * D3 直证：草稿归属只由「项目 + 作用域 + 任务类型」决定，主键是**全局唯一 ID**。
 *
 * 两个项目在**同一作用域、同一任务类型**下各自开工，这是正常业务输入，不是边界用例：
 * 既不能撞主键，也不能串稿。生成 / 编辑 / 刷新 / 采用四条路都要各自走通。
 */
test('两个项目在同一作用域与任务类型下都能生成、编辑、刷新、采用，且互不串稿', async ({ page }) => {
  /*
   * 本用例是本文件里唯一的重活：建两个项目、各造一份草稿、两次 `page.reload()` 重进项目、
   * 再走编辑 / 预览 / 采用 / 重新生成四条路。实测**用例体只需约 18.7s 就全部断言通过**，
   * 但收尾阶段 `Close context` 很慢（本机磁盘压力 + 浏览器 profile 落盘）：
   * 同一用例曾出现「通过，总耗时 46.2s」与「超时，总耗时 48.7s」两种结果 ——
   * 差异全在收尾，正好骑在 Playwright 的默认 teardown 预算上
   * （Playwright 用**用例自身的 timeout** 作为 fixture 拆除的上限，
   * 超时报文即 `Tearing down "context" exceeded the test timeout of …ms`
   * —— 出这条报错时全局默认 `timeout` 还是 30_000，现已在 `playwright.config.ts` 统一抬到 120_000）。
   *
   * 这条用例**不再单独声明超时预算**：同类 teardown 超时在别的长用例上同样存在，
   * 逐条打补丁治不了根，因此统一由 `playwright.config.ts` 的全局 `timeout: 120_000` 覆盖
   * （推导见该文件里的注释）。这里只保留成因说明，不改变任何断言。
   */
  const first = await buildWritableProject(page, '跨项目草稿甲')
  const second = await buildWritableProject(page, '跨项目草稿乙')

  // 生成：同一个 scopeKey（story-core:）+ 同一个 taskType（引导构建），只有项目不同。
  await createStoryCoreDraft(first, page, '甲项目的故事核心')
  await createStoryCoreDraft(second, page, '乙项目的故事核心')

  const draftsOf = async (fixture: ManualFixture) => {
    const response = await page.request.get(
      `${fixture.origin}/api/novels/${fixture.id}/assistant-drafts?scopeKey=${encodeURIComponent('story-core:')}`,
      { headers: fixture.headers }
    )
    return (await response.json()) as Array<{ id: string; summary: string; version: number; status: string }>
  }
  const firstDrafts = await draftsOf(first)
  const secondDrafts = await draftsOf(second)
  expect(firstDrafts, '每个项目在同一作用域只该有一份工作草稿').toHaveLength(1)
  expect(secondDrafts).toHaveLength(1)
  expect(firstDrafts[0]!.summary).toBe('甲项目的故事核心')
  expect(secondDrafts[0]!.summary).toBe('乙项目的故事核心')
  expect(firstDrafts[0]!.id, '草稿 ID 必须全局唯一，两个项目不可能共用同一份').not.toBe(secondDrafts[0]!.id)
  // 归属按项目解析：拿乙的草稿 ID 去甲的项目里读，读不到。
  const crossRead = await page.request.get(
    `${first.origin}/api/novels/${first.id}/assistant-drafts/${secondDrafts[0]!.id}/preview`,
    { headers: first.headers }
  )
  expect(crossRead.status(), '跨项目草稿既读不到也采用不了').toBe(404)

  // 编辑：各自改各自的草稿，互不影响。
  const edit = async (fixture: ManualFixture, draftId: string, version: number, summary: string) => {
    const response = await page.request.put(`${fixture.origin}/api/novels/${fixture.id}/assistant-drafts/${draftId}`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: { version, summary, changes: [{ kind: 'story-core', seed: summary, direction: '作者手改的方向' }] }
    })
    expect(response.status(), await response.text()).toBe(200)
  }
  await edit(first, firstDrafts[0]!.id, firstDrafts[0]!.version, '甲项目手改后的故事核心')
  await edit(second, secondDrafts[0]!.id, secondDrafts[0]!.version, '乙项目手改后的故事核心')
  expect((await draftsOf(first))[0]!.summary).toBe('甲项目手改后的故事核心')
  expect((await draftsOf(second))[0]!.summary).toBe('乙项目手改后的故事核心')

  // 刷新：重开两个项目，各自看到的是自己的那一份。
  const openProject = async (prefix: string, expected: string, forbidden: string) => {
    await page.reload()
    await page.locator('.mjp-hall-project').filter({ hasText: prefix }).first().getByRole('button', { name: /^打开：/ }).click()
    await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
    await openModule(page, '小说大纲', '创作起点')
    // 刷新之后本项目这个作用域的模式偏好（localStorage）仍在；这里走一次真实选择，兜住
    // 「这个项目在创作起点还没选过模式」的情况，选择本身不发请求、也不影响草稿归属。
    await ensureFreeCreation(page)
    const panel = page.getByTestId('candidate-panel')
    await expect(panel, `${prefix} 看到的必须是自己的草稿`).toContainText(expected)
    await expect(panel).not.toContainText(forbidden)
  }
  await openProject('跨项目草稿乙', '乙项目手改后的故事核心', '甲项目手改后的故事核心')
  await openProject('跨项目草稿甲', '甲项目手改后的故事核心', '乙项目手改后的故事核心')

  // 采用：甲采用自己的草稿，只改甲的正式内容；乙的正式内容一个字都不动。
  const seedOf = async (fixture: ManualFixture) =>
    ((await (await page.request.get(`${fixture.origin}/api/novels/${fixture.id}`, { headers: fixture.headers })).json()) as { seed: string }).seed
  const secondSeedBefore = await seedOf(second)
  const preview = await page.request.get(
    `${first.origin}/api/novels/${first.id}/assistant-drafts/${firstDrafts[0]!.id}/preview`, { headers: first.headers }
  )
  const previewBody = (await preview.json()) as { previewDigest: string; version: number; blockers: string[] }
  expect(previewBody.blockers).toEqual([])
  const applied = await page.request.post(
    `${first.origin}/api/novels/${first.id}/assistant-drafts/${firstDrafts[0]!.id}/apply`,
    {
      headers: { ...first.headers, 'Content-Type': 'application/json' },
      data: { expectedVersion: previewBody.version, expectedPreviewDigest: previewBody.previewDigest }
    }
  )
  expect(applied.status(), await applied.text()).toBe(200)
  expect(await seedOf(first)).toBe('甲项目手改后的故事核心')
  expect(await seedOf(second), '乙项目的正式内容不受甲项目采用影响').toBe(secondSeedBefore)

  // 重复生成仍遵守「一份工作草稿 + 可回看历史候选」：乙再生成一次，更新这一份而不是新建第二份。
  const candidatesOf = async (fixture: ManualFixture) => {
    const response = await page.request.get(
      `${fixture.origin}/api/novels/${fixture.id}/assistant-candidate-records?scopeKey=${encodeURIComponent('story-core:')}`,
      { headers: fixture.headers }
    )
    return (await response.json()) as Array<{ summary: string }>
  }
  const candidatesBefore = (await candidatesOf(second)).length
  await createStoryCoreDraft(second, page, '乙项目重新生成的故事核心')
  const secondAgain = await draftsOf(second)
  expect(secondAgain, '重新生成仍然是同一份工作草稿').toHaveLength(1)
  expect(secondAgain[0]!.id).toBe(secondDrafts[0]!.id)
  expect(secondAgain[0]!.summary, '作者手改过的草稿不会被新生成覆盖').toBe('乙项目手改后的故事核心')
  expect((await candidatesOf(second)).length, '新结果作为可回看候选追加一条').toBeGreaterThan(candidatesBefore)
  expect((await draftsOf(first)), '乙的重新生成不碰甲的草稿').toHaveLength(1)
})
