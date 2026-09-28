import { createHash, randomUUID } from 'node:crypto'
import {
  assistantScopeKey, type AssistantAdoptItem, type AssistantAdoptPreview, type AssistantChange, type AssistantDraft,
  type AssistantTarget, type AssistantTaskType, type CreativeAssistantSkillStage, type NovelProject
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'
import { describeAssistantTarget } from './assistantWorkflow'

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }

/** 供 `localRevision.ts` 复用同一套错误形状，避免两处各写一份。 */
export function scopeViolation(code: string, message: string): Error { return fail(code, message) }

const outlineChapters = (project: NovelProject) => (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)

function trim(value: string, limit = 240): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 变更写到哪个对象上；只读描述，不做任何写入。 */
export function changeLabel(change: AssistantChange, project: NovelProject): string {
  switch (change.kind) {
    case 'story-core': return '故事核心'
    case 'outline': return '总纲与主冲突'
    case 'volume': return `第${change.volume.volumeNumber}卷《${change.volume.title || '未命名'}》`
    case 'chapter': return `第${change.chapter.chapterNumber}章《${change.chapter.title || '未命名'}》`
    case 'beat': {
      const card = outlineChapters(project).find((item) => item.id === change.chapterId)
      return `第${card?.chapterNumber ?? '?'}章 · ${change.beat.title || '未命名步骤'}`
    }
    case 'storyline': return `故事线《${change.storyline.title}》`
    default: { const never: never = change; throw fail('DRAFT_CHANGE_UNKNOWN', `不支持的变更：${JSON.stringify(never)}`) }
  }
}

function currentValueOf(change: AssistantChange, project: NovelProject): { exists: boolean; text: string; objectId: string } {
  switch (change.kind) {
    case 'story-core': return { exists: Boolean(project.seed.trim()), text: project.seed, objectId: 'story-core' }
    case 'outline':
      return { exists: Boolean(project.outline), text: project.outline?.synopsis ?? '', objectId: 'outline' }
    case 'volume': {
      const found = project.outline?.volumes.find((item) => item.id === change.volume.id || item.volumeNumber === change.volume.volumeNumber)
      return { exists: Boolean(found), text: found ? `目标：${found.goal}` : '', objectId: change.volume.id }
    }
    case 'chapter': {
      const found = outlineChapters(project).find((item) => item.id === change.chapter.id)
      return { exists: Boolean(found), text: found ? `目标：${found.objective}；冲突：${found.conflict}` : '', objectId: change.chapter.id }
    }
    case 'beat': {
      const card = outlineChapters(project).find((item) => item.id === change.chapterId)
      const beat = card?.beats.find((item) => item.id === change.beat.id)
      return { exists: Boolean(beat), text: beat ? beat.title : '', objectId: change.beat.id }
    }
    case 'storyline': {
      const found = (project.storylines ?? []).find((item) => item.id === change.storyline.id)
      return { exists: Boolean(found), text: found ? found.title : '', objectId: change.storyline.id }
    }
    default: { const never: never = change; throw fail('DRAFT_CHANGE_UNKNOWN', `不支持的变更：${JSON.stringify(never)}`) }
  }
}

function nextValueOf(change: AssistantChange): string {
  switch (change.kind) {
    case 'story-core': return change.seed
    case 'outline': return change.synopsis
    case 'volume': return `目标：${change.volume.goal}`
    case 'chapter': return `目标：${change.chapter.objective}；冲突：${change.chapter.conflict}`
    case 'beat': return change.beat.title
    case 'storyline': return change.storyline.title
    default: { const never: never = change; throw fail('DRAFT_CHANGE_UNKNOWN', `不支持的变更：${JSON.stringify(never)}`) }
  }
}

/**
 * 建立或更新工作草稿。
 *
 * **生成只落草稿，绝不改正式项目。** 若作者已经改过当前草稿，
 * 新的生成结果不会覆盖它，而是追加成一条可回看的候选记录，由作者决定取舍。
 */
export function saveAssistantDraft(input: {
  database: NovelDatabaseService
  project: NovelProject
  target: AssistantTarget
  taskType: AssistantTaskType
  stage: CreativeAssistantSkillStage
  changes: AssistantChange[]
  dependencyGroups?: AssistantDraft['dependencyGroups']
  sourceDigest?: string
  summary?: string
}): { draft: AssistantDraft; keptAuthorEdits: boolean } {
  const { database, project, target, taskType, stage } = input
  const scopeKey = assistantScopeKey(target)
  const existing = database.getAssistantDraft(project.id, scopeKey, taskType)
  const now = new Date().toISOString()
  const changes = input.changes
  const groups = input.dependencyGroups ?? []

  if (existing && existing.authorEdited) {
    // 不静默丢弃作者改过的内容：新结果只作为可回看候选。
    database.appendAssistantCandidateRecord({
      projectId: project.id, scopeKey, taskType, version: existing.version + 1,
      baseRevision: project.revision, sourceDigest: input.sourceDigest || existing.sourceDigest,
      summary: input.summary?.trim() || existing.summary, changes, dependencyGroups: groups, status: '待确认'
    })
    return { draft: existing, keptAuthorEdits: true }
  }

  const draft = database.saveAssistantDraft({
    // 草稿 ID 必须**全局唯一**。`scopeKey` / `taskType` 是跨项目共享的字符串（例如 `story-core:` + `引导构建`），
    // 只能用来**查找**这份草稿属于哪个项目，不能直接当主键 —— 否则同一库里第二个项目建草稿会撞主键。
    // 已有草稿沿用原 ID：不重命名存量记录，也不需要迁移 schema。
    id: existing?.id ?? randomUUID(),
    projectId: project.id, scopeKey, taskType, stage, target,
    baseRevision: project.revision,
    sourceDigest: input.sourceDigest || existing?.sourceDigest || 'manual',
    version: (existing?.version ?? 0) + 1,
    authorEdited: false,
    changes, dependencyGroups: groups,
    status: '待确认',
    summary: input.summary?.trim() || 'AI 生成的工作草稿',
    createdAt: existing?.createdAt ?? now, updatedAt: now
  })
  database.appendAssistantCandidateRecord({
    projectId: project.id, scopeKey, taskType, version: draft.version, baseRevision: project.revision,
    sourceDigest: draft.sourceDigest, summary: draft.summary, changes, dependencyGroups: groups, status: '待确认'
  })
  return { draft, keptAuthorEdits: false }
}

/** 作者手改草稿：版本号必须匹配，旧版本写回直接拒绝。 */
export function updateAssistantDraft(input: {
  database: NovelDatabaseService
  project: NovelProject
  draftId: string
  version: number
  changes: AssistantChange[]
  summary?: string
}): AssistantDraft {
  const draft = input.database.getAssistantDraftById(input.project.id, input.draftId)
  if (!draft) throw fail('DRAFT_NOT_FOUND', '找不到这份工作草稿。')
  if (draft.status === '已采用') throw fail('DRAFT_ALREADY_APPLIED', '这份草稿已经采用过了，不能继续修改。')
  if (draft.status === '已放弃') throw fail('DRAFT_DISCARDED', '这份草稿已经放弃，需要重新生成。')
  if (draft.version !== input.version) throw fail('DRAFT_VERSION_STALE', '这份草稿已经被更新，请基于最新版本修改。')
  return input.database.saveAssistantDraft({
    ...draft, changes: input.changes, version: draft.version + 1, authorEdited: true,
    summary: input.summary?.trim() || draft.summary, status: '待确认', updatedAt: new Date().toISOString()
  })
}

export function previewDigestOf(input: {
  project: NovelProject
  draft: AssistantDraft
  items: AssistantAdoptItem[]
}): string {
  return createHash('sha256').update(JSON.stringify({
    projectId: input.project.id, revision: input.project.revision, draftVersion: input.draft.version,
    items: input.items.map((item) => `${item.kind}|${item.label}|${item.action}|${item.after}`)
  }), 'utf8').digest('hex').slice(0, 32)
}

/**
 * 采用前的差异预览。
 *
 * 只做计算，不写任何东西。预览摘要绑定「当前项目版本 + 草稿版本 + 实际差异」，
 * 项目一变、草稿一改，旧预览立即失效，必须重新预览——不能拿旧预览去写新内容。
 */
export function buildAdoptPreview(input: {
  project: NovelProject
  draft: AssistantDraft
}): AssistantAdoptPreview {
  const { project, draft } = input
  if (draft.projectId !== project.id) throw fail('DRAFT_PROJECT_MISMATCH', '这份草稿不属于当前小说项目。')
  const blockers: string[] = []
  let targetLabel = assistantScopeKey(draft.target)
  try { targetLabel = describeAssistantTarget(project, draft.target).label } catch (error) {
    blockers.push(error instanceof Error ? error.message : '目标已经不存在。')
  }
  if (draft.status === '已采用') blockers.push('这份草稿已经采用过了，不会重复应用。')
  if (draft.status === '已放弃') blockers.push('这份草稿已经放弃，需要重新生成。')
  if (project.revision !== draft.baseRevision) {
    blockers.push(`项目已经从版本 ${draft.baseRevision} 变到 ${project.revision}，请重新预览后再采用。`)
  }

  const items: AssistantAdoptItem[] = draft.changes.map((change, index) => {
    const current = currentValueOf(change, project)
    const after = nextValueOf(change)
    const action: AssistantAdoptItem['action'] = !current.exists ? '新增' : current.text.trim() === after.trim() ? '未变化' : '修改'
    const group = draft.dependencyGroups.find((item) => item.changeIndexes.includes(index))
    return {
      changeIndex: index, kind: change.kind, label: changeLabel(change, project), action,
      before: trim(current.text), after: trim(after), groupId: group?.id ?? ''
    }
  })

  const downstream: AssistantAdoptPreview['downstream'] = []
  const touchedChapters = new Set<number>()
  for (const change of draft.changes) {
    if (change.kind === 'chapter') touchedChapters.add(change.chapter.chapterNumber)
    if (change.kind === 'beat') {
      const card = outlineChapters(project).find((item) => item.id === change.chapterId)
      if (card) touchedChapters.add(card.chapterNumber)
    }
  }
  for (const chapterNumber of touchedChapters) {
    const body = project.chapters.find((item) => item.chapterNumber === chapterNumber && item.blocks.some((block) => block.text.trim()))
    if (body) downstream.push({ label: `第${chapterNumber}章正文`, reason: '章纲已经变化，需要你复核；正文不会被自动改写。' })
  }
  if (draft.changes.some((change) => change.kind === 'outline' || change.kind === 'volume')) {
    const written = project.chapters.filter((item) => item.blocks.some((block) => block.text.trim())).length
    if (written > 0) downstream.push({ label: `已写正文 ${written} 章`, reason: '总纲或卷纲变化只提示待复核，不自动改写已有正文。' })
  }

  const preview = {
    draftId: draft.id, version: draft.version, baseRevision: draft.baseRevision,
    currentRevision: project.revision, previewDigest: '', target: draft.target, targetLabel,
    items, groups: draft.dependencyGroups, downstream, blockers
  }
  return { ...preview, previewDigest: previewDigestOf({ project, draft, items }) }
}

/** 把草稿变更真正写进正式项目；只走白名单形状，不接受任意 patch。 */
function applyChange(project: NovelProject, change: AssistantChange): void {
  if (change.kind === 'story-core') {
    project.seed = change.seed
    return
  }
  if (change.kind === 'outline') {
    if (!project.outline) throw fail('DRAFT_TARGET_MISSING', '请先建立小说大纲，再采用总纲变更。')
    project.outline.synopsis = change.synopsis
    project.outline.mainConflict = change.mainConflict
    project.outline.endingDirection = change.endingDirection
    project.outline.status = '草稿'
    project.outline.updatedAt = new Date().toISOString()
    return
  }
  if (change.kind === 'volume') {
    if (!project.outline) throw fail('DRAFT_TARGET_MISSING', '请先建立小说大纲，再采用卷级变更。')
    const index = project.outline.volumes.findIndex((item) => item.id === change.volume.id || item.volumeNumber === change.volume.volumeNumber)
    if (index < 0) project.outline.volumes.push(change.volume)
    else project.outline.volumes[index] = change.volume
    project.outline.volumes.sort((left, right) => left.volumeNumber - right.volumeNumber)
    project.outline.status = '草稿'
    project.outline.updatedAt = new Date().toISOString()
    return
  }
  if (change.kind === 'chapter') {
    if (!project.outline) throw fail('DRAFT_TARGET_MISSING', '请先建立小说大纲，再采用章纲变更。')
    for (const volume of project.outline.volumes) {
      const index = volume.chapters.findIndex((item) => item.id === change.chapter.id)
      if (index >= 0) {
        volume.chapters[index] = change.chapter
        project.outline.status = '草稿'
        project.outline.updatedAt = new Date().toISOString()
        return
      }
    }
    throw fail('DRAFT_TARGET_MISSING', '找不到该章纲，它可能已被删除或结构调整后合并。')
  }
  if (change.kind === 'beat') {
    const card = outlineChapters(project).find((item) => item.id === change.chapterId)
    if (!card) throw fail('DRAFT_TARGET_MISSING', '找不到该章纲，步骤无法写入。')
    const index = card.beats.findIndex((item) => item.id === change.beat.id)
    if (index < 0) card.beats.push(change.beat)
    else card.beats[index] = change.beat
    if (project.outline) project.outline.status = '草稿'
    return
  }
  const storyline = change.storyline
  if (!project.storylines) project.storylines = []
  const index = project.storylines.findIndex((item) => item.id === storyline.id)
  if (index < 0) project.storylines.push(storyline)
  else project.storylines[index] = storyline
}

/**
 * 原子采用：正式内容、恢复前快照、草稿状态、候选记录在同一事务内提交。
 *
 * 采用前会**重新计算**预览并比对摘要：项目被改过、草稿被改过或目标已删除，
 * 一律拒绝，绝不拿旧预览去写新内容。重复确认也不会执行第二次。
 */
export function applyAssistantDraft(input: {
  database: NovelDatabaseService
  projectId: string
  draftId: string
  expectedVersion: number
  expectedPreviewDigest: string
}): NovelProject {
  const { database } = input
  const project = database.getProject(input.projectId)
  const draft = database.getAssistantDraftById(input.projectId, input.draftId)
  if (!draft) throw fail('DRAFT_NOT_FOUND', '找不到这份工作草稿。')
  if (draft.status === '已采用') throw fail('DRAFT_ALREADY_APPLIED', '这份草稿已经采用过了，不会重复应用。')
  if (draft.version !== input.expectedVersion) throw fail('DRAFT_VERSION_STALE', '这份草稿已经被更新，请重新预览后再采用。')
  const preview = buildAdoptPreview({ project, draft })
  if (preview.blockers.length) throw fail('DRAFT_ADOPT_BLOCKED', preview.blockers.join(' '))
  if (preview.previewDigest !== input.expectedPreviewDigest) {
    throw fail('DRAFT_PREVIEW_STALE', '预览已经过期，请重新预览后再采用。')
  }
  if (draft.changes.length === 0) throw fail('DRAFT_EMPTY', '这份草稿没有任何变更。')

  const next = structuredClone(project)
  for (const change of draft.changes) applyChange(next, change)
  next.status = '大纲草稿'

  return database.applyAcceptedRevision({
    project: next,
    baseRevision: project.revision,
    reason: `采用工作草稿：${draft.summary}`,
    source: '作者确认采用',
    proposal: {
      id: draft.id, projectId: project.id, kind: 'outline', target: 'outline', targetId: draft.scopeKey,
      baseRevision: project.revision, summary: draft.summary, candidate: next.outline ?? {},
      status: '待处理', createdAt: new Date().toISOString()
    },
    onCommit: () => {
      database.saveAssistantDraft({ ...draft, status: '已采用', updatedAt: new Date().toISOString() })
    }
  })
}
