import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, type MemoryProposal, type NovelProject } from '../../contracts/src'
import { applyAcceptedMemory, chapterDigest, explainMemoryRecall, invalidateMemoryProposals, reconcileNovelAfterEdit, resolveCharacterKnowledge, resolveCharacterStates, resolveStoryFacts } from './novelMemory'
import { makeNovel } from './novelTestFactory'

describe('小说记忆生命周期', () => {
  it('正文变化会使本章记忆需更新，并使后续正式记忆待复核', () => {
    const current = makeNovel(3)
    current.memories = current.chapters.map((chapter) => ({ id: `m-${chapter.id}`, chapterId: chapter.id, chapterNumber: chapter.chapterNumber, status: '正式', sourceDigest: chapterDigest(chapter), summary: '', keyEvents: [], characterStates: [], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString() }))
    const edited = structuredClone(current)
    edited.chapters[0]!.blocks[0]!.text = '第一章发生了变化'
    reconcileNovelAfterEdit(current, edited)
    expect(edited.memories.map((item) => item.status)).toEqual(['需更新', '待复核', '待复核'])
  })

  it('首次保存时为新建分支补齐来源摘要，不改写已有分支的来源', () => {
    const current = makeNovel(1)
    current.chapters[0]!.sourceDigest = ''
    const now = new Date().toISOString()
    current.branches = [{ id: 'older', name: '旧分支', description: '', baseChapterId: current.chapters[0]!.id, chapters: [], status: '构思中', sourceDigest: '', baseRevision: current.revision, createdAt: now, updatedAt: now }]
    const edited = structuredClone(current)
    edited.branches.push({ ...edited.branches[0]!, id: 'new', name: '新分支' })

    reconcileNovelAfterEdit(current, edited)

    expect(edited.branches[1]!.sourceDigest).toBe(chapterDigest(edited.chapters[0]!))
    expect(edited.branches[0]!.sourceDigest).toBe('')
  })

  it('只把用户接受的角色状态写入正式记忆', () => {
    const project = makeNovel(1)
    const chapter = project.chapters[0]!
    const proposal = memoryProposal(project, chapter.id, chapterDigest(chapter))
    expect(project.memories).toHaveLength(0)
    applyAcceptedMemory(project, proposal)
    expect(project.memories[0]?.characterStates[0]?.characterName).toBe('林砚')
    expect(project.memories[0]?.characterStates[0]?.appliesFromChapter).toBe(1)
    expect(project.memories[0]?.status).toBe('正式')
  })

  it('接受摘要替换时保留旧摘要供作者查看', () => {
    const project = makeNovel(1)
    const chapter = project.chapters[0]!
    const proposal = { ...memoryProposal(project, chapter.id, chapterDigest(chapter)), category: '章节摘要' as const, candidate: '新摘要' }
    applyAcceptedMemory(project, proposal)
    expect(project.memories[0]!.editHistory).toBeUndefined()
    applyAcceptedMemory(project, { ...proposal, candidate: '修订后的摘要' })
    expect(project.memories[0]!.summary).toBe('修订后的摘要')
    expect(project.memories[0]!.editHistory).toMatchObject([{ summary: '新摘要', keyEvents: [] }])
  })

  it('后续角色状态可替换旧状态，并从指定章节开始生效', () => {
    const project = makeNovel(8)
    const firstChapter = project.chapters[1]!
    const first = memoryProposal(project, firstChapter.id, chapterDigest(firstChapter))
    first.candidate = { ...(first.candidate as object), id: 'state-old', location: '旧城' }
    applyAcceptedMemory(project, first)

    const laterChapter = project.chapters[5]!
    const later = memoryProposal(project, laterChapter.id, chapterDigest(laterChapter))
    later.candidate = { ...(later.candidate as object), id: 'state-new', location: '王都' }
    later.appliesFromChapter = 6
    later.replacesId = 'state-old'
    applyAcceptedMemory(project, later)

    expect(resolveCharacterStates(project.memories, 5).map((item) => item.id)).toEqual(['state-old'])
    expect(resolveCharacterStates(project.memories, 6).map((item) => item.id)).toEqual(['state-new'])
    expect(project.memories[0]?.characterStates[0]?.appliesThroughChapter).toBe(5)
  })

  it('事实按章节范围生效，并支持显式替换', () => {
    const project = makeNovel(10)
    project.memories = [memoryWithFacts(project, 2, [{ id: 'old-fact', content: '城门每天开放', appliesFromChapter: 2 }]), memoryWithFacts(project, 7, [{ id: 'new-fact', content: '城门永久关闭', appliesFromChapter: 7, replacesId: 'old-fact' }])]
    expect(resolveStoryFacts(project.memories, 6).map((item) => item.id)).toEqual(['old-fact'])
    expect(resolveStoryFacts(project.memories, 7).map((item) => item.id)).toEqual(['new-fact'])
  })

  it('旧项目缺少时序字段时仍可解析，并按来源章开始生效', () => {
    const project = makeNovel(3)
    project.memories = [memoryWithFacts(project, 2, [{ id: 'legacy-fact', content: '旧格式事实' }])]
    const parsed = NovelProjectSchema.parse(JSON.parse(JSON.stringify(project)))
    expect(resolveStoryFacts(parsed.memories, 1)).toHaveLength(0)
    expect(resolveStoryFacts(parsed.memories, 2).map((item) => item.id)).toEqual(['legacy-fact'])
  })

  it('章节内容变化后待确认提案自动失效', () => {
    const project = makeNovel(1), chapter = project.chapters[0]!
    const proposal = memoryProposal(project, chapter.id, chapterDigest(chapter))
    chapter.blocks[0]!.text = '已修改正文'
    expect(invalidateMemoryProposals([proposal], project)[0]?.status).toBe('已失效')
  })

  it('客观事实与角色认知分轨，并按知情角色筛选', () => {
    const project = makeNovel(4)
    const chapter = project.chapters[0]!
    project.memories = [{
      id: 'dual-track', chapterId: chapter.id, chapterNumber: 1, status: '正式', sourceDigest: chapterDigest(chapter), summary: '', keyEvents: [],
      characterStates: [
        { id: 'objective-state', characterId: 'char-1', characterName: '林砚', location: '旧城', ability: '未觉醒', physicalState: '健康', emotion: '警惕', goal: '调查古钟', knowledge: [], relationships: [], perspective: '客观事实', knownToCharacterIds: [], knowledgeEvidence: [], source: { chapterId: chapter.id, excerpt: '林砚在旧城。' } },
        { id: 'known-state', characterId: 'char-1', characterName: '林砚', location: '旧城', ability: '未觉醒', physicalState: '健康', emotion: '警惕', goal: '调查古钟', knowledge: ['古钟会夺走记忆'], relationships: [], perspective: '角色认知', knownToCharacterIds: ['char-1'], knowledgeEvidence: [{ chapterId: chapter.id, excerpt: '林砚意识到古钟会夺走记忆。' }], source: { chapterId: chapter.id, excerpt: '林砚意识到古钟会夺走记忆。' } }
      ], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString()
    }]
    expect(resolveCharacterStates(project.memories, 2, { perspective: '客观事实' }).map((item) => item.id)).toEqual(['objective-state'])
    expect(resolveCharacterKnowledge(project.memories, 2, ['char-1']).map((item) => item.id)).toEqual(['known-state'])
    expect(resolveCharacterKnowledge(project.memories, 2, ['other-character'])).toEqual([])
    expect(resolveCharacterKnowledge(project.memories, 2)).toEqual([])
    expect(resolveCharacterStates(project.memories, 2).map((item) => item.id)).toEqual(['objective-state', 'known-state'])
  })

  it('记忆召回返回来源、证据、生效范围和可解释原因', () => {
    const project = makeNovel(4)
    project.memories = [memoryWithFacts(project, 1, [{ id: 'secret', content: '古钟会夺走记忆', appliesFromChapter: 2 }])]
    const [recall] = explainMemoryRecall(project.memories, 3)
    expect(recall).toMatchObject({ memoryId: 'memory-1', itemId: 'secret', category: '剧情事实', perspective: '客观事实', sourceChapterNumber: 1, appliesFromChapter: 2 })
    expect(recall?.source.excerpt).toBe('古钟会夺走记忆')
    expect(recall?.recallReason).toContain('客观事实轨道')
    expect(recall?.recallReason).toContain('第2章起生效')
  })
})

function memoryProposal(project: NovelProject, chapterId: string, sourceDigest: string): MemoryProposal {
  return { id: 'p1', projectId: project.id, chapterId, sourceDigest, category: '角色状态', targetId: 'char-1', candidate: { id: 'state-1', characterId: 'char-1', characterName: '林砚', location: '旧城', ability: '尚未觉醒', physicalState: '轻伤', emotion: '警惕', goal: '寻找古钟', knowledge: [], relationships: [], source: { chapterId, blockId: project.chapters[0]?.blocks[0]?.id, excerpt: '林砚扶着墙走进旧城。' } }, source: { chapterId, excerpt: '林砚扶着墙走进旧城。' }, confidence: .95, risk: '中', status: '待确认', createdAt: new Date().toISOString() }
}

function memoryWithFacts(project: NovelProject, chapterNumber: number, facts: Array<{ id: string; content: string; appliesFromChapter?: number; appliesThroughChapter?: number; replacesId?: string }>) {
  const chapter = project.chapters[chapterNumber - 1]!
  return {
    id: `memory-${chapterNumber}`, chapterId: chapter.id, chapterNumber, status: '正式' as const, sourceDigest: chapterDigest(chapter), summary: '', keyEvents: [], characterStates: [],
    facts: facts.map((item) => ({ ...item, category: '世界规则' as const, certainty: '正式' as const, locked: false, source: { chapterId: chapter.id, excerpt: item.content } })),
    objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString()
  }
}
