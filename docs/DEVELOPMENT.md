# 开发说明

开发环境建议使用 Windows 11 64 位、Node.js 22 和 npm。先在仓库根目录安装依赖：

```powershell
npm install
```

启动浏览器开发环境：

```powershell
npm run dev
```

默认 Web 地址为 `http://localhost:5173`，本机 API 地址为 `http://localhost:8787`。浏览器开发数据写入项目下的 `.mojing-dev`；该目录被 Git 忽略。也可以分别运行 `npm run dev:api`、`npm run dev:web` 或 `npm run dev:desktop`。

常用检查：

```powershell
npm run typecheck
npm test
npm run build
```

端到端测试必须通过 `npm run test:e2e` 运行。启动器会为各测试批次创建独立的内存数据库和动态端口，不使用正式作品数据；它需要本机已安装 Microsoft Edge。公开仓库不包含内部小说范例或像素截图基线，保留的测试使用少量虚构数据。

若测试模型调用，请使用本机测试服务或专门的测试密钥；不要把真实密钥写入源码、Issue 或截图。完整 Windows 安装包构建步骤见 [构建说明](BUILDING.md)。
