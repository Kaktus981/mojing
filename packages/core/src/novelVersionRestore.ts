import { createHash } from 'node:crypto'
import { NovelVersionRestorePreviewSchema, type NovelProject } from '../../contracts/src'

type NovelVersionRestorePreview = ReturnType<typeof NovelVersionRestorePreviewSchema.parse>

/**
 * M8 · 受控事务恢复的差异预览与摘要绑定。
 *
 * 两条硬规则：
 *   1. 差异是**逐条比对真实数据**算出来的，不猜百分比、不用演示文本；
 *   2. 预览摘要绑定「目标快照 + 当前 revision + 双方内容摘要」，
 *      目标或当前任一变化，旧预览立刻失效，恢复必须重新预览。
 */
export class VersionRestorePreviewStaleError extends Error {
  readonly code = 'RESTORE_PREVIEW_STALE'
  constructor() {
    super('这次恢复的预览已经过期：当前稿或目标版本在这期间发生了变化，请重新预览差异后再恢复。')
  }
}

export class VersionNotFoundError extends Error {
  readonly code = 'VERSION_NOT_FOUND'
  constructor() {
    super('找不到这个历史版本，它可能已经被删除。')
  }
}

function contentDigest(project: NovelProject): string {
  return createHash('sha256').update(JSON.stringify(project)).digest('hex')
}

/**
 * 预览摘要：目标快照 id / 版本号 / 内容摘要 + 当前 revision 与内容摘要。
 * 不包含时间戳，因此同一状态下重复预览得到同一个摘要，恢复时可以确定性重算。
 */
export function versionRestoreDigest(current: NovelProject, snapshot: NovelProject, versionId: string): string {
  return createHash('sha256').update(JSON.stringify({
    versionId,
    targetRevision: snapshot.revision,
    targetDigest: contentDigest(snapshot),
    currentRevision: current.revision,
    currentDigest: contentDigest(current)
  })).digest('hex')
}

type DiffPair = { key: string; label: string }

/** 按稳定身份逐项比对：数量变化与内容变化分开统计。 */
function diffByKey(
  before: DiffPair[],
  after: DiffPair[]
): { changed: number; added: number; removed: number; sample: string[] } {
  const beforeMap = new Map(before.map((item) => [item.key, item.label]))
  const afterMap = new Map(after.map((item) => [item.key, item.label]))
  const added = after.filter((item) => !beforeMap.has(item.key))
  const removed = before.filter((item) => !afterMap.has(item.key))
  const changed = after.filter((item) => {
    const previous = beforeMap.get(item.key)
    return previous !== undefined && previous !== item.label
  })
  const sample = [
    ...changed.slice(0, 6).map((item) => `改：${item.label}`),
    ...added.slice(0, 6).map((item) => `增：${item.label}`),
    ...removed.slice(0, 6).map((item) => `删：${item.label}`)
  ].slice(0, 20)
  return { changed: changed.length, added: added.length, removed: removed.length, sample }
}

function chapterPairs(project: NovelProject): DiffPair[] {
  return project.chapters.map((chapter) => ({
    key: chapter.id,
    label: `第${chapter.chapterNumber}章 ${chapter.title || '未命名'}（${chapter.blocks.map((block) => block.text).join('')}）`
  }))
}

function outlinePairs(project: NovelProject): DiffPair[] {
  const volumes = project.outline?.volumes ?? []
  const chapterPairs = volumes.flatMap((volume) => volume.chapters.map((chapter) => ({
    key: chapter.id,
    label: `第${volume.volumeNumber}卷 第${chapter.chapterNumber}章 ${chapter.title || '未命名'}｜目标：${chapter.objective || '（空）'}`
  })))
  const storylinePairs = (project.storylines ?? []).map((line) => ({
    key: `storyline:${line.id}`,
    label: `事件线 ${line.title || '未命名'}（${line.status}，目标：${line.finalGoal || '（空）'}）`
  }))
  return [...chapterPairs, ...storylinePairs]
}

function worldPairs(project: NovelProject): DiffPair[] {
  const bible = project.worldBible
  const entries = (bible?.entries ?? []).map((entry) => ({ key: `entry:${entry.id}`, label: `词条 ${entry.name}（${entry.type}）` }))
  const timeline = (bible?.timeline ?? []).map((event) => ({ key: `event:${event.id}`, label: `时间线 ${event.title || '未命名'}` }))
  const constraints = project.worldConstraints.map((item) => ({ key: `term:${item.id}`, label: `术语 ${item.term}（${item.status}）` }))
  const head = bible ? [{ key: 'bible', label: `世界书 ${bible.status}｜${bible.summary}` }] : []
  return [...head, ...entries, ...timeline, ...constraints]
}

function memoryPairs(project: NovelProject): DiffPair[] {
  return project.memories.map((memory) => ({ key: memory.id, label: `记忆 ${memory.summary || memory.id}（${memory.status}）` }))
}

function threadPairs(project: NovelProject): DiffPair[] {
  return project.plotThreads.map((thread) => ({ key: thread.id, label: `伏笔 ${thread.title || '未命名'}（${thread.status}）` }))
}

function reviewPairs(project: NovelProject): DiffPair[] {
  return project.reviews.map((review) => ({ key: review.id, label: `审稿 ${review.title || '未命名'}（${review.status}）` }))
}

function branchPairs(project: NovelProject): DiffPair[] {
  return project.branches.map((branch) => ({ key: branch.id, label: `分支 ${branch.name || '未命名'}（${branch.status}）` }))
}

/**
 * 生成恢复差异预览。`current` 是当前稿，`snapshot` 是要恢复到的历史版本。
 * 「新增」= 恢复后会出现的条目，「删除」= 恢复后消失的条目。
 */
export function buildVersionRestorePreview(
  current: NovelProject,
  snapshot: NovelProject,
  versionId: string,
  now: string
): NovelVersionRestorePreview {
  const scopes: Array<{ scope: NovelVersionRestorePreview['diffs'][number]['scope']; before: DiffPair[]; after: DiffPair[] }> = [
    { scope: '正文', before: chapterPairs(current), after: chapterPairs(snapshot) },
    { scope: '大纲', before: outlinePairs(current), after: outlinePairs(snapshot) },
    { scope: '世界观', before: worldPairs(current), after: worldPairs(snapshot) },
    { scope: '记忆', before: memoryPairs(current), after: memoryPairs(snapshot) },
    { scope: '伏笔', before: threadPairs(current), after: threadPairs(snapshot) },
    { scope: '审稿', before: reviewPairs(current), after: reviewPairs(snapshot) },
    { scope: '分支', before: branchPairs(current), after: branchPairs(snapshot) }
  ]

  const diffs = scopes.map(({ scope, before, after }) => ({ scope, ...diffByKey(before, after) })).filter((item) => item.changed || item.added || item.removed)

  return NovelVersionRestorePreviewSchema.parse({
    projectId: current.id,
    versionId,
    targetRevision: snapshot.revision,
    currentRevision: current.revision,
    previewDigest: versionRestoreDigest(current, snapshot, versionId),
    createdAt: now,
    diffs
  })
}
