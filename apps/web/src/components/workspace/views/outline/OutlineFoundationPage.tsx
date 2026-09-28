import { ChevronRight, ListTree } from 'lucide-react'
import { Banner, EmptyState, Tag } from '../../../ui/Primitives'
import type { OutlineChapterCard, OutlineFoundationModel } from './outlineModel'

/** 章纲真实状态 → 语义色；不认识的值一律保持中性，不擅自归类。 */
export function outlineCardStatusTone(status: string): 'ok' | 'amber' | 'accent' | 'default' {
  if (status === '已定稿') return 'ok'
  if (status === '已写作') return 'accent'
  if (status === '已规划') return 'amber'
  return 'default'
}

export function beatStatusTone(status: string): 'ok' | 'amber' | 'default' {
  if (status === '已确认') return 'ok'
  if (status === '待确认') return 'amber'
  return 'default'
}

function chapterLabel(card: OutlineChapterCard): string {
  return card.title || `第${card.chapterNumber}章`
}

/**
 * 页面 1/6 · 总纲与卷纲。
 *
 * 数据源：`project.outline`（synopsis / themes / mainConflict / endingDirection /
 * status / updatedAt / volumes[].goal|climax|resolution）+ 正文真实字数与伏笔计数。
 * 空字段一律显示「未填写」并在顶部列出缺失项，不用占位内容冒充已规划。
 * 当前卷默认展开；其余卷的展开状态由外层保留，切换页面回来不会被重置。
 */
export function OutlineFoundationPage({
  model,
  openVolumeIds,
  onToggleVolume,
  onOpenChapterOutline
}: {
  model: OutlineFoundationModel
  openVolumeIds: Record<string, boolean>
  onToggleVolume: (volumeId: string) => void
  onOpenChapterOutline: (cardId: string) => void
}): React.JSX.Element {
  if (!model.hasOutline) {
    return (
      <EmptyState
        icon={ListTree}
        title="还没有小说大纲"
        description="大纲对象为空时无法展示真实卷纲。可以先在大纲架构师那里梳理方向，或新建一章后开始规划。"
      />
    )
  }

  const { totals } = model

  return (
    <>
      <div className="mjp-overview">
        <div className="mjp-ov">
          <div className="l">主题</div>
          <div className="v" title={model.themes.join(' / ')}>{model.themes.length ? model.themes.join(' / ') : '未填写'}</div>
          <div className="sub"><Tag tone={model.status === '定稿' ? 'accent' : 'amber'} dot>{model.status || '未知'}</Tag></div>
        </div>
        <div className="mjp-ov">
          <div className="l">主冲突</div>
          <div className="v" title={model.mainConflict}>{model.mainConflict || '未填写'}</div>
          <div className="sub">共 {model.volumes.length} 卷</div>
        </div>
        <div className="mjp-ov">
          <div className="l">结局方向</div>
          <div className="v" title={model.endingDirection}>{model.endingDirection || '未填写'}</div>
          <div className="sub">{model.endingDirection ? '已记录' : '未锁'}</div>
        </div>
        <div className="mjp-ov">
          <div className="l">总览</div>
          <div className="v">{totals.writtenChapterCount} / {totals.plannedChapterCount || '—'} 章</div>
          <div className="sub">{totals.words.toLocaleString()} 字 · {totals.openThreadCount} 条伏笔待回收</div>
        </div>
      </div>

      {model.missingFields.length > 0 && (
        <Banner tone="warn" title={`大纲基础缺少${model.missingFields.join('、')}`}>
          这些字段用于约束每卷和每章的方向；缺失时下游规划缺少依据，本页不做任何补全或推测。
        </Banner>
      )}

      {model.synopsis.trim() ? (
        <div className="mjp-card">
          <div className="mjp-card-hd"><div className="ti">总纲</div></div>
          <div className="mjp-card-bd mjp-synopsis">{model.synopsis}</div>
        </div>
      ) : (
        <Banner tone="info" title="总纲还没有内容">本页不生成占位总纲，需要先由你或大纲架构师确认方向。</Banner>
      )}

      {model.volumes.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title="还没有卷纲"
          description="大纲里目前没有任何卷，因此没有可展示的卷卡与章节网格。"
        />
      ) : (
        <div className="mjp-vol">
          {model.volumes.map((volume) => {
            const open = openVolumeIds[volume.id] === true
            return (
              <section
                key={volume.id}
                className={`mjp-vol-card${volume.isCurrent ? ' is-current' : ''}${open ? '' : ' is-collapsed'}`}
              >
                <button
                  type="button"
                  className="mjp-vol-head is-btn"
                  aria-expanded={open}
                  onClick={() => onToggleVolume(volume.id)}
                >
                  <span className="n">{volume.numeral}</span>
                  <span className="ti" style={{ minWidth: 0 }}>
                    <span className="nm">第{volume.volumeNumber}卷 · {volume.title}</span>
                    <span className="desc">{volume.goal || '尚未填写本卷目标'}</span>
                  </span>
                  <span className="stats">
                    <span>章节<b>{volume.writtenCount} / {volume.chapters.length || '—'}</b></span>
                    <span>字数<b>{volume.words ? volume.words.toLocaleString() : '—'}</b></span>
                    <Tag tone={volume.missingFields.length ? 'amber' : 'outline'}>
                      {volume.statusTally}
                    </Tag>
                  </span>
                  <ChevronRight className="chev" size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>

                {open && (
                  <>
                    <div className="mjp-ofields">
                      <div className="mjp-ofield">
                        <span className="l">本卷高潮</span>
                        <span className={`v${volume.climax.trim() ? '' : ' is-missing'}`}>{volume.climax.trim() || '未填写'}</span>
                      </div>
                      <div className="mjp-ofield">
                        <span className="l">本卷收束</span>
                        <span className={`v${volume.resolution.trim() ? '' : ' is-missing'}`}>{volume.resolution.trim() || '未填写'}</span>
                      </div>
                    </div>

                    {volume.chapters.length === 0 ? (
                      <p className="mjp-vol-empty">本卷还没有章纲。</p>
                    ) : (
                      <div className="mjp-chs">
                        {volume.chapters.map((card) => (
                          <button
                            key={card.cardId}
                            type="button"
                            className={`mjp-ch${card.hasBody ? '' : ' is-empty'}`}
                            title={`打开第 ${card.chapterNumber} 章章纲（${card.cardStatus}；进入章纲编辑，不跳正文）`}
                            onClick={() => onOpenChapterOutline(card.cardId)}
                          >
                            <span className="idx">{card.chapterNumber}</span>
                            <span className="t">{chapterLabel(card)}</span>
                            <Tag tone={outlineCardStatusTone(card.cardStatus)}>{card.cardStatus}</Tag>
                            <span className="w">{card.words ? card.words.toLocaleString() : '—'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
