/**
 * 墨境长篇压力测试（默认跳过）。
 *
 * 这些测试只使用核心服务和内存/临时 SQLite 数据库，不会触碰正式
 * .mojing-dev/mojing.db。启用方式：
 *   PowerShell: $env:MOJING_STRESS='1'; npm test -- tests/longformStress.test.ts
 *
 * 每个用例都会输出耗时、数据库体积或召回数量，方便在不同机器上比较。
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NovelDatabaseService } from '../packages/core/src/novelDatabase'
import { explainMemoryRecall, chapterDigest, reconcileNovelAfterEdit } from '../packages/core/src/novelMemory'
import { makeNovel } from '../packages/core/src/novelTestFactory'
import { previewOutlineStructureEdit } from '../packages/core/src/novelPlanning'
import type { ChapterMemory, NovelProject } from '../packages/contracts/src/novel'

const enabled = process.env.MOJING_STRESS === '1'
const suite = enabled ? describe : describe.skip
const timed = (label: string, start: number, detail: string) => console.info(`[墨境压力测试] ${label}: ${Date.now() - start} ms; ${detail}`)

function useTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'mojing-longform-'))
  const file = join(directory, 'stress.db')
  const database = new NovelDatabaseService(file)
  return { database, file, directory, close: () => { database.close(); rmSync(directory, { recursive: true, force: true }) } }
}

function millionCharacterProject(chapterCount: number): NovelProject {
  const project = makeNovel(chapterCount)
  project.title = `压力测试-${chapterCount}章`
  project.chapters = project.chapters.map((chapter, index) => ({
    ...chapter,
    // 每章约 1,000 个汉字，1000 章合计接近百万字。
    blocks: [{ id: chapter.blocks[0]!.id, text: `第${index + 1}章 longformmarker${index % 10}。` + ('林砚沿着旧城石阶继续追查星纹古钟。线索、关系与选择不断改变。'.repeat(35)) }]
  }))
  project.chapters.forEach((chapter) => { chapter.sourceDigest = chapterDigest(chapter) })
  // 让一条伏笔横跨全书，供跨卷证据链及远期搜索复用。
  project.plotThreads[0] = {
    ...project.plotThreads[0]!, targetPayoffChapter: chapterCount, status: '推进中',
    progress: [{ id: 'progress-1', chapterId: project.chapters[Math.floor(chapterCount / 2)]!.id, description: '中段再次验证星纹', source: { chapterId: project.chapters[Math.floor(chapterCount / 2)]!.id, blockId: project.chapters[Math.floor(chapterCount / 2)]!.blocks[0]!.id, excerpt: '验证星纹' } }]
  }
  return project
}

function memoriesForLongform(project: NovelProject): ChapterMemory[] {
  const first = project.chapters[0]!, future = project.chapters[Math.min(949, project.chapters.length - 1)]!
  return [
    {
      id: 'memory-early', chapterId: first.id, chapterNumber: first.chapterNumber, status: '正式', sourceDigest: first.sourceDigest,
      summary: '林砚在第一章发现古钟并决定保密。', keyEvents: ['发现古钟'], objectStates: [], timelineEvents: [], styleSignals: [],
      characterStates: [{ id: 'state-early', characterId: 'char-1', characterName: '林砚', location: '旧城', ability: '普通人', physicalState: '健康', emotion: '谨慎', goal: '调查古钟', knowledge: ['古钟存在'], relationships: [], source: { chapterId: first.id, blockId: first.blocks[0]!.id, excerpt: '发现古钟' }, perspective: '客观事实', appliesFromChapter: 1 }],
      facts: [{ id: 'fact-early', category: '秘密', content: '古钟刻有星纹', certainty: '正式', locked: true, source: { chapterId: first.id, blockId: first.blocks[0]!.id, excerpt: '星纹古钟' }, perspective: '客观事实', appliesFromChapter: 1 }], updatedAt: new Date().toISOString()
    },
    {
      id: 'memory-future', chapterId: future.id, chapterNumber: future.chapterNumber, status: '正式', sourceDigest: future.sourceDigest,
      summary: '未来才揭示钟声会改变秩序。', keyEvents: ['未来揭示'], objectStates: [], timelineEvents: [], styleSignals: [],
      characterStates: [], facts: [{ id: 'fact-future', category: '世界规则', content: '钟声会改变世界秩序', certainty: '正式', locked: true, source: { chapterId: future.id, blockId: future.blocks[0]!.id, excerpt: '改变秩序' }, perspective: '客观事实', appliesFromChapter: 950 }], updatedAt: new Date().toISOString()
    }
  ]
}

suite('500/1000 章与百万字 SQLite 基准', () => {
  it('可建立 500 章项目并完成保存、全文搜索和实体索引', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = millionCharacterProject(500)
      const saved = harness.database.createProject(project)
      expect(saved.chapters).toHaveLength(500)
      expect(harness.database.listProjects()[0]!.chapterCount).toBe(500)
      const hits = harness.database.search(saved.id, 'longformmarker7', 20)
      expect(hits.length).toBeGreaterThan(0)
      expect(harness.database.listMentions(saved.id, 'char-1').length).toBeGreaterThan(0)
      timed('500章建库+搜索', started, `搜索 ${hits.length} 条`)
    } finally { harness.close() }
  }, 180_000)

  it('可建立 500、1000 章项目并完成近百万字保存、全文搜索和索引', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = millionCharacterProject(1000)
      const saved = harness.database.createProject(project)
      expect(saved.chapters).toHaveLength(1000)
      const summary = harness.database.listProjects()[0]!
      expect(summary.chapterCount).toBe(1000)
      expect(summary.wordCount).toBeGreaterThan(900_000)
      const hits = harness.database.search(saved.id, 'longformmarker3', 20)
      expect(hits.length).toBeGreaterThan(0)
      expect(harness.database.listMentions(saved.id, 'char-1').length).toBeGreaterThan(0)
      const bytes = statSync(harness.file).size
      expect(bytes).toBeGreaterThan(100_000)
      timed('1000章/近百万字建库+搜索', started, `数据库 ${bytes} bytes，搜索 ${hits.length} 条`)
    } finally { harness.close() }
  }, 180_000)

  it('远期记忆按章节生效，未来事实不会泄漏', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = millionCharacterProject(1000)
      project.memories = memoriesForLongform(project)
      const saved = harness.database.createProject(project)
      const recalled = explainMemoryRecall(saved.memories, 900)
      expect(recalled.some((item) => item.itemId === 'fact-early')).toBe(true)
      expect(recalled.some((item) => item.itemId === 'fact-future')).toBe(false)
      timed('第900章远期记忆召回', started, `召回 ${recalled.length} 条；未来事实隔离通过`)
    } finally { harness.close() }
  }, 180_000)
})

suite('数百人物及别名召回准确率', () => {
  it('300 人物的别名只命中对应实体', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = millionCharacterProject(500)
      const template = project.worldBible!.entries[0]!
      project.worldBible!.entries = Array.from({ length: 300 }, (_, index) => ({ ...template, id: `character-${index}`, name: `人物${index}`, aliases: [`代号${index}`], summary: `第${index}号人物` }))
      project.chapters = project.chapters.map((chapter, index) => ({ ...chapter, blocks: [{ ...chapter.blocks[0]!, text: `${chapter.blocks[0]!.text} 人物${index % 300} 代号${index % 300}` }] }))
      project.chapters.forEach((chapter) => { chapter.sourceDigest = chapterDigest(chapter) })
      const saved = harness.database.createProject(project)
      const entry = saved.worldBible!.entries[137]!
      const mentions = harness.database.listMentions(saved.id, entry.id)
      expect(mentions.length).toBeGreaterThan(0)
      expect(new Set(mentions.map((item) => item.entryId))).toEqual(new Set([entry.id]))
      expect(mentions.every((item) => item.matchedText === entry.name || item.matchedText === entry.aliases[0])).toBe(true)
      timed('300人物别名索引', started, `命中 ${mentions.length} 条，误归属 0`)
    } finally { harness.close() }
  }, 180_000)
})

suite('改纲、删章、调序后的记忆失效与伏笔证据链', () => {
  it('正文修改后记忆失效；结构候选只影响目标范围', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = makeNovel(12)
      const first = project.chapters[0]!
      project.memories = memoriesForLongform(project).slice(0, 1)
      const saved = harness.database.createProject(project)
      const edited = saved.chapters.map((chapter) => chapter.id === first.id ? { ...chapter, blocks: [{ ...chapter.blocks[0]!, text: chapter.blocks[0]!.text + ' 作者改纲后补充了新证据。' }] } : chapter)
      const reconciled = reconcileNovelAfterEdit(saved, { ...saved, chapters: edited, revision: saved.revision + 1 })
      expect(reconciled.memories.find((memory) => memory.chapterId === first.id)?.status).toBe('需更新')
      const outline = saved.outline!
      const target = outline.volumes[0]!.chapters[1]!
      const reference = outline.volumes[0]!.chapters[2]!
      const reorder = previewOutlineStructureEdit(saved, { baseRevision: saved.revision, operation: '调序', chapterId: target.id, relativeChapterId: reference.id, position: '之后' })
      expect(reorder.impact.affectedChapterIds).toContain(target.id)
      const deletion = previewOutlineStructureEdit(saved, { baseRevision: saved.revision, operation: '删除章节', chapterId: target.id })
      expect(deletion.candidate.volumes[0]!.chapters).toHaveLength(11)
      timed('改纲/删章/调序记忆保护', started, `调序影响 ${reorder.impact.affectedOutlineCount} 张，删除候选保留 11 张`)
    } finally { harness.close() }
  }, 60_000)

  it('跨卷伏笔保留埋设、推进、回收证据和状态', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = makeNovel(60)
      const thread = project.plotThreads[0]!
      thread.setupChapterId = project.chapters[0]!.id
      thread.setupEvidence = { chapterId: project.chapters[0]!.id, blockId: project.chapters[0]!.blocks[0]!.id, excerpt: '第一卷埋设' }
      thread.progress = [{ id: 'p1', chapterId: project.chapters[30]!.id, description: '第二卷推进', source: { chapterId: project.chapters[30]!.id, blockId: project.chapters[30]!.blocks[0]!.id, excerpt: '第二卷推进' } }]
      thread.resolutionChapterId = project.chapters[59]!.id; thread.resolutionEvidence = { chapterId: project.chapters[59]!.id, blockId: project.chapters[59]!.blocks[0]!.id, excerpt: '第三卷回收' }; thread.status = '已回收'
      const saved = harness.database.createProject(project)
      const restored = harness.database.getProject(saved.id).plotThreads[0]!
      expect(restored.setupEvidence?.excerpt).toBe('第一卷埋设')
      expect(restored.progress[0]?.source.excerpt).toBe('第二卷推进')
      expect(restored.resolutionEvidence?.excerpt).toBe('第三卷回收')
      timed('跨卷伏笔证据链', started, '埋设/推进/回收证据完整')
    } finally { harness.close() }
  }, 60_000)
})

suite('长时间任务与版本数量', () => {
  it('可持续保存版本并恢复失败任务', () => {
    const started = Date.now(), harness = useTempDatabase()
    try {
      const project = makeNovel(3), saved = harness.database.createProject(project)
      let current = saved
      for (let index = 0; index < 100; index += 1) {
        current = harness.database.saveProject({ ...current, seed: `${current.seed}-${index}` }, current.revision, `压力检查点 ${index + 1}`, '压力测试')
      }
      expect(harness.database.listVersions(saved.id).length).toBe(100)
      const request = { kind: 'chapter' as const, baseRevision: current.revision, chapterId: current.chapters[0]!.id, qualityProfile: 'economy' as const }
      const estimate = { estimatedInputTokens: 100, estimatedOutputTokens: 200, contextWindow: 16_000, warnings: [], entries: [] }
      const jobId = randomUUID(); harness.database.createGenerationJob(jobId, saved.id, 'chapter', estimate, request)
      harness.database.startGenerationJob(jobId); harness.database.appendGenerationJobProgress(jobId, 40, '压力测试中断'); harness.database.failGenerationJob(jobId, { code: 'TEST_INTERRUPTED', message: '测试模拟中断', retryable: true })
      const recoverable = harness.database.listRecoverableGenerationJobs(saved.id)
      expect(recoverable.some((job) => job.id === jobId)).toBe(true)
      const resumed = harness.database.createGenerationJob(randomUUID(), saved.id, 'chapter', estimate, request, jobId)
      expect(resumed.resumeCount).toBe(1)
      timed('100版本+可恢复任务', started, `版本 ${harness.database.listVersions(saved.id).length}，可恢复 ${recoverable.length}`)
    } finally { harness.close() }
  }, 90_000)
})
