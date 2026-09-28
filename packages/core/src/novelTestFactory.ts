import { randomUUID } from 'node:crypto'
import { NovelProjectSchema, type NovelProject } from '../../contracts/src'
import { chapterDigest } from './novelMemory'
import { defaultSettings } from './novelImportExport'

function makeNovelRaw(chapterCount = 1) {
  const now = new Date().toISOString()
  const chapters = Array.from({ length: chapterCount }, (_, index) => {
    const chapter = { id: `chapter-${index + 1}`, volumeNumber: Math.floor(index / 50) + 1, chapterNumber: index + 1, title: index === 0 ? '古钟初鸣' : `第${index + 1}章`, blocks: [{ id: randomUUID(), text: index === 0 ? '林砚在旧城发现一座刻有星纹的古钟，并决定隐瞒此事。' : `林砚继续追查古钟，第${index + 1}章。` }], status: '草稿' as const, sourceDigest: '', updatedAt: now }
    chapter.sourceDigest = chapterDigest(chapter)
    return chapter
  })
  return { schemaVersion: 2, id: randomUUID(), title: '星纹古钟', seed: '少年发现改变世界秩序的古钟', settings: defaultSettings('玄幻修仙'), status: '创作中', revision: 0, worldBible: { status: '定稿', summary: '群国争夺星辉资源。', premise: '力量必有代价。', themes: ['选择'], rules: ['能力使用会消耗记忆'], geography: '', historySummary: '', entries: [{ id: 'char-1', type: '角色', name: '林砚', aliases: [], tags: [], summary: '谨慎的调查者', notes: '', locked: true, aiVisibility: '始终可见', relations: [], customFields: {}, details: { role: '主角', identity: '', appearance: '', personality: '谨慎', values: ['守信'], boundaries: ['不伤害无辜'], goal: '调查古钟', weakness: '多疑', secret: '', speechStyle: '简短', arc: '' } }], timeline: [], updatedAt: now }, outline: { status: '定稿', synopsis: '', themes: [], mainConflict: '', endingDirection: '', volumes: [{ id: 'v1', volumeNumber: 1, title: '旧城', goal: '', climax: '', resolution: '', chapters: chapters.map((chapter) => ({ id: chapter.id, volumeNumber: chapter.volumeNumber, chapterNumber: chapter.chapterNumber, title: chapter.title, pov: '林砚', objective: chapter.chapterNumber === chapterCount ? '古钟再次鸣响，联系第一章秘密' : '', conflict: '', turningPoint: '', reveal: '', endingHook: '', characterIds: ['char-1'], setupThreadIds: chapter.chapterNumber === 1 ? ['thread-clock'] : [], payoffThreadIds: chapter.chapterNumber === chapterCount ? ['thread-clock'] : [], beats: [], status: '已规划' })) }], updatedAt: now }, chapters, memories: [], plotThreads: [{ id: 'thread-clock', title: '古钟星纹', detail: '第一章出现的古钟', characterIds: ['char-1'], status: '推进中', setupChapterId: chapters[0]?.id, setupMethod: '视觉细节', setupEvidence: { chapterId: chapters[0]!.id, blockId: chapters[0]!.blocks[0]!.id, excerpt: '刻有星纹的古钟' }, targetPayoffChapter: chapterCount, resolutionMethod: '', progress: [], updatedAt: now }], branches: [], reviews: [], createdAt: now, updatedAt: now }
}

export function makeNovel(chapterCount = 1): NovelProject {
  return NovelProjectSchema.parse(makeNovelRaw(chapterCount))
}
