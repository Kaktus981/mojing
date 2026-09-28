import { Plus, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { Banner, Btn, Card, EmptyState, Field, KV, Segmented, Stat, Tag } from '../../../ui/Primitives'
import { formatTime, type ReviewIssueRow, type ReviewIssuesModel, type ReviewPageId } from './reviewModel'
import {
  MANUAL_EVIDENCE_PREFIX,
  REVIEW_CATEGORIES,
  REVIEW_METHODS_REQUIRING_REASON,
  REVIEW_RESOLUTION_METHODS,
  REVIEW_SEVERITIES,
  reviewEvidenceProblem,
  type ReviewEvidenceDraft,
  type ReviewResolutionMethod
} from './reviewWriting'

type IssueFilter = 'pending' | 'missing' | 'closed' | 'all'

const FILTERS: readonly { value: IssueFilter; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'missing', label: '缺少处理记录' },
  { value: 'closed', label: '已结束' },
  { value: 'all', label: '全部' }
]

const STATUS_OPTIONS: readonly ('待处理' | '已完成' | '已忽略')[] = ['待处理', '已完成', '已忽略']

export type IssueCreateInput = {
  category: string
  severity: string
  title: string
  description: string
  recommendation: string
  chapterId?: string
  evidence: ReviewEvidenceDraft[]
}

export type IssueResolveInput = {
  method: ReviewResolutionMethod
  reason: string
  evidence: ReviewEvidenceDraft[]
  status: '已完成' | '已忽略'
}

/**
 * 页面 2/4 · 审稿问题。
 *
 * 数据源：`project.reviews`（真实问题、证据与状态）+ `reviewResolutionState()` 计算的处理记录完整度。
 *
 * 写入边界（全部走同一条 `updateProject` 保存通道，没有第二条）：
 *   - 人工**新建问题**：必须挂真实章节；证据只能是真实段落里的原文，或写成「作者手动说明：…」；
 *   - **记录处理意见**：忽略类处理必须写理由；声明「正文已手动修复」必须附新的正文证据；
 *   - **重新打开**：状态回到待处理，上次处理记录保留作为历史，不删除也不覆盖；
 *   - 任何状态变化都**不会自动改写正文**。
 */
export function ReviewIssuesPage({
  model,
  project,
  busy,
  onCreate,
  onResolve,
  onReopen,
  onGoTo
}: {
  model: ReviewIssuesModel
  project: NovelProject
  busy: boolean
  /** 返回失败原因（成功时为 undefined），由本页就地提示。 */
  onCreate: (input: IssueCreateInput) => string | undefined
  onResolve: (id: string, input: IssueResolveInput) => string | undefined
  onReopen: (id: string) => string | undefined
  onGoTo: (page: ReviewPageId) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState<IssueFilter>('pending')
  const [message, setMessage] = useState<string>()
  const [category, setCategory] = useState<string>(REVIEW_CATEGORIES[0])
  const [severity, setSeverity] = useState<string>(REVIEW_SEVERITIES[1])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [blockId, setBlockId] = useState('')

  const chapters = useMemo(
    () => [...project.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber),
    [project.chapters]
  )
  const blocks = useMemo(() => chapters.find((chapter) => chapter.id === chapterId)?.blocks ?? [], [chapters, chapterId])

  if (!model.hasProject) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="尚未打开项目"
        description="审稿问题依附于具体项目，请先打开一个作品。"
      />
    )
  }

  const rows = model.rows.filter((row) => {
    if (filter === 'pending') return row.status === '待处理'
    if (filter === 'missing') return row.resolutionState === '缺少处理记录'
    if (filter === 'closed') return row.status !== '待处理'
    return true
  })

  /** 证据来自真实段落：默认取该段落的原文，作者可改成「作者手动说明：…」。 */
  const suggestedEvidence = (): ReviewEvidenceDraft[] => {
    if (!chapterId) return []
    const block = blocks.find((item) => item.id === blockId) ?? blocks[0]
    if (!block) return []
    return [{ chapterId, blockId: block.id, excerpt: block.text.trim().slice(0, 200) || `${MANUAL_EVIDENCE_PREFIX}这一章还没有正文` }]
  }

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 10 }}>
        <Stat label="待处理" value={model.counts.pending} unit=" 条" tone={model.counts.pending > 0 ? 'warn' : undefined} />
        <Stat label="其中高风险" value={model.counts.severe} unit=" 条" tone={model.counts.severe > 0 ? 'warn' : undefined} />
        <Stat label="已完成" value={model.counts.completed} unit=" 条" />
        <Stat label="已忽略" value={model.counts.ignored} unit=" 条" />
      </div>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="缺少处理记录" value={model.counts.missingResolution} unit=" 条" tone={model.counts.missingResolution > 0 ? 'warn' : undefined} />
        <Stat label="关联候选" value={model.counts.linked} unit=" 条" />
        <Stat label="问题总数" value={model.counts.total} unit=" 条" />
        <Stat label="人工新建" value="可用" />
      </div>

      {/* 人工新建问题：任何一条人工问题都必须能定位到章节或写成作者手动说明 */}
      <Card title="新建审稿问题" icon={Plus} tight>
        <div className="mjp-grid-2">
          <Field label="问题类别">
            <select className="mjp-select" aria-label="问题类别" value={category} onChange={(event) => setCategory(event.target.value)}>
              {REVIEW_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="影响程度">
            <select className="mjp-select" aria-label="影响程度" value={severity} onChange={(event) => setSeverity(event.target.value)}>
              {REVIEW_SEVERITIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="关联章节" hint="可以只选章节，不指定段落。">
            <select
              className="mjp-select"
              aria-label="关联章节"
              value={chapterId}
              onChange={(event) => { setChapterId(event.target.value); setBlockId('') }}
            >
              <option value="">不关联具体章节</option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>第{chapter.chapterNumber}章 · {chapter.title || '未命名'}</option>
              ))}
            </select>
          </Field>
          <Field label="证据段落" hint="选中段落会默认带上该段原文；也可以改写成「作者手动说明：…」。">
            <select
              className="mjp-select"
              aria-label="证据段落"
              value={blockId}
              disabled={!chapterId}
              onChange={(event) => setBlockId(event.target.value)}
            >
              <option value="">{chapterId ? '整个章节（不指段落）' : '请先选择章节'}</option>
              {blocks.map((block, index) => (
                <option key={block.id} value={block.id}>第 {index + 1} 段 · {block.text.slice(0, 20) || '（空段落）'}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="问题标题">
          <input className="mjp-input" aria-label="问题标题" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="具体描述" hint="写清楚哪里不对、为什么不对。">
          <textarea className="mjp-textarea" rows={3} aria-label="问题描述" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="修改建议（可选）">
          <textarea className="mjp-textarea" rows={2} aria-label="修改建议" value={recommendation} onChange={(event) => setRecommendation(event.target.value)} />
        </Field>
        <div className="mjp-row" style={{ marginTop: 6 }}>
          <Btn
            icon={Plus}
            variant="primary"
            disabled={busy || !title.trim() || !description.trim()}
            onClick={() => {
              const failure = onCreate({
                category, severity, title, description, recommendation,
                chapterId: chapterId || undefined,
                evidence: suggestedEvidence()
              })
              setMessage(failure)
              if (failure) return
              setTitle('')
              setDescription('')
              setRecommendation('')
            }}
          >
            记录这条问题
          </Btn>
        </div>
      </Card>

      {message && <Banner tone="warn" title="这次操作没有生效">{message}</Banner>}

      <Banner tone="info" title={model.notice.title}>{model.notice.detail}</Banner>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        风险分布
      </div>
      <div className="mjp-coverage">
        {model.bySeverity.map((entry) => (
          <div key={entry.severity} className={`mjp-cov${entry.total ? '' : ' is-empty'}`}>
            <span className="nm">{entry.severity}风险</span>
            <span className="ct">{entry.total} 条 / 待处理 {entry.pending}</span>
          </div>
        ))}
      </div>
      {model.byCategory.length > 0 && (
        <>
          <div className="mjp-sec-h" style={{ marginTop: 18 }}>
            按类别
            <span className="idx">只列出真实存在问题的类别</span>
          </div>
          <div className="mjp-coverage">
            {model.byCategory.map((entry) => (
              <div key={entry.category} className="mjp-cov">
                <span className="nm">{entry.category}</span>
                <span className="ct">{entry.total} 条 / 待处理 {entry.pending}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        问题列表
        <span className="idx">共 {rows.length} 条 · 证据可定位到章节与段落</span>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Segmented value={filter} options={FILTERS} onChange={setFilter} />
      </div>

      {model.rows.length === 0 ? (
        <Card title="还没有审稿记录" icon={ShieldAlert}>
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
            用上面的表单记录你在阅读中发现的问题，或运行连续性冷读，让系统生成带证据的问题。
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          {filter === 'pending'
            ? '当前没有待处理的审稿问题。'
            : filter === 'missing'
              ? '没有缺少处理记录的问题 —— 已结束的问题都带有处理记录。'
              : '还没有已结束的问题。'}
        </p>
      ) : (
        rows.map((row) => (
          <IssueCard
            key={row.id}
            row={row}
            project={project}
            busy={busy}
            onResolve={onResolve}
            onReopen={onReopen}
          />
        ))
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去处理
        <span className="idx">问题不会自动消失，需要你逐条决定</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('revision-candidates')}>
          <ShieldAlert size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">AI 修改候选</span>
          <span className="d">把问题变成候选后逐条确认，应用候选不等于问题已完成</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('export-manuscript')}>
          <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">导出成稿</span>
          <span className="d">确认问题处理情况后再导出</span>
        </button>
      </div>
    </>
  )
}

function IssueCard({ row, project, busy, onResolve, onReopen }: {
  row: ReviewIssueRow
  project: NovelProject
  busy: boolean
  onResolve: (id: string, input: IssueResolveInput) => string | undefined
  onReopen: (id: string) => string | undefined
}): React.JSX.Element {
  const issue = project.reviews.find((item) => item.id === row.id)
  const chapter = project.chapters.find((item) => item.id === issue?.chapterId)
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<ReviewResolutionMethod>(REVIEW_RESOLUTION_METHODS[0])
  const [reason, setReason] = useState('')
  const [excerpt, setExcerpt] = useState('')

  const needsReason = REVIEW_METHODS_REQUIRING_REASON.includes(method)
  const needsEvidence = method === '正文已手动修复'
  const firstBlock = chapter?.blocks[0]
  const evidence: ReviewEvidenceDraft[] = needsEvidence && issue?.chapterId
    ? [{ chapterId: issue.chapterId, blockId: firstBlock?.id, excerpt: excerpt.trim() || firstBlock?.text.slice(0, 200) || `${MANUAL_EVIDENCE_PREFIX}已手动修复` }]
    : []
  const evidenceProblem = needsEvidence && evidence[0] ? reviewEvidenceProblem({ chapters: project.chapters, reviews: [] }, evidence[0]) : undefined
  const canSubmit = (!needsReason || reason.trim().length > 0) && (!needsEvidence || (evidence.length > 0 && !evidenceProblem))

  return (
    <article className={`mjp-issue${row.severity === '高' ? ' is-danger' : row.severity === '中' ? ' is-warn' : ''}`}>
      <div className="mjp-issue-h">
        <span className="tt">{row.category}：{row.title}</span>
        <span className="loc">{row.location} · {formatTime(row.createdAt)}</span>
      </div>
      <div className="mjp-issue-b">
        {row.description}
        {row.evidence.slice(0, 3).map((item, index) => (
          <blockquote key={index}>{item.chapterLabel}：{item.excerpt}</blockquote>
        ))}
        {row.recommendation && <p style={{ margin: '8px 0 0' }}><b>建议：</b>{row.recommendation}</p>}
      </div>

      <div style={{ padding: '0 var(--sp-4) 10px' }}>
        <div className="rows">
          <KV label="处理记录" value={row.resolutionState} />
          <KV label="处理方式" value={row.resolutionMethod ?? '未记录'} />
          <KV label="处理时间" value={row.resolutionAt ? formatTime(row.resolutionAt) : '未记录'} />
          <KV label="关联候选" value={`${row.linkedProposalCount} 条`} mono />
        </div>
        {row.resolutionState === '缺少处理记录' && (
          <Banner tone="warn" title="缺少处理记录">
            这条问题已被标记为「{row.status}」，但没有保存处理记录。用下面的表单补录处理方式与理由；本页不会替你伪造一条。
          </Banner>
        )}
        {row.resolutionState === '已记录' && row.resolutionReason && (
          <p className="mjp-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>处理理由：{row.resolutionReason}</p>
        )}

        {open && (
          <div className="mjp-window" style={{ marginTop: 10 }}>
            <Field label="处理方式" hint={needsReason ? '这种处理没有改正文，必须写清理由。' : '记录你的实际处理动作。'}>
              <select
                className="mjp-select"
                aria-label={`${row.title} 处理方式`}
                value={method}
                onChange={(event) => setMethod(event.target.value as ReviewResolutionMethod)}
              >
                {REVIEW_RESOLUTION_METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label={needsReason ? '处理理由（必填）' : '处理理由（可选）'}>
              <textarea
                className="mjp-textarea"
                rows={2}
                aria-label={`${row.title} 处理理由`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {needsEvidence && (
              <Field label="新的正文证据" hint="默认取关联章节第一段的原文；如果只是转述，请写成「作者手动说明：…」。">
                <input
                  className="mjp-input"
                  aria-label={`${row.title} 修复证据`}
                  value={excerpt}
                  placeholder={firstBlock?.text.slice(0, 40) ?? `${MANUAL_EVIDENCE_PREFIX}已手动修复`}
                  onChange={(event) => setExcerpt(event.target.value)}
                />
              </Field>
            )}
            {needsEvidence && evidenceProblem && <Banner tone="warn" title="证据还不能用">{evidenceProblem}</Banner>}
            <div className="mjp-row" style={{ marginTop: 8, gap: 8 }}>
              <Btn size="sm" variant="primary" disabled={busy || !canSubmit} onClick={() => { if (!onResolve(row.id, { method, reason, evidence, status: '已完成' })) setOpen(false) }}>
                记录为已完成
              </Btn>
              <Btn size="sm" disabled={busy || !canSubmit} onClick={() => { if (!onResolve(row.id, { method, reason, evidence, status: '已忽略' })) setOpen(false) }}>
                记录为已忽略
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</Btn>
            </div>
          </div>
        )}
      </div>

      <div className="mjp-issue-f">
        <select
          className="mjp-select"
          style={{ height: 28, fontSize: 12, width: 108 }}
          value={row.status}
          aria-label={`${row.title} 的问题状态`}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value as '待处理' | '已完成' | '已忽略'
            if (next === '待处理') onReopen(row.id)
          }}
        >
          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <Btn size="sm" icon={RotateCcw} disabled={busy} onClick={() => setOpen((previous) => !previous)}>
          {open ? '收起处理记录' : '记录处理意见'}
        </Btn>
        {row.status !== '待处理' && (
          <Btn size="sm" variant="ghost" disabled={busy} onClick={() => onReopen(row.id)}>重新打开</Btn>
        )}
        <Tag tone={row.severityTone} dot>{row.severity}风险</Tag>
        {row.linkedProposalCount > 0 && <Tag tone="ai">关联 {row.linkedProposalCount} 条候选</Tag>}
      </div>
    </article>
  )
}
