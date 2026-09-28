import { GitPullRequestArrow, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Banner, Btn, EmptyState, KV, Segmented, Stat, Tag } from '../../../ui/Primitives'
import type { MemoryProposalsModel, ProposalRow } from './memoryModel'

type ProposalTab = 'pending' | 'resolved' | 'expired'

const TABS: readonly { value: ProposalTab; label: string }[] = [
  { value: 'pending', label: '待确认' },
  { value: 'resolved', label: '已处理' },
  { value: 'expired', label: '已失效' }
]

/**
 * 页面 3/5 · 记忆变更提案。
 *
 * 三方对照是本页的骨架：**当前正式值 / 生成时正式值 / 候选值**。三者放在一起，
 * 作者才能判断提案是不是已经过期——只看候选值是不可能看出来的。
 *
 * 写入边界（硬约束）：
 *   - 逐条接受 / 拒绝与批量处理均走真实接口；批量由服务端事务保证整体成功或回滚。
 *   - 分析生成记忆的摘要修订从章节记忆台账提交为待确认提案。
 *   - 接受按钮只在「待确认」行出现；已处理 / 已失效行不提供任何再次写入的入口。
 */
export function MemoryProposalsPage({ model, busy, onResolve, onBatchResolve, onOpenLedger }: {
  model: MemoryProposalsModel
  /** store 的真实忙碌态：写入期间禁用按钮，避免并发提交。 */
  busy: boolean
  onResolve: (id: string, status: '已接受' | '已拒绝') => void
  onBatchResolve: (ids: string[], status: '已接受' | '已拒绝') => void
  onOpenLedger: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<ProposalTab>('pending')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  if (!model.hasProject) {
    return (
      <EmptyState
        icon={GitPullRequestArrow}
        title="尚未打开项目"
        description="记忆提案依附于具体项目，请先打开一个作品。"
      />
    )
  }

  const rows = tab === 'pending' ? model.pending : tab === 'resolved' ? model.resolved : model.expired
  const activeIds = selectedIds.filter((id) => model.pending.some((row) => row.id === id))

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="待确认" value={model.counts.pending} unit=" 条" tone={model.counts.pending > 0 ? 'warn' : undefined} />
        <Stat label="已处理" value={model.counts.resolved} unit=" 条" />
        <Stat label="已失效" value={model.counts.expired} unit=" 条" />
        <Stat label="处理方式" value="逐条或批量" />
      </div>

      <Banner tone="info" title={model.batch.notice.title}>{model.batch.notice.detail}</Banner>
      <div style={{ height: 10 }} />
      <Banner tone="info" title={model.manual.notice.title}>{model.manual.notice.detail}</Banner>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        {TABS.find((item) => item.value === tab)?.label}提案
        <span className="idx">共 {rows.length} 条 · 未接受的提案不会进入正式上下文</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Segmented value={tab} options={TABS} onChange={setTab} />
      </div>

      {tab === 'pending' && model.pending.length > 0 && (
        <div className="mjp-row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <label className="mjp-row" style={{ gap: 6 }}>
            <input type="checkbox" checked={activeIds.length === model.pending.length} disabled={busy}
              onChange={(event) => setSelectedIds(event.target.checked ? model.pending.map((row) => row.id) : [])} />
            全选待确认提案
          </label>
          <span className="mjp-muted">已选 {activeIds.length} 条</span>
          <Btn size="sm" disabled={busy || activeIds.length === 0} onClick={() => onBatchResolve(activeIds, '已拒绝')}>批量拒绝</Btn>
          <Btn size="sm" variant="primary" disabled={busy || activeIds.length === 0} onClick={() => onBatchResolve(activeIds, '已接受')}>批量接受并写入</Btn>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          {tab === 'pending'
            ? '当前没有待确认的记忆提案。保存含有正文的章节后，系统会在后台分析并把候选放到这里。'
            : tab === 'resolved'
              ? '还没有已处理的提案。'
              : '还没有已失效的提案。'}
        </p>
      ) : (
        rows.map((row) => (
          <ProposalCard key={row.id} row={row} busy={busy} onResolve={onResolve} actionable={tab === 'pending'}
            selected={activeIds.includes(row.id)} onSelect={(selected) => setSelectedIds((current) => selected ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} />
        ))
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>人工修订</div>
      <div className="mjp-struct-actions">
        <div className="mjp-struct-action">
          <GitPullRequestArrow size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="main">
            <b>提出摘要修订</b>
            <small>{model.manual.notice.detail}</small>
          </span>
          <Btn size="sm" onClick={onOpenLedger}>前往章节记忆</Btn>
        </div>
      </div>
    </>
  )
}

function ProposalCard({ row, busy, onResolve, actionable, selected, onSelect }: {
  row: ProposalRow
  busy: boolean
  onResolve: (id: string, status: '已接受' | '已拒绝') => void
  actionable: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <article className="mjp-prop" style={{ marginBottom: 12 }}>
      <div className="mjp-prop-h">
        {actionable && <input type="checkbox" aria-label={`选择${row.category}提案`} checked={selected} disabled={busy} onChange={(event) => onSelect(event.target.checked)} />}
        <span className="kind">{row.category}</span>
        <span className="tt">{row.risk}风险 · 置信度 {Math.round(row.confidence * 100)}%</span>
        <span className="src">
          来源：{row.chapterNumber !== undefined ? `第 ${row.chapterNumber} 章 ${row.chapterTitle}` : row.chapterTitle} · {row.createdAt}
        </span>
        <Tag tone={row.status === '待确认' ? 'amber' : row.status === '已接受' ? 'ok' : row.status === '已拒绝' ? 'default' : 'outline'}>
          {row.status}
        </Tag>
      </div>

      <div className="mjp-prop-b is-three">
        <div className="mjp-prop-box">
          <div className="l">当前（正式）</div>
          <div className={`v${row.current.present ? '' : ' muted'}`}>{row.current.text}</div>
          {row.current.detail && <div className="l" style={{ marginTop: 4 }}>{row.current.detail}</div>}
        </div>
        <div className="mjp-prop-box">
          <div className="l">生成时（正式）</div>
          <div className={`v${row.generated.present ? '' : ' muted'}`}>{row.generated.text}</div>
        </div>
        <div className="mjp-prop-box">
          <div className="l">候选（待确认）</div>
          <div className="v">{row.candidate.text}</div>
        </div>
      </div>

      <div style={{ padding: '10px var(--sp-4)', borderTop: '1px solid var(--line-1)' }}>
        <div className="rows">
          <KV label="生效范围" value={row.appliesRange} />
          <KV label="目标记录" value={row.targetId ?? '新增（没有目标记录）'} mono={Boolean(row.targetId)} />
        </div>
        {row.changedSinceGeneration && (
          <Banner tone="warn" title="生成之后正式值又变了">
            提案的「生成时正式值」与当前正式值不一致。接受前请确认候选值仍然适用于现在的内容。
          </Banner>
        )}
        {!row.changedSinceGeneration && row.basedOnStaleText && (
          <Banner tone="warn" title="提案可能已过期">
            提案基于的正文摘要与章节当前摘要不一致，正文已经改过。
          </Banner>
        )}
        {row.changedSinceGeneration && row.basedOnStaleText && (
          <Banner tone="danger" title="既已过期、正式值也变了">
            正文摘要变了，正式值也变了。这条提案建议拒绝后重新生成。
          </Banner>
        )}
        {!row.digestKnown && (
          <p className="mjp-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
            缺少摘要比对依据（正文摘要或提案摘要为空），因此不对「是否过期」做任何推断。
          </p>
        )}
        {row.excerpt && <blockquote className="mjp-evidence">{row.excerpt}</blockquote>}
      </div>

      <div className="mjp-prop-f">
        <span className="conf">逐条或批量确认 · 不自动接受</span>
        <div className="acts">
          <Btn size="sm" onClick={() => setOpen((value) => !value)}>{open ? '收起候选原文' : '查看候选原文'}</Btn>
          {actionable && (
            <>
              <Btn size="sm" disabled={busy} onClick={() => onResolve(row.id, '已拒绝')}>拒绝</Btn>
              <Btn size="sm" variant="primary" disabled={busy} onClick={() => onResolve(row.id, '已接受')}>接受并写入</Btn>
            </>
          )}
          {!actionable && row.status === '已失效' && (
            <span className="conf mjp-row" style={{ gap: 4 }}>
              <ShieldAlert size={12} strokeWidth={1.8} aria-hidden="true" />来源正文已变化，提案不再适用
            </span>
          )}
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 var(--sp-4) 12px' }}>
          <pre className="mjp-json">{row.candidateJson}</pre>
        </div>
      )}
    </article>
  )
}
