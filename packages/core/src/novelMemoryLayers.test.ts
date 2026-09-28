import { afterEach, describe, expect, it } from 'vitest'
import { NovelDatabaseService } from './novelDatabase'
import { buildNovelContext } from './novelContext'
import { chapterDigest, explainMemoryRecall } from './novelMemory'
import { makeNovel } from './novelTestFactory'

describe('长篇记忆五层召回账本', () => {
  const databases: NovelDatabaseService[] = []
  afterEach(() => databases.splice(0).forEach((database) => database.close()))

  it('将生成上下文明确归入五个中文层级，并保留纳入/排除原因', () => {
    const project = makeNovel(12)
    const target = project.chapters[8]!
    project.memories.push({
      id: 'memory-layer', chapterId: project.chapters[0]!.id, chapterNumber: 1, status: '正式', sourceDigest: chapterDigest(project.chapters[0]!),
      summary: '古钟在旧城初次鸣响。', keyEvents: ['发现古钟'], characterStates: [], facts: [{
        id: 'fact-layer', category: '秘密', content: '古钟会夺走记忆', certainty: '正式', locked: true,
        source: { chapterId: project.chapters[0]!.id, blockId: project.chapters[0]!.blocks[0]!.id, excerpt: '古钟夺走了记忆。' }
      }], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString()
    })
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, target.id, 8_000)
    expect(context.layers.map((layer) => layer.layer)).toEqual(['稳定事实', '动态状态', '剧情证据', '近期正文', '远期召回'])
    expect(context.layers.every((layer) => layer.includedCount + layer.excludedCount === layer.entries.length)).toBe(true)
    expect(context.layers.find((layer) => layer.layer === '稳定事实')?.entries.some((entry) => entry.id === 'world-constraints' || entry.id === 'world-core')).toBe(true)
    expect(context.layers.find((layer) => layer.layer === '近期正文')?.entries.every((entry) => entry.layer === '近期正文')).toBe(true)
    expect(context.entries.every((entry) => entry.layer)).toBe(true)
  })

  it('召回解释带有动态/剧情层与全部认知证据，且不会读取未来章节', () => {
    const project = makeNovel(6)
    const source = project.chapters[0]!, future = project.chapters[4]!
    project.memories = [{
      id: 'memory-1', chapterId: source.id, chapterNumber: 1, status: '正式', sourceDigest: chapterDigest(source), summary: '', keyEvents: [],
      characterStates: [{ id: 'state-layer', characterId: 'char-1', characterName: '林砚', location: '旧城', ability: '未觉醒', physicalState: '健康', emotion: '警惕', goal: '调查', knowledge: [], relationships: [], perspective: '角色认知', knownToCharacterIds: ['char-1'], knowledgeEvidence: [{ chapterId: source.id, blockId: source.blocks[0]!.id, excerpt: '林砚亲眼看见古钟。' }], source: { chapterId: source.id, excerpt: '林砚亲眼看见古钟。' } }],
      facts: [{ id: 'future-fact', category: '秘密', content: '第五章才揭示的秘密', certainty: '正式', locked: false, appliesFromChapter: 5, source: { chapterId: future.id, excerpt: '未来秘密' } }], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString()
    }]
    const recalls = explainMemoryRecall(project.memories, 3)
    expect(recalls).toHaveLength(1)
    expect(recalls[0]).toMatchObject({ layer: '动态状态', perspective: '角色认知', knownToCharacterIds: ['char-1'] })
    expect(recalls[0]?.evidence).toHaveLength(2)
    expect(recalls.some((item) => item.itemId === 'future-fact')).toBe(false)
  })

  it('数据库可按项目读取同一份五层账本，不会产生持久化副作用', () => {
    const project = makeNovel(2)
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const before = database.getProject(project.id).revision
    const ledger = database.contextLedger(project.id, project.chapters[1]!.id, 10_000)
    expect(ledger).toHaveLength(5)
    expect(database.getProject(project.id).revision).toBe(before)
  })
})
