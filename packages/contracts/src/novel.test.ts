import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, RhetoricIntensitySchema, StoryDirectionCardSchema, WorldConstraintSchema, WorldEntrySchema, WorldQualityFindingSchema, emptyWorldDetails, rhetoricGuidance, type GenreTemplate } from './novel'
import { ApplyNovelRevisionSchema, NovelGenerationRequestSchema } from './novelApi'
import { NovelProjectSummarySchema } from './novel'

describe('墨境小说领域契约', () => {
  it('列表简介兼容旧响应，并保留新响应的真实简介', () => {
    const summary = { id: 'novel', title: '小说', status: '待规划', genreTemplate: '通用', chapterCount: 0, wordCount: 0, pendingMemoryCount: 0, updatedAt: new Date().toISOString() }
    expect(NovelProjectSummarySchema.parse(summary).description).toBeUndefined()
    expect(NovelProjectSummarySchema.parse({ ...summary, description: '巡夜人寻找失踪的城门。' }).description).toBe('巡夜人寻找失踪的城门。')
  })
  it.each(['通用', '玄幻修仙', '科幻', '历史架空', '都市', '悬疑'] satisfies GenreTemplate[])('支持%s题材模板', (genreTemplate) => {
    const result = NovelProjectSchema.safeParse(project({ genreTemplate }))
    expect(result.success).toBe(true)
  })

  it('修行体系、国家和货币拥有独立结构，而不是版权作品设定', () => {
    const types = ['修行体系', '国家', '货币'] as const
    for (const type of types) {
      const result = WorldEntrySchema.safeParse({ id: type, type, name: `原创${type}`, aliases: [], tags: [], summary: '', notes: '', locked: false, aiVisibility: '按需召回', relations: [], customFields: {}, details: emptyWorldDetails(type) })
      expect(result.success).toBe(true)
      expect(JSON.stringify(result.success && result.data)).not.toMatch(/诡秘|序列9|韩立|筑基/)
    }
  })

  it('拒绝重复章节编号', () => {
    const value = project({ genreTemplate: '通用' })
    value.chapters = [chapter('a', 1), chapter('b', 1)]
    const result = NovelProjectSchema.safeParse(value)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('第 1 章重复')
  })

  it('旧小说项目无损升级并采用克制修辞默认值', () => {
    const parsed = NovelProjectSchema.parse(project({ genreTemplate: '玄幻修仙' }))
    expect(parsed.schemaVersion).toBe(7)
    expect(parsed.settings.rhetoricIntensity).toBe(1)
    expect(parsed.worldConstraints).toEqual([])
    expect(parsed.worldQualityFindings).toEqual([])
  })

  it('修辞强度只接受五个整数档位，并提供稳定的中文指导', () => {
    for (const level of [0, 1, 2, 3, 4]) {
      expect(RhetoricIntensitySchema.parse(level)).toBe(level)
      expect(rhetoricGuidance(level)).toMatchObject({ level })
      expect(rhetoricGuidance(level).label).toBeTruthy()
      expect(rhetoricGuidance(level).instruction).toBeTruthy()
    }
    for (const invalid of [-1, 5, 1.5]) expect(RhetoricIntensitySchema.safeParse(invalid).success).toBe(false)
    expect(RhetoricIntensitySchema.parse(undefined)).toBe(1)
  })

  it('结构化术语约束和世界观问题可被契约校验', () => {
    const constraint = {
      id: 'constraint-yigu', term: '异骨', definition: '生灵可能生来自带的异常骨质结构。', notDefinition: '自然资源', entityType: '先天身体结构',
      allowedUsages: ['生灵具有异骨'], forbiddenUsages: [{ phrase: '旧骨资源枯竭', reason: '异骨不是自然资源。', suggestedReplacement: '可合法流通的遗骨日益稀缺。' }],
      facts: [{ subject: '生灵', relation: '可能先天具有', object: '异骨', polarity: '允许' }], source: { fieldPath: '/seed', excerpt: '世间生灵，体生异骨。' },
      status: '已锁定', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    expect(WorldConstraintSchema.safeParse(constraint).success).toBe(true)
    expect(WorldQualityFindingSchema.safeParse({
      id: 'finding-1', type: '设定冲突', severity: '高', confidence: 1,
      evidence: { fieldPath: '/historySummary', excerpt: '旧骨资源枯竭' }, constraintIds: [constraint.id], explanation: '异骨不是自然资源。',
      suggestedReplacement: '可合法流通的遗骨日益稀缺。', baseFieldDigest: 'digest', status: '待处理', source: '本地规则', createdAt: new Date().toISOString()
    }).success).toBe(true)
  })

  it('支持术语提取和世界观审校任务，并要求强制应用显式声明', () => {
    for (const kind of ['world-constraint-extraction', 'world-audit', 'world-repair-suggestion'] as const) {
      expect(NovelGenerationRequestSchema.safeParse({ kind, baseRevision: 0 }).success).toBe(true)
    }
    expect(ApplyNovelRevisionSchema.parse({ currentRevision: 0 })).toMatchObject({ allowQualityConflict: false })
    expect(ApplyNovelRevisionSchema.parse({ currentRevision: 0, allowQualityConflict: true })).toMatchObject({ allowQualityConflict: true })
  })

  it('故事方向卡支持多版本、编辑和采用状态', () => {
    const now = new Date().toISOString()
    const card = StoryDirectionCardSchema.parse({ id: 'direction-1', version: 1, title: '目标驱动', premise: '一个原创前提', protagonistHook: '主角被迫选择', coreConflict: '目标与阻力冲突', emotionalPromise: '人物持续成长', openingSituation: '从一次选择开始', createdAt: now, updatedAt: now })
    expect(card.status).toBe('候选')
    expect(card.unresolvedQuestions).toEqual([])
    expect(card.genreDirection).toBeUndefined()
    expect(NovelProjectSchema.parse({ ...project({ genreTemplate: '通用' }), directionCards: [card], activeDirectionCardId: card.id, creationMode: '引导创作' }).activeDirectionCardId).toBe(card.id)
    expect(NovelGenerationRequestSchema.safeParse({ kind: 'story-direction', baseRevision: 0 }).success).toBe(true)
  })

  it('重新提问的答案可以保存，旧项目缺少答案字段仍可读取', () => {
    const legacy = NovelProjectSchema.parse({ ...project({ genreTemplate: '通用' }), directionQuestions: ['故事必须保留什么？'] })
    expect(legacy.directionQuestionAnswers).toBeUndefined()
    const answered = NovelProjectSchema.parse({ ...legacy, directionQuestionAnswers: ['必须保留会改变记忆的潮声。'] })
    expect(answered.directionQuestionAnswers).toEqual(['必须保留会改变记忆的潮声。'])
  })

  it('完整故事方向卡记录题材、人物、代价、悬念和逐项确认状态', () => {
    const now = new Date().toISOString()
    const card = StoryDirectionCardSchema.parse({ id: 'direction-full', version: 2, title: '秘密牵引', premise: '兼容前提', protagonistHook: '兼容钩子', coreConflict: '兼容冲突', emotionalPromise: '兼容承诺', openingSituation: '异常细节出现', genreDirection: '玄幻悬疑', logline: '调查者追查会改变身份的秘密。', protagonistIdentity: '旧城调查者', protagonistSituation: '没有证据且受到监视', protagonistGoal: '找出秘密来源', mainObstacle: '证据被不同势力分割', specialPremise: '角色只能看见部分真相', cost: '每次调查都会损失一段信任', failureConsequence: '幕后者将完成身份替换', centralMystery: '主角为何被选中', readingExperience: '证据重组与认知反转', unresolvedQuestions: ['最终身份是否改变？'], fieldStatuses: { genreDirection: '作者已确定', centralMystery: '暂时采用', failureConsequence: '尚未确定' }, createdAt: now, updatedAt: now })
    expect(card).toMatchObject({ genreDirection: '玄幻悬疑', protagonistGoal: '找出秘密来源', cost: '每次调查都会损失一段信任', centralMystery: '主角为何被选中' })
    expect(card.fieldStatuses).toMatchObject({ genreDirection: '作者已确定', failureConsequence: '尚未确定' })
  })

  it('旧章纲会根据已有节拍推导确认状态', () => {
    const withBeat = { id: 'c1', volumeNumber: 1, chapterNumber: 1, title: '开端', pov: '', objective: '', conflict: '', turningPoint: '', reveal: '', endingHook: '', characterIds: [], setupThreadIds: [], payoffThreadIds: [], beats: [{ id: 'b1', order: 1, title: '相遇', purpose: '', conflict: '', outcome: '' }], status: '已规划' }
    const empty = { ...withBeat, id: 'c2', chapterNumber: 2, beats: [] }
    const parsed = NovelProjectSchema.parse({ ...project({ genreTemplate: '通用' }), outline: { status: '草稿', synopsis: '', themes: [], mainConflict: '', endingDirection: '', volumes: [{ id: 'v1', volumeNumber: 1, title: '', goal: '', climax: '', resolution: '', chapters: [withBeat, empty] }], updatedAt: new Date().toISOString() } })
    expect(parsed.outline?.volumes[0]?.chapters.map((chapter) => chapter.beatStatus)).toEqual(['已确认', '未生成'])
    expect(parsed.outline?.volumes[0]?.chapters[0]?.beats[0]).toMatchObject({ location: '', characterIds: [], threadActions: [] })
  })

  it('分层大纲与场景节拍任务校验必要参数', () => {
    expect(NovelGenerationRequestSchema.safeParse({ kind: 'outline-foundation', baseRevision: 0 }).success).toBe(true)
    expect(NovelGenerationRequestSchema.safeParse({ kind: 'outline-volume', baseRevision: 0 }).success).toBe(false)
    expect(NovelGenerationRequestSchema.safeParse({ kind: 'outline-volume', volumeNumber: 1, baseRevision: 0 }).success).toBe(true)
    expect(NovelGenerationRequestSchema.safeParse({ kind: 'scene-beats', chapterId: 'chapter-1', baseRevision: 0 }).success).toBe(true)
  })

  it('质量问题可以保存 AI 修改思路和需要作者选择的备选方案', () => {
    const parsed = WorldQualityFindingSchema.parse({
      id: 'finding-advice', type: '无依据事实', severity: '中', confidence: 1,
      evidence: { fieldPath: '/historySummary', excerpt: '黑市回收死者异骨' }, constraintIds: [], explanation: '死后能否取用尚未确定。',
      baseFieldDigest: 'digest', status: '待处理', source: 'AI 语义审校', createdAt: new Date().toISOString(),
      suggestionType: '需要作者决定', aiSuggestionReason: '这句话涉及尚未确定的遗骨利用规则。', alternativeSuggestions: ['删除该句', '明确死后可以取用', '明确禁止取用']
    })
    expect(parsed.alternativeSuggestions).toHaveLength(3)
    expect(parsed.suggestedReplacement).toBeUndefined()
  })
})

function project(settings: { genreTemplate: GenreTemplate }): any {
  const now = new Date().toISOString()
  return { schemaVersion: 2, id: 'novel', title: '原创小说', seed: '一个原创故事', settings: { ...settings, targetWords: 300000, plannedVolumes: 3, plannedChapters: 120, pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文' }, status: '待规划', revision: 0, chapters: [], memories: [], plotThreads: [], branches: [], reviews: [], createdAt: now, updatedAt: now }
}
function chapter(id: string, chapterNumber: number): any { return { id, volumeNumber: 1, chapterNumber, title: '', blocks: [], status: '草稿', sourceDigest: '', updatedAt: new Date().toISOString() } }
