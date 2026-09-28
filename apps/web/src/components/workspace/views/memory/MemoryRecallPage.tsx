import { BookOpenText, Radar, ShieldAlert, UserRound } from 'lucide-react'
import { Banner, EmptyState, KV, Tag } from '../../../ui/Primitives'
import { chapterLabel, type MemoryPageId, type MemoryRecallModel, type RecallItem } from './memoryModel'

/**
 * 页面 2/5 · 长篇记忆召回。
 *
 * 只消费 `buildMemoryRecall` 的纯模型：条目全部来自「章号 ≤ 目标章」的正式章节记忆，
 * 并按 `appliesFromChapter` / `appliesThroughChapter` 逐条筛选。模型已经把未来信息
 * 单独挑出来计数，本页只如实展示——**不做任何二次推断，也不补占位条目**。
 *
 * 客观事实与角色认知分成两栏，这是本页的核心语义：同一件事「真实发生了」和
 * 「某人认为它发生了」是两回事，混在一列里会让作者误判视角。
 */
export function MemoryRecallPage({ model, onGoTo }: {
  model: MemoryRecallModel
  onGoTo: (page: MemoryPageId) => void
}): React.JSX.Element {
  if (!model.hasProject) {
    return (
      <EmptyState
        icon={Radar}
        title="尚未打开项目"
        description="长篇记忆召回依附于具体项目，请先打开一个作品。"
      />
    )
  }

  if (model.chapterNumber === undefined) {
    return (
      <EmptyState
        icon={Radar}
        title="没有可召回的目标章节"
        description="项目里还没有章节，因此没有可筛选的生效范围。请先在正文创作里建立第一章。"
      />
    )
  }

  const total = model.objective.length + model.cognition.length

  return (
    <>
      <div className="mjp-window" style={{ marginBottom: 14 }}>
        <KV label="目标章节" value={chapterLabel(model.chapterNumber)} mono />
        <KV label="章节来源" value={model.targetSource} />
        <KV label="客观事实" value={`${model.objective.length} 条`} mono />
        <KV label="角色认知" value={`${model.cognition.length} 条`} mono />
        <KV label="未来信息已排除" value={`${model.futureExcluded.count} 条`} mono />
        <KV label="未来章节记忆" value={`${model.futureChapterMemories.count} 章`} mono />
      </div>

      <Banner tone="info" title={model.notice.title}>{model.notice.detail}</Banner>

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        召回分布
      </div>
      {model.layers.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          第 {model.chapterNumber} 章之前没有任何可召回的正式记忆条目。
        </p>
      ) : (
        <div className="mjp-coverage">
          {model.layers.map((layer) => (
            <div key={layer.layer} className="mjp-cov">
              <span className="nm">{layer.label}</span>
              <span className="ct">{layer.count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        客观事实
        <span className="idx">真实发生的事 · {model.objective.length} 条</span>
      </div>
      {model.objective.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          这一章之前没有生效中的客观事实记录。若正文已经确认过事实，说明正式章节记忆还没建立。
        </p>
      ) : (
        <div className="mjp-recall-list">
          {model.objective.map((item) => <RecallCard key={item.id} item={item} />)}
        </div>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        角色认知
        <span className="idx">角色以为的事 · {model.cognition.length} 条</span>
      </div>
      {model.cognition.length === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          这一章之前没有标记为「角色认知」的记录。这类条目的视角是角色本人，不等于客观事实。
        </p>
      ) : (
        <div className="mjp-recall-list">
          {model.cognition.map((item) => <RecallCard key={item.id} item={item} />)}
        </div>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        未来信息已排除
        <span className="idx">生效范围晚于第 {model.chapterNumber} 章，绝不进入本章</span>
      </div>
      {model.futureExcluded.count === 0 && model.futureChapterMemories.count === 0 ? (
        <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
          没有需要排除的未来信息：所有已知记忆的生效范围都不晚于本章。
        </p>
      ) : (
        <>
          {model.futureChapterMemories.count > 0 && (
            <Banner tone="warn" title={`${model.futureChapterMemories.count} 章的记忆整章未参与召回`}>
              这些章节号大于 {model.chapterNumber}：{model.futureChapterMemories.chapterNumbers.map((number) => chapterLabel(number)).join('、')}。
              更早章节绝不能读到后来的真相，因此整章跳过。
            </Banner>
          )}
          {model.futureExcluded.items.length > 0 && (
            <div className="mjp-jump-list">
              {model.futureExcluded.items.map((item) => (
                <div key={item.id} className="mjp-jump is-static">
                  <ShieldAlert size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span className="t">{item.label || '未填写内容'}</span>
                  <span className="d">生效起点 {chapterLabel(item.appliesFromChapter)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mjp-sec-h" style={{ marginTop: 18 }}>
        去核对
        <span className="idx">共 {total} 条位于本章生效范围内</span>
      </div>
      <div className="mjp-jump-list">
        <button type="button" className="mjp-jump" onClick={() => onGoTo('memory-ledger')}>
          <BookOpenText size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">正式章节记忆</span>
          <span className="d">看这些条目的完整档案与摘要比对</span>
        </button>
        <button type="button" className="mjp-jump" onClick={() => onGoTo('memory-proposals')}>
          <UserRound size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="t">记忆变更提案</span>
          <span className="d">待确认的变更不会进入本章召回</span>
        </button>
      </div>
    </>
  )
}

function RecallCard({ item }: { item: RecallItem }): React.JSX.Element {
  const cognition = item.perspective === '角色认知'
  return (
    <article className="mjp-recall-item">
      <div className="hd">
        <Tag tone={cognition ? 'ai' : 'accent'} dot>{item.perspective}</Tag>
        <span className="tt">{item.title}</span>
        <span className="src">
          来自 {chapterLabel(item.sourceChapterNumber)} · {item.memoryStatus}
        </span>
      </div>
      <div className="mt">{item.detail}</div>
      <div className="rows">
        <KV label="条目类型" value={item.kind} />
        <KV label="记忆层级" value={item.layer} />
        <KV label="生效范围" value={item.range} />
        <KV label="知情角色" value={item.knownTo.length > 0 ? item.knownTo.join('、') : '未登记'} />
        {item.locked ? <KV label="锁定" value="已锁定（不会被自动改写）" /> : null}
        {item.replacesId ? <KV label="替换目标" value={item.replacesId} mono /> : null}
      </div>
      <div className="reason">召回原因：{item.reason}</div>
      {item.excerpt ? (
        <blockquote className="mjp-evidence">{item.excerpt}</blockquote>
      ) : (
        <p className="mjp-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>该条目没有登记原文证据摘录。</p>
      )}
      {item.evidenceExcerpts.length > 0 && (
        <ul className="mjp-evidence-list">
          {item.evidenceExcerpts.map((text, index) => (
            <li key={`${item.id}-ev-${index}`}>{text}</li>
          ))}
        </ul>
      )}
      {item.blockId && <div className="src-line">原文定位：{item.blockId}</div>}
    </article>
  )
}
