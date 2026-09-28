import { describe, expect, it } from 'vitest'
import type { ChapterOutline, VolumeOutline } from '../../contracts/src'
import { chapterOutlineDigest, chapterPlanStaleness, establishPlanningDigestBaseline, volumePlanDigest, withPlanningDigests } from './novelPlanning'

describe('小说规划依赖摘要', () => {
  it('只在卷级规划内容变化时标记章纲依据过期', () => {
    const volume = testVolume()
    const chapter = withPlanningDigests(volume, volume.chapters[0]!)
    expect(chapterPlanStaleness({ ...volume, chapters: [chapter] }, chapter).volumeChanged).toBe(false)
    expect(chapterPlanStaleness({ ...volume, goal: '新的本卷目标', chapters: [chapter] }, chapter).volumeChanged).toBe(true)
  })

  it('章纲内容变化会让已有剧情步骤过期，步骤自身变化不会反向污染摘要', () => {
    const volume = testVolume()
    const chapter = withPlanningDigests(volume, volume.chapters[0]!)
    expect(chapterPlanStaleness(volume, chapter).outlineChanged).toBe(false)
    expect(chapterPlanStaleness(volume, { ...chapter, objective: '新的本章目标' }).outlineChanged).toBe(true)
    const changedBeatOnly: ChapterOutline = { ...chapter, beats: [{ ...chapter.beats[0]!, outcome: '修改结果' }] }
    expect(chapterOutlineDigest(changedBeatOnly)).toBe(chapterOutlineDigest(chapter))
  })

  it('旧项目缺少摘要时不产生虚假过期，列表顺序不影响摘要', () => {
    const volume = testVolume(), chapter = volume.chapters[0]!
    expect(chapterPlanStaleness(volume, chapter)).toEqual({ volumeChanged: false, outlineChanged: false })
    expect(chapterOutlineDigest({ ...chapter, characterIds: ['乙', '甲'] })).toBe(chapterOutlineDigest({ ...chapter, characterIds: ['甲', '乙'] }))
    expect(volumePlanDigest(volume)).toHaveLength(64)
  })

  it('旧项目只建立一次当前基线，不覆盖已经保存的依赖摘要', () => {
    const volume = testVolume()
    const project = { outline: { status: '草稿', synopsis: '', themes: [], mainConflict: '', endingDirection: '', volumes: [volume], updatedAt: new Date().toISOString() } } as unknown as import('../../contracts/src').NovelProject
    establishPlanningDigestBaseline(project)
    const chapter = volume.chapters[0]!
    const baseline = chapter.sourceVolumeDigest
    volume.goal = '后来修改的卷目标'
    establishPlanningDigestBaseline(project)
    expect(chapter.sourceVolumeDigest).toBe(baseline)
    expect(chapterPlanStaleness(volume, chapter).volumeChanged).toBe(true)
  })
})

function testVolume(): VolumeOutline {
  const chapter: ChapterOutline = {
    id: 'chapter-1', volumeNumber: 1, chapterNumber: 1, title: '旧城来信', pov: '沈砚', objective: '查明来信来源', conflict: '档案被封存', turningPoint: '来信出自未来', reveal: '钟楼保存时间回声', endingHook: '第二封信出现',
    characterIds: ['甲', '乙'], setupThreadIds: ['伏笔一'], payoffThreadIds: [], status: '已规划', beatStatus: '已确认', beatFindings: [],
    beats: [{ id: 'beat-1', order: 1, title: '查档案', purpose: '寻找来信', conflict: '权限不足', outcome: '发现缺页', location: '档案馆', timeframe: '清晨', characterIds: ['甲'], reveal: '', threadActions: [] }]
  }
  return { id: 'volume-1', volumeNumber: 1, title: '失名之城', goal: '确认失名事件', climax: '钟楼失控', resolution: '主角保存证据', chapters: [chapter] }
}
