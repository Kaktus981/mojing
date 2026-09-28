/**
 * M5 · 世界观手写资料（术语边界与词条）的纯写入口。
 *
 * 这些函数只改传入的草稿对象；页面把它们包进既有的 `updateProject`
 * （900ms 防抖 + 版本校验），不新增保存通道。
 *
 * 四条写入规则：
 *   1. 人工录入的术语必须**如实标注来源**为作者录入，不伪装成 AI 提取结果；
 *      反过来也不动 AI 已有的文本（状态切换只改 status）。
 *   2. `term` 与 `definition` 是契约必填，不能被改成空串。
 *   3. 锁定中的条目**先解锁再删**（术语 status=已锁定 / 词条 locked=true）。
 *   4. 删除前先看引用：词条被别的词条关系或事件线引用时拒绝删除，
 *      否则会留下悬空关联；正文提及只作为提示，作者确认后可继续。
 */

export type WriteResult = { ok: boolean; message?: string }

import { checkWorldFinalize } from './worldCanonRules'

export type ConstraintDraft = {
  id: string
  term: string
  definition: string
  notDefinition: string
  entityType: string
  allowedUsages: string[]
  unresolvedQuestions: string[]
  /** 契约里这两个数组有默认值，但前端不经过 schema 解析：缺了它们界面读 undefined.map 会直接白屏。 */
  forbiddenUsages: Array<{ phrase: string; reason: string; suggestedReplacement: string }>
  facts: Array<{ subject: string; relation: string; object: string; polarity: '允许' | '禁止' }>
  status: string
  createdAt: string
  updatedAt: string
  source: { fieldPath: string; excerpt: string }
}

export type EntryRelationDraft = { id: string; targetEntryId: string; type: string; description: string }

export type EntryDraft = {
  id: string
  name: string
  type?: string
  locked: boolean
  relations?: EntryRelationDraft[]
  /** 词条相关性的引用方；与关系分开记账，两者都要在删除前检查。 */
  entryIds?: string[]
}

export type StorylineRefDraft = { id: string; title: string; entryIds: string[] }

/** 世界观主体（worldBible）草稿形态：status / 四项必填 / 主题 / 更新时间 / 词条数组。 */
export type WorldBibleDraft = {
  status: string
  summary: string
  premise: string
  /** 主题列表：契约里已有该字段，界面按「顿号 / 逗号 / 换行」录入，不新增数据体系。 */
  themes: string[]
  geography: string
  historySummary: string
  updatedAt: string
  entries: EntryDraft[]
}

export type WorldWritingDraft = {
  worldConstraints: ConstraintDraft[]
  worldBible?: WorldBibleDraft
  storylines?: StorylineRefDraft[]
  worldQualityFindings?: Array<{ id: string; constraintIds: string[]; status: string }>
}

/** 可手写的术语文本字段。 */
export const CONSTRAINT_TEXT_FIELDS = ['term', 'definition', 'notDefinition', 'entityType'] as const
export type ConstraintTextField = (typeof CONSTRAINT_TEXT_FIELDS)[number]

/** 可整组替换的术语数组字段（界面用顿号 / 换行分隔录入）。 */
export const CONSTRAINT_LIST_FIELDS = ['allowedUsages', 'unresolvedQuestions'] as const
export type ConstraintListField = (typeof CONSTRAINT_LIST_FIELDS)[number]

/** 作者手动录入时写入的来源证据：fieldPath 指向自身，摘录写明是人工录入。 */
export const MANUAL_SOURCE_EXCERPT = '作者手动录入'

function findConstraint(draft: WorldWritingDraft, id: string): ConstraintDraft | undefined {
  return draft.worldConstraints.find((item) => item.id === id)
}

/* ------------------------------------------------------------------ *
 * 术语边界
 * ------------------------------------------------------------------ */

export function applyAddWorldConstraint(
  draft: WorldWritingDraft,
  input: { term: string; definition: string },
  now: string,
  id: string
): WriteResult {
  const term = input.term.trim()
  const definition = input.definition.trim()
  if (!term) return { ok: false, message: '请先填写术语名称。' }
  if (!definition) return { ok: false, message: '请先填写术语定义；定义是必填项，不会替你代写。' }
  if (draft.worldConstraints.some((item) => item.id === id)) return { ok: false, message: '这条术语已经存在。' }

  draft.worldConstraints.unshift({
    id,
    term,
    definition,
    notDefinition: '',
    entityType: '',
    allowedUsages: [],
    unresolvedQuestions: [],
    forbiddenUsages: [],
    facts: [],
    status: '待确认',
    createdAt: now,
    updatedAt: now,
    source: { fieldPath: `worldConstraints.${id}`, excerpt: MANUAL_SOURCE_EXCERPT }
  })
  return { ok: true }
}

export function applyConstraintFieldEdit(
  draft: WorldWritingDraft,
  id: string,
  field: ConstraintTextField,
  value: string,
  now: string
): boolean {
  const constraint = findConstraint(draft, id)
  if (!constraint) return false
  // term 与 definition 是契约必填，不能改成空串
  if ((field === 'term' || field === 'definition') && !value.trim()) return false
  if (constraint[field] === value) return false
  constraint[field] = value
  constraint.updatedAt = now
  return true
}

export function applyConstraintListEdit(
  draft: WorldWritingDraft,
  id: string,
  field: ConstraintListField,
  values: string[],
  now: string
): boolean {
  const constraint = findConstraint(draft, id)
  if (!constraint) return false
  const cleaned = [...new Set(values.map((item) => item.trim()).filter(Boolean))]
  if (constraint[field].length === cleaned.length && constraint[field].every((item, index) => item === cleaned[index])) return false
  constraint[field] = cleaned
  constraint.updatedAt = now
  return true
}

/** 术语当前被哪些审校问题引用；只有未处理的问题算作阻塞。 */
export function constraintReferenceCount(draft: WorldWritingDraft, id: string): number {
  return (draft.worldQualityFindings ?? []).filter(
    (finding) => finding.constraintIds.includes(id) && finding.status !== '已忽略' && finding.status !== '已失效'
  ).length
}

export function applyRemoveWorldConstraint(draft: WorldWritingDraft, id: string): WriteResult {
  const index = draft.worldConstraints.findIndex((item) => item.id === id)
  if (index < 0) return { ok: false, message: '找不到这条术语。' }

  const constraint = draft.worldConstraints[index]!
  if (constraint.status === '已锁定') {
    return { ok: false, message: '这条术语处于「已锁定」；请先把它改成其他状态（明确解锁）再删除。' }
  }
  const referenced = constraintReferenceCount(draft, id)
  if (referenced > 0) {
    return { ok: false, message: `还有 ${referenced} 条未处理的审校问题引用这条术语，先处理或忽略它们再删除。` }
  }

  draft.worldConstraints.splice(index, 1)
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 世界词条
 * ------------------------------------------------------------------ */

export type EntryReferenceReport = {
  locked: boolean
  relationOwners: string[]
  storylineTitles: string[]
}

/** 删除词条前的引用检查：只报事实，不替作者决定。 */
export function entryReferenceReport(draft: WorldWritingDraft, entryId: string): EntryReferenceReport {
  const entries = draft.worldBible?.entries ?? []
  return {
    locked: entries.find((entry) => entry.id === entryId)?.locked ?? false,
    relationOwners: entries
      .filter((entry) => entry.id !== entryId && (entry.relations ?? []).some((relation) => relation.targetEntryId === entryId))
      .map((entry) => entry.name),
    storylineTitles: (draft.storylines ?? []).filter((line) => line.entryIds.includes(entryId)).map((line) => line.title)
  }
}

/**
 * 删除词条。锁定中的词条必须先解锁；被别的词条关系或事件线引用时一律拒绝，
 * 避免删完留下指向不存在条目的悬空关联。
 */
export function applyRemoveWorldEntry(draft: WorldWritingDraft, entryId: string): WriteResult {
  const entries = draft.worldBible?.entries
  const index = entries?.findIndex((entry) => entry.id === entryId) ?? -1
  if (!entries || index < 0) return { ok: false, message: '找不到这个词条。' }

  const report = entryReferenceReport(draft, entryId)
  if (report.locked) return { ok: false, message: '这个词条处于锁定状态；请先解锁再删除。' }
  if (report.relationOwners.length > 0) {
    return { ok: false, message: `还有词条（${report.relationOwners.join('、')}）的关系指向它；请先解除这些关系再删除。` }
  }
  if (report.storylineTitles.length > 0) {
    return { ok: false, message: `事件线（${report.storylineTitles.join('、')}）还在引用它；请先在事件线里解绑再删除。` }
  }

  entries.splice(index, 1)
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 词条关系：手动建立 / 解除
 * ------------------------------------------------------------------ *
 * 关系是**条目级**的事实：它长在起点词条上，指向目标词条的身份。
 * 这里只维护这一条边，不复制目标词条的资料，也不动别的词条。
 */

/* ------------------------------------------------------------------ *
 * 世界总览：可编辑 + 可定稿
 * ------------------------------------------------------------------ */

export const WORLD_OVERVIEW_TEXT_FIELDS = ['summary', 'premise', 'geography', 'historySummary'] as const
export type WorldOverviewTextField = (typeof WORLD_OVERVIEW_TEXT_FIELDS)[number]

/** 定稿入口接受的对象：与 `updateProject` 传入的草稿（NovelProject）结构兼容，
 *  调用点直接传 `draft`，由本模块在内部改写 worldBible 与项目状态。
 *  worldBible 复用单一的 WorldBibleDraft（含 entries 等完整字段）。 */
export type WorldOverviewEditTarget = {
  status: string
  worldBible?: WorldBibleDraft | null
}

/**
 * 写入单个总览正文片段。无 worldBible 即拒绝；值未变化（===）不写（沿用 outlineIntegrationModel
 * 「同值不写」惯例）；写入后刷新 updatedAt，并按既有「改动即回草稿」规则：若原 status 是
 * 「定稿」则退回「草稿」，同时把项目状态标为「世界观草稿」。
 */
export function applyWorldOverviewEdit(
  draft: WorldOverviewEditTarget,
  field: WorldOverviewTextField,
  value: string,
  now: string
): WriteResult {
  const world = draft.worldBible
  if (!world) return { ok: false, message: '请先建立世界观主体。' }
  if (world[field] === value) return { ok: false, message: '内容没有变化。' }
  world[field] = value
  world.updatedAt = now
  if (world.status === '定稿') world.status = '草稿'
  draft.status = '世界观草稿'
  return { ok: true }
}

/**
 * 写入总览的「主题」列表。用法与规则和四个正文片段完全一致：无 worldBible 拒绝、
 * 内容没变不写、写入后刷新 updatedAt、已定稿则退回草稿。
 * 主题不是定稿必填项（定稿门槛只看四个正文片段），所以它不参与 checkWorldFinalize。
 */
export function applyWorldOverviewThemesEdit(
  draft: WorldOverviewEditTarget,
  values: string[],
  now: string
): WriteResult {
  const world = draft.worldBible
  if (!world) return { ok: false, message: '请先建立世界观主体。' }
  const cleaned = [...new Set(values.map((item) => item.trim()).filter(Boolean))]
  const current = world.themes ?? []
  if (current.length === cleaned.length && current.every((item, index) => item === cleaned[index])) {
    return { ok: false, message: '内容没有变化。' }
  }
  world.themes = cleaned
  world.updatedAt = now
  if (world.status === '定稿') world.status = '草稿'
  draft.status = '世界观草稿'
  return { ok: true }
}

/**
 * 定稿：独立操作，不复用会强制回草稿的 editWorld，但必须仍走既有的 updateProject
 * （900ms 防抖 + baseRevision 乐观并发）。必填未补齐则拒绝且**不写**；已是「定稿」也拒绝
 * （不刷新时间）；通过则置 worldBible.status 为「定稿」并刷新 updatedAt。
 * 注意：这里**不碰** draft.status——「定稿」的读者只看 worldBible.status；NovelProjectStatusSchema
 * 里「世界观草稿」只是进度标记，不必为定稿另加项目状态语义。
 */
export function applyWorldOverviewFinalize(
  draft: WorldOverviewEditTarget,
  now: string
): WriteResult {
  const world = draft.worldBible
  if (!world) return { ok: false, message: '请先建立世界观主体。' }
  const check = checkWorldFinalize(world)
  if (!check.canFinalize) {
    return { ok: false, message: '还不能定稿：请先补全' + check.missing.join('、') }
  }
  if (world.status === '定稿') {
    return { ok: false, message: '世界观已经是定稿。' }
  }
  world.status = '定稿'
  world.updatedAt = now
  return { ok: true }
}

/** 关系容器：只需要词条数组，页面的 `editWorld` 与测试都能直接传进来。 */
export type EntryRelationHost = { entries: EntryDraft[] }

/**
 * 建立两条词条之间的关系。
 * 起点锁定、指向自己、重复关联都会拒绝——重复关联会让「被引用」统计与删除保护失真。
 */
export function applyAddEntryRelation(
  host: EntryRelationHost,
  input: { fromEntryId: string; toEntryId: string; type?: string; description?: string; id: string }
): WriteResult {
  const from = host.entries.find((entry) => entry.id === input.fromEntryId)
  const to = host.entries.find((entry) => entry.id === input.toEntryId)
  if (!from) return { ok: false, message: '找不到关系的起点词条。' }
  if (!to) return { ok: false, message: '找不到关系的目标词条。' }
  if (from.id === to.id) return { ok: false, message: '不能把词条关联到它自己。' }
  if (from.locked) return { ok: false, message: `「${from.name}」处于锁定状态；请先解锁再改它的关系。` }
  if (!from.relations) from.relations = []
  if (from.relations.some((relation) => relation.targetEntryId === to.id)) {
    return { ok: false, message: `「${from.name}」已经关联了「${to.name}」；如需修改请先解除。` }
  }
  from.relations.push({
    id: input.id,
    targetEntryId: to.id,
    type: input.type?.trim() || '关联',
    description: input.description?.trim() ?? ''
  })
  return { ok: true }
}

/** 解除一条关系。只删这一条，其余关系与词条本身都不动。 */
export function applyRemoveEntryRelation(
  host: EntryRelationHost,
  input: { fromEntryId: string; toEntryId: string }
): WriteResult {
  const from = host.entries.find((entry) => entry.id === input.fromEntryId)
  if (!from) return { ok: false, message: '找不到关系的起点词条。' }
  if (from.locked) return { ok: false, message: `「${from.name}」处于锁定状态；请先解锁再改它的关系。` }
  const relations = from.relations ?? []
  const index = relations.findIndex((relation) => relation.targetEntryId === input.toEntryId)
  if (index < 0) return { ok: false, message: '这条关系已经不存在。' }
  relations.splice(index, 1)
  return { ok: true }
}
