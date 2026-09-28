import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { restoreZoomLevel } from './components/settings/zoomPreference'
// 暖纸主题（参考样例风格）：令牌 + 外壳组件样式。必须在此引入，
// 否则 Vite 不会把样式表打进产物（此前 90-*.css 曾因未被 import 而整份失效）。
import './styles/95-paper-theme.css'
import './styles/96-paper-shell.css'
// 工作区三栏与五个视图（卷章结构 / 世界观 / 正文 / 记忆与伏笔 / 审稿与导出）
// 以及 360px AI 创作助手。同样必须在此 import，否则不会进产物。
import './styles/97-workspace-views.css'
// 浮层与反馈：遮罩 / 模态 / 表单消息 / 全局 toast。
import './styles/98-overlays.css'
import './styles/98-hall.css'
// 设置中心：七栏的行式布局、键值网格、路径条、表格容器，以及正文字体
// （--font-prose）与「减少动效」的落地规则。必须在此引入。
import './styles/99-settings.css'

void restoreZoomLevel().catch(() => { /* 缩放偏好失败不阻止项目启动 */ })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
