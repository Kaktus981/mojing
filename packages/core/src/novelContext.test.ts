import { afterEach, describe, expect, it } from 'vitest'
import { NovelDatabaseService } from './novelDatabase'
import { buildNovelContext } from './novelContext'
import { chapterDigest } from './novelMemory'
import { makeNovel } from './novelTestFactory'

describe('200章长篇上下文', () => {
  const databases: NovelDatabaseService[] = []
  afterEach(() => databases.splice(0).forEach((database) => database.close()))

  it('在预算内召回第一章事实和伏笔，不发送全部正文', () => {
    const project = makeNovel(200)
    project.memories.push({ id: 'm1', chapterId: project.chapters[0]!.id, chapterNumber: 1, status: '正式', sourceDigest: chapterDigest(project.chapters[0]!), summary: '林砚发现星纹古钟并隐瞒。', keyEvents: ['古钟第一次鸣响'], characterStates: [], facts: [{ id: 'fact-clock', category: '秘密', content: '只有林砚知道古钟会夺走一段记忆', certainty: '正式', locked: true, source: { chapterId: project.chapters[0]!.id, excerpt: '古钟夺走了他的童年片段' } }], objectStates: ['古钟仍在旧城'], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString() })
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, project.chapters[199]!.id, 6_000)
    expect(context.estimatedInputTokens).toBeLessThanOrEqual(6_000)
    expect(context.json).toContain('古钟')
    expect(context.json).toContain('第一章')
    expect(context.entries.some((item) => item.id === 'threads' && item.included)).toBe(true)
    expect(context.json.length).toBeLessThan(project.chapters.map((chapter) => chapter.blocks[0]!.text).join('').length * 5)
  })

  it('生成较早章节时不读取未来状态、事实或全文检索结果', () => {
    const project = makeNovel(12)
    const earlier = project.chapters[1]!
    const future = project.chapters[9]!
    future.blocks[0]!.text = '未来泄露：林砚将在王都加冕。'
    project.memories.push({
      id: 'future-memory', chapterId: future.id, chapterNumber: 10, status: '正式', sourceDigest: chapterDigest(future), summary: '未来泄露：林砚已经加冕。', keyEvents: [],
      characterStates: [{ id: 'future-state', characterId: 'char-1', characterName: '林砚', location: '王都', ability: '王权', physicalState: '健康', emotion: '平静', goal: '统治群国', knowledge: [], relationships: [], appliesFromChapter: 10, source: { chapterId: future.id, excerpt: '林砚在王都加冕' } }],
      facts: [{ id: 'future-fact', category: '事件', content: '未来泄露：林砚成为国王', certainty: '正式', locked: false, appliesFromChapter: 10, source: { chapterId: future.id, excerpt: '林砚成为国王' } }],
      objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString()
    })
    earlier.title = '林砚王都'
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, earlier.id, 20_000)
    expect(context.json).not.toContain('未来泄露')
    expect(context.json).not.toContain('统治群国')
  })

  it('上下文只保留当前章已生效的最新角色状态', () => {
    const project = makeNovel(8)
    const chapter2 = project.chapters[1]!, chapter6 = project.chapters[5]!
    project.memories.push({ id: 'm2', chapterId: chapter2.id, chapterNumber: 2, status: '正式', sourceDigest: chapterDigest(chapter2), summary: '', keyEvents: [], characterStates: [{ id: 'state-old', characterId: 'char-1', characterName: '林砚', location: '旧城', ability: '无', physicalState: '轻伤', emotion: '警惕', goal: '调查', knowledge: [], relationships: [], appliesFromChapter: 2, appliesThroughChapter: 5, source: { chapterId: chapter2.id, excerpt: '留在旧城' } }], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString() })
    project.memories.push({ id: 'm6', chapterId: chapter6.id, chapterNumber: 6, status: '正式', sourceDigest: chapterDigest(chapter6), summary: '', keyEvents: [], characterStates: [{ id: 'state-new', characterId: 'char-1', characterName: '林砚', location: '王都', ability: '星辉', physicalState: '痊愈', emotion: '坚定', goal: '追查议会', knowledge: [], relationships: [], appliesFromChapter: 6, replacesId: 'state-old', source: { chapterId: chapter6.id, excerpt: '抵达王都' } }], facts: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString() })
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const before = buildNovelContext(database, project, project.chapters[4]!.id, 20_000)
    const after = buildNovelContext(database, project, project.chapters[6]!.id, 20_000)
    expect(before.json).toContain('旧城')
    expect(before.json).not.toContain('追查议会')
    expect(after.json).toContain('追查议会')
    expect(after.json).not.toContain('留在旧城')
  })

  it('过去章节记录的延迟生效事实不会经全文检索提前泄露', () => {
    const project = makeNovel(12)
    const source = project.chapters[1]!, target = project.chapters[4]!
    target.title = '王冠线索'
    project.memories.push({ id: 'delayed', chapterId: source.id, chapterNumber: 2, status: '正式', sourceDigest: chapterDigest(source), summary: '第二章记录了一项延后生效的安排。', keyEvents: [], characterStates: [], facts: [{ id: 'delayed-fact', category: '秘密', content: '王冠线索：第十章才确认林砚拥有王位继承权', certainty: '正式', locked: false, appliesFromChapter: 10, source: { chapterId: source.id, excerpt: '作者预留的未来事实' } }], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: new Date().toISOString() })
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, target.id, 20_000)
    expect(context.json).not.toContain('王位继承权')
  })

  it('把修辞强度作为最高优先级创作规格显示在生成前预览中', () => {
    const project = makeNovel(1)
    project.settings.rhetoricIntensity = 0
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, project.chapters[0]!.id, 20_000)
    expect(context.entries.find((item) => item.id === 'settings')).toMatchObject({
      category: '创作规格', authority: '最高', included: true
    })
    expect(context.json).toContain('极少')
    expect(context.json).toContain('普通信息直接叙述')
    expect(context.json).not.toContain('rhetoricIntensity')
    expect(context.json).not.toContain('rhetoricGuidance')
  })

  it('把已采用的完整故事方向作为中文最高优先级上下文，并保留字段确认状态', () => {
    const project = makeNovel(1)
    const now = new Date().toISOString()
    project.directionCards = [{
      id: 'full-direction', version: 2, title: '秘密与代价',
      premise: '兼容的一句话故事', protagonistHook: '兼容的主角信息', coreConflict: '兼容的主要冲突', emotionalPromise: '兼容的阅读体验',
      genreDirection: '玄幻悬疑', logline: '失忆调查者必须在身份被替换前找回真相。', protagonistIdentity: '旧城调查者',
      protagonistSituation: '遭到两个势力共同监视', protagonistGoal: '找回被删除的身份记录', mainObstacle: '证据掌握在互不信任的知情者手中',
      specialPremise: '记忆会改变可见的道路', cost: '每次恢复记忆都会失去一段关系', failureConsequence: '主角将被永久替换',
      centralMystery: '谁第一次删除了主角的名字', readingExperience: '证据重组与认知反转', openingSituation: '主角发现自己的通行证属于另一个人',
      unresolvedQuestions: ['幕后者是否认识主角的家人？'], fieldStatuses: { genreDirection: '作者已确定', failureConsequence: '暂时采用', centralMystery: '尚未确定' },
      status: '已采用', createdAt: now, updatedAt: now
    }]
    project.activeDirectionCardId = 'full-direction'
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, project.chapters[0]!.id, 20_000)
    expect(context.entries.find((item) => item.id === 'story-direction')).toMatchObject({ category: '故事方向', authority: '最高', included: true })
    const direction = (JSON.parse(context.json) as Array<{ title: string; content: Record<string, unknown> }>).find((item) => item.content?.方向名称 === '秘密与代价')?.content
    expect(direction).toMatchObject({ 题材方向: '玄幻悬疑', 主角目标: '找回被删除的身份记录', 失败后果: '主角将被永久替换', 最大悬念: '谁第一次删除了主角的名字', 尚未确定事项: ['幕后者是否认识主角的家人？'] })
    expect(direction?.内容确认状态).toMatchObject({ 题材方向: '作者已确定', 失败后果: '暂时采用', 最大悬念: '尚未确定' })
    expect(JSON.stringify(direction)).not.toContain('genreDirection')
    expect(JSON.stringify(direction)).not.toContain('fieldStatuses')
  })

  it('旧精简故事方向卡仍能向生成上下文提供关键字段', () => {
    const project = makeNovel(1)
    const now = new Date().toISOString()
    project.directionCards = [{ id: 'legacy-direction', version: 1, title: '旧版方向', premise: '守钟人寻找失踪的钟声。', protagonistHook: '年轻守钟人，正在被误解', coreConflict: '城中各方都想夺走古钟', emotionalPromise: '克制的成长与悬念', openingSituation: '古钟第一次沉默', unresolvedQuestions: [], status: '已采用', createdAt: now, updatedAt: now }]
    project.activeDirectionCardId = 'legacy-direction'
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const context = buildNovelContext(database, project, project.chapters[0]!.id, 20_000)
    const direction = (JSON.parse(context.json) as Array<{ title: string; content: Record<string, unknown> }>).find((item) => item.content?.方向名称 === '旧版方向')?.content
    expect(direction).toMatchObject({ 一句话故事: '守钟人寻找失踪的钟声。', 主角身份: '年轻守钟人，正在被误解', 主要阻力: '城中各方都想夺走古钟', 阅读体验: '克制的成长与悬念', 开篇起点: '古钟第一次沉默' })
    expect(direction?.内容确认状态).toMatchObject({ 一句话故事: '暂时采用', 题材方向: '尚未确定' })
  })

  it('抽象文风画像只进入正文类上下文，不污染世界观和记忆任务', () => {
    const project = makeNovel(1)
    project.settings.activeStyleProfileId = 'style-safe'
    project.settings.styleProfileSnapshot = {
      profileId: 'style-safe', name: '测试画像', description: '动作直接、对白自然。',
      traits: { sentenceRhythm: '短句推进', narrativeDistance: '贴近人物', dialogueStyle: '自然对白', descriptionStyle: '具体细节', pacing: '稳定', diction: '清晰', paragraphPattern: '短段', rhetoric: '克制' },
      guidelines: ['先写动作'], avoidPatterns: ['堆叠形容词'], sourceKind: '用户创建', capturedAt: new Date().toISOString()
    }
    const database = new NovelDatabaseService(':memory:'); databases.push(database); database.createProject(project)
    const nonWriting = buildNovelContext(database, project, project.chapters[0]!.id, 20_000)
    const writing = buildNovelContext(database, project, project.chapters[0]!.id, 20_000, true)
    expect(nonWriting.entries.some((entry) => entry.id === 'style-profile')).toBe(false)
    expect(nonWriting.json).not.toContain('动作直接、对白自然')
    expect(writing.entries.find((entry) => entry.id === 'style-profile')).toMatchObject({ category: '文风范本', authority: '最高', included: true })
    expect(writing.json).toContain('动作直接、对白自然')
    expect(writing.json).not.toContain('styleProfileId')
  })
})
