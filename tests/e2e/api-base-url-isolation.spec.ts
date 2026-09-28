import { expect, test, type Page } from '@playwright/test'

/**
 * 现役隔离契约（接管已退役的 `vite-proxy-isolation.test.mjs` 的判别意图）。
 *
 * 被守护的安全属性：**浏览器客户端发出的业务请求必须落在「本次运行的隔离 API」上**，
 * 而不是任何默认地址（`mojingClient.ts:292` 的兜底默认值是 `http://localhost:8787`）或别的服务。
 *
 * 旧的 `node:test` 版本守的是「同源 `/api` + Vite dev proxy」这条**已经不存在**的机制；现役架构是
 * **绝对基址直连**（`apps/web/vite.config.ts` 没有 `proxy`），因此本用例改为直接断言两件可观测事实：
 *   ① 浏览器真实发出的一个业务请求，其 origin 精确等于本次隔离 API 的 origin；
 *   ② 设置页如实显示的 `runtime.apiBaseUrl` 与之一致。
 *
 * 期望值 `MOJING_E2E_EXPECTED_API_ORIGIN` 由 `tests/e2e/run-e2e.mjs` 在**该栈 API 真正监听成功之后**
 * 用监听结果注入；**不从页面显示值或客户端配置反推**（否则断言会自我验证）。
 *
 * 判别性对照：启动器还会给 Web 进程设一个**不可用**的旧变量 `MOJING_API_URL=http://127.0.0.1:1`。
 * 产品里没有任何代码读取它；一旦将来有人重新引入一个读取 `MOJING_API_URL` 的代理，下面的
 * 「origin 精确等于期望值」就会立刻失败 —— 这正是旧测试当年要守的判别意图。
 */

const expectedApiOrigin = process.env.MOJING_E2E_EXPECTED_API_ORIGIN

function rail(page: Page) {
  return page.getByRole('complementary', { name: '应用窄栏' }).getByRole('navigation')
}

test('浏览器客户端的业务请求落在本次隔离 API，且设置页如实显示该地址', async ({ page }) => {
  expect(expectedApiOrigin, '缺少 MOJING_E2E_EXPECTED_API_ORIGIN：必须通过 npm run test:e2e 启动。').toBeTruthy()
  expect(process.env.MOJING_E2E_ISOLATED).toBe('memory')
  // 与客户端 `config.apiBaseUrl.replace(/\/$/, '')` 同口径地规范化期望值。
  const expectedOrigin = new URL(expectedApiOrigin as string).origin

  await page.goto('/')
  await rail(page).getByRole('button', { name: '设置', exact: true }).click()

  // —— ① 真实页面操作触发的**真实业务请求**（不 mock、不手工请求）——
  // 切到「模型 API」面板时，面板挂载即调用 GET /api/providers。
  const providersResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/providers')
  await page.locator('.mjp-settings > .mjp-snav').getByRole('button', { name: '模型 API', exact: true }).click()
  const response = await providersResponse
  expect(response.request().method()).toBe('GET')
  expect(new URL(response.url()).origin).toBe(expectedOrigin)
  expect(response.status()).toBe(200)

  // —— ② 设置页显示的 runtime.apiBaseUrl 与该栈期望 origin 精确一致 ——
  const apiAddress = page.locator('.mjp-kv', { has: page.locator('.k', { hasText: /^API 地址$/ }) }).locator('.v')
  await expect(apiAddress).toHaveText(expectedOrigin)
})
