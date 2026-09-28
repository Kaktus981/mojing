import { Check, Trash2, Waypoints } from 'lucide-react'
import { useState } from 'react'
import type { NovelProject, WorldEntry, WorldEntryType } from '../../../../../../../packages/contracts/src'
import { emptyWorldDetails } from '../../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../../novelStore'
import { Banner, Btn, Card, EmptyState, Field, Tag } from '../../../ui/Primitives'
import { useWorldEdit } from './useWorldEdit'
import { applyAddEntryRelation, applyRemoveEntryRelation, applyRemoveWorldEntry, entryReferenceReport, type WriteResult } from './worldWriting'
import type { WorldEntriesModel } from './worldModel'
import { WORLD_ENTRY_TYPES } from './worldModel'

/**
 * 页面 3/5 · 世界词条。
 *
 * 数据源与写入方式沿用旧 WorldView 的真实逻辑（没有重新设计数据模型）：
 * 词条来自 `project.worldBible.entries`，编辑走 updateProject（900ms 防抖 +
 * baseRevision 乐观并发），改完 worldBible.status 回到「草稿」。
 * 左列的「失效引用」是按关系目标是否真实存在算出来的，不是装饰。
 */
export function WorldEntriesPage({ model, project }: {
  model: WorldEntriesModel
  project: NovelProject
}): React.JSX.Element {
  const { editWorld } = useWorldEdit()
  const updateProject = useNovelStore((state) => state.updateProject)
  const mentions = useNovelStore((state) => state.mentions)
  const [selectedId, setSelectedId] = useState<string>()
  const [confirmRemoveId, setConfirmRemoveId] = useState<string>()
  const [deleteMessage, setDeleteMessage] = useState<string>()
  const [newType, setNewType] = useState<WorldEntryType>('角色')
  const [relationTargetId, setRelationTargetId] = useState('')
  const [relationType, setRelationType] = useState('')
  const [relationMessage, setRelationMessage] = useState<string>()

  const entries = project.worldBible?.entries ?? []

  /** 关系改动先在副本上校验，确认通过后再经 editWorld 写回，绝不直接改 store 里的对象。 */
  function draftEntries(): WorldEntry[] {
    return entries.map((entry) => ({ ...entry, relations: [...entry.relations] }))
  }


  if (!model.hasWorld) {
    return (
      <EmptyState
        icon={Waypoints}
        title="世界观尚未建立"
        description="还没有世界观内容，因此没有可编辑的词条。请先在「世界总览」建立一个空白世界。"
      />
    )
  }

  const selected = entries.find((entry) => entry.id === selectedId)
  const entryIds = new Set(entries.map((entry) => entry.id))
  const brokenTargets = (entry: WorldEntry): string[] =>
    entry.relations.filter((relation) => !entryIds.has(relation.targetEntryId)).map((relation) => relation.targetEntryId)

  function addEntry(): void {
    const id = crypto.randomUUID()
    editWorld((world) => {
      world.entries.push({
        id,
        type: newType,
        name: `新${newType}`,
        aliases: [],
        tags: [],
        summary: '',
        notes: '',
        locked: false,
        aiVisibility: '按需召回',
        relations: [],
        customFields: {},
        details: emptyWorldDetails(newType)
      } as unknown as WorldEntry)
    })
    setSelectedId(id)
  }

  function patchEntry(changes: Partial<WorldEntry>): void {
    if (!selected) return
    const id = selected.id
    editWorld((world) => {
      const index = world.entries.findIndex((entry) => entry.id === id)
      if (index >= 0) world.entries[index] = { ...world.entries[index]!, ...changes } as WorldEntry
    })
  }

  /**
   * 单项资料 / 列表资料只存在于**通用**词条的 details（`fields` / `lists`）。
   * 角色 / 修行体系 / 国家 / 货币有各自固定的专属结构，这里不硬塞这两类资料，
   * 以免把专属字段挤掉——对它们如实不显示，而不是放假控件。
   */
  function genericDetails(): { fields: Record<string, string>; lists: Record<string, string[]> } | undefined {
    if (!selected) return undefined
    const details = selected.details as Record<string, unknown>
    if (!('fields' in details) || !('lists' in details)) return undefined
    return details as { fields: Record<string, string>; lists: Record<string, string[]> }
  }

  /** 写入走既有的 patchEntry → editWorld → updateProject（revision 校验），不另开保存通道。 */
  function writeGenericDetails(next: { fields: Record<string, string>; lists: Record<string, string[]> }): void {
    if (!selected) return
    patchEntry({ details: { fields: next.fields, lists: next.lists } })
  }

  /**
   * 删除词条：先解锁、再看引用、最后二次确认。
   * 旧实现会顺手把别人的关系一起删掉（静默改写别的词条），这里不再那么做：
   * 被引用时直接拒绝并说明该先处理哪里，避免留下悬空关联。
   */
  function requestRemoveEntry(id: string): void {
    setDeleteMessage(undefined)
    setConfirmRemoveId(id)
  }

  function confirmRemoveEntry(): void {
    if (!confirmRemoveId) return
    const id = confirmRemoveId
    let result: WriteResult = { ok: false, message: '没有项目。' }
    updateProject((draft) => {
      result = applyRemoveWorldEntry(draft, id)
    })
    setConfirmRemoveId(undefined)
    if (result.ok) {
      setDeleteMessage(undefined)
      if (selectedId === id) setSelectedId(undefined)
    } else {
      setDeleteMessage(result.message)
    }
  }

  const referenceReport = entryReferenceReport(project, selected?.id ?? '')
  const mentionCount = mentions.filter((mention) => mention.entryId === selected?.id).length
  const generic = genericDetails()
  const fieldRows = generic ? Object.entries(generic.fields) : []
  const listRows = generic ? Object.entries(generic.lists) : []

  return (
    <>
      <div className="mjp-wtoolbar">
        <select
          className="mjp-select"
          style={{ maxWidth: 160 }}
          value={newType}
          onChange={(event) => setNewType(event.target.value as WorldEntryType)}
          aria-label="新词条类型"
        >
          {WORLD_ENTRY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <Btn onClick={addEntry}>新建词条</Btn>
        <span className="mjp-muted" style={{ fontSize: 11 }}>
          共 {model.entryCount} 条 · {model.unlockedCount} 条未锁定
        </span>
      </div>

      <div className="mjp-grid-23">
        <div className="mjp-col" style={{ gap: 14 }}>
          {model.entryCount === 0 ? (
            <Card title="世界词条" icon={Waypoints}>
              <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>
                还没有任何词条。世界观可以完全手写，也可以让 AI 生成候选后由你确认。
              </p>
            </Card>
          ) : (
            <div className="mjp-wgrid">
              {model.groups.map((group) => (
                <section key={group.type} className="mjp-wcat">
                  <div className="mjp-wcat-top">
                    <div className="ic" aria-hidden="true"><Waypoints size={14} strokeWidth={1.8} /></div>
                    <div className="n">{group.type}</div>
                    <div className="ct">{group.items.length}</div>
                  </div>
                  <div className="mjp-wcat-list">
                    {group.items.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`mjp-wcat-e${entry.id === selectedId ? ' is-active' : ''}`}
                        onClick={() => setSelectedId(entry.id)}
                      >
                        <span className="d" aria-hidden="true" />
                        <span className="nm">{entry.name}{entry.locked ? ' ·锁' : ''}</span>
                        <span className="s">
                          {entry.brokenRelationCount > 0
                            ? `${entry.brokenRelationCount} 条失效引用`
                            : entry.summary ? '已填写' : '待补充'}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="mjp-col" style={{ gap: 14 }}>
          {selected ? (
            <>
              <Card
                title={selected.name}
                desc={`${selected.type} · ${selected.aiVisibility}`}
                headRight={
                  confirmRemoveId === selected.id ? (
                    <>
                      <Btn size="sm" variant="primary" onClick={confirmRemoveEntry}>确认删除</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setConfirmRemoveId(undefined)}>取消</Btn>
                    </>
                  ) : (
                    <Btn variant="danger" size="sm" icon={Trash2} onClick={() => requestRemoveEntry(selected.id)}>删除</Btn>
                  )
                }
              >
                <div className="mjp-col" style={{ gap: 12 }}>
                  {deleteMessage && <Banner tone="warn" title="这个词条现在不能删除">{deleteMessage}</Banner>}
                  {confirmRemoveId === selected.id && (
                    <Banner tone="warn" title="删除前请确认影响">
                      {referenceReport.relationOwners.length === 0 && referenceReport.storylineTitles.length === 0
                        ? '没有词条关系或事件线引用它，可以删除。'
                        : `被 ${referenceReport.relationOwners.length} 个词条关系、${referenceReport.storylineTitles.length} 条事件线引用，删除会被拒绝。`}
                      {' '}正文里提到「{selected.name}」共 {mentionCount} 处；删除词条不会改动正文，只是这些提法不再有词条可查。
                    </Banner>
                  )}
                  <Field label="名称">
                    <input className="mjp-input" value={selected.name} onChange={(event) => patchEntry({ name: event.target.value })} />
                  </Field>
                  <Field label="别名" hint="用顿号、逗号或换行分隔">
                    <input
                      className="mjp-input"
                      value={selected.aliases.join('、')}
                      onChange={(event) => patchEntry({ aliases: event.target.value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean) })}
                    />
                  </Field>
                  <Field label="摘要">
                    <textarea className="mjp-textarea" rows={3} value={selected.summary} onChange={(event) => patchEntry({ summary: event.target.value })} />
                  </Field>
                  <Field label="AI 可见范围">
                    <select
                      className="mjp-select"
                      value={selected.aiVisibility}
                      onChange={(event) => patchEntry({ aiVisibility: event.target.value as WorldEntry['aiVisibility'] })}
                    >
                      {['始终可见', '按需召回', '仅审校', '永不发送'].map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </Field>
                  <Field label="补充笔记">
                    <textarea className="mjp-textarea" rows={3} value={selected.notes} onChange={(event) => patchEntry({ notes: event.target.value })} />
                  </Field>
                  <label className="mjp-switch">
                    <input type="checkbox" checked={selected.locked} onChange={(event) => patchEntry({ locked: event.target.checked })} />
                    <span className="track" />
                    <span>锁定为最高权威</span>
                  </label>

                  {/*
                    单项资料（键值对）与列表资料（一行一条）只在通用词条上出现，
                    直接写在 details.fields / details.lists 上；空态如实说明，不放假的增删按钮。
                  */}
                  {generic && (
                    <>
                      <div className="mjp-col" style={{ gap: 6 }}>
                        <span className="mjp-hint">单项资料 · {fieldRows.length}</span>
                        {fieldRows.length === 0 && (
                          <span className="mjp-muted" style={{ fontSize: 12 }}>还没有单项资料；点下面的按钮加上第一条键值资料。</span>
                        )}
                        {fieldRows.map(([key, value], index) => (
                          <div key={`field-${index}`} className="mjp-row" data-testid="world-entry-field" style={{ gap: 8, alignItems: 'center' }}>
                            <input
                              className="mjp-input"
                              style={{ maxWidth: 160 }}
                              aria-label={`单项资料名称 ${index + 1}`}
                              placeholder="名称"
                              value={key}
                              onChange={(event) => {
                                const nextKey = event.target.value
                                const next: Record<string, string> = {}
                                fieldRows.forEach(([k, v], i) => { const target = i === index ? nextKey : k; if (target) next[target] = v })
                                writeGenericDetails({ fields: next, lists: generic.lists })
                              }}
                            />
                            <input
                              className="mjp-input"
                              aria-label={`单项资料内容 ${index + 1}`}
                              placeholder="内容"
                              value={value}
                              onChange={(event) => writeGenericDetails({ fields: { ...generic.fields, [key]: event.target.value }, lists: generic.lists })}
                            />
                            <Btn
                              size="sm"
                              variant="ghost"
                              aria-label={`删除单项资料 ${index + 1}`}
                              onClick={() => {
                                const next = { ...generic.fields }
                                delete next[key]
                                writeGenericDetails({ fields: next, lists: generic.lists })
                              }}
                            >
                              删除
                            </Btn>
                          </div>
                        ))}
                        <div>
                          <Btn
                            size="sm"
                            onClick={() => {
                              let name = '新资料', i = 1
                              while (name in generic.fields) { i += 1; name = `新资料${i}` }
                              writeGenericDetails({ fields: { ...generic.fields, [name]: '' }, lists: generic.lists })
                            }}
                          >
                            新增单项资料
                          </Btn>
                        </div>
                      </div>

                      <div className="mjp-col" style={{ gap: 6 }}>
                        <span className="mjp-hint">列表资料 · {listRows.length}</span>
                        {listRows.length === 0 && (
                          <span className="mjp-muted" style={{ fontSize: 12 }}>还没有列表资料；例如把「常用招式」写成一行一条。</span>
                        )}
                        {listRows.map(([key, values], index) => (
                          <div key={`list-${index}`} className="mjp-col" data-testid="world-entry-list" style={{ gap: 6 }}>
                            <div className="mjp-row" style={{ gap: 8, alignItems: 'center' }}>
                              <input
                                className="mjp-input"
                                style={{ maxWidth: 200 }}
                                aria-label={`列表资料名称 ${index + 1}`}
                                placeholder="列表名称"
                                value={key}
                                onChange={(event) => {
                                  const nextKey = event.target.value
                                  const next: Record<string, string[]> = {}
                                  listRows.forEach(([k, v], i) => { const target = i === index ? nextKey : k; if (target) next[target] = v })
                                  writeGenericDetails({ fields: generic.fields, lists: next })
                                }}
                              />
                              <Btn
                                size="sm"
                                variant="ghost"
                                aria-label={`删除列表资料 ${index + 1}`}
                                onClick={() => {
                                  const next = { ...generic.lists }
                                  delete next[key]
                                  writeGenericDetails({ fields: generic.fields, lists: next })
                                }}
                              >
                                删除
                              </Btn>
                            </div>
                            <textarea
                              className="mjp-textarea"
                              rows={3}
                              aria-label={`列表资料条目 ${index + 1}`}
                              placeholder="每行一条"
                              value={values.join('\n')}
                              onChange={(event) => writeGenericDetails({ fields: generic.fields, lists: { ...generic.lists, [key]: event.target.value.split('\n') } })}
                            />
                          </div>
                        ))}
                        <div>
                          <Btn
                            size="sm"
                            onClick={() => {
                              let name = '新列表', i = 1
                              while (name in generic.lists) { i += 1; name = `新列表${i}` }
                              writeGenericDetails({ fields: generic.fields, lists: { ...generic.lists, [name]: [] } })
                            }}
                          >
                            新增列表资料
                          </Btn>
                        </div>
                      </div>
                    </>
                  )}

                  {/*
                    关系是条目级事实，直接改在这里：加一条、解一条。
                    被别的词条或事件线引用时删除会被拒绝，所以作者必须能自己解除引用。
                  */}
                  <div className="mjp-col" style={{ gap: 6 }}>
                    <span className="mjp-hint">实体关系 · {selected.relations.length}（失效 {brokenTargets(selected).length}）</span>
                    {selected.relations.length === 0 && (
                      <span className="mjp-muted" style={{ fontSize: 12 }}>还没有关系；下面选一个词条即可建立。</span>
                    )}
                    {selected.relations.map((relation) => {
                      const target = entries.find((entry) => entry.id === relation.targetEntryId)
                      return (
                        <div key={relation.id} className="mjp-row" style={{ gap: 8, fontSize: 12, alignItems: 'center' }}>
                          <Tag tone="outline">{relation.type || '关系'}</Tag>
                          <span className={target ? 'mjp-muted' : 'mjp-hint is-danger'}>
                            {target?.name ?? `已失效引用（${relation.targetEntryId}）`}
                          </span>
                          {relation.description && <span className="mjp-muted">{relation.description}</span>}
                          <Btn
                            size="sm"
                            variant="ghost"
                            aria-label={`解除与${target?.name ?? relation.targetEntryId}的关系`}
                            onClick={() => {
                              const result = applyRemoveEntryRelation({ entries: draftEntries() }, {
                                fromEntryId: selected.id, toEntryId: relation.targetEntryId
                              })
                              if (!result.ok) {
                                setRelationMessage(result.message)
                                return
                              }
                              setRelationMessage(undefined)
                              patchEntry({ relations: selected.relations.filter((item) => item.targetEntryId !== relation.targetEntryId) })
                            }}
                          >
                            解除
                          </Btn>
                        </div>
                      )
                    })}

                    {relationMessage && <Banner tone="warn" title="这次关系操作没有生效">{relationMessage}</Banner>}

                    <div className="mjp-row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <select
                        className="mjp-select"
                        style={{ maxWidth: 200 }}
                        aria-label="关系目标词条"
                        value={relationTargetId}
                        onChange={(event) => setRelationTargetId(event.target.value)}
                      >
                        <option value="">选择要关联的词条</option>
                        {entries.filter((entry) => entry.id !== selected.id).map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.name}（{entry.type}）</option>
                        ))}
                      </select>
                      <input
                        className="mjp-input"
                        style={{ maxWidth: 140 }}
                        aria-label="关系类型"
                        placeholder="关系类型（如师徒）"
                        value={relationType}
                        onChange={(event) => setRelationType(event.target.value)}
                      />
                      <Btn
                        size="sm"
                        disabled={!relationTargetId}
                        onClick={() => {
                          const copy = draftEntries()
                          const result = applyAddEntryRelation({ entries: copy }, {
                            fromEntryId: selected.id, toEntryId: relationTargetId, type: relationType, id: crypto.randomUUID()
                          })
                          if (!result.ok) {
                            setRelationMessage(result.message)
                            return
                          }
                          setRelationMessage(undefined)
                          setRelationTargetId('')
                          setRelationType('')
                          const created = copy.find((entry) => entry.id === selected.id)!.relations.at(-1)!
                          patchEntry({ relations: [...selected.relations, created] })
                        }}
                      >
                        建立关系
                      </Btn>
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="世界观覆盖" icon={Check} tight>
                {model.coverage.map((item) => (
                  <div key={item.type} className="mjp-health-row">
                    <span className="nm">{item.type}</span>
                    {item.count > 0
                      ? <Tag tone="ok" dot>{item.count} 条</Tag>
                      : <span className="mjp-muted">未建立</span>}
                  </div>
                ))}
              </Card>
            </>
          ) : (
            <Card title="词条详情" icon={Waypoints}>
              <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>从左侧选一个词条开始编辑，或新建一条。</p>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
