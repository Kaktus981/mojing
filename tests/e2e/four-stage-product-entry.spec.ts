import { expect, test, type Page } from '@playwright/test'

function globalRail(page: Page) {
  return page.getByRole('complementary', { name: '应用窄栏' }).getByRole('navigation')
}

async function expectWidth(locator: ReturnType<Page['locator']>, expected: number): Promise<void> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(expected - 1)
  expect(box!.width).toBeLessThanOrEqual(expected + 1)
}

async function createProjectFromHall(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建小说', exact: true })
  await dialog.getByLabel('小说名称', { exact: true }).fill(title)
  await dialog.getByLabel('最初的故事想法', { exact: true }).fill('巡夜人发现城门每天少一块砖。')
  await dialog.getByRole('button', { name: /^创建/ }).click()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toBeVisible()
}

test('根路径显示项目大厅', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '项目大厅', exact: true })).toBeVisible()
})

test('大厅全局窄栏的设置可返回项目大厅', async ({ page }) => {
  await page.goto('/')

  await globalRail(page).getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByText('应用级配置 · 仅本机生效', { exact: true })).toBeVisible()
  const backToHall = page.getByRole('button', { name: '返回项目大厅', exact: true })
  await expect(backToHall).toBeVisible()
  await backToHall.click()
  await expect(page.getByRole('heading', { name: '项目大厅', exact: true })).toBeVisible()
})

test('新建项目进入工作区', async ({ page }) => {
  const title = `正式入口项目-${Date.now()}`
  await page.goto('/')

  await createProjectFromHall(page, title)
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
})

test('工作区的全局设置返回同一项目工作区', async ({ page }) => {
  const title = `设置返回项目-${Date.now()}`
  await page.goto('/')
  await createProjectFromHall(page, title)

  await globalRail(page).getByRole('button', { name: '设置', exact: true }).click()
  const backToWorkspace = page.getByRole('button', { name: '返回工作区', exact: true })
  await expect(backToWorkspace).toBeVisible()
  await backToWorkspace.click()
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '返回项目大厅', exact: true })).toBeVisible()
})

test('真实正文编辑保存后可经隔离 API 重新打开，并保留候选确认界面', async ({ page }) => {
  const title = `正文持久化项目-${Date.now()}`
  const body = `这是隔离持久化验证正文-${Date.now()}`
  await page.goto('/')
  await createProjectFromHall(page, title)

  await page.getByRole('button', { name: '正文创作', exact: true }).click()
  await page.getByRole('button', { name: '新建第一章', exact: true }).click()
  const paragraph = page.locator('.mjp-prose .para[contenteditable="true"]')
  await expect(paragraph).toBeVisible()
  await paragraph.fill(body)

  const save = page.waitForResponse((response) => response.request().method() === 'PUT' && /\/api\/novels\/[^/]+$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const saved = await save
  const projectId = new URL(saved.url()).pathname.split('/').at(-1)!
  // P1 起保存状态只有一处：232px 工作区导航底部（项目级全局状态）。正文编辑栏里那份
  // 重复显示已删除，断言意图不变：保存确实落盘并显示「已保存」。
  const saveState = page.locator('.mjp-snav-foot .mjp-save-state')
  await expect(saveState).toBeVisible()
  await expect(saveState).toHaveText('已保存')

  await page.reload()
  await expect(page.getByRole('heading', { name: '项目大厅', exact: true })).toBeVisible()
  const reopened = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/novels/${projectId}`)
  await page.locator('.mjp-hall-project').filter({ hasText: title }).getByRole('button', { name: `打开：${title}`, exact: true }).click()
  await reopened
  await expect(page.getByText(body, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '审稿与导出', exact: true }).click()
  // 新版把「审稿与导出」拆成子页：导出成稿页提供「AI 修改候选」入口，
  // 空候选确认界面在「AI 修改候选」子页。断言意图不变：候选确认界面保留、当前无待处理候选。
  const candidatesEntry = page.locator('.mjp-canvas-scroll').getByRole('button', { name: /^AI 修改候选/ })
  await expect(candidatesEntry).toBeVisible()
  await candidatesEntry.click()
  await expect(page.locator('.mjp-view-head .title')).toHaveText('AI 修改候选')
  await expect(page.getByText('没有待处理的候选', { exact: true })).toBeVisible()
})

test('正式创作助手通过 mojingClient 请求并显示隔离响应', async ({ page }) => {
  const title = `创作助手项目-${Date.now()}`
  const prompt = `请检查真实请求边界-${Date.now()}`
  const reply = '这是由隔离测试响应的助手结论。'
  let requestMethod = ''
  let requestPath = ''
  let requestBody: Record<string, unknown> | undefined

  await page.route('**/api/novels/*/creative-chat', async (route) => {
    const request = route.request()
    requestMethod = request.method()
    requestPath = new URL(request.url()).pathname
    requestBody = request.postDataJSON() as Record<string, unknown>
    const projectId = requestPath.split('/')[3]!
    const now = new Date().toISOString()
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        conversation: { id: 'isolated-conversation', projectId, assistantId: 'writing-assistant', stage: 'writing', targetId: 'project', title: '隔离对话', createdAt: now, updatedAt: now, messageCount: 2 },
        messages: [
          { id: 'isolated-user', conversationId: 'isolated-conversation', role: 'user', content: prompt, mode: '综合协作', references: [], actions: [], projectRevision: 0, createdAt: now },
          { id: 'isolated-assistant', conversationId: 'isolated-conversation', role: 'assistant', content: reply, mode: '综合协作', references: [], actions: [], projectRevision: 0, createdAt: now }
        ]
      })
    })
  })

  await page.goto('/')
  await createProjectFromHall(page, title)
  await page.getByRole('button', { name: '正文创作', exact: true }).click()
  const assistant = page.getByRole('complementary', { name: /创作助手$/ })
  await expect(assistant).toBeVisible()
  await assistant.getByRole('textbox').fill(prompt)
  await assistant.getByRole('button', { name: '发送', exact: true }).click()

  await expect(assistant.getByText(reply, { exact: true })).toBeVisible()
  expect(requestMethod).toBe('POST')
  expect(requestPath).toMatch(/^\/api\/novels\/[^/]+\/creative-chat$/)
  expect(requestBody).toMatchObject({ stage: 'writing', mode: '综合协作', content: prompt })
})

for (const viewport of [
  { name: '常规桌面', width: 1500, height: 940 },
  { name: 'Electron 支持的最小桌面宽度', width: 1120, height: 940 }
]) {
  test(`${viewport.name}遵守正式四阶段几何契约`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await createProjectFromHall(page, `几何契约项目-${viewport.width}-${Date.now()}`)

    const applicationRail = page.getByRole('complementary', { name: '应用窄栏' })
    const workspaceNavigation = page.getByRole('complementary', { name: '项目导航' })
    const assistant = page.getByRole('complementary', { name: /创作助手$/ })

    await expect(applicationRail).toBeVisible()
    await expect(workspaceNavigation).toBeVisible()
    await expect(assistant).toBeVisible()
    await expectWidth(applicationRail, 68)
    await expectWidth(workspaceNavigation, 232)
    await expectWidth(assistant, 360)
    await expect(page.locator('.mjp-dock-toggle')).not.toBeVisible()
    await expect(page.locator('.mjp-dock button[aria-label="收起助手"]')).toHaveCount(0)

    const assistantControls = await page.locator('button:visible').evaluateAll((buttons) => buttons
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
      .filter((label) => /(收起|隐藏|关闭|切换).{0,8}助手|助手.{0,8}(收起|隐藏|关闭|切换)/.test(label)))
    expect(assistantControls).toEqual([])

    const workspaceDimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }))
    expect(workspaceDimensions.scrollWidth).toBeLessThanOrEqual(workspaceDimensions.clientWidth + 1)

    await globalRail(page).getByRole('button', { name: '设置', exact: true }).click()
    const settingsNavigation = page.locator('.mjp-settings > .mjp-snav')
    await expect(settingsNavigation).toBeVisible()
    await expectWidth(settingsNavigation, 240)

    const settingsDimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }))
    expect(settingsDimensions.scrollWidth).toBeLessThanOrEqual(settingsDimensions.clientWidth + 1)
  })
}
