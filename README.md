# 墨境

“墨境”是一款本地优先的 Windows AI 长篇小说创作软件。它把灵感、世界观、小说大纲、卷章正文、角色记忆、伏笔台账、连续性审查和导出放进同一套可追溯工作流中；AI 只提交候选或记忆提案，不会静默覆盖人工正文。

当前桌面安装包仅支持 Windows 11 64 位。可从 [Releases](https://github.com/Kaktus981/mojing/releases) 下载 `Mojing_1.0.0_x64_Setup.exe`。安装包尚未进行代码签名；首次安装和卸载由使用者验收，升级及失败回退流程尚未完成真实跨版本验收。作品和设置默认保留在本机；使用 AI 时，所选内容会发送到你配置的模型服务。

## 界面预览

以下截图仅使用空白项目，不包含用户作品：

![项目大厅](docs/screenshots/hall.png)
![空白项目工作区](docs/screenshots/workspace.png)
![正文空章](docs/screenshots/editor.png)

## 当前能力

- 六阶段工作区：灵感与规格、世界观、小说大纲、正文创作、记忆与伏笔、审稿与导出。
- 独立 AI 工作台：以世界观、大纲、正文、记忆、伏笔和连续性审查组成固定引导流程，生成前先检查上下文，生成中显示步骤与进度，生成后再处理候选。
- 通用、玄幻修仙、科幻、历史架空、都市、悬疑六类模板，以及角色、修行体系、国家、货币、势力、地点、宗教、历史等结构化词条。
- 世界观与大纲规划门禁：缺失时阻止 AI 正文生成，未定稿时明确警告，定稿后再编辑会退回草稿并产生复核提醒。
- 卷章树、稳定段落 ID、字数统计、专注模式、搜索替换和续写、扩写、压缩、润色等 AI 入口。
- 章节保存后的记忆分析任务会合并去重；角色状态、知识、关系、剧情事实和伏笔变化先进入待确认提案。
- 永久层、状态层、剧情层、近期层和 FTS5 远期召回层组成的长篇上下文，生成前展示纳入项、Token 估算和裁剪原因。
- AI 任务历史保存在本机 SQLite 中，包含 Token 预算、上下文纳入/排除原因、进度事件、结果与错误；任务可取消，软件意外关闭后会标记为可重试的中断任务。
- 长篇生成支持流式模型响应、15 分钟客户端超时和临时故障自动重试，降低世界观与大纲生成的中途超时概率。
- 世界观首轮生成采用受控规模的基础草案 Schema，再转换为可编辑实体；任务历史明确区分 Token 预算与实际用量，并警告容易失效的临时本机高位端口。
- 角色状态和剧情事实支持生效章、失效章与替换关系，生成早期章节时不会读取未来才发生的变化。
- 伏笔埋设、推进、计划回收、实际回收、逾期和证据定位；连续性审查只产生报告与修改候选。
- TXT、Markdown、DOCX、墨境 JSON 导入；TXT、Markdown、DOCX、完整 JSON 导出；版本检查点与冲突保护。

产品和数据身份与旧“漫剧工坊”完全隔离：开发数据位于 `.mojing-dev/mojing.db`，正式数据库为 Electron 用户数据目录下的 `mojing.db`，环境变量统一使用 `MOJING_*`。旧漫剧 JSON 会被明确拒绝，不做隐式转换。

## 工程结构

```text
apps/web             React + Vite 前端
apps/api             Fastify 本机 HTTP API、异步任务与 SSE
apps/desktop         Electron Windows 桌面壳
packages/contracts   小说领域 Schema、API 契约与客户端类型
packages/core        SQLite、上下文、AI、记忆、导入导出和版本逻辑
tests/e2e             前后端分离端到端测试
```

Web 前端不直接访问 Node.js、SQLite 或模型密钥。Electron 负责窗口、本机 API 生命周期、Windows `safeStorage` 和文件保存位置。本机 API 只监听 `127.0.0.1`，除健康检查外均要求随机会话令牌。

## 开发

在项目根目录运行：

```powershell
npm install
npm run dev
```

- Web：`http://localhost:5173`
- API：`http://localhost:8787`
- 浏览器开发数据库：`.mojing-dev/mojing.db`
- 浏览器开发模型密钥：环境变量 `MOJING_DEV_API_KEY`

也可以分别运行 `npm run dev:api`、`npm run dev:web` 或 `npm run dev:desktop`。不要直接双击 `apps/web/index.html`，它是 Vite 源码入口。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

端到端测试会启动独立的内存数据库，不会写入正在使用的作品数据。Windows 安装包构建步骤见 [构建说明](docs/BUILDING.md)。

开发入口见 [开发说明](docs/DEVELOPMENT.md)，组件与数据流见 [架构说明](docs/ARCHITECTURE.md)，详细功能与接口见 [功能说明](docs/墨境-1.0-功能与开发说明.md)。

## 授权与反馈

源代码以 [GNU AGPL v3](LICENSE) 授权。作者对自己输入和创作的作品保有权利；墨境不因参与创作而主张作品所有权、版税或分成，详见 [作品权利说明](OUTPUT_RIGHTS.md)。公开分发的修改版须更换名称和主图标，并标明非官方版本，详见 [品牌使用说明](TRADEMARKS.md)。运行所需水墨背景可沿用或修改。

普通问题和功能建议请使用 Issues，不要上传作品正文、模型密钥或数据库。安全漏洞请先按 [安全报告说明](SECURITY.md) 私密报告。另见 [隐私说明](PRIVACY.md) 与 [第三方组件](THIRD_PARTY_NOTICES.md)。

© 2026 Kaktus981。源码授权见 [LICENSE](LICENSE)；品牌使用规则见 [TRADEMARKS.md](TRADEMARKS.md)。
