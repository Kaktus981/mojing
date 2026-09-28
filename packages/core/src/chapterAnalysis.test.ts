import { describe, expect, it } from 'vitest'
import type { ChapterAnalysisResult, NovelProject } from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import {
  analysisRouting, cancelChapterAnalysis, chapterSourceDigest, completeChapterAnalysis, enqueueChapterAnalysis,
  failChapterAnalysis, markInterruptedAnalyses, markStaleAnalyses, shouldAutoAnalyzeAfterHandoff, startChapterAnalysis
} from './chapterAnalysis'

const result: ChapterAnalysisResult = {
  summary: '林砚第一次听见钟声，并决定独自追查。',
  memoryCandidates: [{ content: '林砚隐瞒了钟声', evidence: '他决定不告诉任何人' }],
  settingCandidates: [{ name: '潮汐港', reason: '正文出现的新地点', inferred: false }],
  foreshadowCandidates: [{ title: '钟声与记忆', evidence: '钟声后他忘了一件事' }],
  reviewFindings: [{ title: '时间线跳跃', detail: '第二段缺少过渡', severity: '中' }]
}

function setup() {
  const database = new NovelDatabaseService(':memory:')
  const project = structuredClone(makeNovel(1)) as NovelProject
  database.createProject(project)
  return { database, project, chapterId: project.chapters[0]!.id }
}

describe('章后分析任务（D6）', () => {
  it('同一章节同一份源码只排一个任务', () => {
    const { database, project, chapterId } = setup()
    const first = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' })
    expect(first.deduped).toBe(false)
    const second = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' })
    expect(second.deduped).toBe(true)
    expect(second.task.id).toBe(first.task.id)
    expect(database.listChapterAnalyses(project.id)).toHaveLength(1)
    database.close()
  })

  it('正文改动后源指纹变化，会排新任务并让旧任务过期', () => {
    const { database, project, chapterId } = setup()
    const first = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' })
    startChapterAnalysis(database, first.task.id)

    const current = database.getProject(project.id)
    const edited = structuredClone(current)
    edited.chapters[0]!.blocks[0]!.text = `${edited.chapters[0]!.blocks[0]!.text} 他又往前走了一段。`
    database.saveProject(edited, current.revision, '手动编辑', '用户编辑')

    const stale = markStaleAnalyses(database, database.getProject(project.id), chapterId)
    expect(stale).toHaveLength(1)
    expect(stale[0]!.status).toBe('过期')
    expect(database.getChapterAnalysis(first.task.id)!.status).toBe('过期')

    const second = enqueueChapterAnalysis({ database, project: database.getProject(project.id), chapterId, trigger: '手动分析' })
    expect(second.deduped).toBe(false)
    expect(chapterSourceDigest(database.getProject(project.id), chapterId)).not.toBe(first.task.sourceDigest)
    database.close()
  })

  it('完成 / 失败 / 取消都是可见状态，失败不影响已保存正文', () => {
    const { database, project, chapterId } = setup()
    const task = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' }).task
    const bodyBefore = database.getProject(project.id).chapters[0]!.blocks.map((item) => item.text)

    startChapterAnalysis(database, task.id)
    expect(database.getChapterAnalysis(task.id)!.status).toBe('运行中')
    failChapterAnalysis(database, task.id, '模型服务不可达')
    expect(database.getChapterAnalysis(task.id)!.status).toBe('失败')
    expect(database.getChapterAnalysis(task.id)!.error).toBe('模型服务不可达')
    expect(database.getProject(project.id).chapters[0]!.blocks.map((item) => item.text)).toEqual(bodyBefore)

    const retry = enqueueChapterAnalysis({ database, project: database.getProject(project.id), chapterId, trigger: '手动分析' })
    expect(retry.task.id).toBe(task.id)
    // 失败任务可以取消排队，但已经结束的不能取消。
    const done = completeChapterAnalysis(database, task.id, result)
    expect(done.status).toBe('完成')
    expect(done.result?.summary).toBe(result.summary)
    expect(() => cancelChapterAnalysis(database, task.id)).toThrowError(/已经结束/)

    const another = enqueueChapterAnalysis({ database, project: database.getProject(project.id), chapterId, trigger: '手动分析' })
    expect(another.task.id, '同一源码仍不重复排任务').toBe(task.id)
    database.close()
  })

  it('取消后再次排队允许新任务', () => {
    const { database, project, chapterId } = setup()
    const task = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' }).task
    cancelChapterAnalysis(database, task.id)
    expect(database.getChapterAnalysis(task.id)!.status).toBe('取消')
    // 取消过的任务不再参与去重：同一源码重新排队会生成新任务。
    const fresh = enqueueChapterAnalysis({
      database, project: database.getProject(project.id), chapterId, trigger: '手动分析'
    })
    expect(fresh.deduped).toBe(false)
    expect(fresh.task.id).not.toBe(task.id)
    database.close()
  })

  it('进程中断把等待/运行中的任务变成可见失败', () => {
    const { database, project, chapterId } = setup()
    const task = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' }).task
    startChapterAnalysis(database, task.id)
    markInterruptedAnalyses(database, project.id)
    const after = database.getChapterAnalysis(task.id)!
    expect(after.status).toBe('失败')
    expect(after.error).toMatch(/中断/)
    database.close()
  })

  it('自动分析开关默认关闭，只有开启且交接成功才入队', () => {
    const { database, project } = setup()
    expect(shouldAutoAnalyzeAfterHandoff(database.getProject(project.id))).toBe(false)
    const enabled = database.getProject(project.id)
    database.saveProject({ ...enabled, settings: { ...enabled.settings, chapterAutoAnalyze: true } }, enabled.revision, '开启自动分析', '章后交接')
    expect(shouldAutoAnalyzeAfterHandoff(database.getProject(project.id))).toBe(true)
    database.close()
  })
})

describe('分析结果归属（D6/D10）', () => {
  it('四类结果各有唯一归属，界面只拿跳转目标', () => {
    const routing = analysisRouting(result)
    expect(routing.map((item) => item.kind)).toEqual(['记忆提案', '设定提案', '伏笔候选', '待审问题'])
    expect(routing.find((item) => item.kind === '记忆提案')?.target).toEqual({ stageId: 'memory', subnavId: 'memory-proposals' })
    expect(routing.find((item) => item.kind === '设定提案')?.target).toEqual({ stageId: 'world', subnavId: 'world-expansion' })
    expect(routing.find((item) => item.kind === '伏笔候选')?.target).toEqual({ stageId: 'memory', subnavId: 'foreshadowing' })
    expect(routing.find((item) => item.kind === '待审问题')?.target).toEqual({ stageId: 'delivery', subnavId: 'review-issues' })
    expect(routing.reduce((sum, item) => sum + item.count, 0)).toBe(4)
  })

  it('结果只是候选，不会写进正式记忆、世界观或伏笔', () => {
    const { database, project, chapterId } = setup()
    const before = JSON.stringify(database.getProject(project.id))
    const task = enqueueChapterAnalysis({ database, project, chapterId, trigger: '手动分析' }).task
    completeChapterAnalysis(database, task.id, result)
    const after = database.getProject(project.id)
    expect(after.memories).toEqual([])
    expect(after.plotThreads.map((item) => item.title)).toEqual(project.plotThreads.map((item) => item.title))
    expect(after.worldBible!.entries.map((item) => item.name)).toEqual(project.worldBible!.entries.map((item) => item.name))
    expect(JSON.stringify(after)).toBe(before)
    database.close()
  })
})
