import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'

/**
 * 标准 E2E 入口：**顺序**启动三套完全隔离的栈（各自独立的内存库 + API 进程 + Web 进程），
 * 再把地址注入 `shared` / `guided` / `scope` 测试项目，隔离检查复用 `scope` 栈。
 * 最后汇总退出码。
 *
 * 另外，本入口还负责把**隔离 API 的真实监听 origin** 交给 Playwright（`isolation` project）：
 * `startStack` 会在该栈 API 的 `/api/health` 真正可访问之后，把 `apiUrl` 通过
 * `MOJING_E2E_EXPECTED_API_ORIGIN` 传给 Playwright 进程。这样
 * `tests/e2e/api-base-url-isolation.spec.ts` 断言的「浏览器请求落在本次隔离 API」用的是
 * **监听事实**，而不是从页面显示值或客户端配置反推出来的值（那样会自我验证）。
 *
 * 关于已退役的 `tests/e2e/vite-proxy-isolation.test.mjs`：它是一条 `node:test` 文件，守的是
 * 「同源 `/api` + Vite dev proxy」这条**已不存在**的机制（现役客户端用绝对基址直连）。其判别
 * 意图已由 `api-base-url-isolation.spec.ts` 以现役方式接管，因此该文件与
 * `npm run test:e2e:precheck` 入口均已移除。详见 `test-results/api-base-url-isolation-20260919/`。
 */

const children = []
let stopping = false

const start = (args, environment) => {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: 'inherit'
  })
  children.push(child)
  return child
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const findAvailablePort = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.unref()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close(() => reject(new Error('无法分配端到端测试端口。')))
      return
    }
    server.close(() => resolve(address.port))
  })
})

const waitForUrl = async (url, child) => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`测试服务启动失败：${url}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 服务仍在启动，稍后重试。
    }
    await delay(150)
  }
  throw new Error(`等待测试服务超时：${url}`)
}

const stopProcessTree = async (child) => {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), delay(2_000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const stopAll = async () => {
  if (stopping) return
  stopping = true
  for (const child of [...children].reverse()) await stopProcessTree(child)
}

const interrupt = async () => {
  await stopAll()
  process.exit(130)
}

process.once('SIGINT', () => void interrupt())
process.once('SIGTERM', () => void interrupt())

/**
 * 启动**一套完全隔离的栈**：独立的内存数据库 + 独立 API 进程 + 独立 Web 进程（动态端口）。
 *
 * 各批次使用独立数据库，避免模型服务等全局配置互相影响。
 */
const startStack = async ({ label, databasePath }) => {
  const apiPort = await findAvailablePort()
  let webPort = await findAvailablePort()
  while (webPort === apiPort) webPort = await findAvailablePort()
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://localhost:${webPort}`

  const api = start(
    ['node_modules/tsx/dist/cli.mjs', 'apps/api/src/dev.ts'],
    {
      MOJING_DEV_DATABASE_PATH: databasePath,
      MOJING_API_PORT: String(apiPort),
      MOJING_WEB_ORIGIN: webUrl
    }
  )
  const web = start(
    ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts'],
    {
      MOJING_WEB_PORT: String(webPort),
      VITE_MOJING_API_URL: apiUrl,
      /**
       * **判别性对照**（承自已退役的 `vite-proxy-isolation.test.mjs`）：给 Web 进程再设一个
       * **不可用**的旧变量 `MOJING_API_URL`。产品里没有任何代码读取它 —— 只有 `VITE_MOJING_API_URL`
       * 会被 Vite 注入浏览器（非 `VITE_` 前缀的变量不会进前端），所以它不改变任何运行期行为。
       * 它保证的是：「若将来有人重新引入一个读取 `MOJING_API_URL` 的代理」，就会把浏览器请求导向
       * 这个死地址，从而让 `api-base-url-isolation.spec.ts` 里「浏览器请求必须落在本次隔离 API」
       * 的断言立刻失败。地址取本机保留、明显不可用的 `127.0.0.1:1`，不指向任何正式服务。
       */
      MOJING_API_URL: 'http://127.0.0.1:1'
    }
  )

  await Promise.all([
    waitForUrl(`${apiUrl}/api/health`, api),
    waitForUrl(webUrl, web)
  ])
  process.stdout.write(`[${label}] 隔离栈就绪：${webUrl} → ${apiUrl}（库 ${databasePath}）\n`)
  return { webUrl, apiUrl }
}

const playwrightArgs = process.argv.slice(2)

let exitCode = 1
try {
  // 三套栈**顺序**启动：后启动的 Vite 依赖预构建可以直接复用先启动的那套写好的缓存，
  // 避免多个 dev server 并发写同一个 `node_modules/.vite` 目录。
  const shared = await startStack({ label: '业务回归批次', databasePath: ':memory:' })
  const guided = await startStack({ label: '引导验收批次（独立库）', databasePath: ':memory:' })
  const scope = await startStack({ label: '作用域空配置批次（独立库）', databasePath: ':memory:' })

  const playwright = start(
    ['node_modules/@playwright/test/cli.js', 'test', ...playwrightArgs],
    {
      MOJING_E2E_BASE_URL: shared.webUrl,
      MOJING_E2E_GUIDED_BASE_URL: guided.webUrl,
      MOJING_E2E_SCOPE_BASE_URL: scope.webUrl,
      /**
       * 现役隔离契约（替代已退役的 `vite-proxy-isolation.test.mjs`）：
       * `isolation` project 跑在 `scope` 这套栈上，这里把**该栈 API 实际监听的 origin**
       * 原样交给 Playwright（`startStack` 里 `waitForUrl(apiUrl/api/health)` 成功后才返回）。
       * 期望值必须来自监听结果本身 —— 不能从页面显示值或客户端配置反推，否则断言会自我验证。
       * 各栈使用各自地址：本变量只承载 `scope` 栈的值。
       */
      MOJING_E2E_EXPECTED_API_ORIGIN: scope.apiUrl,
      MOJING_E2E_ISOLATED: 'memory'
    }
  )
  const [code] = await once(playwright, 'exit')
  exitCode = typeof code === 'number' ? code : 1
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
} finally {
  await stopAll()
}

process.exit(exitCode)
