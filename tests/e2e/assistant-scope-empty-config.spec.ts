import { expect, test } from '@playwright/test'
import { buildWritableProject, openModule, title, type ManualFixture } from './helpers/manual-workspace'
import { ensureFreeCreation } from './helpers/workspace-ui'

/**
 * 「空模型配置」作用域验收：**本文件必须跑在一个从未写入任何模型服务配置的库里**。
 *
 * 为什么单独成文件、单独一个 Playwright project（`scope`）：
 * 产品的模型服务配置只有新增/覆盖、没有删除通道（`/api/providers` 只有 GET/PUT），
 * 也就是说一旦某条用例把配置写进某个库，「还没有可用的模型服务」这个状态在该库里
 * **再也回不去**。`assistant-capability-mounting.spec.ts` 与 `assistant-guided-flow.spec.ts`
 * 都要写入模型配置，它们与「必须没有配置」的断言同库时，成败只会取决于**文件名的字母序** ——
 * 而本套件的前提恰恰是「不依赖用例执行顺序」。
 *
 * 因此按与 `guided` / `visual` 完全相同的思路隔离：`tests/e2e/run-e2e.mjs` 为这一批单独起
 * 一套「独立 API 进程 + 独立 Web 进程 + 独立 `:memory:` 库」的栈，并用
 * `MOJING_E2E_SCOPE_BASE_URL` 注入；**不是**靠清空共享库、隐藏卡片、伪造接口响应或调整用例顺序。
 *
 * 本文件的两条用例从 `assistant-scope.spec.ts` 原样搬来（断言与文案一字未改），
 * 只改变了所属 project。
 *
 * 全部走真实隔离 API：项目用 UI 建立，不用 `page.route` 伪造项目数据。
 * 这里**不配置任何模型服务**——正好可以验证「没有模型时如实报错，不伪造成功」。
 */
test('切换栏目与选中对象不发起任何模型请求，作用域由服务端解析', async ({ page }) => {
  const fixture = await buildWritableProject(page, '助手作用域验收')
  let chatRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/creative-chat')) chatRequests += 1
  })

  // 连续切换大纲模块与选中对象：一次都不能自动调用 AI。
  await openModule(page, '小说大纲', '总纲与卷纲')
  await openModule(page, '小说大纲', '章节规划')
  await openModule(page, '小说大纲', '故事线')
  await openModule(page, '世界观', '世界总览')
  await openModule(page, '小说大纲', '创作起点')
  await expect(title(page)).toHaveText('创作起点')
  expect(chatRequests, '切换模块和对象不得自动调用 AI').toBe(0)

  // 有精确目标的页面先出模式选择页：选一次自由创作（这一步同样不发请求）。
  await ensureFreeCreation(page)
  expect(chatRequests, '选择模式本身不得调用 AI').toBe(0)

  // 展开「本次使用」：只读预览，仍然不是模型调用。
  const preview = page.waitForResponse((response) => response.url().includes('/assistant-runs/preview') && response.status() === 200)
  await page.getByRole('button', { name: /本次使用/ }).click()
  await preview
  const scope = page.getByTestId('assistant-target')
  await expect(scope).toBeVisible()
  await expect(scope).not.toHaveText(/outline|chapter|world/)
  expect(chatRequests, '预览配置不得触发模型调用').toBe(0)

  const usage = page.getByTestId('assistant-usage')
  await expect(usage).toContainText('读取')
  await expect(usage).toContainText('可写')
  // 隔离库没有模型服务：必须如实说明，不能显示「已生成」或假装可用。
  await expect(usage).toContainText(/还没有可用的模型服务|还没有配置密钥/)

  // 手动发送：没有模型服务时失败，但输入必须保留，不能假装成功。
  await page.locator('#mojing-dock-input').fill('帮我细化这一章')
  await page.locator('.mjp-dock-send').click()
  await expect(page.locator('.mjp-msg.is-error')).toContainText(/还没有可用的模型服务|还没有配置密钥/)
  await expect(page.locator('#mojing-dock-input')).toHaveValue('帮我细化这一章')
  expect(chatRequests).toBe(1)
})

test('跨项目、已删除对象和栏目不匹配的目标都被服务端拒绝', async ({ page }) => {
  const fixture = await buildWritableProject(page, '助手作用域拒绝')

  const post = (body: unknown) => page.request.post(`${fixture.origin}/api/novels/${fixture.id}/assistant-runs/preview`, { headers: { ...fixture.headers, 'Content-Type': 'application/json' }, data: body })

  const crossProject = await post({
    stage: 'outline', taskType: '局部修改',
    target: { kind: 'chapter', projectId: 'someone-elses-project', objectId: fixture.chapterId }
  })
  expect(crossProject.status(), '跨项目目标必须被拒绝').toBe(400)
  expect((await crossProject.json()).error.message).toMatch(/不属于当前小说项目/)

  const missing = await post({
    stage: 'outline', taskType: '局部修改',
    target: { kind: 'chapter', projectId: fixture.id, objectId: 'chapter-does-not-exist' }
  })
  // 目标不存在走统一的 *_NOT_FOUND → 404 约定。
  expect(missing.status()).toBe(404)
  expect((await missing.json()).error.message).toMatch(/找不到该章节/)

  const wrongStage = await post({
    stage: 'world', taskType: '引导构建',
    target: { kind: 'story-core', projectId: fixture.id }
  })
  expect(wrongStage.status()).toBe(400)
  expect((await wrongStage.json()).error.message).toMatch(/不能在/)

  const wrongTarget = await post({
    stage: 'outline', taskType: '局部修改',
    target: { kind: 'world', projectId: fixture.id }
  })
  expect(wrongTarget.status()).toBe(400)
  expect((await wrongTarget.json()).error.message).toMatch(/不能以/)

  // 同一个真实章节的目标是合法的，且解析出的标签来自服务端。
  const ok = await post({
    stage: 'writing', taskType: '章节分析',
    target: { kind: 'chapter', projectId: fixture.id, objectId: fixture.chapterId }
  })
  expect(ok.status()).toBe(200)
  const body = (await ok.json()) as { context: { targetLabel: string; readRefs: string[]; writableRefs: string[] }; effective: { source: string } }
  expect(body.context.targetLabel).toContain('第1章')
  expect(body.context.readRefs).toContain(`chapter:${fixture.chapterId}`)
  expect(body.context.writableRefs, '章节分析不能写入正式内容').toEqual([])
  expect(body.effective.source).toBe('未配置')
})
