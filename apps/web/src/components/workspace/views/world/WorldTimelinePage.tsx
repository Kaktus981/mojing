import { useState } from 'react'
import { History, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { Banner, Btn, EmptyState, Tag } from '../../../ui/Primitives'
import { useWorldEdit } from './useWorldEdit'
import type { WorldTimelineEventModel, WorldTimelineModel } from './worldModel'

/**
 * 页面 4/5 · 世界时间线。
 *
 * 数据源：`project.worldBible.timeline` 的真实事件（dateLabel / order / title /
 * description / entryIds / locked），按 order 排序展示。
 * 写入沿用 updateProject：可新增、改文字、删除、锁定、**选择新事件的插入位置**。
 * 「关联词条」里若指向已不存在的词条，会如实标成「已失效引用」。
 *
 * 「新事件插入位置」是上一版已交付、改版中被丢掉的能力（安装包
 * `release/mojing/win-unpacked/resources/app.asar` 内有 `新事件插入位置` 与
 * `时间线最前面` / `在“…”与“…”之间` / `时间线末尾` 三个选项），此处按原语义恢复：
 * 选项文字取自事件的**真实标签**（日期标签优先，退回标题），不编造名字。
 */
export function WorldTimelinePage({ model }: { model: WorldTimelineModel }): React.JSX.Element {
  const { editWorld } = useWorldEdit()
  const [insertAfter, setInsertAfter] = useState<string>('末尾')

  if (!model.hasWorld) {
    return (
      <EmptyState
        icon={History}
        title="世界观尚未建立"
        description="还没有世界观内容，因此没有可编辑的时间线。请先在「世界总览」建立一个空白世界。"
      />
    )
  }

  function addEvent(): void {
    editWorld((world) => {
      const ordered = [...world.timeline].sort((left, right) => left.order - right.order)
      const anchorIndex = ordered.findIndex((event) => event.id === insertAfter)
      const index =
        insertAfter === '最前面'
          ? 0
          : insertAfter === '末尾' || anchorIndex < 0
            ? ordered.length
            : anchorIndex + 1
      const created = {
        id: crypto.randomUUID(),
        dateLabel: '',
        order: 0,
        title: `新事件 ${index + 1}`,
        description: '',
        entryIds: [] as string[],
        locked: false
      }
      // 落库前统一重排 order 1..n —— 作者选的位置就是保存后的顺序，不做两套顺序。
      world.timeline = [...ordered.slice(0, index), created, ...ordered.slice(index)].map(
        (event, position) => ({ ...event, order: position + 1 })
      )
    })
  }

  function patchEvent(id: string, changes: { dateLabel?: string; title?: string; description?: string; locked?: boolean }): void {
    editWorld((world) => {
      const event = world.timeline.find((item) => item.id === id)
      if (event) Object.assign(event, changes)
    })
  }

  function removeEvent(id: string): void {
    editWorld((world) => {
      world.timeline = world.timeline.filter((event) => event.id !== id)
    })
  }

  return (
    <>
      <div className="mjp-wtoolbar">
        <label className="mjp-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          新事件插入位置
          <select
            className="mjp-select"
            style={{ maxWidth: 240 }}
            value={insertAfter}
            onChange={(event) => setInsertAfter(event.target.value)}
            aria-label="新事件插入位置"
          >
            <option value="最前面">时间线最前面</option>
            {model.events.slice(0, -1).map((event, index) => (
              <option key={event.id} value={event.id}>
                {`在“${eventLabel(event)}”与“${eventLabel(model.events[index + 1])}”之间`}
              </option>
            ))}
            <option value="末尾">时间线末尾</option>
          </select>
        </label>
        <Btn icon={Plus} onClick={addEvent}>新增事件</Btn>
        <span className="mjp-muted" style={{ fontSize: 11 }}>
          共 {model.events.length} 个事件 · {model.lockedCount} 个已锁定
        </span>
      </div>

      {model.repeatedLabels.length > 0 && (
        <Banner tone="warn" title={`有 ${model.repeatedLabels.length} 个日期标签被多个事件共用`}>
          {model.repeatedLabels.map((item) => `「${item.label}」×${item.count}`).join('、')}
          {' '}——这是数据现状，本页不会自动改写事件顺序。
        </Banner>
      )}

      {model.events.length === 0 ? (
        <EmptyState
          icon={History}
          title="还没有时间线事件"
          description="项目里没有保存任何历史事件。可以先记下故事开始前必须发生的事，再往故事内时间推进。"
        />
      ) : (
        <ol className="mjp-timeline">
          {model.events.map((event) => (
            <li key={event.id} className={`mjp-tl-item${event.locked ? ' is-locked' : ''}`}>
              <div className="rail" aria-hidden="true">
                <span className="dot" />
              </div>
              <div className="body">
                <div className="head">
                  <input
                    className="mjp-input date"
                    value={event.dateLabel}
                    placeholder="日期标签"
                    aria-label={`第 ${event.order} 个事件的日期标签`}
                    onChange={(input) => patchEvent(event.id, { dateLabel: input.target.value })}
                  />
                  <Tag tone="outline">顺序 {event.order}</Tag>
                  {event.locked && <Tag tone="accent" dot>已锁定</Tag>}
                  <span className="mjp-right acts">
                    <Btn
                      size="sm"
                      icon={event.locked ? Unlock : Lock}
                      onClick={() => patchEvent(event.id, { locked: !event.locked })}
                    >
                      {event.locked ? '解锁' : '锁定'}
                    </Btn>
                    <Btn size="sm" variant="danger" icon={Trash2} onClick={() => removeEvent(event.id)} aria-label={`删除第 ${event.order} 个事件`} />
                  </span>
                </div>
                <input
                  className="mjp-input title"
                  value={event.title}
                  aria-label={`第 ${event.order} 个事件的标题`}
                  onChange={(input) => patchEvent(event.id, { title: input.target.value })}
                />
                <textarea
                  className="mjp-textarea"
                  rows={2}
                  value={event.description}
                  placeholder="事件描述"
                  aria-label={`第 ${event.order} 个事件的描述`}
                  onChange={(input) => patchEvent(event.id, { description: input.target.value })}
                />
                {event.entryIds.length > 0 && (
                  <div className="mjp-tag-row">
                    <span className="mjp-muted">关联词条</span>
                    {event.brokenEntryIds.length > 0 && <Tag tone="danger">失效 {event.brokenEntryIds.length}</Tag>}
                    {event.entryIds.map((id) => (
                      <Tag key={id} tone={event.brokenEntryIds.includes(id) ? 'danger' : 'outline'}>
                        {event.brokenEntryIds.includes(id) ? `已失效引用（${id}）` : id}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mjp-tbl-foot">
        时间线只记录作者确认的历史事件；正文不会因为这里的新增或排序而被改写。
      </p>
    </>
  )
}

/** 下拉选项里显示的事件名：日期标签优先，退回标题，都没有才用顺序兜底（不编造名字）。 */
function eventLabel(event: WorldTimelineEventModel | undefined): string {
  if (!event) return '未命名事件'
  return event.dateLabel.trim() || event.title.trim() || `第 ${event.order} 个事件`
}
