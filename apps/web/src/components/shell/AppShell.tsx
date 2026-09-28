import type { AppRailItem } from './AppRail'
import { AppRail } from './AppRail'
import { AppTopBar } from './AppTopBar'
import type { MojingTheme } from './useTheme'

export type AppShellProps = {
  railItems: readonly AppRailItem[]
  activeRailId: string
  onSelectRail: (id: string) => void
  brand: React.ReactNode
  railFooter?: React.ReactNode
  breadcrumb?: readonly string[]
  saveState?: string | null
  job?: { label: string; percent: number }
  theme: MojingTheme
  onToggleTheme: () => void
  topBarActions?: React.ReactNode
  /** 工作区可提供自己的项目一级导航；大厅与设置继续使用默认应用窄栏。 */
  railContent?: React.ReactNode
  /** 一级侧栏由 App 常驻渲染时，本页只负责主内容。 */
  embedded?: boolean
  /** 页面已自带 .mjp-body 布局容器时置 true，跳过外壳的默认包裹层 */
  bareBody?: boolean
  /** 大厅自带页面头部时置 false；其余页面保持默认顶栏。 */
  showTopBar?: boolean
  children: React.ReactNode
}

/**
 * 应用外壳：68px 窄栏 + 顶栏 + 内容区。
 * 对应参考样例原型中的 .app / .rail / .topbar 三层结构。
 */
export function AppShell({
  railItems,
  activeRailId,
  onSelectRail,
  brand,
  railFooter,
  breadcrumb,
  saveState,
  job,
  theme,
  onToggleTheme,
  topBarActions,
  railContent,
  embedded = false,
  bareBody,
  showTopBar = true,
  children
}: AppShellProps): React.JSX.Element {
  const main = (
    <div className="mjp-main">
        {showTopBar && (
          <AppTopBar
            breadcrumb={breadcrumb}
            saveState={saveState}
            job={job}
            theme={theme}
            onToggleTheme={onToggleTheme}
            actions={topBarActions}
          />
        )}
        {bareBody ? children : <div className="mjp-body no-snav">{children}</div>}
    </div>
  )
  return embedded ? main : (
    <div className="mjp-app">
      {railContent ?? <AppRail items={railItems} activeId={activeRailId} onSelect={onSelectRail} brand={brand} footer={railFooter} />}
      {main}
    </div>
  )
}
