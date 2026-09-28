import { describe, expect, it } from 'vitest'
import { auditChapterLocally, applySceneQualityRecommendation, isSceneQualityFindingStale } from './sceneQuality'
import { makeNovel } from './novelTestFactory'

describe('章节场景质量门禁', () => {
  it('识别空正文、技术泄漏与锁定术语冲突', () => {
    const project = makeNovel(1)
    project.worldConstraints = [{ id: 'c1', term: '异骨', definition: '生灵先天可能具有的异常骨质结构', notDefinition: '自然矿产或可开采资源', entityType: '生灵特征', allowedUsages: [], forbiddenUsages: [{ phrase: '异骨资源枯竭', reason: '异骨不是自然资源。', suggestedReplacement: '具异骨的生灵逐渐减少' }], unresolvedQuestions: [], facts: [], source: { fieldPath: '/seed', excerpt: '异骨' }, status: '已锁定', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    const chapter = { ...project.chapters[0]!, blocks: [{ id: 'b1', text: 'JSON Schema 异骨资源枯竭。' }] }
    const findings = auditChapterLocally(chapter, project.outline!.volumes[0]!.chapters[0]!, project)
    expect(findings.some((item) => item.category === '文本异常')).toBe(true)
    expect(findings.some((item) => item.category === '术语冲突' && item.severity === '高')).toBe(true)
  })

  it('发现未来事实泄漏，并在候选摘要变化后失效', () => {
    const project = makeNovel(1)
    project.memories = [{ id: 'm1', chapterId: 'future', chapterNumber: 10, status: '正式', sourceDigest: 'x', summary: '', keyEvents: [], characterStates: [], facts: [{ id: 'f1', category: '秘密', content: '皇城将在冬至封锁城门', certainty: '正式', locked: true, source: { chapterId: 'future', excerpt: '皇城将在冬至封锁城门' }, appliesFromChapter: 10 }], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString() }]
    const chapter = { ...project.chapters[0]!, blocks: [{ id: 'b1', text: '皇城将在冬至封锁城门。' }] }
    const outline = project.outline!.volumes[0]!.chapters[0]!
    const finding = auditChapterLocally(chapter, outline, project).find((item) => item.category === '知识越界')!
    expect(finding).toBeTruthy()
    expect(isSceneQualityFindingStale(finding, { ...chapter, blocks: [{ ...chapter.blocks[0]!, text: '已经修改。' }] })).toBe(true)
  })

  it('局部修复只替换目标段落，并更新摘要', () => {
    const project = makeNovel(1), chapter = { ...project.chapters[0]!, blocks: [{ id: 'b1', text: '林砚看见旧钟。' }] }
    const finding = auditChapterLocally({ ...chapter, blocks: [{ id: 'b1', text: '林砚看见旧钟。。' }] }, project.outline!.volumes[0]!.chapters[0]!, project).find((item) => item.category === '文本异常')!
    const fixed = applySceneQualityRecommendation({ ...chapter, blocks: [{ id: 'b1', text: '林砚看见旧钟。。' }] }, finding, '。')
    expect(fixed.blocks[0]!.text).toBe('林砚看见旧钟。')
    expect(fixed.sourceDigest).not.toBe(chapter.sourceDigest)
  })
})
