import {
  ChevronRight, Eye, LockKeyhole, Plus, SlidersHorizontal, Trash2
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  CreativeCapability, CreativeSeat, NovelProject, ProviderConfigPublic
} from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'
import { Btn, Field, Tag } from '../../../ui/Primitives'

const PHASE_ORDER: CreativeSeat['phase'][] = ['设定阶段', '规划阶段', '写作阶段', '复核阶段', '归档阶段']

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 原始 id（seat-xxx / world-foundation 之类）不直接展示给作者，缺名时用兜底文案。 */
export function safeVisibleLabel(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return fallback
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(trimmed)) return fallback
  return trimmed
}

function seatCapabilitySummary(seat: CreativeSeat, capabilities: CreativeCapability[]): string {
  const attached = capabilities.filter((capability) => seat.capabilityIds.includes(capability.id))
  return attached.length > 0 ? attached.map((capability) => capability.name).join('、') : '未装配额外能力'
}

/**
 * 席位与能力装配（P0-1c）。
 *
 * 席位目录列出全部 AI 分工，选中后再在右侧明细里调启停、模型与能力。
 * 明细行使用 `seat-detail-header`：checkbox 控启停，文案在「已启用 / 已停用」间切换，
 * 启停一律走 `creativeSeats.update`。能力目录在 `capability-catalog-grid`，新增的文字能力
 * 走 `creativeSeats.createCapability`。能力只包含文字约束——不具备脚本或命令权限。
 */
export function SeatCapabilityAssembler({ project }: { project: NovelProject }): React.JSX.Element {
  const [seats, setSeats] = useState<CreativeSeat[]>([])
  const [capabilities, setCapabilities] = useState<CreativeCapability[]>([])
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([])
  const [selectedSeatId, setSelectedSeatId] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customConstraints, setCustomConstraints] = useState('')

  const load = async (): Promise<void> => {
    try {
      const [seatResult, providerResult] = await Promise.all([
        mojingClient.creativeSeats.list(project.id),
        mojingClient.providers.list().catch(() => [])
      ])
      setSeats(seatResult.seats ?? [])
      setCapabilities(seatResult.capabilities ?? [])
      setProviders(providerResult)
      setSelectedSeatId((current) => current && (seatResult.seats ?? []).some((item) => item.id === current)
        ? current
        : seatResult.seats?.[0]?.id ?? '')
    } catch (error) { setNotice(message(error)) }
  }

  useEffect(() => { void load() }, [project.id])

  const selectedSeat = seats.find((item) => item.id === selectedSeatId) ?? seats[0]
  const customCapabilities = capabilities.filter((capability) => capability.source === '用户配置')

  async function updateSeat(patch: Pick<CreativeSeat, 'enabled' | 'providerId' | 'capabilityIds'>): Promise<void> {
    if (!selectedSeat) return
    const seatId = selectedSeat.id
    // 乐观更新：受控 checkbox 必须立刻反映新状态，否则外部观察到的仍是旧值。
    setSeats((items) => items.map((item) => item.id === seatId ? { ...item, ...patch } : item))
    setBusy(true)
    try {
      const result = await mojingClient.creativeSeats.update(project.id, seatId, patch)
      setSeats(result.seats ?? [])
      setCapabilities(result.capabilities ?? capabilities)
      setNotice(patch.enabled === selectedSeat.enabled ? '席位设置已保存。' : patch.enabled ? '席位已启用。' : '席位已停用。')
    } catch (error) { setNotice(message(error)); await load() } finally { setBusy(false) }
  }

  async function createCapability(): Promise<void> {
    if (!customName.trim() || !customDescription.trim()) { setNotice('请先填写能力名称和用途说明。'); return }
    setBusy(true)
    try {
      const capability = await mojingClient.creativeSeats.createCapability(project.id, {
        name: customName.trim(), description: customDescription.trim(),
        taskScopes: ['中文审校'], contextScopes: [], permission: '只读分析',
        constraints: customConstraints.split('\n').map((item) => item.trim()).filter(Boolean), taskPreferences: []
      })
      setCapabilities((items) => [...items, capability])
      setCustomName(''); setCustomDescription(''); setCustomConstraints(''); setShowForm(false)
      setNotice('自定义能力已保存。')
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  async function toggleCapability(capability: CreativeCapability): Promise<void> {
    setBusy(true)
    try {
      const updated = await mojingClient.creativeSeats.setCapabilityEnabled(project.id, capability.id, !capability.enabled)
      setCapabilities((items) => items.map((item) => item.id === updated.id ? updated : item))
      setNotice(updated.enabled ? `已启用能力：${updated.name}` : `已停用能力：${updated.name}`)
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  async function removeCapability(capability: CreativeCapability): Promise<void> {
    if (capability.source !== '用户配置' || !window.confirm(`确定删除「${capability.name}」吗？`)) return
    setBusy(true)
    try {
      await mojingClient.creativeSeats.removeCapability(project.id, capability.id)
      await load()
      setNotice('自定义能力已删除。')
    } catch (error) { setNotice(message(error)) } finally { setBusy(false) }
  }

  return (
    <div className="seat-assembler">
      {notice && <div className="mjp-banner info" role="status" data-testid="seat-notice"><div>{notice}</div></div>}

      <div className="seat-assembler-layout">
        <section className="seat-directory">
          <div className="seat-directory-title">
            <h4>AI 分工</h4>
            <span className="mjp-muted">{seats.filter((seat) => seat.enabled).length}/{seats.length} 项分工已启用</span>
          </div>
          <div className="seat-list">
            {PHASE_ORDER.map((phase) => {
              const items = seats.filter((seat) => seat.phase === phase)
              if (items.length === 0) return null
              return (
                <div key={phase} className="seat-phase">
                  <span className="seat-phase-label">{phase.replace('阶段', '')}</span>
                  {items.map((seat) => (
                    <button
                      key={seat.id} type="button"
                      className={`seat-item${selectedSeat?.id === seat.id ? ' selected' : ''}`}
                      onClick={() => setSelectedSeatId(seat.id)}
                    >
                      <i className={seat.enabled ? 'on' : ''} />
                      <span>{safeVisibleLabel(seat.name, '未命名席位')}</span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </section>

        <section className="seat-detail">
          {selectedSeat ? (
            <>
              <header className="seat-detail-header">
                <div>
                  <small className="mjp-muted">{selectedSeat.phase}</small>
                  <h4>{safeVisibleLabel(selectedSeat.name, '未命名席位')}</h4>
                  <p className="mjp-muted">{selectedSeat.responsibility}</p>
                </div>
                <label className="seat-switch">
                  <input
                    type="checkbox"
                    checked={selectedSeat.enabled}
                    disabled={busy}
                    aria-label={`${safeVisibleLabel(selectedSeat.name, '未命名席位')}启用状态`}
                    onChange={(event) => void updateSeat({
                      enabled: event.target.checked, providerId: selectedSeat.providerId, capabilityIds: selectedSeat.capabilityIds
                    })}
                  />
                  <span data-testid="seat-state">{selectedSeat.enabled ? '已启用' : '已停用'}</span>
                </label>
              </header>
              <div className="seat-primary-config">
                <label>使用模型
                  <select
                    aria-label="使用模型"
                    value={selectedSeat.providerId ?? ''} disabled={busy}
                    onChange={(event) => void updateSeat({
                      enabled: selectedSeat.enabled, providerId: event.target.value || undefined, capabilityIds: selectedSeat.capabilityIds
                    })}
                  >
                    <option value="">跟随全局模型设置</option>
                    {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}
                  </select>
                </label>
                <p className="mjp-muted">当前能力：{seatCapabilitySummary(selectedSeat, capabilities)}</p>
              </div>
              <p className="mjp-hint">
                <LockKeyhole size={13} /> {selectedSeat.locked
                  ? '内置席位的职责不可改写，只能调整启停、模型和能力。'
                  : '这是项目级配置，不会执行外部脚本或写入正式正文。'}
              </p>
            </>
          ) : <p className="mjp-muted">暂时没有可配置的 AI 分工。</p>}
        </section>
      </div>

      <details className="capability-catalog">
        <summary>
          <span className="mjp-row" style={{ gap: 6 }}>
            <Eye size={16} /><strong>高级能力管理</strong>
            <span className="mjp-muted">{customCapabilities.length} 项自定义能力</span>
          </span>
          <ChevronRight size={15} />
        </summary>
        <div className="capability-catalog-body">
          <div className="capability-catalog-toolbar">
            <p className="mjp-muted">可以停用能力，或添加只包含文字约束的自定义能力。能力不具备脚本或命令权限。</p>
            <Btn size="sm" icon={Plus} onClick={() => setShowForm((value) => !value)}>
              {showForm ? '收起新增表单' : '新增文字能力'}
            </Btn>
          </div>
          <p className="mjp-muted" data-testid="capability-mount-note">内置能力由所在栏目决定是否装配。</p>
          {showForm && (
            <div className="custom-capability-form">
              <Field label="能力名称"><input aria-label="能力名称" value={customName} maxLength={40} onChange={(event) => setCustomName(event.target.value)} placeholder="例如：克制修辞检查" /></Field>
              <Field label="用途说明"><input aria-label="用途说明" value={customDescription} maxLength={500} onChange={(event) => setCustomDescription(event.target.value)} placeholder="说明它应检查什么" /></Field>
              <Field label="文字约束"><textarea aria-label="文字约束" rows={3} value={customConstraints} onChange={(event) => setCustomConstraints(event.target.value)} placeholder="每行一条，只能填写创作约束" /></Field>
              <Btn size="sm" variant="primary" icon={Plus} disabled={busy} onClick={() => void createCapability()}>保存文字能力</Btn>
            </div>
          )}
          <div className="capability-catalog-grid">
            {capabilities.length === 0 ? (
              <p className="mjp-muted">当前没有任何能力。</p>
            ) : capabilities.map((capability) => (
              <article key={capability.id} className="capability-card">
                <header>
                  <strong>{capability.name}</strong>
                  <label>
                    <input type="checkbox" checked={capability.enabled} disabled={busy} onChange={() => void toggleCapability(capability)} />
                    {capability.enabled ? '可用' : '停用'}
                  </label>
                </header>
                <p>{capability.description}</p>
                {/*
                  适用范围直接取**该能力自己声明的** taskScopes（不在前端另写一份 id → 范围映射表）。
                  文案用「适用任务：」而不是「适用：」：它只说明**能力自己的用途声明**，不等于
                  「在这些栏目里都会自动装配」——内置能力的实际装配由所在栏目决定（见下方面板说明）。
                  只在内置能力卡片上渲染：用户配置能力的「适用：」在「技能库」列表里已渲染，这里不重复。
                */}
                {capability.source === '内置' && capability.taskScopes.length > 0 && (
                  <p className="mjp-muted" data-testid="capability-scope">适用任务：{capability.taskScopes.join('、')}</p>
                )}
                <footer>
                  <Tag tone="outline">{capability.source}</Tag>
                  <Tag tone="outline">{capability.permission}</Tag>
                  {capability.source === '用户配置' && (
                    <Btn size="sm" variant="ghost" icon={Trash2} aria-label={`删除${capability.name}`} disabled={busy} onClick={() => void removeCapability(capability)} />
                  )}
                </footer>
              </article>
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}

/**
 * 「高级设置」折叠面板：模型、AI 分工与执行能力。
 *
 * 展开后才显示各席位明细与能力目录；未展开时连主语「席位」都不可见，
 * 与「通常不需要修改」的引导一致。任务中心与助手与技能页共用同一面板，避免两份实现。
 */
export function SeatAssemblyPanel({ project }: { project: NovelProject }): React.JSX.Element {
  return (
    <details className="mjp-card creative-seat-settings">
      <summary>
        <span className="mjp-row" style={{ gap: 6 }}>
          <SlidersHorizontal size={18} /><strong>高级设置</strong>
          <span className="mjp-muted">模型、AI 分工与执行能力</span>
        </span>
        <ChevronRight size={17} />
      </summary>
      <div className="mjp-card-bd">
        <p className="mjp-muted">通常不需要修改。只有需要更换模型、停用某项分工或添加特殊文字要求时再展开设置。</p>
        <SeatCapabilityAssembler project={project} />
      </div>
    </details>
  )
}
