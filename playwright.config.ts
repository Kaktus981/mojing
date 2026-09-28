import { defineConfig, type Project } from '@playwright/test'

/**
 * 端到端测试使用三个隔离内存数据库，供四个测试项目运行：
 *
 *   - `shared`：业务回归批次，跑 `tests/e2e` 下除引导和空配置隔离验收以外的用例。
 *     同一批次内的用例共用一个内存库（这是既有行为，业务用例之间本来就有前后置关系）。
 *   - `guided`：五领域引导验收批次（`assistant-guided-flow.spec.ts`），**独占一个库**。
 *     隔离它的原因不是「它需要干净库」，而是**它不能被别的用例影响、也不能影响别的用例**：
 *     它自己会往全局写一条模型服务配置，而产品的模型服务配置**只有新增/覆盖、没有删除通道**
 *     （`/api/providers` 只有 GET/PUT），也就是说一旦被写进某个库，「未配置」这个状态在该库里
 *     **再也回不去**。`assistant-scope.spec.ts` 有两条业务断言正是「隔离库还没有模型服务时必须
 *     如实说明」。两者同库时，成败会取决于文件名的字母序 —— 而本文件的设计前提恰恰是
 *     「不依赖用例执行顺序」。所以按同一套思路（独立数据库实例）把这一批单独隔开。
 *   - `scope`：「必须还没有模型服务配置」那一批（`assistant-scope-empty-config.spec.ts`），
 *     **独占一个从不写入模型配置的库**。同样的理由：`shared` 批次里
 *     `assistant-capability-mounting.spec.ts` 会往库里写入模型服务配置，而产品的模型服务配置
 *     **只有新增/覆盖、没有删除通道**，所以一旦同库，「未配置」这个状态就再也回不去。
 *     把这两条断言留在 `shared` 只会让成败取决于文件名排序 —— 与「不依赖执行顺序」的前提冲突。
 *   - `isolation`：**现役隔离契约批次**（`api-base-url-isolation.spec.ts`），接管已退役的
 *     `vite-proxy-isolation.test.mjs`。它验证「浏览器客户端发出的真实业务请求，落在本次运行的
 *     隔离 API 上」。跑在 `scope` 那套栈上，期望值由启动器以该栈 API 的**真实监听 origin**
 *     （`MOJING_E2E_EXPECTED_API_ORIGIN`）注入 —— 不是从页面显示值或客户端配置反推。
 *
 * 这些批次的隔离靠**各自独立的数据库实例**实现，不是靠清空共享库、隐藏项目卡片或伪造响应；
 * 由 `tests/e2e/run-e2e.mjs` 顺序启动各套栈后，用 `MOJING_E2E_BASE_URL` /
 * `MOJING_E2E_GUIDED_BASE_URL` / `MOJING_E2E_SCOPE_BASE_URL`
 * 分别注入。标准入口 `npm run test:e2e` 会自动跑完所有 project 并汇总退出码，不需要手动跑多次。
 *
 * 关于已退役的 `tests/e2e/vite-proxy-isolation.test.mjs`：它是一条 `node:test` 文件，守的是
 * 「同源 `/api` + Vite dev proxy」这条**已不存在**的机制。其判别意图已由 `isolation` 批次的
 * `api-base-url-isolation.spec.ts` 以现役方式（浏览器真实请求的 origin 必须等于本次隔离 API）
 * 接管，该文件与 `npm run test:e2e:precheck` 入口已一并移除。
 */

const sharedBaseUrl = process.env.MOJING_E2E_BASE_URL
const guidedBaseUrl = process.env.MOJING_E2E_GUIDED_BASE_URL
const scopeBaseUrl = process.env.MOJING_E2E_SCOPE_BASE_URL
const expectedApiOrigin = process.env.MOJING_E2E_EXPECTED_API_ORIGIN
if (!sharedBaseUrl || process.env.MOJING_E2E_ISOLATED !== 'memory') {
  throw new Error('端到端测试必须通过 npm run test:e2e 启动，以确保使用隔离的内存数据库。')
}
if (!guidedBaseUrl) {
  throw new Error('五领域引导验收需要独立的内存数据库实例（MOJING_E2E_GUIDED_BASE_URL），请通过 npm run test:e2e 启动。')
}
if (!scopeBaseUrl) {
  throw new Error('「必须没有模型服务配置」的用例需要独立的内存数据库实例（MOJING_E2E_SCOPE_BASE_URL），请通过 npm run test:e2e 启动。')
}
if (!expectedApiOrigin) {
  throw new Error('浏览器客户端 API 基址隔离用例需要本次隔离 API 的真实监听 origin（MOJING_E2E_EXPECTED_API_ORIGIN），请通过 npm run test:e2e 启动。')
}

/** 五领域引导验收：独占一个库，避免与业务回归批次互相污染全局模型服务配置。 */
const GUIDED_SPEC = '**/assistant-guided-flow.spec.ts'
/**
 * 「必须还没有模型服务配置」批次：独占一个**从不写入模型配置**的库。
 * 与 `guided` 同源问题（模型配置只有新增/覆盖、没有删除通道），必须与 `shared` 分开。
 */
const SCOPE_SPEC = '**/assistant-scope-empty-config.spec.ts'
/**
 * 现役隔离契约批次：验证**浏览器客户端实际把请求发往本次隔离 API**，
 * 接管已退役的 `vite-proxy-isolation.test.mjs` 的判别意图。跑在 `scope` 那套栈上
 * （该栈库干净、且没有别的用例往里面写模型配置），期望值由启动器用**该栈 API 的真实监听
 * origin**（`MOJING_E2E_EXPECTED_API_ORIGIN`）注入。
 */
const ISOLATION_SPEC = '**/api-base-url-isolation.spec.ts'
const projects: Project[] = [
  {
    name: 'shared',
    testIgnore: [GUIDED_SPEC, SCOPE_SPEC, ISOLATION_SPEC],
    use: { baseURL: sharedBaseUrl }
  },
  {
    name: 'guided',
    testMatch: [GUIDED_SPEC],
    use: { baseURL: guidedBaseUrl }
  },
  {
    name: 'scope',
    testMatch: [SCOPE_SPEC],
    use: { baseURL: scopeBaseUrl }
  },
  {
    name: 'isolation',
    testMatch: [ISOLATION_SPEC],
    // 复用 `scope` 这套栈（库干净、无写入）；期望 API origin 由启动器按该栈真实监听结果注入。
    use: { baseURL: scopeBaseUrl }
  }
]

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  /**
   * 全局超时 **120_000** 是**基础设施修复**，不是产品行为变化。
   *
   * Playwright 会把 **fixture teardown（拆栈）的耗时算进用例自身的超时预算**（超时报文即
   * `Tearing down "context" exceeded the test timeout of …ms`）。而本机 `Close context`
   * 实测需要**约 28–35s**（真实观测，非估算：磁盘压力 + 浏览器 profile 落盘）。于是只要全局值
   * 还是 30s，任何**本体耗时接近或超过 30s 的长用例**都会在收尾阶段炸掉 —— 哪怕所有业务断言
   * 都已通过，也会被判成 `Tearing down "context" exceeded the test timeout of 30000ms`。
   *
   * 取值推导：本套件最重的用例是 `assistant-scope` 那条「两个项目」用例（两个项目各建一份草稿 +
   * 两次 `page.reload()`）。它的**本体**只需约 19s 就断言完毕，但**总耗时**实测波动很大 ——
   * 43.3s / 47.7s / 53.8s 都出现过，抬高全局值后甚至见到 72s，差额几乎全在收尾的 `Close context`。
   * 按最坏观测（本体约 19s + 收尾约 53s ≈ 72s）再留一档抖动余量，故取 **120_000**。
   * （注意区分：`Close context` 的 28–35s 是**收尾**耗时，不是用例本体耗时，两者不可相加成 89s。）
   *
   * 兼容性：本仓库已有 40 余处用例**显式声明了更长的预算**（120_000 / 150_000 / 180_000 /
   * 240_000，例如 `assistant-guided-flow.spec.ts` 的 17 条全部声明）—— 它们仍然覆盖本全局值，
   * 行为不变。本项只抬高**默认**预算，不改变任何断言与产品语义。
   */
  timeout: 120_000,
  /**
   * `updateSnapshots: 'none'` 是本轮的关键硬化。
   *
   * Playwright 的默认值是 `'missing'`：基线缺失时会**把这次运行的实际截图直接写进快照目录**
   * （日志是「A snapshot doesn't exist at …, writing actual.」）。也就是说，任何一次常规回归
   * 只要碰上缺图，就会**自动生成未审阅的正式基线** —— 正是「不批量接受未审阅图片」要禁止的行为。
   *
   * 改成 `'none'` 后：缺图只报失败，**不往快照目录写任何文件**；差异只以测试结果与
   * `-actual.png` / `-diff.png` 附件的形式落在 `--output` 指定的 `test-results/` 里。
   * 正式基线只能由人工逐张复制审阅通过的候选图产生（沿用既有口径，禁止 `--update-snapshots`）。
   */
  updateSnapshots: 'none',
  use: {
    trace: 'retain-on-failure',
    /**
     * 本项目统一使用本机已安装的 Microsoft Edge 运行浏览器测试与预览：
     * 不下载 Playwright 专用 Chromium，也不使用 Chrome。
     * Edge 未安装时启动会直接报错，据实上报，不擅自改用其他浏览器。
     */
    channel: 'msedge'
  },
  projects
})
