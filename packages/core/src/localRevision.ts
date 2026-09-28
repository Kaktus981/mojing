import type {
  AssistantChange, AssistantDraft, AssistantTarget, LocalRevisionCandidate, LocalRevisionScope, NovelProject
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'
import { changeLabel, saveAssistantDraft, scopeViolation } from './assistantCandidates'

/**
 * 局部修改与分批细化（D1/D3）：**范围即权限**。
 *
 * 作者声明改某个步骤，就只允许写那个步骤；改某卷，就只允许碰那一卷里的章；
 * 改某条故事线，就不能顺手改别的线；批次只覆盖作者明确选中的章。
 * 越界的变更一律拒绝，不会「先写进去再提醒」。
 */
export function saveScopedRevisionDraft(input: {
  database: NovelDatabaseService
  project: NovelProject
  scope: LocalRevisionScope
  changes: AssistantChange[]
  batchChapterIds?: string[]
  sourceDigest?: string
  summary?: string
}): { draft: AssistantDraft; keptAuthorEdits: boolean } {
  const { project, scope } = input
  if (scope.projectId !== project.id) throw scopeViolation('DRAFT_PROJECT_MISMATCH', '该创作对象不属于当前小说项目。')
  assertWithinScope(project, scope, input.changes, input.batchChapterIds)
  const target: AssistantTarget = scope.kind === 'beat'
    ? { kind: 'beat', projectId: project.id, objectId: scope.objectId, beatId: scope.beatId }
    : { kind: scope.kind, projectId: project.id, objectId: scope.objectId }
  const first = input.changes[0]
  const summary = input.summary?.trim()
    || (first ? `局部修改：${changeLabel(first, project)} 等 ${input.changes.length} 项` : '局部修改')
  return saveAssistantDraft({
    database: input.database, project, target, taskType: '局部修改', stage: 'outline',
    changes: input.changes, sourceDigest: input.sourceDigest, summary
  })
}

/**
 * 把模型输出映射成领域变更。
 *
 * 模型只给出「要改成什么文字」，**不给出写哪条路径**：
 * 目标对象由 `scope` 和项目里已经存在的稳定 ID 决定，映射后再走一次范围校验。
 * 模型给的 id 若不存在于当前范围，直接拒绝，不会新建悬空对象。
 */
export function localRevisionChangesFromCandidate(input: {
  project: NovelProject
  scope: LocalRevisionScope
  candidate: LocalRevisionCandidate
}): AssistantChange[] {
  const { project, scope, candidate } = input
  const chapters = (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
  const changes: AssistantChange[] = []

  if (scope.kind === 'volume' && candidate.volumeGoal !== undefined) {
    const volume = project.outline?.volumes.find((item) => item.id === scope.objectId)
    if (!volume) throw scopeViolation('DRAFT_TARGET_MISSING', '找不到当前卷。')
    changes.push({ kind: 'volume', volume: { ...volume, goal: candidate.volumeGoal } })
  }
  if (candidate.chapterObjective !== undefined || candidate.chapterConflict !== undefined) {
    if (scope.kind !== 'chapter') throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改的范围不是单章。')
    const card = chapters.find((item) => item.id === scope.objectId)
    if (!card) throw scopeViolation('DRAFT_TARGET_MISSING', '找不到当前章纲。')
    changes.push({
      kind: 'chapter',
      chapter: {
        ...card,
        objective: candidate.chapterObjective ?? card.objective,
        conflict: candidate.chapterConflict ?? card.conflict
      }
    })
  }
  for (const item of candidate.chapters ?? []) {
    const card = chapters.find((entry) => entry.id === item.id)
    if (!card) throw scopeViolation('DRAFT_TARGET_MISSING', `找不到章纲 ${item.id}；模型不能新建章。`)
    changes.push({ kind: 'chapter', chapter: { ...card, objective: item.objective, conflict: item.conflict } })
  }
  for (const item of candidate.beats ?? []) {
    const card = chapters.find((entry) => entry.id === item.chapterId)
    const beat = card?.beats.find((entry) => entry.id === item.id)
    if (!card || !beat) throw scopeViolation('DRAFT_TARGET_MISSING', `找不到剧情步骤 ${item.id}；模型不能新建步骤。`)
    changes.push({
      kind: 'beat', chapterId: card.id,
      beat: {
        ...beat, title: item.title, purpose: item.purpose, conflict: item.conflict, outcome: item.outcome,
        order: item.order, location: item.location, timeframe: item.timeframe, reveal: item.reveal
      }
    })
  }
  for (const item of candidate.storylines ?? []) {
    const line = (project.storylines ?? []).find((entry) => entry.id === item.id)
    if (!line) throw scopeViolation('DRAFT_TARGET_MISSING', `找不到故事线 ${item.id}；模型不能新建故事线。`)
    changes.push({ kind: 'storyline', storyline: { ...line, title: item.title, whyNecessary: item.whyNecessary } })
  }
  if (changes.length === 0) throw scopeViolation('DRAFT_EMPTY', '模型没有给出任何改动。')
  return changes
}

function assertWithinScope(project: NovelProject, scope: LocalRevisionScope, changes: AssistantChange[], batch?: string[]): void {
  const volumeOf = (chapterId: string) => (project.outline?.volumes ?? []).find((volume) => volume.chapters.some((item) => item.id === chapterId))
  const batchSet = batch ? new Set(batch) : undefined
  if (batchSet && batchSet.size === 0) throw scopeViolation('DRAFT_SCOPE_VIOLATION', '多章批次必须至少选中一章。')

  for (const change of changes) {
    if (change.kind === 'story-core' || change.kind === 'outline') {
      throw scopeViolation('DRAFT_SCOPE_VIOLATION', '局部修改不能改写故事核心或全书总纲；请改用明确的初纲流程。')
    }
    if (change.kind === 'volume') {
      if (scope.kind !== 'volume' || change.volume.id !== scope.objectId) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改只能改动当前选中的这一卷。')
      }
    }
    if (change.kind === 'chapter') {
      if (batchSet && !batchSet.has(change.chapter.id)) throw scopeViolation('DRAFT_SCOPE_VIOLATION', '批次只能覆盖你明确选中的章。')
      if (scope.kind === 'storyline') throw scopeViolation('DRAFT_SCOPE_VIOLATION', '改故事线时不能顺带修改章纲。')
      if (scope.kind === 'beat') throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次只改当前剧情步骤，不能改写整章。')
      if (scope.kind === 'chapter' && change.chapter.id !== scope.objectId) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改只能改动当前选中的这一章。')
      }
      if (scope.kind === 'volume' && volumeOf(change.chapter.id)?.id !== scope.objectId) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改只能改动当前卷里的章。')
      }
    }
    if (change.kind === 'beat') {
      if (batchSet && !batchSet.has(change.chapterId)) throw scopeViolation('DRAFT_SCOPE_VIOLATION', '批次只能覆盖你明确选中的章。')
      if (scope.kind === 'storyline') throw scopeViolation('DRAFT_SCOPE_VIOLATION', '改故事线时不能顺带修改剧情步骤。')
      if (scope.kind === 'volume' && volumeOf(change.chapterId)?.id !== scope.objectId) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改只能改动当前卷里的章。')
      }
      if (scope.kind === 'chapter' && change.chapterId !== scope.objectId) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改只能改动当前选中的这一章。')
      }
      if (scope.kind === 'beat' && (change.chapterId !== scope.objectId || change.beat.id !== scope.beatId)) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次只改当前剧情步骤，不能改写同章的其它步骤。')
      }
    }
    if (change.kind === 'storyline') {
      if (scope.kind !== 'storyline' || change.storyline.id !== scope.objectId) {
        throw scopeViolation('DRAFT_SCOPE_VIOLATION', '这次修改只能改动当前选中的故事线。')
      }
    }
  }
}
