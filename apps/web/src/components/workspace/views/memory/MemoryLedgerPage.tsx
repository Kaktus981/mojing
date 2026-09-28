import { BookOpenText, Lock } from 'lucide-react'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { Banner, EmptyState, KV, Stat, Tag } from '../../../ui/Primitives'
import { ChapterMemoryManualPanel } from './MemoryManualPanels'
import type { LedgerRow, MemoryLedgerModel } from './memoryModel'

/**
 * 页面 5/5 · 正式章节记忆（只读台账）。
 *
 * 这一页是**唯一**能看到「已被确认的章节事实」的地方，因此红线最硬：
 *   - 作者手写记忆可在页首维护；分析生成的记忆仍由提案流程修订；
 *   - 不覆盖、不删除旧记录：替换关系只按真实的 `replacesId` 双向展示，
 *     旧记录永远留在台账里，「需更新」只是状态标记，不触发任何自动重写；
 *   - 摘要比对只报事实：`digestMatches` 为 undefined 时写「不做推断」，
 *     绝不把「无法比对」说成「一致」。
 */
export function MemoryLedgerPage({ model, project, chapterId }: { model: MemoryLedgerModel; project: NovelProject; chapterId?: string }): React.JSX.Element {
  if (!model.hasProject) {
    return (
      <EmptyState
        icon={BookOpenText}
        title="尚未打开项目"
        description="正式章节记忆依附于具体项目，请先打开一个作品。"
      />
    )
  }

  return (
    <>
      <div className="mjp-stats" style={{ marginBottom: 14 }}>
        <Stat label="章节记忆" value={model.counts.total} unit=" 章" />
        <Stat label="正式" value={model.counts.formal} unit=" 章" />
        <Stat label="需更新" value={model.counts.needsUpdate} unit=" 章" tone={model.counts.needsUpdate > 0 ? 'warn' : undefined} />
        <Stat label="待复核" value={model.counts.pendingReview} unit=" 章" />
        <Stat label="含替换链" value={model.counts.withReplacementChain} unit=" 章" />
      </div>

      <ChapterMemoryManualPanel project={project} chapterId={chapterId} />

      <Banner tone="info" title="本页其余内容只读">
        上方可以维护作者手写记忆，或为分析生成的摘要提交修订提案。正式值只在确认提案后变化。
      </Banner>
      <div style={{ height: 10 }} />
      <Banner tone="info" title={model.manual.notice.title}>{model.manual.notice.detail}</Banner>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        章节记忆台账
        <span className="idx">按章号排列 · {model.rows.length} 章</span>
      </div>

      {model.rows.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          这个项目还没有正式章节记忆。接受记忆提案后，被确认的章节事实会出现在这里。
        </p>
      ) : (
        model.rows.map((row) => <LedgerCard key={row.id} row={row} />)
      )}

      <Banner tone="info" title="历史记录会保留">确认过的修订提案保留原值；条目替换关系也可在台账中核对。</Banner>
    </>
  )
}

function LedgerCard({ row }: { row: LedgerRow }): React.JSX.Element {
  const digestTone = row.digestMatches === undefined ? 'outline' : row.digestMatches ? 'ok' : 'danger'
  const digestLabel = row.digestMatches === undefined ? '无法比对' : row.digestMatches ? '摘要一致' : '摘要已变化'

  return (
    <section className="mjp-card mjp-ledger" style={{ marginBottom: 12 }}>
      <div className="mjp-card-hd">
        <div className="ti">
          第 {row.chapterNumber} 章 · {row.chapterTitle}
          <div className="desc">更新于 {row.updatedAt}</div>
        </div>
        <div className="right mjp-tag-row" style={{ marginTop: 0 }}>
          <Tag tone={row.status === '正式' ? 'ok' : row.status === '需更新' ? 'danger' : 'amber'} dot>{row.status}</Tag>
          <Tag tone={digestTone}>{digestLabel}</Tag>
          {row.replacedBy.length > 0 && <Tag tone="info">被 {row.replacedBy.length} 条条目取代</Tag>}
          {row.replaces.length > 0 && <Tag tone="outline">取代了 {row.replaces.length} 条条目</Tag>}
        </div>
      </div>

      <div className="mjp-card-bd">
        <div className="mjp-ledger-summary">{row.summary || '本章记忆没有摘要。'}</div>

        <p className={`mjp-digest${row.digestMatches === undefined ? ' unknown' : row.digestMatches ? ' ok' : ' warn'}`}>
          {row.digestNote}
        </p>

        <div className="mjp-window" style={{ marginBottom: 12 }}>
          <KV label="事实条目" value={`${row.facts.total} 条`} mono />
          <KV label="已锁定" value={`${row.facts.locked} 条`} mono />
          <KV label="角色状态" value={`${row.characterStates.total} 条`} mono />
          <KV label="原文证据" value={`${row.excerpts.length} 段`} mono />
        </div>

        {row.facts.byCertainty.length > 0 && (
          <div className="mjp-tag-row" style={{ marginTop: 0 }}>
            {row.facts.byCertainty.map((item) => <Tag key={item.certainty} tone="accent">{item.certainty} {item.count}</Tag>)}
          </div>
        )}
        {row.characterStates.perspectives.length > 0 && (
          <div className="mjp-tag-row">
            {row.characterStates.perspectives.map((item) => (
              <Tag key={item.perspective} tone={item.perspective === '角色认知' ? 'ai' : 'default'}>
                {item.perspective} {item.count}
              </Tag>
            ))}
          </div>
        )}

        <div className="mjp-ledger-sec">
          <div className="h">关键事件<span className="idx">{row.keyEvents.length} 条</span></div>
          {row.keyEvents.length === 0 ? (
            <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>未记录关键事件。</p>
          ) : (
            <ul className="mjp-kn">
              {row.keyEvents.map((event, index) => (
                <li key={`${row.id}-ke-${index}`}><span className="t">{event}</span></li>
              ))}
            </ul>
          )}
        </div>

        {(row.objectStates.length > 0 || row.timelineEvents.length > 0 || row.styleSignals.length > 0) && (
          <div className="mjp-ledger-sec">
            <div className="h">其他信息<span className="idx">物品 / 时间线 / 文笔信号</span></div>
            {row.objectStates.length > 0 && (
              <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>物品状态：{row.objectStates.join('；')}</p>
            )}
            {row.timelineEvents.length > 0 && (
              <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>时间线：{row.timelineEvents.join('；')}</p>
            )}
            {row.styleSignals.length > 0 && (
              <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>文笔信号：{row.styleSignals.join('；')}</p>
            )}
          </div>
        )}

        {/*
          替换关系只带条目 id 与对端章号，没有可读标题；裸 id 对作者是噪音，
          所以只按章号锚定，是刻意的取舍。
        */}
        {(row.replaces.length > 0 || row.replacedBy.length > 0) && (
          <div className="mjp-ledger-sec">
            <div className="h">替换链<span className="idx">按事实条目收集的前后替换关系</span></div>
            <ul className="mjp-evidence-list">
              {row.replaces.map((item) => (
                <li key={`rep-${row.id}-${item.itemId}-${item.otherItemId}`}>
                  本记录里有条目取代了{item.otherChapterNumber === undefined ? '另一条记录（所在章节已不存在）' : `第 ${item.otherChapterNumber} 章的记录`}，被取代的旧条目本身不会被删除。
                </li>
              ))}
              {row.replacedBy.map((item) => (
                <li key={`reped-${row.id}-${item.itemId}-${item.otherItemId}`}>
                  本记录里有条目已被{item.otherChapterNumber === undefined ? '另一条记录（所在章节已不存在）' : `第 ${item.otherChapterNumber} 章的记录`}取代，本记录本身不会被删除。
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mjp-ledger-sec">
          <div className="h">原文证据<span className="idx">{row.excerpts.length} 段</span></div>
          {row.excerpts.length === 0 ? (
            <p className="mjp-muted" style={{ margin: 0, fontSize: 12 }}>没有登记原文证据摘录。</p>
          ) : (
            row.excerpts.map((text, index) => (
              <blockquote key={`${row.id}-ex-${index}`} className="mjp-evidence">{text}</blockquote>
            ))
          )}
        </div>
      </div>

      <footer className="mjp-card-ft">
        <span className="hint mjp-row" style={{ gap: 4 }}>
          <Lock size={12} strokeWidth={1.8} aria-hidden="true" />
          只读台账：修订只能形成候选，不会覆盖这一条记录。
        </span>
      </footer>
    </section>
  )
}
