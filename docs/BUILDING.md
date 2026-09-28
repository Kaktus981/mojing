# Windows 安装包构建

桌面版目前面向 Windows 11 64 位。需要 Node.js 22、npm，以及 Electron 和 electron-builder 构建时所需的 Windows 工具。仓库的 `build/installer.nsh`、`build/installer-maintenance.ps1` 和图标、位图资源参与安装器构建。

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run dist:win
```

最后一步会再次构建应用并在 `release/mojing/` 生成 `Mojing_1.0.0_x64_Setup.exe`。`release/` 不进入源码仓库；发布的二进制文件应作为 GitHub Release 附件。公开安装包尚未签名，Windows 可能显示未知发布者提示。

安装器为当前用户安装，提供安装位置和桌面快捷方式选择。卸载默认保留本机作品与设置；主动选择删除时会再次确认。安装器包含升级前作品备份和恢复逻辑，但首次公开时仍未完成真实跨版本升级及失败回退验收。不要仅凭脚本测试声称它们通过了实装验证。
