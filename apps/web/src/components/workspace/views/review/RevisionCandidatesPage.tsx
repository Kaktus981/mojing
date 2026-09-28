import { CheckCircle2, GitPullRequestArrow, X } from 'lucide-react'
import { useState } from 'react'
import { Banner, Btn, Card, EmptyState, KV, Segmented, Stat, Tag } from '../../../ui/Primitives'
import { formatTime, type RevisionCandidateRow, type RevisionCandidatesModel, type ReviewPageId } from './reviewModel'

type CandidateTab = 'pending' | 'resolved' | 'all'

const TABS: readonly { value: CandidateTab; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'resolved', label: '已处理' },
  { value: 'all', label: '全部' }
]

/**
 * 页面 3/4 · AI 修改候选。
 *
 * 数据源：store 的 `revisions`（真实候选列表）+ `project.revision`（用于判断候选是否已落后）。
 *
 * 写入边界：
 *   - 唯一的写入是**逐条**确认应用 / 永久放弃，走 store 既有的 `applyRevision` /
 *     `rejectRevision`（内部即 `mojingClient.revisions.apply / reject`），不新增第二条通道；
 *   - 批量处理走服务端事务；有一条不能安全应用时整批不写入。
 *   - 候选基线版本落后于当前项目时，如实提示需要重新核对（应用时服务端仍会要求确认）。
 */
export function RevisionCandidatesPage({
  model,
  busy,
  onApply,
  onReject,
  onBatchResolve,
  onGoTo
}: {
  model: RevisionCandidatesModel
  busy: boolean
  onApply: (id: string) => void
  onReject: (id: string) => void
  onBatchResolve: (ids: string[], action: '应用' | '放弃') => void
  onGoTo: (page: ReviewPageId) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<CandidateTab>('pending')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<'应用' | '放弃'>()

  if (!model.hasProject) {
    return (
      <EmptyState
        icon={GitPullRequestArrow}
        title="尚未打开项目"
        description="修改候选依附于具体项目，请先打开一个作品。"
      />
    )
  }

  const rows = model.rows.filter((row) => {
    if (tab === 'pending') return row.status === '待处理'
    if (tab === 'resolved') return row.status !== '待处理'
    return true
  })
  const pendingRows = model.rows.filter((row) => row.status === '待处理')
  const activeRows = pendingRows.filter((row) => selectedIds.includes(row.id))
  const canBatchApply = activeRows.length > 0 && activeRows.every((row) => !row.stale && row.qualityCount === 0 && row.sceneQualityCount === 0 && !row.structureImpact)

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 10 }}>
        <Stat label="待处理" value={model.counts.pending} unit=" 条" tone={model.counts.pending > 0 ? 'warn' : undefined} />
        <Stat label="基线已落后" value={model.counts.stale} unit=" 条" tone={model.counts.stale > 0 ? 'warn' : undefined} />
        <Stat label="已应用" value={model.counts.applied} unit=" 条" />
        <Stat label="已拒绝" value={model.counts.rejected} unit=" 条" />
      </div>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="已冲突" value={model.counts.conflicted} unit=" 条" tone={model.counts.conflicted > 0 ? 'warn' : undefined} />
        <Stat label="关联审稿问题" value={model.counts.linked} unit=" 条" />
        <Stat label="候选总数" value={model.counts.total} unit=" 条" />
        <Stat label="处理方式" value="逐条或批量" />
      </div>

      <Banner tone="info" title={model.notice.title}>{model.notice.detail}</Banner>

      {model.targetGroups.length > 0 && (
        <>
          <div className="mjp-sec-h" style={{ marginTop: 18 }}>
            按改动目标
            <span className="idx">按每条候选要改的地方统计</span>
          </div>
          <div className="mjp-coverage">
            {model.targetGroups.map((group) => (
              <div key={group.target} className="mjp-cov">
                <span className="nm">{group.label}</span>
                <span className="ct">{group.count} 条</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        {TABS.find((item) => item.value === tab)?.label}候选
        <span className="idx">共 {rows.length} 条 · 未确认的候选不会进入正式内容</span>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={tab} options={TABS} onChange={setTab} />
      </div>

      {tab === 'pending' && pendingRows.length > 0 && <div className="mjp-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="mjp-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={activeRows.length === pendingRows.length} disabled={busy}
            onChange={(event) => { setSelectedIds(event.target.checked ? pendingRows.map((row) => row.id) : []); setConfirmAction(undefined) }} />
          全选待处理候选
        </label>
        <span className="mjp-muted">已选 {activeRows.length} 条</span>
        <Btn size="sm" disabled={busy || activeRows.length === 0} onClick={() => setConfirmAction('放弃')}>批量放弃</Btn>
        <Btn size="sm" variant="primary" disabled={busy || !canBatchApply} onClick={() => setConfirmAction('应用')}>批量应用</Btn>
        {activeRows.length > 0 && !canBatchApply && <span className="mjp-muted">过期、带检查或结构调整的候选请逐条核对。</span>}
      </div>}
      {tab === 'pending' && confirmAction && activeRows.length > 0 && <Banner tone="warn" title={`确认${confirmAction} ${activeRows.length} 条候选？`}>
        <div>{activeRows.map((row) => row.summary).join('；')}</div>
        <div className="mjp-row" style={{ gap: 8, marginTop: 8 }}>
          <Btn size="sm" disabled={busy} onClick={() => setConfirmAction(undefined)}>取消</Btn>
          <Btn size="sm" variant="primary" disabled={busy || (confirmAction === '应用' && !canBatchApply)} onClick={() => { onBatchResolve(activeRows.map((row) => row.id), confirmAction); setConfirmAction(undefined) }}>确认{confirmAction}</Btn>
        </div>
      </Banner>}

      {model.rows.length === 0 ? (
        <Card title="没有待处理的候选" icon={CheckCircle2}>
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>AI 产出会先落在这里，确认后才会应用。</p>
        </Card>
      ) : rows.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          {tab === 'pending' ? '当前没有待处理的候选。' : '还没有已处理的候选。'}
        </p>
      ) : (
        rows.map((row) => (
          <CandidateCard
            key={row.id}
            row={row}
            busy={busy}
            onApply={onApply}
            onReject={onReject}
            actionable={tab === 'pending' && row.status === '待处理'}
            selected={selectedIds.includes(row.id)}
            onSelect={(selected) => { setSelectedIds((current) => selected ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id)); setConfirmAction(undefined) }}
          />
        ))
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去核对
        <span className="idx">候选通常因某条问题或分支而产生</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('review-issues')}>
          <GitPullRequestArrow size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">审稿问题</span>
          <span className="d">看候选对应的原始问题与证据</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('story-branches')}>
          <GitPullRequestArrow size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">剧情分支</span>
          <span className="d">比较备选走向，采用分支同样只生成候选</span>
        </button>
      </div>
    </>
  )
}

function CandidateCard({ row, busy, onApply, onReject, actionable, selected, onSelect }: {
  row: RevisionCandidateRow
  busy: boolean
  onApply: (id: string) => void
  onReject: (id: string) => void
  actionable: boolean
  selected: boolean
  onSelect: (selected: boolean) => void
}): React.JSX.Element {
  return (
    <article className="mjp-prop" style={{ marginBottom: 12 }}>
      <div className="mjp-prop-h">
        {actionable && <input type="checkbox" aria-label={`选择${row.summary}`} checked={selected} disabled={busy} onChange={(event) => onSelect(event.target.checked)} />}
        <span className="kind">{row.targetLabel}</span>
        <span className="tt">{row.summary}</span>
        <span className="src">{formatTime(row.createdAt)}</span>
        <Tag tone={row.status === '待处理' ? 'amber' : row.status === '已应用' ? 'ok' : row.status === '已冲突' ? 'danger' : 'default'}>
          {row.status}
        </Tag>
      </div>

      <div className="mjp-prop-b is-three">
        <div className="mjp-prop-box">
          <div className="l">改动目标</div>
          <div className="v">{row.targetLabel}</div>
          <div className="l" style={{ marginTop: 4 }}>{row.targetId ?? '未指定目标记录'}</div>
        </div>
        <div className="mjp-prop-box">
          <div className="l">候选基线版本</div>
          <div className={`v${row.stale ? ' muted' : ''}`}>{row.baseRevision}</div>
          <div className="l" style={{ marginTop: 4 }}>
            {row.stale ? `当前项目版本已前进 ${row.revisionLag} 版` : '与当前项目版本一致'}
          </div>
        </div>
        <div className="mjp-prop-box">
          <div className="l">附带检查</div>
          <div className="v">质量 {row.qualityCount} · 场景 {row.sceneQualityCount}</div>
          <div className="l" style={{ marginTop: 4 }}>生成类型 {row.kind}</div>
        </div>
      </div>

      <div style={{ padding: '10px var(--sp-4)', borderTop: '1px solid var(--line-1)' }}>
        <div className="rows">
          <KV label="关联审稿问题" value={row.linkedReviewTitle ?? (row.reviewId ? row.reviewId : '未关联')} />
          <KV label="结构调整影响" value={row.structureImpact ?? '无'} />
          <KV label="会改动的内容" value={row.candidateFieldLabels.length ? row.candidateFieldLabels.join('、') : '未记录改动了什么'} />
        </div>
        {row.stale && (
          <Banner tone="warn" title="候选生成后项目已变化">
            候选基线版本是 {row.baseRevision}，当前项目版本是 {row.baseRevision + row.revisionLag}。应用前请先核对候选是否仍然适用；应用前会先自动保存一版，并要求你确认。
          </Banner>
        )}
      </div>

      <div className="mjp-prop-f">
        <span className="conf">逐条或批量确认 · 不自动应用</span>
        <div className="acts">
          {actionable ? (
            <>
              <Btn size="sm" icon={X} disabled={busy} onClick={() => onReject(row.id)}>永久放弃</Btn>
              <Btn size="sm" variant="primary" disabled={busy} onClick={() => onApply(row.id)}>确认应用</Btn>
            </>
          ) : (
            <span className="conf">{row.status === '待处理' ? '切到「待处理」页签后逐条确认' : '已处理，不能再改'}</span>
          )}
        </div>
      </div>
    </article>
  )
}
