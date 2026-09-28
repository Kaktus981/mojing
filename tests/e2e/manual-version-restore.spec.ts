import { expect, test, type Page } from '@playwright/test'

/**
 * M8 · 统一安全恢复（Edge 隔离 E2E）。
 *
 *   npm run test:e2e -- tests/e2e/manual-version-restore.spec.ts
 *
 * 全程通过产品界面操作；恢复前后都用 GET 复核真实落库结果。
 * 事务中途失败的回滚由 packages/core/src/novelVersionRestore.test.ts 用真实数据库注入验证。
 */

const canvas = (page: Page) => page.locator('.mjp-canvas-scroll')
const title = (page: Page) => page.locator('.mjp-view-head .title')
const prose = (page: Page) => page.locator('.mjp-prose .para')

type ServerProject = { revision: number; chapters: Array<{ id: string; blocks: Array<{ id: string; text: string }> }> }

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

async function openProject(page: Page, prefix: string): Promise<{ origin: string; id: string; headers: Record<string, string>; title: string }> {
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
  return { origin, id, headers, title: projectTitle }
}

/** 刷新页面后从大厅重新打开同一个项目 —— 用于验证「恢复真的落库了」。 */
async function reopenProject(page: Page, projectTitle: string): Promise<void> {
  await page.reload()
  await page.locator('.mjp-hall-project', { hasText: projectTitle }).first().getByRole('button', { name: /^打开：/ }).click()
  await expect(page.locator('.mjp-body.is-docked')).toBeVisible()
}

/** 建一章并写下正文。 */
async function buildChapter(page: Page, id: string, text: string): Promise<void> {
  const createdOutline = projectPut(page, id)
  await page.getByRole('button', { name: '创建空白大纲' }).click()
  await createdOutline
  const addedVolume = projectPut(page, id)
  await page.getByRole('button', { name: '新增第一卷' }).click()
  await addedVolume
  await openModule(page, '小说大纲', '章节规划')
  const created = projectPut(page, id)
  await page.getByRole('button', { name: '新建章节规划' }).click()
  await created
  const named = projectPut(page, id)
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('古钟初鸣')
  await named
  const body = projectPut(page, id)
  await page.getByRole('button', { name: '开始写作' }).click()
  await body
  const saved = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.type(text)
  await saved
}

test('检查点可用自定义名称，恢复必须先预览差异再事务提交', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers, title: projectTitle } = await openProject(page, 'M8 恢复')
  await buildChapter(page, id, '第一版正文')

  // 1) 自定义命名的检查点
  await openModule(page, '审稿与导出', '版本历史')
  await page.getByLabel('检查点名称').fill('定稿前')
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/checkpoints')
  )
  await page.getByRole('button', { name: '以这个名称创建检查点' }).click()
  expect((await created).status()).toBe(201)

  const versionsResponse = await page.request.get(`${origin}/api/novels/${id}/versions`, { headers })
  const versions = (await versionsResponse.json()) as Array<{ id: string; revision: number; reason: string }>
  const checkpoint = versions.find((version) => version.reason === '定稿前')!
  expect(checkpoint, '自定义名称必须原样成为快照 reason').toBeTruthy()
  const checkpointRevision = checkpoint.revision

  // 2) 改正文，制造与快照的差异
  await openModule(page, '正文创作', '正文编辑')
  const edited = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('第二版正文')
  await edited
  await expect(page.locator('.mjp-save-state').first()).toContainText('已保存')

  const beforeRestore = await readProject(page, origin, id, headers)
  expect(beforeRestore.chapters[0]!.blocks[0]!.text).toBe('第二版正文')

  // 3) 选中快照 → 预览差异 → 确认恢复
  await openModule(page, '审稿与导出', '版本历史')
  await page.locator('.mjp-jump', { hasText: `版本 ${checkpointRevision}` }).first().click()

  const restoreRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/restore')) restoreRequests.push(request.url())
  })

  await expect(page.getByRole('button', { name: '确认恢复到此版本' }), '未预览前不得提交').toBeDisabled()
  const previewResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/restore-preview')
  )
  await page.getByRole('button', { name: '预览差异' }).click()
  expect((await previewResponse).status()).toBe(200)
  await expect(canvas(page)).toContainText('差异预览')
  await expect(canvas(page)).toContainText('正文')

  const restoreResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/restore')
  )
  await page.getByRole('button', { name: '确认恢复到此版本' }).click()
  expect((await restoreResponse).status()).toBe(200)

  const afterRestore = await readProject(page, origin, id, headers)
  expect(afterRestore.chapters[0]!.blocks[0]!.text, '正文回到快照内容').toBe('第一版正文')
  expect(afterRestore.revision, 'revision 只前进，不倒退成历史版本号').toBe(beforeRestore.revision + 1)

  const versionsAfter = await page.request.get(`${origin}/api/novels/${id}/versions`, { headers })
  const list = (await versionsAfter.json()) as Array<{ reason: string }>
  expect(list.some((version) => version.reason === `恢复前：第 ${checkpointRevision} 版`), '恢复前当前稿进入版本历史').toBe(true)
  expect(restoreRequests, '一次恢复只提交一次').toHaveLength(1)

  // 4) 恢复成功后预览作废，不能重复执行
  await expect(canvas(page)).toContainText('③ 差异预览')
  expect(restoreRequests, '重复点击不会再发请求').toHaveLength(1)

  // 5) 刷新页面重开项目：界面显示的仍是恢复后的内容（确认不是前端假象）
  await reopenProject(page, projectTitle)
  await openModule(page, '正文创作', '正文编辑')
  await expect(prose(page).first(), '刷新重开后正文仍是恢复后的结果').toContainText('第一版正文')

  console.log(`[M8 恢复] 检查点「定稿前」(第 ${checkpointRevision} 版) → 预览差异 → 恢复后正文=「${afterRestore.chapters[0]!.blocks[0]!.text}」revision ${beforeRestore.revision} → ${afterRestore.revision}，并留下恢复前快照；/restore 请求=1；刷新重开内容一致`)
})

test('预览过期后不能再提交：当前稿变化会让确认恢复重新变成不可用', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id } = await openProject(page, 'M8 过期预览')
  await buildChapter(page, id, '第一版正文')

  await openModule(page, '审稿与导出', '版本历史')
  await page.getByLabel('检查点名称').fill('基线')
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/checkpoints')
  )
  await page.getByRole('button', { name: '以这个名称创建检查点' }).click()
  await created

  await page.locator('.mjp-jump', { hasText: '基线' }).first().click()
  const preview = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/restore-preview')
  )
  await page.getByRole('button', { name: '预览差异' }).click()
  await preview
  await expect(page.getByRole('button', { name: '确认恢复到此版本' })).toBeEnabled()
  await expect(canvas(page)).toContainText('可恢复')

  // 预览之后继续改正文：预览与当前稿不再匹配
  await openModule(page, '正文创作', '正文编辑')
  const edited = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('预览之后又改了')
  await edited
  await expect(page.locator('.mjp-save-state').first()).toContainText('已保存')

  const restoreRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/restore')) restoreRequests.push(request.url())
  })

  await openModule(page, '审稿与导出', '版本历史')
  await page.locator('.mjp-jump', { hasText: '基线' }).first().click()
  await expect(canvas(page), '契约判定为预览已过期').toContainText('预览已过期')
  await expect(page.getByRole('button', { name: '确认恢复到此版本' }), '过期预览不得提交').toBeDisabled()
  expect(restoreRequests).toHaveLength(0)

  console.log('[M8 过期预览] 预览后改动正文 → 状态=预览已过期、确认恢复不可用、/restore 请求=0')
})

test('切换目标版本后旧预览立即失效：不能拿 A 的预览去恢复 B', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { id } = await openProject(page, 'M8 切换目标')
  await buildChapter(page, id, '第一版正文')

  // 两条检查点：基线A（第一版内容）与基线B（第二版内容）
  await openModule(page, '审稿与导出', '版本历史')
  await page.getByLabel('检查点名称').fill('基线A')
  const first = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/checkpoints'))
  await page.getByRole('button', { name: '以这个名称创建检查点' }).click()
  expect((await first).status()).toBe(201)

  await openModule(page, '正文创作', '正文编辑')
  const edited = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('第二版正文')
  await edited
  await expect(page.locator('.mjp-save-state').first()).toContainText('已保存')

  await openModule(page, '审稿与导出', '版本历史')
  await page.getByLabel('检查点名称').fill('基线B')
  const second = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/checkpoints'))
  await page.getByRole('button', { name: '以这个名称创建检查点' }).click()
  expect((await second).status()).toBe(201)

  const restoreRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/versions\/[^/]+\/restore$/.test(new URL(request.url()).pathname)) restoreRequests.push(request.url())
  })

  // 选中并预览「基线A」：选中与预览同源 → 可恢复
  await page.locator('.mjp-jump', { hasText: '基线A' }).first().click()
  const preview = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/restore-preview'))
  await page.getByRole('button', { name: '预览差异' }).click()
  expect((await preview).status()).toBe(200)
  await expect(page.getByRole('button', { name: '确认恢复到此版本' })).toBeEnabled()
  await expect(canvas(page)).toContainText('可恢复')

  // 切换到「基线B」：A 的预览不再属于当前选中
  await page.locator('.mjp-jump', { hasText: '基线B' }).first().click()
  await expect(canvas(page), '切换选中后契约判定为预览缺失').toContainText('预览缺失')
  await expect(canvas(page), '旧预览被明确标注不属于当前快照').toContainText('这条预览属于另一条快照')
  await expect(page.getByRole('button', { name: '确认恢复到此版本' }), '不得拿 A 的预览去恢复 B').toBeDisabled()
  expect(restoreRequests, '切换目标版本不产生任何恢复请求').toHaveLength(0)

  console.log('[M8 切换目标] 预览基线A→可恢复；切到基线B→预览缺失 + 旧预览标注无效 + 确认恢复禁用 + /restore=0')
})

test('恢复请求失败时当前内容不变，且旧预览必须重新预览', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 940 })
  const { origin, id, headers } = await openProject(page, 'M8 恢复失败')
  await buildChapter(page, id, '第一版正文')

  await openModule(page, '审稿与导出', '版本历史')
  await page.getByLabel('检查点名称').fill('基线')
  const created = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/checkpoints'))
  await page.getByRole('button', { name: '以这个名称创建检查点' }).click()
  await created

  await openModule(page, '正文创作', '正文编辑')
  const edited = projectPut(page, id)
  await page.locator('.mjp-prose .para').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('第二版正文')
  await edited
  await expect(page.locator('.mjp-save-state').first()).toContainText('已保存')

  await openModule(page, '审稿与导出', '版本历史')
  await page.locator('.mjp-jump', { hasText: '基线' }).first().click()
  const preview = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().includes('/restore-preview'))
  await page.getByRole('button', { name: '预览差异' }).click()
  await preview
  await expect(canvas(page)).toContainText('可恢复')

  const restoreRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/versions\/[^/]+\/restore$/.test(new URL(request.url()).pathname)) restoreRequests.push(request.url())
  })
  // 只在浏览器侧注入本次恢复失败 —— 当前内容绝不能因此改变
  await page.route(/\/versions\/[^/]+\/restore$/, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INJECTED_RESTORE_FAILURE', message: '服务端拒绝了这次恢复（E2E 注入）' } })
    })
  )

  await page.getByRole('button', { name: '确认恢复到此版本' }).click()
  await expect(page.locator('.mjp-toast.is-error'), '失败必须如实报错，不伪装成功').toContainText('服务端拒绝了这次恢复')
  await expect(canvas(page), '失败后预览作废，必须重新预览').toContainText('预览缺失')
  await expect(page.getByRole('button', { name: '确认恢复到此版本' }), '失败后确认恢复回到禁用').toBeDisabled()

  const afterFailure = await readProject(page, origin, id, headers)
  expect(afterFailure.chapters[0]!.blocks[0]!.text, '恢复失败时当前正文必须原样不动').toBe('第二版正文')
  expect(restoreRequests, '失败后按钮禁用，不会再发第二次恢复').toHaveLength(1)

  console.log(`[M8 恢复失败] 注入 /restore 500 → 服务端正文仍=「${afterFailure.chapters[0]!.blocks[0]!.text}」，预览作废、按钮禁用、/restore=1`)
})
