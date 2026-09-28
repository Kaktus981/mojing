import { Lock, ShieldCheck, Waypoints } from 'lucide-react'
import { useState } from 'react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { Banner, EmptyState, KV, Stat, Tag, type TagTone } from '../../../ui/Primitives'
import { PlotThreadManualPanel } from './MemoryManualPanels'
import type { ForeshadowingModel, ThreadEvidenceRow, ThreadRow } from './memoryModel'

type ThreadFilter = 'all' | 'open' | 'overdue'

const FILTERS: readonly { value: ThreadFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'open', label: '未回收' },
  { value: 'overdue', label: '逾期' }
]

function statusTone(status: string): TagTone {
  if (status === '逾期') return 'danger'
  if (status === '已回收') return 'ok'
  if (status === '推进中' || status === '已埋设') return 'accent'
  if (status === '已放弃') return 'outline'
  return 'amber'
}

/**
 * 页面 4/5 · 伏笔中心。
 *
 * 只读梳理：证据池、认知差、状态历史、回收准备度四块全部来自 `project.plotThreads`。
 *
 * 两条本页独有的红线：
 *   - **不渲染删除入口**。有证据 / 引用 / 状态历史的伏笔会被 `threadHasHistory`
 *     标记为受保护，本页连按钮都不放（而不是放一个点了没反应的假入口）。
 *     作废走真实状态「已放弃」，它保留全部证据与历史。
 *   - **不伪造准备度**。`readiness.assessed` 为 false 时写「未评估」，
 *     并把历史遗留的 `revealReadiness` 数值单独标为「旧字段」显示，不冒充评分。
 */
export function ForeshadowingPage({ model, project, chapterId }: { model: ForeshadowingModel; project: NovelProject; chapterId?: string }): React.JSX.Element {
  const [filter, setFilter] = useState<ThreadFilter>('all')

  if (!model.hasProject) {
    return (
      <EmptyState icon={Waypoints} title="尚未打开项目" description="伏笔依附于具体项目，请先打开一个作品。" />
    )
  }

  const rows = model.threads.filter((thread) => {
    if (filter === 'open') return !['已回收', '已放弃'].includes(thread.status)
    if (filter === 'overdue') return thread.status === '逾期'
    return true
  })

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="伏笔" value={model.counts.total} unit=" 条" />
        <Stat label="未回收" value={model.counts.open} unit=" 条" />
        <Stat label="逾期" value={model.counts.overdue} unit=" 条" tone={model.counts.overdue > 0 ? 'warn' : undefined} />
        <Stat label="受保护（禁硬删）" value={model.counts.protectedFromDelete} unit=" 条" />
        <Stat label="准备度未评估" value={model.counts.unassessedReadiness} unit=" 条" tone={model.counts.unassessedReadiness > 0 ? 'warn' : undefined} />
      </div>

      <Banner tone="info" title={model.notice.title}>{model.notice.detail}</Banner>

      <PlotThreadManualPanel project={project} chapterId={chapterId} />

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        证据池分布
        <span className="idx">按证据阶段汇总全部伏笔</span>
      </div>
      <div className="mjp-coverage">
        {model.phases.map((phase) => (
          <div key={phase.phase} className={`mjp-cov${phase.count > 0 ? '' : ' is-empty'}`}>
            <span className="nm">{phase.phase}</span>
            <span className="ct">{phase.count}</span>
          </div>
        ))}
      </div>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        伏笔明细
        <span className="idx">共 {rows.length} 条 · 可在上方手写维护伏笔</span>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div className="mjp-seg" role="tablist">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={item.value === filter}
              className={item.value === filter ? 'is-active' : undefined}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {model.threads.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          这个项目还没有登记任何伏笔。可在上方填写名称，直接新建一条伏笔。
        </p>
      ) : rows.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>当前筛选条件下没有伏笔。</p>
      ) : (
        rows.map((thread) => <ThreadCard key={thread.id} thread={thread} />)
      )}
    </>
  )
}

function ThreadCard({ thread }: { thread: ThreadRow }): React.JSX.Element {
  return (
    <section className="mjp-card mjp-thread" style={{ marginBottom: 12 }}>
      <div className="mjp-card-hd">
        <div className="ti">
          {thread.title || '未命名伏笔'}
          <div className="desc">{thread.detail || '未填写说明'}</div>
        </div>
        <div className="right mjp-tag-row" style={{ marginTop: 0 }}>
          <Tag tone={statusTone(thread.status)} dot>{thread.status}</Tag>
          {thread.archivedFromStatus && <Tag tone="outline">作废前：{thread.archivedFromStatus}</Tag>}
          {thread.protectedFromDelete && <Tag tone="info">受保护</Tag>}
        </div>
      </div>

      <div className="mjp-card-bd">
        <div className="mjp-window" style={{ marginBottom: 12 }}>
          <KV label="埋设章" value={thread.setup.chapterNumber !== undefined ? `第 ${thread.setup.chapterNumber} 章` : '尚未埋设'} mono />
          <KV label="埋设方式" value={thread.setup.method || '未填写'} />
          <KV label="计划回收章" value={thread.payoff.targetChapter !== undefined ? `第 ${thread.payoff.targetChapter} 章` : '未计划'} mono />
          <KV label="实际回收章" value={thread.payoff.resolutionChapterNumber !== undefined ? `第 ${thread.payoff.resolutionChapterNumber} 章` : '尚未回收'} mono />
          <KV label="回收方式" value={thread.payoff.method || '未填写'} />
          <KV label="最近更新" value={thread.updatedAt} mono />
        </div>

        <div className="mjp-thread-sec">
          <div className="h">
            证据池
            <span className="idx">{thread.evidence.length} 项 · 含 {thread.evidence.filter((item) => item.legacy).length} 项来自旧版记录</span>
          </div>
          {thread.evidence.length === 0 ? (
            <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>还没有任何证据记录。</p>
          ) : (
            <ul className="mjp-evidence-pool">
              {thread.evidence.map((item) => <EvidenceRow key={item.id} item={item} />)}
            </ul>
          )}
          {thread.byPhase.length > 0 && (
            <div className="mjp-tag-row">
              {thread.byPhase.map((phase) => (
                <Tag key={phase.phase} tone={phase.count > 0 ? 'accent' : 'outline'}>
                  {phase.phase} {phase.count}
                </Tag>
              ))}
            </div>
          )}
        </div>

        <div className="mjp-thread-sec">
          <div className="h">认知差<span className="idx">读者 / 主角 / 其他角色各自知道什么</span></div>
          {thread.cognition ? (
            <>
              <div className="rows">
                <KV label="读者" value={thread.cognition.reader || '未填写'} />
                <KV label="主角" value={thread.cognition.protagonist || '未填写'} />
              </div>
              {thread.cognition.others.length > 0 && (
                <ul className="mjp-evidence-list">
                  {thread.cognition.others.map((item) => (
                    <li key={item.name}>
                      {item.name}：{item.knowledge || '未填写'}（依据证据 {item.evidenceCount} 项）
                    </li>
                  ))}
                </ul>
              )}
              <p className="mjp-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                认知差小结：{thread.cognition.gapSummary || '未填写'}
                {thread.cognition.updatedAt ? ` · 更新于 ${thread.cognition.updatedAt}` : ''}
              </p>
            </>
          ) : thread.legacyCognitiveGap ? (
            <>
              <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>{thread.legacyCognitiveGap}</p>
              <div className="mjp-jump-list" style={{ marginTop: 8 }}>
                <div className="mjp-unassessed">
                  <span className="k">结构化认知差</span>
                  <span className="v">未记录（只有旧版数据）</span>
                </div>
              </div>
            </>
          ) : (
            <div className="mjp-jump-list">
              <div className="mjp-unassessed">
                <span className="k">认知差</span>
                <span className="v">未记录</span>
              </div>
            </div>
          )}
        </div>

        <div className="mjp-thread-sec">
          <div className="h">回收准备度<span className="idx">{thread.readiness.assessed ? `评估于 ${thread.readiness.assessedAt ?? '未记录时间'}` : '尚无评估快照'}</span></div>
          {thread.readiness.assessed ? (
            <>
              <div className="mjp-window" style={{ marginBottom: 10 }}>
                <KV label="评分" value={thread.readiness.score !== undefined ? String(thread.readiness.score) : '未给出'} mono />
                <KV label="等级" value={thread.readiness.level || '未给出'} />
              </div>
              {thread.readiness.fulfilled.length > 0 && (
                <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>已满足：{thread.readiness.fulfilled.join('、')}</p>
              )}
              {thread.readiness.gaps.length > 0 && (
                <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>缺口：{thread.readiness.gaps.join('、')}</p>
              )}
              {thread.readiness.basis.length > 0 && (
                <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>依据：{thread.readiness.basis.join('、')}</p>
              )}
              {thread.readiness.recommendation && (
                <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>建议：{thread.readiness.recommendation}</p>
              )}
            </>
          ) : (
            <>
              <div className="mjp-jump-list">
                <div className="mjp-unassessed">
                  <span className="k">回收准备度</span>
                  <span className="v">未评估</span>
                </div>
              </div>
              <p className="mjp-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                还没有为这条伏笔生成准备度快照。本页不会用证据数量折算成分数。
                {thread.readiness.legacyRevealReadiness !== undefined && (
                  <> 旧版记录里还留着一个准备度数值 <b>{thread.readiness.legacyRevealReadiness}</b>（历史遗留，不是本快照的评分）。</>
                )}
              </p>
            </>
          )}
        </div>

        <div className="mjp-thread-sec">
          <div className="h">状态历史<span className="idx">{thread.history.length} 次变更</span></div>
          {thread.history.length === 0 ? (
            <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>还没有状态变更记录。</p>
          ) : (
            <ul className="mjp-timeline">
              {thread.history.map((item) => (
                <li key={item.id} className="mjp-tl-item">
                  <span className="rail" aria-hidden="true"><span className="dot" /></span>
                  <div className="body">
                    <div className="head">
                      <b>{item.fromStatus} → {item.toStatus}</b>
                      {item.chapterNumber !== undefined && <Tag tone="outline">第 {item.chapterNumber} 章</Tag>}
                      <span className="mjp-muted">{item.changedAt}</span>
                    </div>
                    <span className="mjp-muted" style={{ fontSize: 12 }}>{item.reason || '未填写原因'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mjp-thread-sec">
          <div className="h">删除保护<span className="idx">依据真实引用判定</span></div>
          {thread.protectedFromDelete ? (
            <>
              <p className="mjp-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>
                <ShieldCheck size={12} strokeWidth={1.8} aria-hidden="true" /> 该伏笔已有证据 / 引用 / 状态历史，因此本页不渲染任何删除入口：
              </p>
              <div className="mjp-tag-row" style={{ marginTop: 0 }}>
                {thread.protectionReasons.map((reason) => <Tag key={reason} tone="info">{reason}</Tag>)}
              </div>
              <p className="mjp-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                需要作废时使用真实的「已放弃」状态：它保留全部证据与状态历史。
              </p>
            </>
          ) : (
            <div className="mjp-jump-list">
              <div className="mjp-unassessed">
                <span className="k">受保护</span>
                <span className="v">否（暂无证据、引用与状态历史）</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="mjp-card-ft">
        <span className="hint mjp-row" style={{ gap: 4 }}>
          <Lock size={12} strokeWidth={1.8} aria-hidden="true" />
          证据记录在上方手写维护区；已有证据和状态历史会保留。
        </span>
      </footer>
    </section>
  )
}

function EvidenceRow({ item }: { item: ThreadEvidenceRow }): React.JSX.Element {
  return (
    <li className="mjp-evidence-item">
      <div className="hd">
        <Tag tone={item.phase === '冲突' ? 'danger' : item.phase === '回收' ? 'ok' : 'accent'}>{item.phase}</Tag>
        <span className="ch">{item.chapterNumber !== undefined ? `第 ${item.chapterNumber} 章` : '未标注章号'}</span>
        <Tag tone="outline">{item.status}</Tag>
        {item.legacy && <Tag tone="default">旧版记录</Tag>}
        <span className="src">{item.source}</span>
      </div>
      {item.excerpt && <blockquote className="mjp-evidence">{item.excerpt}</blockquote>}
      <div className="note">
        {item.note || '未填写说明'}
        <span className="mjp-muted"> · 置信度 {item.confidence}</span>
      </div>
    </li>
  )
}

/** 本页不提供硬删除入口 —— 这是结构性声明，测试据此核对页面边界。 */
export const FORESHADOWING_HARD_DELETE_SUPPORTED = false
