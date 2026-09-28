import { GitBranch, Scale } from 'lucide-react'
import { useState } from 'react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { Banner, Btn, Card, EmptyState, KV, Stat, Tag } from '../../../ui/Primitives'
import { formatTime, formatWords, type ReviewPageId, type StoryBranchRow, type StoryBranchesModel } from './reviewModel'

/**
 * 页面 4/4 · 剧情分支。
 *
 * 数据源：`project.branches`（真实分支正文）+ `branchFreshness()`（真实摘要比对）+ `project.revision`。
 *
 * 写入边界：
 *   - 新建分支只记录真实来源章节；生成备选剧情与采用都先产生修改候选，
 *     由作者确认后才写入分支或正式正文；
 *   - 新鲜度一律由 `branchFreshness()` 计算：缺任一方摘要即「来源缺失」，此时禁用采用
 *     并写明原因（无法确认分支基于哪一版正文），而不是猜一个「最新」；
 *   - 归档保留分支历史和来源，不提供直接覆盖正文或硬删除。
 */
export function StoryBranchesPage({
  model,
  project,
  busy,
  onAdopt,
  onCreate,
  onGenerate,
  onArchive,
  onGoTo
}: {
  model: StoryBranchesModel
  project: NovelProject
  busy: boolean
  onAdopt: (branchId: string) => void
  onCreate: (name: string, baseChapterId: string) => string | undefined
  onGenerate: (branchId: string) => void
  onArchive: (branchId: string) => string | undefined
  onGoTo: (page: ReviewPageId) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState(project.chapters[0]?.id ?? '')
  const [createError, setCreateError] = useState<string>()
  if (!model.hasProject) {
    return (
      <EmptyState
        icon={GitBranch}
        title="尚未打开项目"
        description="剧情分支依附于具体项目，请先打开一个作品。"
      />
    )
  }

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 10 }}>
        <Stat label="分支总数" value={model.counts.total} unit=" 条" />
        <Stat label="构思中" value={model.counts.drafting} unit=" 条" />
        <Stat label="可比较" value={model.counts.comparable} unit=" 条" />
        <Stat label="已采用" value={model.counts.adopted} unit=" 条" />
      </div>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="最新" value={model.counts.fresh} unit=" 条" />
        <Stat label="需要重新比较" value={model.counts.stale} unit=" 条" tone={model.counts.stale > 0 ? 'warn' : undefined} />
        <Stat label="来源缺失" value={model.counts.missingSource} unit=" 条" tone={model.counts.missingSource > 0 ? 'warn' : undefined} />
        <Stat label="当前可比较并采用" value={model.counts.adoptable} unit=" 条" />
      </div>

      <Banner tone="info" title={model.notice.title}>{model.notice.detail}</Banner>
      <Card title="创建备选剧情" tight>
        <div className="mjp-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="mjp-input" aria-label="分支名称" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="分支名称" style={{ width: 220 }} />
          <select className="mjp-select" aria-label="分支起点章节" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            {project.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>第 {chapter.chapterNumber} 章 · {chapter.title}</option>)}
          </select>
          <Btn size="sm" disabled={busy || !name.trim() || !sourceId} onClick={() => { const error = onCreate(name.trim(), sourceId); setCreateError(error); if (!error) setName('') }}>创建分支</Btn>
        </div>
        {createError && <p className="mjp-hint is-warn">{createError}</p>}
      </Card>
      <div style={{ height: 10 }} />
      <Banner tone="info" title={model.freshnessNotice.title}>{model.freshnessNotice.detail}</Banner>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        分支列表
        <span className="idx">共 {model.rows.length} 条 · 分支正文与正式正文始终隔离</span>
      </div>

      {model.rows.length === 0 ? (
        <Card title="还没有剧情分支" icon={GitBranch}>
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
            选一章作为起点创建分支，再在分支中生成备选剧情。正式正文不会因此改变。
          </p>
        </Card>
      ) : (
        model.rows.map((row) => (
          <BranchCard key={row.id} row={row} busy={busy} onAdopt={onAdopt} onGenerate={onGenerate} onArchive={onArchive} />
        ))
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去处理
        <span className="idx">采用分支之后，去候选里逐条确认</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('revision-candidates')}>
          <Scale size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">AI 修改候选</span>
          <span className="d">采用分支生成的候选会出现在这里，确认后才会替换正式章节</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('review-issues')}>
          <GitBranch size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">审稿问题</span>
          <span className="d">分支比较若发现连续性冲突，会作为问题出现在这里</span>
        </button>
      </div>
    </>
  )
}

function BranchCard({ row, busy, onAdopt, onGenerate, onArchive }: {
  row: StoryBranchRow
  busy: boolean
  onAdopt: (branchId: string) => void
  onGenerate: (branchId: string) => void
  onArchive: (branchId: string) => string | undefined
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState<string>()

  return (
    <article className="mjp-prop" style={{ marginBottom: 12 }}>
      <div className="mjp-prop-h">
        <span className="kind">{row.status}</span>
        <span className="tt">{row.name}</span>
        <span className="src">更新于 {formatTime(row.updatedAt)}</span>
        <Tag tone={row.freshnessTone === 'ok' ? 'ok' : row.freshnessTone === 'amber' ? 'amber' : 'danger'} dot>
          {row.freshness}
        </Tag>
      </div>

      <div className="mjp-prop-b is-three">
        <div className="mjp-prop-box">
          <div className="l">来源章节</div>
          <div className={`v${row.baseChapterFound ? '' : ' muted'}`}>
            {row.baseChapterFound ? `${row.baseChapterLabel} ${row.baseChapterTitle}` : row.baseChapterLabel}
          </div>
        </div>
        <div className="mjp-prop-box">
          <div className="l">分支正文</div>
          <div className="v">{row.chapterCount} 章 · {formatWords(row.words)} 字</div>
        </div>
        <div className="mjp-prop-box">
          <div className="l">基线版本</div>
          <div className="v">{row.baseRevision ?? '未记录'}</div>
          <div className="l" style={{ marginTop: 4 }}>
            {row.revisionLag === undefined ? '没有基线版本可比对' : row.revisionLag > 0 ? `当前项目版本已前进 ${row.revisionLag} 版` : '与当前项目版本一致'}
          </div>
        </div>
      </div>

      <div style={{ padding: '10px var(--sp-4)', borderTop: '1px solid var(--line-1)' }}>
        {row.description && <p className="mjp-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>{row.description}</p>}
        <div className="rows">
          <KV label="创建时间" value={formatTime(row.createdAt)} />
        </div>
        <Banner tone={row.freshnessTone === 'ok' ? 'info' : row.freshnessTone === 'amber' ? 'warn' : 'danger'} title={`新鲜度：${row.freshness}`}>
          {row.freshnessDetail}
        </Banner>
        {row.adoptBlockedReason && (
          <p className="mjp-hint is-warn" style={{ margin: '8px 0 0' }}>{row.adoptBlockedReason}</p>
        )}
      </div>

      <div className="mjp-prop-f">
        <span className="conf">采用分支先生成候选，确认后才影响正文。</span>
        <div className="acts">
          <Btn size="sm" disabled={busy || row.status === '已归档' || !row.baseChapterFound} onClick={() => onGenerate(row.id)}>生成备选剧情</Btn>
          <Btn size="sm" onClick={() => setOpen((value) => !value)} disabled={row.chapterCount === 0}>
            {open ? '收起分支正文' : `查看分支正文（${row.chapterCount} 章）`}
          </Btn>
          <Btn size="sm" disabled={busy || row.status === '已归档'} onClick={() => setActionError(onArchive(row.id))}>归档分支</Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled={busy || !row.adoptable}
            title={row.adoptBlockedReason}
            onClick={() => onAdopt(row.id)}
          >
            采用并生成候选
          </Btn>
        </div>
      </div>
      {actionError && <p className="mjp-hint is-warn">{actionError}</p>}

      {open && row.chapterCount > 0 && (
        <div style={{ padding: '0 var(--sp-4) 12px' }}>
          {row.chapters.map((chapter) => (
            <div key={chapter.id} className="mjp-health-row">
              <span className="nm">
                <b>{chapter.label}</b>
                <span className="mjp-muted"> · {chapter.title}</span>
              </span>
              <span className="val">{formatWords(chapter.words)} 字</span>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
