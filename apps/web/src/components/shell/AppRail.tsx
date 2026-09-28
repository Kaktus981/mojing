import type { LucideIcon } from 'lucide-react'

/**
 * 窄栏条目。
 *
 * 不再带 `disabled`：P1 已删除三个「点了没反应」的禁用占位入口
 * （AI 工作台 / 文风库 / 历史记录），它们的真实功能分别在 232px 工作区导航的
 * 「任务中心 / 文笔工坊 / 版本快照」中。窄栏里出现的条目一律可点。
 */
export type AppRailItem = { id: string; label: string; icon: LucideIcon }

type AppRailProps = {
  items: readonly AppRailItem[]
  activeId: string
  onSelect: (id: string) => void
  brand: React.ReactNode
  footer?: React.ReactNode
}

/** 68px 全局应用窄栏（对应参考样例 .rail）。 */
export function AppRail({ items, activeId, onSelect, brand, footer }: AppRailProps): React.JSX.Element {
  return (
    <aside className="mjp-rail" aria-label="应用窄栏">
      <div className="mjp-rail-brand" title="墨境">{brand}</div>
      <nav className="mjp-rail-nav">
        {items.map((item) => {
          const Icon = item.icon
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              className={`mjp-rail-item${active ? ' is-active' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <Icon size={22} strokeWidth={1.7} />
            </button>
          )
        })}
        {footer ? <div className="mjp-rail-foot">{footer}</div> : null}
      </nav>
    </aside>
  )
}
