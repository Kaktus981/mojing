import { Cpu, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MojingTheme } from './useTheme'

export type AppTopBarProps = {
  /** 面包屑，如 ['长夜行', '正文创作']，最后一项为主标题。 */
  breadcrumb?: readonly string[]
  /** 保存状态文案：已保存 / 正在保存 / 未保存。
   * 传 null 则整块不渲染 —— 设置中心这类「没有正在编辑的文稿」的页面用它隐藏胶囊，
   * 避免出现一句与实际无关的「已保存」。 */
  saveState?: string | null
  /** AI 任务进度（0—100）；不传则不显示任务胶囊。 */
  job?: { label: string; percent: number }
  theme: MojingTheme
  onToggleTheme: () => void
  actions?: React.ReactNode
  leading?: React.ReactNode
}

const SAVE_CLASS: Record<string, string> = {
  未保存: ' is-dirty',
  正在保存: ' is-dirty'
}

/** 52px 顶栏（对应参考样例 .topbar）。 */
export function AppTopBar({
  breadcrumb = [],
  saveState = '已保存',
  job,
  theme,
  onToggleTheme,
  actions,
  leading
}: AppTopBarProps): React.JSX.Element {
  const saveClass = saveState ? SAVE_CLASS[saveState] ?? '' : ''
  return (
    <header className="mjp-topbar">
      {leading ?? (
        <div className="mjp-brand">
          <span className="mjp-brand-seal mjp-serial">墨</span>
          <span className="mjp-brand-text">
            <b>墨境</b>
            <span>长篇小说创作</span>
          </span>
        </div>
      )}

      {breadcrumb.length > 0 && (
        <nav className="mjp-crumb" aria-label="面包屑">
          {breadcrumb.map((part, index) => (
            <span key={`${part}-${index}`} className="mjp-row">
              {index > 0 && <span className="sep">/</span>}
              {index === breadcrumb.length - 1 ? <b>{part}</b> : <span>{part}</span>}
            </span>
          ))}
        </nav>
      )}

      <span className="mjp-spacer" />

      {job && (
        <span className="mjp-status-pill is-ai" title={job.label}>
          <Cpu size={14} />
          {job.label}
          <span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, job.percent))}%` }} /></span>
        </span>
      )}

      {saveState && (
        <span className={`mjp-status-pill${saveClass}`} title={`保存状态：${saveState}`}>
          <i className="dot" />
          {saveState}
        </span>
      )}

      {actions}

      <button
        type="button"
        className="mjp-btn ghost icon"
        title={theme === 'paper' ? '切换到夜墨' : '切换到暖纸'}
        aria-label={theme === 'paper' ? '切换到夜墨' : '切换到暖纸'}
        onClick={onToggleTheme}
      >
        {theme === 'paper' ? <Moon size={18} strokeWidth={1.7} /> : <Sun size={18} strokeWidth={1.7} />}
      </button>
    </header>
  )
}

/** 窄栏底部按钮（主题 / 设置），与 AppRail 的 footer 插槽配套。 */
export function RailFooterButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="mjp-rail-item" title={label} aria-label={label} onClick={onClick}>
      <Icon size={20} strokeWidth={1.7} />
    </button>
  )
}
