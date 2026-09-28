# 架构说明

墨境是本地优先的 npm 工作区。桌面程序由 Electron 承载 React 界面，并在本机启动 Fastify API；业务资料由 SQLite 持久化。浏览器开发模式使用相同的前后端代码，开发数据库与桌面版数据库分开。

| 目录 | 职责 |
| --- | --- |
| `apps/web` | React 页面、编辑器、状态与 API 客户端 |
| `apps/api` | 本机 HTTP API、异步任务、SSE 进度 |
| `apps/desktop` | Electron 窗口、本机服务生命周期、文件与系统集成 |
| `packages/contracts` | 数据结构、校验规则和共享接口类型 |
| `packages/core` | 项目、SQLite、记忆、模型任务、导入导出和版本逻辑 |

编辑流程是“输入 → 界面草稿 → 保存请求 → 本机 API → SQLite”。AI 任务先整理项目上下文，再调用用户配置的模型地址；任务结果以候选或提案返回，需由作者确认才会进入正式内容。前端不直接访问数据库或模型密钥。

桌面 API 只监听回环地址，业务接口使用会话令牌。开发者若单独运行浏览器版，应为测试环境指定独立的数据目录，不要连接正式作品目录。端到端测试由 `npm run test:e2e` 启动独立的内存数据库。

主要入口：`apps/web/src/App.tsx`、`apps/web/src/novelStore.ts`、`apps/web/src/api/mojingClient.ts`、`apps/api/src/mojingServer.ts`、`packages/core/src/novelDatabase.ts`。接口及领域功能另见 [功能说明](墨境-1.0-功能与开发说明.md)。
