import { AlertTriangle, Brain, ClipboardList, GitPullRequestArrow, Radar, Waypoints } from 'lucide-react'
import { Banner, EmptyState, KV, Stat, Tag } from '../../../ui/Primitives'
import type { MemoryPageId, MemoryWorkbenchModel } from './memoryModel'

/**
 * 页面 1/5 · 记忆工作台。
 *
 * 数据源：目标章节（`selectedChapterId` 或章号最大的章节）、`project.memories`、
 * store 的 `memoryProposals`、`project.plotThreads`，以及 store 的 `memoryHealth`。
 *
 * 诚实边界：`memoryHealth` 是后端真实快照。拿不到快照时**不折算、不估百分比**，
 * 直接写「未评估」——本页刻意不使用 Meter，避免出现看起来像评分的东西。
 */
export function MemoryWorkbenchPage({ model, onGoTo }: {
  model: MemoryWorkbenchModel
  onGoTo: (page: MemoryPageId) => void
}): React.JSX.Element {
  if (!model.hasProject) {
    return (
      <EmptyState
        icon={Brain}
        title="尚未打开项目"
        description="记忆与伏笔都依附于具体项目，请先打开一个作品。"
      />
    )
  }

  return (
    <>
      <section className="mjp-card">
        <div className="mjp-card-hd">
          <div className="ti">目标章节</div>
          <div className="right">
            {model.target ? (
              <Tag tone={model.target.source === '已选章节' ? 'accent' : 'outline'}>
                {model.target.source}
              </Tag>
            ) : null}
          </div>
        </div>
        <div className="mjp-card-bd">
          {model.target ? (
            <>
              <div className="mjp-window">
                <KV label="章号" value={`第 ${model.target.chapterNumber} 章`} mono />
                <KV label="标题" value={model.target.title || '未命名'} />
                <KV label="正文状态" value={model.target.status} />
                <KV label="章节来源" value={model.target.source} />
              </div>
              <p className="mjp-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
                目标章节决定「长篇记忆召回」按哪一章筛选生效范围；没有选中章节时默认取章号最大的一章，并在上方如实标注来源。
              </p>
            </>
          ) : (
            <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
              项目里还没有章节。记忆与伏笔都按章号生效，请先在正文创作里建立第一章。
            </p>
          )}
        </div>
      </section>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        真实记忆状态
      </div>
      <div className="mjp-stats">
        <Stat label="章节记忆" value={model.memories.total} unit=" 章" />
        <Stat label="正式记忆" value={model.memories.formal} unit=" 章" />
        <Stat label="需更新" value={model.memories.needsUpdate} unit=" 章" tone={model.memories.needsUpdate > 0 ? 'warn' : undefined} />
        <Stat label="待复核" value={model.memories.pendingReview} unit=" 章" />
      </div>
      <div className="mjp-stats" style={{ marginTop: 10 }}>
        <Stat label="待确认提案" value={model.proposals.pending} unit=" 条" tone={model.proposals.pending > 0 ? 'warn' : undefined} />
        <Stat label="未回收伏笔" value={model.threads.open} unit=" 条" />
        <Stat label="逾期伏笔" value={model.threads.overdue} unit=" 条" tone={model.threads.overdue > 0 ? 'warn' : undefined} />
        <Stat label="受保护伏笔" value={model.threads.protectedFromDelete} unit=" 条" />
      </div>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        健康检查
        <span className="idx">{model.health.assessed ? '已有检查结果' : '尚无检查结果'}</span>
      </div>
      {model.health.assessed ? (
        <>
          <div className="mjp-coverage">
            {model.health.entries.map((entry) => (
              <div key={entry.key} className={`mjp-cov${entry.value ? '' : ' is-empty'}`}>
                <span className="nm">{entry.label}</span>
                <span className="ct">{entry.value}</span>
              </div>
            ))}
          </div>
          <p className="mjp-muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            最近成功：{model.health.lastSuccessAt ?? '未记录'} · 最近失败：{model.health.lastFailureAt ?? '未记录'}
          </p>
        </>
      ) : (
        <>
          <Banner tone="warn" title="未评估">
            项目里还没有可用的健康检查结果，暂时无法评估。
          </Banner>
          <div className="mjp-jump-list">
            <div className="mjp-unassessed">
              <span className="k">健康检查</span>
              <span className="v">未评估</span>
            </div>
          </div>
        </>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        当前章召回摘要
        <span className="idx">{model.target ? `第 ${model.target.chapterNumber} 章的召回条目数` : '无目标章节'}</span>
      </div>
      {model.target ? (
        <div className="mjp-window">
          <KV label="客观事实" value={`${model.recall.objective} 条`} mono />
          <KV label="角色认知" value={`${model.recall.cognition} 条`} mono />
          <KV label="未来信息已排除" value={`${model.recall.futureExcluded} 条`} mono />
          {model.recall.layers.map((layer) => (
            <KV key={layer.layer} label={layer.layer} value={`${layer.count} 条`} mono />
          ))}
        </div>
      ) : (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>没有目标章节，无法统计当前章召回。</p>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        待处理事项
        <span className="idx">全部由真实计数驱动</span>
      </div>
      {model.todos.length === 0 ? (
        <div className="mjp-jump-list">
          <div className="mjp-jump is-static">
            <ClipboardList size={15} strokeWidth={1.8} aria-hidden="true" />
            <span className="t">当前没有需要处理的记忆或伏笔事项</span>
            <span className="d">依据：无待确认提案、无「需更新」章节记忆、无逾期伏笔</span>
          </div>
        </div>
      ) : (
        <div className="mjp-jump-list">
          {model.todos.map((todo) => (
            <button key={todo.id} type="button" className="mjp-jump" onClick={() => onGoTo(todo.page)}>
              <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" />
              <span className="t">{todo.label}</span>
              <span className="d">{todo.detail}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去核对
        <span className="idx">四个页面各自解决问题</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('memory-recall')}>
          <Radar size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">长篇记忆召回</span>
          <span className="d">看这一章会用到哪些记忆，以及为什么</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('memory-proposals')}>
          <GitPullRequestArrow size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">记忆变更提案</span>
          <span className="d">三方对照后逐条接受或拒绝</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('foreshadowing')}>
          <Waypoints size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">伏笔中心</span>
          <span className="d">核对证据池、认知差与回收准备度</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('memory-ledger')}>
          <Brain size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">正式章节记忆</span>
          <span className="d">只读台账：已确认的章节事实与角色状态</span>
        </button>
      </div>
    </>
  )
}
