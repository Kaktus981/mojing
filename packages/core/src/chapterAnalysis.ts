import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type {
  ChapterAnalysisResult, ChapterAnalysisTask, NovelProject
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }
const now = (): string => new Date().toISOString()

/**
 * 章后分析（D6/D9）。
 *
 * 三条硬规则：
 *  1. **先保存成功再分析**：保存失败不排任务；普通防抖自动保存永不触发分析。
 *  2. 任务固定「章节源指纹 + 上下文版本」；源码一变，旧结果立刻标过期，不作为当前结论。
 *  3. 结果只作为候选：摘要是分析记录（不冒充作者确认记忆），状态/设定是设定候选，
 *     伏笔是伏笔候选，质量发现是待审问题——都不自动写入正式资料。
 */

/** 章节源指纹：正文文本一变就变。 */
export function chapterSourceDigest(project: NovelProject, chapterId: string): string {
  const chapter = project.chapters.find((item) => item.id === chapterId)
  if (!chapter) throw fail('CHAPTER_NOT_FOUND', '找不到该章节。')
  const text = chapter.blocks.map((block) => block.text).join('\n')
  return createHash('sha256').update(`${chapter.id}::${text}`, 'utf8').digest('hex').slice(0, 32)
}

/** 同一章节同一份源码只排一个任务；重复触发直接复用。 */
export function findDuplicateTask(
  database: NovelDatabaseService,
  projectId: string,
  chapterId: string,
  sourceDigest: string
): ChapterAnalysisTask | undefined {
  return database.listChapterAnalyses(projectId, chapterId)
    .find((item) => item.sourceDigest === sourceDigest && item.status !== '取消')
}

export function enqueueChapterAnalysis(input: {
  database: NovelDatabaseService
  project: NovelProject
  chapterId: string
  trigger: ChapterAnalysisTask['trigger']
}): { task: ChapterAnalysisTask; deduped: boolean } {
  const sourceDigest = chapterSourceDigest(input.project, input.chapterId)
  const existing = findDuplicateTask(input.database, input.project.id, input.chapterId, sourceDigest)
  if (existing) return { task: existing, deduped: true }
  const task = input.database.createChapterAnalysis({
    id: `analysis-${randomUUID()}`, projectId: input.project.id, chapterId: input.chapterId,
    sourceDigest, contextVersion: input.project.revision,
    trigger: input.trigger, status: '等待', result: null, error: null,
    createdAt: now(), startedAt: null, endedAt: null
  })
  return { task, deduped: false }
}

/** 源码已经变了就把旧任务标过期：晚回来的结果不能再当当前结论。 */
export function markStaleAnalyses(database: NovelDatabaseService, project: NovelProject, chapterId?: string): ChapterAnalysisTask[] {
  const stale: ChapterAnalysisTask[] = []
  for (const task of database.listChapterAnalyses(project.id, chapterId)) {
    // 已经完成的结果同样会过期：源码一变，它就不再是当前结论。
    if (task.status === '过期' || task.status === '取消') continue
    const current = (() => { try { return chapterSourceDigest(project, task.chapterId) } catch { return task.sourceDigest } })()
    if (current !== task.sourceDigest || project.revision !== task.contextVersion) {
      stale.push(database.updateChapterAnalysis(task.id, { status: '过期', error: '章节或上下文已经变化，这次分析的结果不再作为当前结论。' }))
    }
  }
  return stale
}

export function startChapterAnalysis(database: NovelDatabaseService, id: string): ChapterAnalysisTask {
  const task = database.getChapterAnalysis(id)
  if (!task) throw fail('ANALYSIS_NOT_FOUND', '找不到该分析任务。')
  if (task.status === '取消' || task.status === '过期') throw fail('ANALYSIS_CLOSED', `该任务已经${task.status}，请重新分析。`)
  return database.updateChapterAnalysis(id, { status: '运行中', startedAt: now() })
}

export function completeChapterAnalysis(database: NovelDatabaseService, id: string, result: ChapterAnalysisResult): ChapterAnalysisTask {
  return database.updateChapterAnalysis(id, { status: '完成', result, error: null, endedAt: now() })
}

/** 失败不影响已保存正文：任务只记录状态与原因，不无限自动重试。 */
export function failChapterAnalysis(database: NovelDatabaseService, id: string, message: string): ChapterAnalysisTask {
  return database.updateChapterAnalysis(id, { status: '失败', error: message, endedAt: now() })
}

export function cancelChapterAnalysis(database: NovelDatabaseService, id: string): ChapterAnalysisTask {
  const task = database.getChapterAnalysis(id)
  if (!task) throw fail('ANALYSIS_NOT_FOUND', '找不到该分析任务。')
  if (task.status === '完成' || task.status === '失败') throw fail('ANALYSIS_CLOSED', '该任务已经结束，不能取消。')
  return database.updateChapterAnalysis(id, { status: '取消', endedAt: now() })
}

/** 进程中断时把「等待/运行中」变成可见的失败状态，不假装还在跑。 */
export function markInterruptedAnalyses(database: NovelDatabaseService, projectId: string): void {
  for (const task of database.listChapterAnalyses(projectId)) {
    if (task.status === '等待' || task.status === '运行中') {
      database.updateChapterAnalysis(task.id, {
        status: '失败', error: '软件关闭后分析已中断，可以重新分析本章。', endedAt: now()
      })
    }
  }
}

/** 交接成功后是否自动分析：开关默认关闭，只有开启且交接成功才入队。 */
export function shouldAutoAnalyzeAfterHandoff(project: NovelProject): boolean {
  return project.settings.chapterAutoAnalyze === true
}

/** 结果归属（D6/D10）：只给跳转目标，不在这里写入任何正式资料。 */
export function analysisRouting(result: ChapterAnalysisResult): Array<{
  kind: '记忆提案' | '设定提案' | '伏笔候选' | '待审问题'
  label: string
  count: number
  target: { stageId: 'memory' | 'world' | 'delivery'; subnavId: string }
}> {
  return [
    { kind: '记忆提案', label: '章节摘要与状态候选', count: result.memoryCandidates.length, target: { stageId: 'memory', subnavId: 'memory-proposals' } },
    { kind: '设定提案', label: '设定候选', count: result.settingCandidates.length, target: { stageId: 'world', subnavId: 'world-expansion' } },
    { kind: '伏笔候选', label: '伏笔候选', count: result.foreshadowCandidates.length, target: { stageId: 'memory', subnavId: 'foreshadowing' } },
    { kind: '待审问题', label: '质量发现', count: result.reviewFindings.length, target: { stageId: 'delivery', subnavId: 'review-issues' } }
  ]
}
