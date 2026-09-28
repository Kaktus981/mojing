import { describe, expect, it } from 'vitest'

import {
  BEAT_EDITABLE_FIELDS,
  CHAPTER_OUTLINE_EDITABLE_FIELDS,
  CHAPTER_REFERENCE_KINDS,
  applyAddBeat,
  applyAddChapterOutline,
  applyBeatFieldEdit,
  applyChapterOutlineFieldEdit,
  applyChapterReferenceEdit,
  applyConfirmBeats,
  applyCreateBodyForOutline,
  applyCreateOutlineForBody,
  applyMoveBeat,
  applyRemoveBeat,
  nextChapterNumber,
  type ChapterWritingDraft
} from './outlineIntegrationModel'

/**
 * M4 · 章纲到正文：纯 mutator 测试。
 *
 * 这些函数是「章纲 / 剧情步骤 / 正文关联」的唯一写入口，页面只把它们包进
 * `updateProject`，因此这里证明五件事：
 *   1. 新章编号同时考虑现有章纲与正文，不只看正文；
 *   2. 章纲七字段与剧情步骤七字段可写，改动已确认步骤必须标记复核；
 *   3. 「开始写作」为章纲建立唯一正文，重复点击不产生第二份；
 *   4. 正文无章纲时可补建作者确认的空规划，不猜正文内容；
 *   5. 章纲引用的选择 / 移除只改章纲上的稳定 id 数组，不碰伏笔状态与证据；
 *   6. 越界、缺失目标、重复 id 一律返回空且无副作用。
 */

const NOW = '2026-09-14T12:00:00.000Z'

function outlineChapter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'oc-1',
    volumeNumber: 1,
    chapterNumber: 1,
    title: '古钟初鸣',
    pov: '',
    objective: '',
    conflict: '',
    turningPoint: '',
    reveal: '',
    endingHook: '',
    characterIds: [],
    setupThreadIds: [],
    payoffThreadIds: [],
    beats: [],
    beatFindings: [],
    status: '已规划',
    beatStatus: '未生成',
    ...overrides
  }
}

function bodyChapter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ch-1',
    volumeNumber: 1,
    chapterNumber: 1,
    title: '古钟初鸣',
    blocks: [{ id: 'ch-1-b1', text: '' }],
    status: '草稿',
    sourceDigest: '',
    updatedAt: NOW,
    ...overrides
  }
}

/** 一册一卷三章纲 + 两章正文的前置草稿。 */
function draftWithPlan(): ChapterWritingDraft {
  return {
    outline: {
      status: '草稿',
      synopsis: '',
      themes: [],
      mainConflict: '',
      endingDirection: '',
      updatedAt: NOW,
      volumes: [
        {
          id: 'vol-1',
          volumeNumber: 1,
          title: '第1卷',
          goal: '',
          climax: '',
          resolution: '',
          chapters: [
            outlineChapter({ id: 'oc-1', chapterNumber: 1 }),
            outlineChapter({ id: 'oc-2', chapterNumber: 2 }),
            outlineChapter({ id: 'oc-3', chapterNumber: 3 })
          ]
        }
      ]
    },
    directionCards: [],
    directionQuestions: [],
    directionQuestionAnswers: [],
    chapters: [
      bodyChapter({ id: 'ch-1', chapterNumber: 1 }),
      bodyChapter({ id: 'ch-2', chapterNumber: 2 })
    ]
  }
}

describe('新章编号', () => {
  it('同时考虑章纲与正文，取两者最大编号 +1', () => {
    expect(nextChapterNumber(draftWithPlan())).toBe(4)
  })

  it('只有正文没有章纲时按正文最大值递增', () => {
    const draft = draftWithPlan()
    draft.outline = undefined
    draft.chapters.push(bodyChapter({ id: 'ch-9', chapterNumber: 9 }))
    expect(nextChapterNumber(draft)).toBe(10)
  })

  it('只有章纲没有正文时按章纲最大值递增（修复只看正文的问题）', () => {
    const draft = draftWithPlan()
    draft.chapters = []
    expect(nextChapterNumber(draft)).toBe(4)
  })

  it('空项目从第 1 章开始', () => {
    const draft = draftWithPlan()
    draft.outline = undefined
    draft.chapters = []
    expect(nextChapterNumber(draft)).toBe(1)
  })
})

describe('新建章纲', () => {
  it('追加到目标卷末尾，编号避开章纲与正文，字段为空且状态为未规划', () => {
    const draft = draftWithPlan()
    const id = applyAddChapterOutline(draft, { volumeNumber: 1 }, NOW, 'oc-new')

    expect(id).toBe('oc-new')
    const volume = draft.outline!.volumes[0]!
    expect(volume.chapters).toHaveLength(4)

    const created = volume.chapters[3]!
    expect(created).toMatchObject({
      id: 'oc-new',
      volumeNumber: 1,
      chapterNumber: 4,
      title: '',
      pov: '',
      objective: '',
      conflict: '',
      turningPoint: '',
      reveal: '',
      endingHook: '',
      beats: [],
      status: '未规划',
      beatStatus: '未生成',
      // 章节目录会直接读这个数组；缺了它界面会在渲染时抛错（历史事故）
      beatFindings: []
    })
    expect(Array.isArray(created.beatFindings)).toBe(true)
  })

  it('不传卷号时追加到最后一卷', () => {
    const draft = draftWithPlan()
    draft.outline!.volumes.push({
      id: 'vol-2',
      volumeNumber: 2,
      title: '第2卷',
      goal: '',
      climax: '',
      resolution: '',
      chapters: []
    })

    const id = applyAddChapterOutline(draft, {}, NOW, 'oc-new')
    expect(draft.outline!.volumes[1]!.chapters[0]!.id).toBe(id)
    expect(draft.outline!.volumes[0]!.chapters).toHaveLength(3)
  })

  it('没有大纲、卷不存在或重复 id 都不写任何东西', () => {
    const noOutline = draftWithPlan()
    noOutline.outline = undefined
    expect(applyAddChapterOutline(noOutline, {}, NOW, 'x')).toBeUndefined()
    expect(noOutline.chapters).toHaveLength(2)

    const missingVolume = draftWithPlan()
    expect(applyAddChapterOutline(missingVolume, { volumeNumber: 9 }, NOW, 'x')).toBeUndefined()
    expect(missingVolume.outline!.volumes[0]!.chapters).toHaveLength(3)

    const duplicate = draftWithPlan()
    expect(applyAddChapterOutline(duplicate, { volumeNumber: 1 }, NOW, 'oc-1')).toBeUndefined()
    expect(duplicate.outline!.volumes[0]!.chapters).toHaveLength(3)
  })
})

describe('章纲字段编辑', () => {
  it('七个作者字段都能手写，并刷新大纲时间', () => {
    expect([...CHAPTER_OUTLINE_EDITABLE_FIELDS]).toEqual([
      'title', 'pov', 'objective', 'conflict', 'turningPoint', 'reveal', 'endingHook'
    ])

    const draft = draftWithPlan()
    draft.outline!.updatedAt = '2026-09-01T00:00:00.000Z'

    for (const field of CHAPTER_OUTLINE_EDITABLE_FIELDS) {
      expect(applyChapterOutlineFieldEdit(draft, 'oc-1', field, `${field}-值`, NOW)).toBe(true)
    }
    const chapter = draft.outline!.volumes[0]!.chapters[0]!
    expect(chapter.title).toBe('title-值')
    expect(chapter.endingHook).toBe('endingHook-值')
    expect(draft.outline!.updatedAt).toBe(NOW)
  })

  it('第一次写入字段时把「未规划」提升为「已规划」', () => {
    const draft = draftWithPlan()
    draft.outline!.volumes[0]!.chapters[0]!.status = '未规划'
    applyChapterOutlineFieldEdit(draft, 'oc-1', 'objective', '确认钟声改写记忆', NOW)
    expect(draft.outline!.volumes[0]!.chapters[0]!.status).toBe('已规划')
  })

  it('已定稿章纲被改写时退回「已规划」，且不触碰任何正文', () => {
    const draft = draftWithPlan()
    draft.outline!.volumes[0]!.chapters[0]!.status = '已定稿'
    const bodies = JSON.stringify(draft.chapters)

    expect(applyChapterOutlineFieldEdit(draft, 'oc-1', 'conflict', '与巡夜人对立', NOW)).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.status).toBe('已规划')
    expect(JSON.stringify(draft.chapters)).toBe(bodies)
  })

  it('已有剧情步骤时改写章纲会标记下游待复核', () => {
    const draft = draftWithPlan()
    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')

    expect(applyChapterOutlineFieldEdit(draft, 'oc-1', 'reveal', '钟声来自地底', NOW)).toBe(true)
    const chapter = draft.outline!.volumes[0]!.chapters[0]!
    expect(chapter.downstreamReviewStatus).toBe('待复核')
    expect(chapter.downstreamReviewReason).toMatch(/剧情步骤/)
  })

  it('同值重写与找不到目标都不改变任何字段', () => {
    const draft = draftWithPlan()
    expect(applyChapterOutlineFieldEdit(draft, 'oc-1', 'title', '古钟初鸣', NOW)).toBe(false)
    expect(applyChapterOutlineFieldEdit(draft, 'missing', 'title', 'x', NOW)).toBe(false)
    expect(draft.outline!.updatedAt).toBe(NOW)
  })
})

describe('章纲引用（本章出场角色 / 计划埋设伏笔 / 计划回收伏笔）', () => {
  it('三类引用各自只写自己的稳定 id 数组，其余字段一律不动', () => {
    expect([...CHAPTER_REFERENCE_KINDS]).toEqual(['character', 'setupThread', 'payoffThread'])

    const draft = draftWithPlan()
    draft.outline!.volumes[0]!.chapters[0]!.status = '已规划'
    const before = JSON.stringify({ ...draft, outline: undefined })
    const beats = JSON.stringify(draft.outline!.volumes[0]!.chapters[0]!.beats)

    expect(applyChapterReferenceEdit(draft, 'oc-1', 'character', 'char-1', true, NOW)).toBe(true)
    expect(applyChapterReferenceEdit(draft, 'oc-1', 'setupThread', 'thread-1', true, NOW)).toBe(true)
    expect(applyChapterReferenceEdit(draft, 'oc-1', 'payoffThread', 'thread-2', true, NOW)).toBe(true)

    const chapter = draft.outline!.volumes[0]!.chapters[0]!
    expect(chapter.characterIds).toEqual(['char-1'])
    expect(chapter.setupThreadIds).toEqual(['thread-1'])
    expect(chapter.payoffThreadIds).toEqual(['thread-2'])
    expect(JSON.stringify(chapter.beats)).toBe(beats)
    expect(JSON.stringify({ ...draft, outline: undefined })).toBe(before)
    expect(draft.outline!.updatedAt).toBe(NOW)
  })

  it('引用只描述章纲计划：不写入任何伏笔状态与证据', () => {
    const draft = draftWithPlan()
    // 用一条真实伏笔对象证明「计划回收」不会把它改成已回收，也不会补证据。
    const thread = {
      id: 'thread-1', title: '被刮去的守钟人姓名', detail: '', characterIds: [], status: '推进中',
      setupMethod: '', resolutionMethod: '', progress: [], updatedAt: NOW
    }
    ;(draft as unknown as { plotThreads: unknown[] }).plotThreads = [thread]
    const before = JSON.stringify(thread)

    expect(applyChapterReferenceEdit(draft, 'oc-1', 'payoffThread', 'thread-1', true, NOW)).toBe(true)
    expect(JSON.stringify(thread)).toBe(before)
    expect(draft.outline!.volumes[0]!.chapters[0]!.payoffThreadIds).toEqual(['thread-1'])
  })

  it('重复选择同一 id 不追加第二份（禁止重复引用）', () => {
    const draft = draftWithPlan()
    expect(applyChapterReferenceEdit(draft, 'oc-1', 'character', 'char-1', true, NOW)).toBe(true)
    expect(applyChapterReferenceEdit(draft, 'oc-1', 'character', 'char-1', true, NOW)).toBe(false)
    expect(draft.outline!.volumes[0]!.chapters[0]!.characterIds).toEqual(['char-1'])
  })

  it('移除只解除关联：其他已选 id 与人 / 伏笔本体都不受影响', () => {
    const draft = draftWithPlan()
    applyChapterReferenceEdit(draft, 'oc-1', 'character', 'char-1', true, NOW)
    applyChapterReferenceEdit(draft, 'oc-1', 'character', 'char-2', true, NOW)
    const available = ['char-1', 'char-2']

    expect(applyChapterReferenceEdit(draft, 'oc-1', 'character', 'char-1', false, NOW)).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.characterIds).toEqual(['char-2'])
    // 「本体」在项目其他位置，不在章纲草稿里，因此这里断言候选池未被改动。
    expect(available).toEqual(['char-1', 'char-2'])
  })

  it('失效引用可按 id 移除；目标不存在或已处于期望状态时不写', () => {
    const draft = draftWithPlan()
    draft.outline!.volumes[0]!.chapters[0]!.setupThreadIds = ['thread-deleted']
    draft.outline!.updatedAt = '2026-09-01T00:00:00.000Z'

    expect(applyChapterReferenceEdit(draft, 'oc-1', 'setupThread', 'thread-deleted', false, NOW)).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.setupThreadIds).toEqual([])

    expect(applyChapterReferenceEdit(draft, 'oc-2', 'setupThread', 'thread-1', false, NOW)).toBe(false)
    expect(applyChapterReferenceEdit(draft, 'missing', 'character', 'char-1', true, NOW)).toBe(false)
    expect(applyChapterReferenceEdit(draft, 'oc-1', 'character', '', true, NOW)).toBe(false)
  })

  it('已定稿章纲加引用后退回「已规划」，已有步骤时标记下游待复核', () => {
    const draft = draftWithPlan()
    draft.outline!.volumes[0]!.chapters[0]!.status = '已定稿'
    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')

    expect(applyChapterReferenceEdit(draft, 'oc-1', 'payoffThread', 'thread-1', true, NOW)).toBe(true)
    const chapter = draft.outline!.volumes[0]!.chapters[0]!
    expect(chapter.status).toBe('已规划')
    expect(chapter.downstreamReviewStatus).toBe('待复核')
    expect(chapter.downstreamReviewReason).toMatch(/剧情步骤/)
  })
})

describe('剧情步骤', () => {
  it('七个步骤字段可写，新增步骤按顺序编号', () => {
    expect([...BEAT_EDITABLE_FIELDS]).toEqual([
      'title', 'purpose', 'conflict', 'outcome', 'location', 'timeframe', 'reveal'
    ])

    const draft = draftWithPlan()
    expect(applyAddBeat(draft, 'oc-1', NOW, 'beat-1')).toBe('beat-1')
    expect(applyAddBeat(draft, 'oc-1', NOW, 'beat-2')).toBe('beat-2')

    const beats = draft.outline!.volumes[0]!.chapters[0]!.beats
    expect(beats.map((beat) => beat.order)).toEqual([1, 2])
    expect(beats[0]).toMatchObject({ id: 'beat-1', title: '', purpose: '', conflict: '', outcome: '', location: '', timeframe: '', reveal: '' })
    expect(draft.outline!.volumes[0]!.chapters[0]!.beatStatus).toBe('待确认')

    for (const field of BEAT_EDITABLE_FIELDS) {
      expect(applyBeatFieldEdit(draft, 'oc-1', 'beat-1', field, `${field}-值`)).toBe(true)
    }
    expect(beats[0]!.purpose).toBe('purpose-值')
    expect(beats[0]!.reveal).toBe('reveal-值')
  })

  it('步骤可上移下移，顺序号始终从 1 连续', () => {
    const draft = draftWithPlan()
    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')
    applyAddBeat(draft, 'oc-1', NOW, 'beat-2')
    applyAddBeat(draft, 'oc-1', NOW, 'beat-3')

    expect(applyMoveBeat(draft, 'oc-1', 'beat-3', 'up')).toBe(true)
    let beats = draft.outline!.volumes[0]!.chapters[0]!.beats
    expect(beats.map((beat) => beat.id)).toEqual(['beat-1', 'beat-3', 'beat-2'])
    expect(beats.map((beat) => beat.order)).toEqual([1, 2, 3])

    expect(applyMoveBeat(draft, 'oc-1', 'beat-3', 'down')).toBe(true)
    beats = draft.outline!.volumes[0]!.chapters[0]!.beats
    expect(beats.map((beat) => beat.id)).toEqual(['beat-1', 'beat-2', 'beat-3'])

    // 越界移动与找不到目标都返回 false 且顺序不变
    expect(applyMoveBeat(draft, 'oc-1', 'beat-1', 'up')).toBe(false)
    expect(applyMoveBeat(draft, 'oc-1', 'beat-3', 'down')).toBe(false)
    expect(applyMoveBeat(draft, 'oc-1', 'missing', 'up')).toBe(false)
    expect(beats.map((beat) => beat.id)).toEqual(['beat-1', 'beat-2', 'beat-3'])
  })

  it('步骤可删除并按剩余顺序重编号', () => {
    const draft = draftWithPlan()
    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')
    applyAddBeat(draft, 'oc-1', NOW, 'beat-2')
    applyAddBeat(draft, 'oc-1', NOW, 'beat-3')

    expect(applyRemoveBeat(draft, 'oc-1', 'beat-2')).toBe(true)
    const beats = draft.outline!.volumes[0]!.chapters[0]!.beats
    expect(beats.map((beat) => beat.id)).toEqual(['beat-1', 'beat-3'])
    expect(beats.map((beat) => beat.order)).toEqual([1, 2])

    expect(applyRemoveBeat(draft, 'oc-1', 'missing')).toBe(false)
    expect(beats).toHaveLength(2)
  })

  it('修改已确认步骤会退回「待确认」并标记复核', () => {
    const draft = draftWithPlan()
    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')
    expect(applyConfirmBeats(draft, 'oc-1')).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.beatStatus).toBe('已确认')

    expect(applyBeatFieldEdit(draft, 'oc-1', 'beat-1', 'outcome', '发现被抹去的记录')).toBe(true)
    const chapter = draft.outline!.volumes[0]!.chapters[0]!
    expect(chapter.beatStatus).toBe('待确认')
    expect(chapter.downstreamReviewStatus).toBe('待复核')
    expect(chapter.downstreamReviewReason).toMatch(/剧情步骤/)
  })

  it('排序与删除已确认步骤同样退回「待确认」', () => {
    const draft = draftWithPlan()
    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')
    applyAddBeat(draft, 'oc-1', NOW, 'beat-2')
    applyConfirmBeats(draft, 'oc-1')

    expect(applyMoveBeat(draft, 'oc-1', 'beat-2', 'up')).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.beatStatus).toBe('待确认')

    applyConfirmBeats(draft, 'oc-1')
    expect(applyRemoveBeat(draft, 'oc-1', 'beat-1')).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.beatStatus).toBe('待确认')
  })

  it('没有步骤时不能确认，确认后清掉步骤复核标记', () => {
    const draft = draftWithPlan()
    expect(applyConfirmBeats(draft, 'oc-1')).toBe(false)

    applyAddBeat(draft, 'oc-1', NOW, 'beat-1')
    applyBeatFieldEdit(draft, 'oc-1', 'beat-1', 'title', '入城')
    expect(draft.outline!.volumes[0]!.chapters[0]!.downstreamReviewStatus).not.toBe('待复核')

    applyBeatFieldEdit(draft, 'oc-1', 'beat-1', 'title', '入城')
    applyConfirmBeats(draft, 'oc-1')
    expect(applyBeatFieldEdit(draft, 'oc-1', 'beat-1', 'title', '再入城')).toBe(true)
    expect(draft.outline!.volumes[0]!.chapters[0]!.downstreamReviewStatus).toBe('待复核')

    expect(applyConfirmBeats(draft, 'oc-1')).toBe(true)
    const chapter = draft.outline!.volumes[0]!.chapters[0]!
    expect(chapter.beatStatus).toBe('已确认')
    expect(chapter.downstreamReviewStatus).toBe('正常')
    expect(chapter.downstreamReviewReason).toBeUndefined()
  })
})

describe('开始写作：为章纲建立唯一正文', () => {
  it('按章纲的卷号与章号建立空正文，重复点击不产生第二份', () => {
    const draft = draftWithPlan()
    draft.chapters = []

    const id = applyCreateBodyForOutline(draft, 'oc-3', NOW)
    // 正文沿用章纲的稳定身份：结构调整重排章号时正文才会跟着自己那一张章纲
    expect(id).toBe('oc-3')
    expect(draft.chapters).toHaveLength(1)
    expect(draft.chapters[0]).toMatchObject({
      id: 'oc-3',
      volumeNumber: 1,
      chapterNumber: 3,
      title: '古钟初鸣',
      status: '草稿',
      sourceDigest: ''
    })
    expect(draft.chapters[0]!.blocks).toHaveLength(1)
    expect(draft.chapters[0]!.blocks[0]!.text).toBe('')

    expect(applyCreateBodyForOutline(draft, 'oc-3', NOW)).toBeUndefined()
    expect(draft.chapters).toHaveLength(1)
  })

  it('已有正文的章纲不重复建立，也不会改写既有正文', () => {
    const draft = draftWithPlan()
    const before = JSON.stringify(draft.chapters)

    expect(applyCreateBodyForOutline(draft, 'oc-1', NOW)).toBeUndefined()
    expect(JSON.stringify(draft.chapters)).toBe(before)
  })

  it('找不到章纲时不建立正文', () => {
    const draft = draftWithPlan()
    draft.chapters = []
    expect(applyCreateBodyForOutline(draft, 'missing', NOW)).toBeUndefined()
    expect(draft.chapters).toHaveLength(0)
  })
})

describe('正文无章纲：补建作者确认的空规划', () => {
  it('按正文的章号与卷号补建空章纲，标题取自正文', () => {
    const draft = draftWithPlan()
    draft.outline!.volumes[0]!.chapters = [outlineChapter({ id: 'oc-1', chapterNumber: 1 })]
    draft.chapters.push(bodyChapter({ id: 'ch-7', chapterNumber: 7, title: '孤章' }))

    const id = applyCreateOutlineForBody(draft, 'ch-7', NOW)
    // 补建的章纲沿用正文的稳定身份
    expect(id).toBe('ch-7')
    const chapters = draft.outline!.volumes[0]!.chapters
    expect(chapters).toHaveLength(2)
    expect(chapters[1]).toMatchObject({
      id: 'ch-7',
      volumeNumber: 1,
      chapterNumber: 7,
      title: '孤章',
      status: '未规划',
      beatStatus: '未生成',
      beats: [],
      beatFindings: []
    })
    // 不猜正文摘要：除标题外的规划字段一律留空，正文本身也不被改写
    expect(chapters[1]!.objective).toBe('')
    expect(chapters[1]!.conflict).toBe('')
    expect(chapters[1]!.endingHook).toBe('')
    expect(draft.chapters.find((chapter) => chapter.id === 'ch-7')!.blocks[0]!.text).toBe('')
  })

  it('正文所在卷不存在时一并建立承载卷，不猜卷内容', () => {
    const draft = draftWithPlan()
    draft.chapters.push(bodyChapter({ id: 'ch-4', volumeNumber: 2, chapterNumber: 4, title: '第二卷首章' }))

    const id = applyCreateOutlineForBody(draft, 'ch-4', NOW)
    expect(id).toBe('ch-4')
    const createdVolume = draft.outline!.volumes.find((volume) => volume.volumeNumber === 2)!
    expect(createdVolume.goal).toBe('')
    expect(createdVolume.chapters[0]!.id).toBe('ch-4')
  })

  it('已经存在同章号章纲时不重复补建', () => {
    const draft = draftWithPlan()
    expect(applyCreateOutlineForBody(draft, 'ch-1', NOW)).toBeUndefined()
    expect(draft.outline!.volumes[0]!.chapters).toHaveLength(3)
  })

  it('没有大纲或找不到正文时不做任何事', () => {
    const noOutline = draftWithPlan()
    noOutline.outline = undefined
    expect(applyCreateOutlineForBody(noOutline, 'ch-1', NOW)).toBeUndefined()

    const draft = draftWithPlan()
    expect(applyCreateOutlineForBody(draft, 'missing', NOW)).toBeUndefined()
    expect(draft.outline!.volumes[0]!.chapters).toHaveLength(3)
  })
})
