import { describe, expect, it } from 'vitest'
import { previewOutlineStructureEdit, retargetProjectAfterStructureEdit } from './novelPlanning'
import { makeNovel } from './novelTestFactory'
import type { ChapterOutline, ChapterMemory, NovelProject, NovelStoryline } from '../../contracts/src'

describe('大纲结构调整候选', () => {
  it('插入章节只调整显示编号并保留既有章纲身份', () => {
    const project = fixture(3)
    const result = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '插入章节', relativeChapterId: 'outline-2', position: '之前',
      chapterDraft: { title: '新的线索' }
    }, { now: '2026-08-30T00:00:00.000Z', createId: () => 'outline-new' })
    const chapters = result.candidate.volumes[0]!.chapters
    expect(chapters.map((chapter) => [chapter.id, chapter.chapterNumber])).toEqual([
      ['outline-1', 1], ['outline-new', 2], ['outline-2', 3], ['outline-3', 4]
    ])
    expect(result.impact.risk).toBe('中')
    expect(result.impact.affectedChapterIds).toContain('outline-2')
  })

  it('调序不会把故事时间改成阅读顺序', () => {
    const project = fixture(3)
    const result = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '调序', chapterId: 'outline-3', relativeChapterId: 'outline-1', position: '之前'
    }, { now: '2026-08-30T00:00:00.000Z' })
    const moved = result.candidate.volumes[0]!.chapters.find((chapter) => chapter.id === 'outline-3')!
    expect(moved.chapterNumber).toBe(1)
    expect(moved.storyTime).toBe('第三天')
    expect(moved.narrativeMode).toBe('倒叙')
    expect(result.impact.warnings.some((item) => item.includes('故事发生时间'))).toBe(true)
  })

  it('删除已有正文时提升为高风险，并不从候选中删除正文数据', () => {
    const project = fixture(3)
    project.chapters = [{ id: 'outline-2', volumeNumber: 1, chapterNumber: 2, title: '正文', blocks: [{ id: 'b1', text: '正文' }], status: '草稿', sourceDigest: '', updatedAt: '' }]
    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除章节', chapterId: 'outline-2' }, { now: '2026-08-30T00:00:00.000Z' })
    expect(result.impact.risk).toBe('高')
    expect(result.impact.affectedBodyCount).toBe(1)
    expect(result.impact.warnings.some((item) => item.includes('不会自动重写或删除'))).toBe(true)
    expect(project.chapters).toHaveLength(1)
  })

  it('正文 id 与章纲 id 不同时，影响摘要仍必须统计到该正文（按章号关联）', () => {
    const project = fixture(3)
    project.chapters = [{ id: 'body-2', volumeNumber: 1, chapterNumber: 2, title: '正文', blocks: [{ id: 'b1', text: '正文' }], status: '草稿', sourceDigest: '', updatedAt: '' }]
    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除章节', chapterId: 'outline-2' }, { now: '2026-08-30T00:00:00.000Z' })
    expect(result.impact.affectedBodyCount, '按章号也必须认得出这一章正文').toBe(1)
    expect(result.impact.risk).toBe('高')
    expect(result.impact.warnings.some((item) => item.includes('不会自动重写或删除'))).toBe(true)
  })

  it('拆分只生成一个新身份：原章纲身份默认保留给「前半」', () => {
    const project = fixture(1)
    project.outline!.volumes[0]!.chapters[0]!.beats = [beat('b1', 1), beat('b2', 2), beat('b3', 3)]
    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '拆分章节', chapterId: 'outline-1', splitAfterBeat: 1 }, { createId: (() => { let n = 0; return () => `new-${++n}` })() })
    const chapters = result.candidate.volumes[0]!.chapters
    expect(chapters).toHaveLength(2)
    // 两张都用新身份会让原正文、记忆与伏笔同时失去宿主，只能被挪到末尾；这里不允许。
    expect(chapters.map((item) => item.id), '前半沿用原章纲身份，只有后半是新身份').toEqual(['outline-1', 'new-1'])
    expect(chapters.map((item) => item.beats.length)).toEqual([1, 2])
    expect(result.impact.affectedChapterIds).toContain('outline-1')
    expect(result.impact.bodyHandling).toContain('前半')
    expect(result.impact.identityMerges, '拆分不产生身份归并').toBeUndefined()
  })

  it('拆分可以按作者选择把原章纲身份留给「后半」', () => {
    const project = fixture(1)
    project.outline!.volumes[0]!.chapters[0]!.beats = [beat('b1', 1), beat('b2', 2), beat('b3', 3)]
    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '拆分章节', chapterId: 'outline-1', splitAfterBeat: 1, splitBodySide: '后半' }, { createId: (() => { let n = 0; return () => `new-${++n}` })() })
    expect(result.candidate.volumes[0]!.chapters.map((item) => item.id)).toEqual(['new-1', 'outline-1'])
    expect(result.impact.bodyHandling).toContain('后半')
  })

  it('只允许合并相邻章节，合并后沿用较早章纲的稳定身份', () => {
    const project = fixture(3)
    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '合并章节', chapterId: 'outline-1', otherChapterId: 'outline-2', mergeBodyStrategy: '拼接' })
    const chapters = result.candidate.volumes[0]!.chapters
    expect(chapters.map((item) => item.id), '合并后沿用较早章纲身份，后章身份被退休并改挂').toEqual(['outline-1', 'outline-3'])
    expect(chapters[0]!.beats.map((item) => item.order)).toEqual([])
    expect(result.impact.changes[0]).toContain('合并')
    expect(result.impact.identityMerges).toEqual([
      { kind: '章纲', from: 'outline-2', to: 'outline-1' },
      { kind: '正文', from: 'chapter-2', to: 'chapter-1', joinBlocks: true }
    ])
  })

  it('后章已有正文时，合并必须先由作者选择正文如何保留', () => {
    const project = fixture(2)
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '合并章节', chapterId: 'outline-1', otherChapterId: 'outline-2' }))
      .toThrow('请先明确两份正文如何保留')
  })

  it('合并选「保留为无章纲」时，影响摘要如实说明后章正文会失去对应章纲', () => {
    const project = fixture(2)
    const result = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '合并章节', chapterId: 'outline-1', otherChapterId: 'outline-2', mergeBodyStrategy: '保留为无章纲'
    })
    expect(result.impact.bodyHandling).toContain('没有对应章纲')
    expect(result.impact.warnings.join('|')).toContain('没有对应章纲')
    expect(result.impact.identityMerges, '不拼接就不该归并正文身份').toEqual([{ kind: '章纲', from: 'outline-2', to: 'outline-1' }])
  })

  it('跨卷调序必须明确使用跨卷移动', () => {
    const project = fixture(2)
    project.outline!.volumes.push({ id: 'v2', volumeNumber: 2, title: '第二卷', goal: '', climax: '', resolution: '', chapters: [{ ...project.outline!.volumes[0]!.chapters[1]!, id: 'outline-v2', volumeNumber: 2, chapterNumber: 2 }] })
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '调序', chapterId: 'outline-1', relativeChapterId: 'outline-v2', position: '之后' })).toThrow('跨卷调整请使用')
  })

  it('跨卷移动不能把章节移动到原来的卷', () => {
    const project = fixture(2)
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '跨卷移动', chapterId: 'outline-1', targetVolumeNumber: 1 })).toThrow('目标卷与当前卷相同')
  })
})

describe('卷级结构与关联重定向', () => {
  it('卷排序：卷号与章号按新顺序重排，章纲身份不变', () => {
    const project = twoVolumeFixture()
    const result = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '卷排序', volumeNumber: 2, relativeVolumeNumber: 1, position: '之前'
    }, { now: '2026-08-30T00:00:00.000Z' })

    expect(result.candidate.volumes.map((volume) => [volume.volumeNumber, volume.title])).toEqual([[1, '第二卷'], [2, '旧城']])
    expect(result.candidate.volumes[0]!.chapters.map((chapter) => chapter.id)).toEqual(['chapter-2'])
    expect(result.candidate.volumes[0]!.chapters[0]!.chapterNumber).toBe(1)
    expect(result.candidate.volumes[1]!.chapters.map((chapter) => chapter.id)).toEqual(['chapter-1'])
    expect(result.candidate.volumes[1]!.chapters[0]!.chapterNumber).toBe(2)
    expect(result.impact.changes.join()).toContain('移动到')
  })

  it('卷排序：同一卷或找不到的卷都要报错', () => {
    const project = twoVolumeFixture()
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '卷排序', volumeNumber: 1, relativeVolumeNumber: 1, position: '之前' })).toThrow('不能是同一卷')
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '卷排序', volumeNumber: 9, relativeVolumeNumber: 1, position: '之前' })).toThrow('找不到第 9 卷')
  })

  it('删除卷：卷内有正文时拒绝，且一个字都不改', () => {
    const project = twoVolumeFixture()
    const snapshot = JSON.stringify(project)
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除卷', volumeNumber: 1 }))
      .toThrow('不会级联删除这些内容')
    expect(JSON.stringify(project), '被拒绝后项目必须原样不动').toBe(snapshot)
  })

  it('删除卷：卷内只有剧情步骤时同样拒绝', () => {
    const project = twoVolumeFixture()
    project.outline!.volumes[0]!.chapters[0]!.beats = [beat('b1', 1)]
    project.chapters = []
    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除卷', volumeNumber: 1, confirmVolumeChapters: true }))
      .toThrow('剧情步骤')
  })

  it('删除卷：只剩空章纲时必须显式确认，确认后正文与伏笔不受影响', () => {
    const project = twoVolumeFixture()
    // 卷内还有 2 张章纲，但都没有正文、剧情步骤与引用：必须显式确认才会移除
    project.chapters = []
    project.memories = []
    // 换成一条只引用第 2 卷（第 2 章）的伏笔：它不该拦住第 1 卷的删除，也不该被删卷改坏
    project.plotThreads = [{ ...project.plotThreads[0]!, setupChapterId: 'chapter-2', targetPayoffChapter: 2 }]

    expect(() => previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除卷', volumeNumber: 1 }))
      .toThrow('我已确认移除这些章纲')

    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除卷', volumeNumber: 1, confirmVolumeChapters: true }, { now: '2026-08-30T00:00:00.000Z' })
    expect(result.candidate.volumes.map((volume) => volume.volumeNumber)).toEqual([1])
    expect(result.candidate.volumes[0]!.title).toBe('第二卷')
    expect(project.plotThreads, '伏笔与证据不得因删卷而删除').toHaveLength(1)
  })

  it('删除卷：整卷没有任何章纲时可直接删除', () => {
    const project = twoVolumeFixture()
    project.outline!.volumes.push({ id: 'v3', volumeNumber: 3, title: '空卷', goal: '', climax: '', resolution: '', chapters: [] })
    const result = previewOutlineStructureEdit(project, { baseRevision: 0, operation: '删除卷', volumeNumber: 3 })
    expect(result.candidate.volumes.map((volume) => volume.title)).toEqual(['旧城', '第二卷'])
  })

  it('调序后关联重定向：正文跟随自己的章纲，记忆章号与伏笔计划回收章同步改写', () => {
    const project = makeNovel(3)
    project.revision = 0
    project.memories = [memory('chapter-1', 1)]
    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '调序', chapterId: 'chapter-3', relativeChapterId: 'chapter-1', position: '之前'
    }, { now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted, movedBodyIds } = retargetProjectAfterStructureEdit(project, preview.candidate)
    const outlineNumbers = new Map(retargeted.outline!.volumes[0]!.chapters.map((chapter) => [chapter.id, chapter.chapterNumber]))

    for (const body of retargeted.chapters) {
      expect(body.chapterNumber, '正文必须与同身份的章纲保持同一阅读位置').toBe(outlineNumbers.get(body.id))
    }
    expect(retargeted.chapters.map((chapter) => [chapter.id, chapter.chapterNumber])).toEqual([
      ['chapter-1', 2], ['chapter-2', 3], ['chapter-3', 1]
    ])
    expect(movedBodyIds.sort()).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
    expect(retargeted.memories[0]!.chapterNumber, '章节记忆缓存的章号必须跟着自己的正文').toBe(2)
    expect(retargeted.plotThreads[0]!.targetPayoffChapter, '伏笔计划回收章按阅读顺序映射改写').toBe(1)
  })

  it('结构变更后事件线的章节关联章号跟着自己的章纲走', () => {
    const project = makeNovel(2)
    project.revision = 0
    const [first, second] = project.outline!.volumes[0]!.chapters
    project.storylines = [storyline('line-1', [first!.id, second!.id])]

    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '调序', chapterId: second!.id, relativeChapterId: first!.id, position: '之前'
    }, { now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted } = retargetProjectAfterStructureEdit(project, preview.candidate)
    const outlineNumbers = new Map(retargeted.outline!.volumes[0]!.chapters.map((chapter) => [chapter.id, chapter.chapterNumber]))
    const plans = retargeted.storylines![0]!.chapterPlans

    expect(plans).toHaveLength(2)
    for (const plan of plans) {
      expect(plan.chapterNumber, '事件线的章节关联必须与章纲同号').toBe(outlineNumbers.get(plan.chapterId))
    }
    expect(plans.map((plan) => plan.chapterNumber), '按新阅读顺序排列').toEqual([1, 2])
  })

  it('旧项目（正文与章纲身份不同）调序后按旧章号映射跟随，不串章', () => {
    const project = fixture(3)
    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '调序', chapterId: 'outline-3', relativeChapterId: 'outline-1', position: '之前'
    }, { now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted, orphanBodyIds } = retargetProjectAfterStructureEdit(project, preview.candidate)
    const outlineNumbers = new Map(retargeted.outline!.volumes[0]!.chapters.map((chapter) => [chapter.id, chapter.chapterNumber]))

    // 旧正文只按章号关联：它必须继续跟着「原来那一张章纲」，而不是停在旧编号上
    expect(orphanBodyIds.sort()).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
    expect(retargeted.chapters.map((chapter) => chapter.chapterNumber)).toEqual([2, 3, 1])
    expect(retargeted.chapters[0]!.chapterNumber).toBe(outlineNumbers.get('outline-1'))
    expect(retargeted.chapters[2]!.chapterNumber).toBe(outlineNumbers.get('outline-3'))
    expect(new Set(retargeted.chapters.map((chapter) => chapter.chapterNumber)).size).toBe(3)
  })

  it('拆章后原正文仍挂在「前半」，不产生无章纲正文也不被挪到末尾', () => {
    const project = makeNovel(2)
    project.revision = 0
    project.outline!.volumes[0]!.chapters[1]!.beats = [beat('b1', 1), beat('b2', 2)]
    project.memories = [memory('chapter-2', 2)]
    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '拆分章节', chapterId: 'chapter-2', splitAfterBeat: 1
    }, { createId: (() => { let n = 0; return () => `new-${++n}` })(), now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted, orphanBodyIds } = retargetProjectAfterStructureEdit(project, preview.candidate, { identityMerges: preview.impact.identityMerges })
    const outlineById = new Map(retargeted.outline!.volumes[0]!.chapters.map((chapter) => [chapter.id, chapter.chapterNumber]))
    const body = retargeted.chapters.find((chapter) => chapter.id === 'chapter-2')!

    expect(orphanBodyIds, '原正文有明确归属，不得变成无章纲正文').toEqual([])
    expect(outlineById.get('chapter-2'), '前半沿用原身份，原正文跟着它到新章号').toBe(2)
    expect(body.chapterNumber, '正文跟随自己章纲，没有被挪到末尾').toBe(2)
    expect(body.blocks.map((block) => block.text), '正文内容不得被改写').toEqual(project.chapters[1]!.blocks.map((block) => block.text))
    // 章节记忆按正文身份记账，章号跟着正文走
    expect(retargeted.memories[0]!.chapterId).toBe('chapter-2')
    expect(retargeted.memories[0]!.chapterNumber).toBe(body.chapterNumber)
    // 后半是新身份，还没有正文——这是新章的正常状态
    expect(retargeted.chapters.filter((chapter) => chapter.chapterNumber === outlineById.get('new-1'))).toHaveLength(0)
    expect(new Set(retargeted.chapters.map((chapter) => chapter.chapterNumber)).size).toBe(retargeted.chapters.length)
  })

  it('拆章选「后半」时，原正文与关联一起改挂到后半', () => {
    const project = makeNovel(2)
    project.revision = 0
    project.outline!.volumes[0]!.chapters[1]!.beats = [beat('b1', 1), beat('b2', 2)]
    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '拆分章节', chapterId: 'chapter-2', splitAfterBeat: 1, splitBodySide: '后半'
    }, { createId: (() => { let n = 0; return () => `new-${++n}` })(), now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted, orphanBodyIds } = retargetProjectAfterStructureEdit(project, preview.candidate, { identityMerges: preview.impact.identityMerges })
    const outlineById = new Map(retargeted.outline!.volumes[0]!.chapters.map((chapter) => [chapter.id, chapter.chapterNumber]))
    const body = retargeted.chapters.find((chapter) => chapter.id === 'chapter-2')!

    expect(orphanBodyIds).toEqual([])
    expect(body.chapterNumber, '正文跟着改为后半身份的章纲').toBe(outlineById.get('chapter-2'))
    expect(outlineById.get('new-1'), '新身份的前半排在原章号位置').toBe(2)
  })

  it('合章选「拼接」：两章段落按顺序并入同一份正文，关联全部改挂且无悬空引用', () => {
    const project = makeNovel(2)
    project.revision = 0
    project.memories = [memory('chapter-2', 2)]
    project.reviews = [{
      id: 'review-1', chapterId: 'chapter-2', category: '连续性', severity: '低', title: '衔接', description: '',
      evidence: [{ chapterId: 'chapter-2', blockId: project.chapters[1]!.blocks[0]!.id, excerpt: '古钟' }], recommendation: '', status: '待处理', createdAt: '2026-08-30T00:00:00.000Z'
    }]
    project.storylines = [storyline('line-1', ['chapter-1', 'chapter-2'])]
    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '合并章节', chapterId: 'chapter-1', otherChapterId: 'chapter-2', mergeBodyStrategy: '拼接'
    }, { now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted, orphanBodyIds, mergedBodyIds } = retargetProjectAfterStructureEdit(project, preview.candidate, { identityMerges: preview.impact.identityMerges })
    const body = retargeted.chapters[0]!

    expect(orphanBodyIds, '拼接后不允许出现无对应章纲的正文').toEqual([])
    expect(mergedBodyIds).toEqual(['chapter-2'])
    expect(retargeted.chapters, '两份正文合成一份').toHaveLength(1)
    expect(body.id, '沿用先者正文身份').toBe('chapter-1')
    expect(body.blocks.map((block) => block.text), '段落按顺序拼接、内容不改写')
      .toEqual([...project.chapters[0]!.blocks, ...project.chapters[1]!.blocks].map((block) => block.text))
    expect(body.blocks.map((block) => block.id), '段落身份保持，段落级证据不会失效')
      .toEqual([...project.chapters[0]!.blocks, ...project.chapters[1]!.blocks].map((block) => block.id))
    expect(body.chapterNumber).toBe(retargeted.outline!.volumes[0]!.chapters[0]!.chapterNumber)

    // 章节记忆：改挂到接管正文，章号同步
    expect(retargeted.memories[0]!.chapterId).toBe('chapter-1')
    expect(retargeted.memories[0]!.chapterNumber).toBe(body.chapterNumber)
    // 审稿问题及其段落证据：同样改挂，不留悬空身份
    expect(retargeted.reviews[0]!.chapterId).toBe('chapter-1')
    expect(retargeted.reviews[0]!.evidence[0]!.chapterId).toBe('chapter-1')
    expect(retargeted.reviews[0]!.evidence[0]!.blockId, '段落身份不变，证据仍可定位').toBe(project.chapters[1]!.blocks[0]!.id)
    // 伏笔证据仍指向真实存在的正文与段落
    expect(retargeted.plotThreads[0]!.setupEvidence!.chapterId).toBe('chapter-1')
    expect(retargeted.plotThreads[0]!.setupEvidence!.blockId, '埋设证据的段落身份不变').toBe(project.chapters[0]!.blocks[0]!.id)
    expect(retargeted.chapters.some((chapter) => chapter.id === retargeted.plotThreads[0]!.setupEvidence!.chapterId)).toBe(true)
    // 事件线章节关联改挂到合并后的章纲身份
    expect(retargeted.storylines![0]!.chapterPlans.map((plan) => plan.chapterId)).toEqual(['chapter-1'])
    expect(retargeted.storylines![0]!.chapterPlans[0]!.chapterNumber).toBe(retargeted.outline!.volumes[0]!.chapters[0]!.chapterNumber)
    // 全项目不得残留指向已消失身份的引用
    const liveBodyIds = new Set(retargeted.chapters.map((chapter) => chapter.id))
    const dangling = [
      ...retargeted.memories.map((item) => item.chapterId),
      ...retargeted.plotThreads.flatMap((thread) => [thread.setupChapterId, thread.resolutionChapterId, ...thread.progress.map((item) => item.chapterId), ...(thread.evidencePool ?? []).map((item) => item.chapterId)]),
      ...retargeted.reviews.flatMap((item) => [item.chapterId, ...item.evidence.map((evidence) => evidence.chapterId)])
    ].filter((value): value is string => typeof value === 'string' && value !== 'chapter-1' && !liveBodyIds.has(value))
    expect(dangling, '不得留下悬空引用').toEqual([])
  })

  it('合章选「保留为无章纲」时才允许出现无对应章纲的正文，且章号不与他人重复', () => {
    const project = makeNovel(2)
    project.revision = 0
    const preview = previewOutlineStructureEdit(project, {
      baseRevision: 0, operation: '合并章节', chapterId: 'chapter-1', otherChapterId: 'chapter-2', mergeBodyStrategy: '保留为无章纲'
    }, { now: '2026-08-30T00:00:00.000Z' })

    const { project: retargeted, orphanBodyIds } = retargetProjectAfterStructureEdit(project, preview.candidate, { identityMerges: preview.impact.identityMerges })
    const numbers = retargeted.chapters.map((chapter) => chapter.chapterNumber)

    expect(orphanBodyIds).toEqual(['chapter-2'])
    expect(new Set(numbers).size, '不得出现重复章号').toBe(numbers.length)
    expect(retargeted.chapters, '正文本身不得被删除').toHaveLength(2)
  })
})

function storyline(id: string, chapterIds: string[]): NovelStoryline {
  return {
    id, title: `事件线 ${id}`, type: '', whyNecessary: '', openingState: '', finalGoal: '', endCondition: '',
    characterIds: [], entryIds: [], relatedPlotThreadIds: [], keyNodes: [],
    chapterPlans: chapterIds.map((chapterId, index) => ({
      chapterId, chapterNumber: index + 1, subGoal: '', method: '', obstacle: '', outcome: '', nextTrigger: '', changes: [], status: '计划', evidence: []
    })),
    currentProgress: 0, costPaid: '', unresolvedQuestions: [], nextAction: '', status: '未开始', evidenceChain: [],
    updatedAt: '2026-08-30T00:00:00.000Z'
  }
}

function twoVolumeFixture(): NovelProject {
  const project = makeNovel(2)
  project.revision = 0
  project.outline!.volumes.push({
    id: 'v2', volumeNumber: 2, title: '第二卷', goal: '', climax: '', resolution: '',
    chapters: [{ ...project.outline!.volumes[0]!.chapters[1]!, volumeNumber: 2 }]
  })
  project.outline!.volumes[0]!.chapters = [project.outline!.volumes[0]!.chapters[0]!]
  project.chapters[1]!.volumeNumber = 2
  return project
}

function memory(chapterId: string, chapterNumber: number): ChapterMemory {
  return {
    id: `memory-${chapterId}`, chapterId, chapterNumber, status: '正式', sourceDigest: 'digest',
    summary: '摘要', keyEvents: [], characterStates: [], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: '2026-08-30T00:00:00.000Z'
  }
}

function fixture(count: number): NovelProject {
  const project = makeNovel(count)
  project.revision = 0
  const chapters = Array.from({ length: count }, (_, index) => chapter(`outline-${index + 1}`, index + 1))
  project.outline!.volumes[0]!.chapters = chapters
  return project
}

function chapter(id: string, number: number): ChapterOutline {
  return { id, volumeNumber: 1, chapterNumber: number, title: `第${number}章`, storyTime: number === 3 ? '第三天' : `${number}天`, narrativeMode: number === 3 ? '倒叙' : '顺叙', pov: '林砚', objective: `目标${number}`, conflict: `冲突${number}`, turningPoint: `转折${number}`, reveal: '', endingHook: '', characterIds: ['char-1'], setupThreadIds: [], payoffThreadIds: [], beats: [], status: '已规划', beatStatus: '未生成', beatFindings: [] }
}

function beat(id: string, order: number) { return { id, order, title: `步骤${order}`, purpose: '', conflict: '', outcome: '', reveal: '', characterIds: [], location: '', timeframe: '', threadActions: [] } }
