import type { LucideIcon } from 'lucide-react'
import type { AsyncState } from './asyncState'

/* 公共基础组件：命名与参考样例原型保持一致（card / btn / tag / chip / seg /
 * field / switch / kv / status / meter / stat / empty / banner），
 * 类名统一 mjp- 前缀，色值全部来自 styles/95-paper-theme.css 的令牌。 */

type CardProps = {
  title?: React.ReactNode
  desc?: React.ReactNode
  icon?: LucideIcon
  headRight?: React.ReactNode
  foot?: React.ReactNode
  footHint?: React.ReactNode
  tight?: boolean
  children: React.ReactNode
}

export function Card({ title, desc, icon: Icon, headRight, foot, footHint, tight, children }: CardProps): React.JSX.Element {
  return (
    <section className="mjp-card">
      {(title || headRight) && (
        <header className="mjp-card-hd">
          <div className="ti">
            {Icon ? <Icon size={18} strokeWidth={1.7} className="ico" /> : null}
            {title}
            {desc ? <div className="desc">{desc}</div> : null}
          </div>
          {headRight ? <div className="right">{headRight}</div> : null}
        </header>
      )}
      <div className={`mjp-card-bd${tight ? ' tight' : ''}`}>{children}</div>
      {(foot || footHint) && (
        <footer className="mjp-card-ft">
          {footHint ? <span className="hint">{footHint}</span> : null}
          {foot}
        </footer>
      )}
    </section>
  )
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ai' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
  active?: boolean
}

export function Btn({ variant = 'default', size = 'md', icon: Icon, loading, active, children, className, disabled, ...rest }: BtnProps): React.JSX.Element {
  const classes = ['mjp-btn']
  if (variant !== 'default') classes.push(variant)
  if (size !== 'md') classes.push(size)
  if (active) classes.push('is-active')
  if (loading) classes.push('is-loading')
  if (className) classes.push(className)
  return (
    <button type="button" className={classes.join(' ')} disabled={disabled || loading} {...rest}>
      {loading ? <span className="mjp-spin" aria-hidden="true">◌</span> : Icon ? <Icon size={15} strokeWidth={1.8} /> : null}
      {children}
    </button>
  )
}

export type TagTone = 'default' | 'amber' | 'ai' | 'accent' | 'danger' | 'ok' | 'info' | 'outline'

export function Tag({ tone = 'default', dot, children }: { tone?: TagTone; dot?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={`mjp-tag${tone === 'default' ? '' : ` ${tone}`}`}>
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  )
}

export function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <div className="mjp-kv">
      <span className="k">{label}</span>
      <span className={`v${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  )
}

/**
 * 状态徽标。
 *
 * P3 第一阶段只补语义：`role="status"` 让屏幕阅读器把它当实时区域读出来，
 * 颜色、文案与 DOM 结构一律不动。
 */
export function Status({ tone = 'ok', children }: { tone?: 'ok' | 'warn' | 'danger'; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className={`mjp-status${tone === 'ok' ? '' : ` ${tone}`}`} role="status">
      <i className="dot" />
      {children}
    </span>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="mjp-seg" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? 'is-active' : undefined}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Field({
  label,
  hint,
  tone,
  children
}: {
  label?: string
  hint?: string
  tone?: 'warn' | 'danger'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="mjp-field">
      {label ? <span className="lbl">{label}</span> : null}
      {children}
      {hint ? <span className={`mjp-hint${tone ? ` is-${tone}` : ''}`}>{hint}</span> : null}
    </label>
  )
}

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  disabled?: boolean
  lockedHint?: string
} & Omit<React.LabelHTMLAttributes<HTMLLabelElement>, 'onChange' | 'children'>

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  lockedHint,
  ...rest
}: SwitchProps): React.JSX.Element {
  // 其余原生属性（如 data-testid / aria-*）一并透传到外层 label，
  // 让自动化测试能稳定定位这个受控开关，而不必依赖内部结构。
  return (
    <label className={`mjp-switch${disabled ? ' is-locked' : ''}`} title={disabled ? lockedHint : undefined} {...rest}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  )
}

export function Stat({ label, value, unit, tone }: { label: string; value: React.ReactNode; unit?: string; tone?: 'warn' | 'ai' }): React.JSX.Element {
  return (
    <div className={`mjp-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="k">{label}</span>
      <span className="v">{value}{unit ? <small>{unit}</small> : null}</span>
    </div>
  )
}

/**
 * 进度条。
 *
 * P3 第一阶段只补语义：`role="progressbar"` + 四个 aria 值属性，
 * 让「当前百分之几」在无障碍树里可读；宽度计算、颜色与 DOM 结构一律不动。
 * `percent` 必须是**真实**进度，本组件不提供任何伪造或动画补间。
 */
export function Meter({ percent, tone }: { percent: number; tone?: 'ai' | 'ok' | 'warn' }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div
      className={`mjp-meter${tone ? ` ${tone}` : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped}%`}
    >
      <i style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mjp-empty" data-state="empty">
      {Icon ? <Icon size={34} strokeWidth={1.5} /> : null}
      <h4>{title}</h4>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

/**
 * 提示条。
 *
 * P3 第一阶段只新增一个可选的 `state`：它会原样落成 `data-state`，
 * 让「这条提示属于哪个语义阶段」可被 CSS 与测试定位。
 * 不新增任何可见 UI、文案或布局结构——`tone` 与内容渲染完全保持原样。
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  state,
  ...rest
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ai'
  title?: string
  children: React.ReactNode
  action?: React.ReactNode
  /** 语义阶段；给出时落成 `data-state`，不给则不输出该属性。 */
  state?: AsyncState
} & Omit<React.ComponentPropsWithoutRef<'div'>, 'title'>): React.JSX.Element {
  return (
    <div className={`mjp-banner ${tone}`} data-state={state} {...rest}>
      <div style={{ flex: 1 }}>
        {title ? <b>{title}</b> : null}
        {children}
      </div>
      {action ? <div className="right">{action}</div> : null}
    </div>
  )
}
