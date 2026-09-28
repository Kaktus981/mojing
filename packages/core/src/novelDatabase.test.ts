import { describe, expect, it } from 'vitest'
import { unlinkSync } from 'node:fs'
import Database from 'better-sqlite3'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import { buildNovelOrchestrationPlan } from './novelOrchestrator'
import { establishPlanningDigestBaseline } from './novelPlanning'

describe('小说数据库索引与记忆健康', () => {
  it('列表简介优先使用大纲，空白回退故事种子，不改写原文', () => {
    const database = new NovelDatabaseService(':memory:')
    try {
      const project = makeNovel(1)
      project.seed = '  巡夜人\n发现城门少了一块砖。  '
      project.outline!.synopsis = '  城门失踪\n 真相浮现  '
      database.createProject(project)
      expect(database.listProjects()[0]?.description).toBe('城门失踪 真相浮现')
      expect(database.getProject(project.id).outline!.synopsis).toBe(project.outline!.synopsis)
      project.outline!.synopsis = '  '
      const saved = database.saveProject(project, project.revision)
      expect(database.listProjects()[0]?.description).toBe('巡夜人 发现城门少了一块砖。')
      saved.seed = ' '
      database.saveProject(saved, saved.revision)
      expect(database.listProjects()[0]?.description).toBeUndefined()
    } finally { database.close() }
  })

  it('列表长简介限制为 160 个字符，不截断 Unicode 字符', () => {
    const database = new NovelDatabaseService(':memory:')
    try {
      const project = makeNovel(1)
      project.outline!.synopsis = '山🌙'.repeat(100)
      database.createProject(project)
      expect(Array.from(database.listProjects()[0]?.description ?? '')).toHaveLength(160)
    } finally { database.close() }
  })
  it('提供合并默认值的创作席位、能力，并持久化项目配置', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    database.createProject(project)
    expect(database.listCreativeSeats(project.id).length).toBeGreaterThanOrEqual(6)
    expect(database.listCreativeCapabilities(project.id).length).toBeGreaterThanOrEqual(9)
    const seat = database.listCreativeSeats(project.id)[0]!
    const saved = database.saveCreativeSeatConfiguration({ projectId: project.id, seatId: seat.id, enabled: false, providerId: null, capabilityIds: seat.capabilityIds })
    expect(saved.enabled).toBe(false)
    expect(database.getCreativeSeat(project.id, seat.id)?.enabled).toBe(false)
    database.saveCreativeCapabilityConfiguration({ projectId: project.id, capabilityId: seat.capabilityIds[0]!, enabled: false })
    expect(database.listCreativeCapabilities(project.id).find((item) => item.id === seat.capabilityIds[0])?.enabled).toBe(false)
    const custom = database.createCustomCreativeCapability(project.id, { name: '自定义检查', description: '只提供说明性建议。', taskScopes: ['中文审校'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [] })
    expect(custom.source).toBe('用户配置')
    expect(database.listCreativeCapabilities(project.id).some((item) => item.id === custom.id)).toBe(true)
    expect(() => database.updateCustomCreativeCapability(project.id, custom.id, { script: 'nope' } as never)).toThrow()
    database.removeCustomCreativeCapability(project.id, custom.id)
    expect(database.listCreativeCapabilities(project.id).some((item) => item.id === custom.id)).toBe(false)
    database.close()
  })

  it('技能版本按内容幂等追加、回滚重复调用不新增 revision，并保持快照不可变', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    database.createProject(project)
    const first = database.createCustomCreativeCapability(project.id, {
      name: '版本检查', description: '记录正文版本。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保持叙事克制。'
    })

    expect(database.listCreativeSkillVersions(project.id, first.id)).toHaveLength(1)
    const firstVersion = database.listCreativeSkillVersions(project.id, first.id)[0]!
    expect(firstVersion.active).toBe(true)
    expect(firstVersion.skillVersion).toBe('1.0')

    database.updateCustomCreativeCapability(project.id, first.id, { enabled: false })
    expect(database.listCreativeSkillVersions(project.id, first.id)).toHaveLength(1)
    expect(database.listCreativeSkillVersions(project.id, first.id)[0]!.capability.enabled).toBe(true)

    database.updateCustomCreativeCapability(project.id, first.id, { skillText: '保持叙事克制，减少解释。' })
    const secondHistory = database.listCreativeSkillVersions(project.id, first.id)
    expect(secondHistory).toHaveLength(2)
    expect(secondHistory[0]!.active).toBe(false)
    expect(secondHistory[1]!.active).toBe(true)

    database.rollbackCreativeSkill(project.id, first.id, firstVersion.id)
    const afterRollback = database.listCreativeSkillVersions(project.id, first.id)
    expect(afterRollback).toHaveLength(3)
    expect(afterRollback[2]!.capability.skillText).toBe('保持叙事克制。')
    expect(afterRollback[2]!.skillVersion).toBe('1.0')
    expect(afterRollback[2]!.active).toBe(true)
    expect(afterRollback[0]!.capability.skillText).toBe('保持叙事克制。')
    expect(afterRollback[0]!.active).toBe(false)
    afterRollback[0]!.capability.skillText = '调用方篡改不应落库。'
    expect(database.listCreativeSkillVersions(project.id, first.id)[0]!.capability.skillText).toBe('保持叙事克制。')

    const beforeRepeatRollback = database.listCreativeCapabilities(project.id).find((item) => item.id === first.id)!
    database.rollbackCreativeSkill(project.id, first.id, firstVersion.id)
    expect(database.listCreativeSkillVersions(project.id, first.id)).toHaveLength(3)
    expect(database.listCreativeCapabilities(project.id).find((item) => item.id === first.id)?.updatedAt).toBe(beforeRepeatRollback.updatedAt)
    database.close()
  })

  it('技能能力写入和版本快照在同一事务中提交或回滚', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    database.createProject(project)
    const first = database.createCustomCreativeCapability(project.id, {
      name: '事务检查', description: '验证版本写入事务。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保持原始版本。', skillVersion: '1.0'
    })
    database.setFailureInjectorForTest((stage) => {
      if (stage === '已写入技能快照') throw new Error('模拟技能快照提交失败')
    })

    expect(() => database.updateCustomCreativeCapability(project.id, first.id, { skillText: '不应留下半写版本。' })).toThrow('模拟技能快照提交失败')
    database.setFailureInjectorForTest()
    expect(database.listCreativeCapabilities(project.id).find((item) => item.id === first.id)?.skillText).toBe('保持原始版本。')
    expect(database.listCreativeSkillVersions(project.id, first.id)).toHaveLength(1)
    database.close()
  })

  it('创建和回滚技能在快照失败时都回滚能力写入', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    database.createProject(project)
    database.setFailureInjectorForTest((stage) => {
      if (stage === '已写入技能快照') throw new Error('模拟技能快照提交失败')
    })
    expect(() => database.createCustomCreativeCapability(project.id, {
      name: '创建事务', description: '创建失败不能留下能力。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '不应落库。'
    })).toThrow('模拟技能快照提交失败')
    database.setFailureInjectorForTest()
    expect(database.listCreativeCapabilities(project.id).some((item) => item.name === '创建事务')).toBe(false)

    const first = database.createCustomCreativeCapability(project.id, {
      name: '回滚事务', description: '回滚失败不能半写。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '第一版。'
    })
    database.updateCustomCreativeCapability(project.id, first.id, { skillText: '第二版。' })
    const before = database.listCreativeSkillVersions(project.id, first.id)
    database.setFailureInjectorForTest((stage) => {
      if (stage === '已写入技能快照') throw new Error('模拟技能快照提交失败')
    })
    expect(() => database.rollbackCreativeSkill(project.id, first.id, before[0]!.id)).toThrow('模拟技能快照提交失败')
    database.setFailureInjectorForTest()
    expect(database.listCreativeCapabilities(project.id).find((item) => item.id === first.id)?.skillText).toBe('第二版。')
    expect(database.listCreativeSkillVersions(project.id, first.id)).toHaveLength(2)
    database.close()
  })

  it('删除自定义技能时级联清理全部版本历史', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    database.createProject(project)
    const skill = database.createCustomCreativeCapability(project.id, {
      name: '历史清理', description: '删除时不残留历史。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保留历史。'
    })
    database.updateCustomCreativeCapability(project.id, skill.id, { skillText: '生成第二历史。' })
    expect(database.listCreativeSkillVersions(project.id, skill.id)).toHaveLength(2)
    database.removeCustomCreativeCapability(project.id, skill.id)
    expect(database.listCreativeSkillVersions(project.id, skill.id)).toEqual([])
    database.close()
  })

  it('持久化创作运行、依赖工序和失败恢复状态', () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    database.createProject(project)
    const plan = buildNovelOrchestrationPlan(project, { intent: '长篇复核', maxParallel: 2 })
    const run = database.createCreativeOrchestrationRun({ ...plan, updatedAt: plan.createdAt, status: '等待执行', request: { intent: '长篇复核', maxParallel: 2 }, steps: plan.steps.map((step, index) => ({ id: step.id, runId: plan.id, order: index, seatId: 'seat-continuity-keeper', title: step.title, kind: step.kind, targetId: step.targetId, dependsOn: step.dependsOn, status: step.status === '已满足' ? '跳过' : step.status === '需要作者确认' ? '待作者确认' : step.status, reason: step.reason, evidence: step.evidence, estimatedTokens: step.estimatedTokens, memoryProposalIds: [], attempt: 0, createdAt: plan.createdAt, updatedAt: plan.createdAt })) })
    expect(database.getCreativeOrchestrationRun(run.id)?.steps).toHaveLength(plan.steps.length)
    const first = run.steps[0]!
    const updated = database.updateCreativeOrchestrationStep(run.id, first.id, { status: '失败', attempt: 1, error: { code: 'TEST', message: '可恢复', retryable: true } })
    expect(updated.status).toBe('失败')
    expect(database.updateCreativeOrchestrationRun(run.id, { status: '暂停' }).status).toBe('暂停')
    database.close()
  })

  it('保存项目后建立实体出现记录，并可查询记忆健康状态', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(2)
    establishPlanningDigestBaseline(project)
    project.outline!.volumes[0]!.goal = '改变后的卷目标'
    database.createProject(project)
    const candidate = structuredClone(project.chapters[0]!)
    database.saveRevision({
      id: 'health-scene-proposal', projectId: project.id, kind: 'chapter', target: 'chapter', targetId: candidate.id,
      baseRevision: project.revision, summary: '健康统计测试候选', candidate, status: '待处理', createdAt: project.createdAt,
      sceneQualityFindings: [{
        id: 'health-scene-finding', chapterId: candidate.id, category: '表达问题', severity: '中', confidence: .9,
        evidence: { chapterId: candidate.id, blockId: candidate.blocks[0]!.id, excerpt: '林砚' }, explanation: '测试待处理问题统计。',
        baseCandidateDigest: candidate.sourceDigest, status: '待处理', source: '本地规则', createdAt: project.createdAt
      }]
    })
    const mentions = database.listMentions(project.id, 'char-1')
    expect(mentions.length).toBeGreaterThan(0)
    expect(mentions[0]).toMatchObject({ entryId: 'char-1', chapterId: 'chapter-1', chapterNumber: 1 })
    const health = database.memoryHealth(project.id)
    expect(health.indexedMentions).toBe(mentions.length)
    expect(health.unindexedChapters).toBe(0)
    expect(health.missingSummaries).toBe(2)
    expect(health.staleOutlineCards).toBe(2)
    expect(health.pendingSceneQualityFindings).toBe(1)
    database.close()
  })

  it('重启数据库后会为旧项目重建实体索引', () => {
    const path = `${process.env.TEMP ?? '.'}/mojing-index-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
    const first = new NovelDatabaseService(path)
    const project = makeNovel(1)
    first.createProject(project)
    first.close()
    const second = new NovelDatabaseService(path)
    expect(second.listMentions(project.id, 'char-1').length).toBeGreaterThan(0)
    second.close()
    for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(`${path}${suffix}`) } catch { /* 测试清理 */ } }
  })

  it('保存抽象文风范本与文笔学习任务，不保留上传原文', () => {
    const database = new NovelDatabaseService(':memory:')
    const profile = database.createStyleProfile({ name: '清爽叙事', description: '节奏明快、句子简洁。', traits: { sentenceRhythm: '短句为主', narrativeDistance: '近距离', dialogueStyle: '对白简洁', descriptionStyle: '少量感官细节', pacing: '快速推进', diction: '具体易懂', paragraphPattern: '短段落', rhetoric: '克制' }, guidelines: ['优先动作和对白'], avoidPatterns: ['堆叠华丽形容词'] })
    expect(database.getStyleProfile(profile.id)?.sourceKind).toBe('用户创建')
    const job = database.createStyleLearningJob({ sourceName: 'sample.txt', sourceDigest: 'abc', sourceCharacterCount: 22000, requestedName: '学习范本' })
    expect(database.updateStyleLearningJob(job.id, { status: '待确认', candidate: { name: '学习范本', description: '', traits: profile.traits, guidelines: [], avoidPatterns: [] } }).status).toBe('待确认')
    expect(database.getStyleLearningJob(job.id)?.candidate?.name).toBe('学习范本')
    database.removeStyleProfile(profile.id)
    expect(database.getStyleProfile(profile.id)).toBeUndefined()
    database.close()
  })

  it('持久化模型单次输出上限和兼容参数，并可在重启后读取', () => {
    const path = `${process.env.TEMP ?? '.'}/mojing-provider-output-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
    const first = new NovelDatabaseService(path)
    const saved = first.saveProvider({ id: 'provider-output', name: '本机长输出模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-test', contextWindow: 128_000, maxOutputTokens: 24_000, outputTokenParameter: 'max_tokens', supportsStreaming: true, supportsJsonSchema: true, hasApiKey: false })
    expect(saved).toMatchObject({ maxOutputTokens: 24_000, outputTokenParameter: 'max_tokens' })
    first.close()
    const second = new NovelDatabaseService(path)
    expect(second.getProvider('provider-output')).toMatchObject({ maxOutputTokens: 24_000, outputTokenParameter: 'max_tokens' })
    second.close()
    for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(`${path}${suffix}`) } catch { /* 测试清理 */ } }
  })

  it('持久化长输出能力测试快照，且数据库升级到版本 11', () => {
    const database = new NovelDatabaseService(':memory:')
    const record = database.insertProviderOutputTest({
      providerName: '本机测试模型', model: 'local-test', baseUrl: 'http://127.0.0.1:11434/v1', contextWindow: 32_000,
      outputTokenParameter: 'auto', supportsStreaming: true, supportsJsonSchema: true, testMode: '流式',
      targetOutputTokens: 9_000, outputTokens: 8_320, finishReason: 'stop', ok: true, message: '测试通过', latencyMs: 420,
      configDigest: 'a'.repeat(64), testedAt: '2026-08-30T12:00:00.000Z', expiresAt: '2026-09-29T12:00:00.000Z'
    })
    expect(database.listProviderOutputTests()).toMatchObject([{ id: record.id, testMode: '流式', outputTokens: 8_320, stale: false }])
    database.close()
  })

  it('从版本 10 无损迁移阶段技能表并保留原项目', () => {
    const path = `${process.env.TEMP ?? '.'}/mojing-skill-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
    const project = makeNovel(1)
    const seed = new NovelDatabaseService(path)
    seed.createProject(project)
    seed.close()

    const legacy = new Database(path)
    legacy.exec('DROP TABLE novel_assistant_skill_configs')
    legacy.exec('DROP TABLE novel_assistant_guide_sessions')
    legacy.pragma('user_version = 10')
    legacy.close()

    const upgraded = new NovelDatabaseService(path)
    expect(upgraded.getProject(project.id).title).toBe(project.title)
    expect(upgraded.listAssistantSkillConfigurations(project.id)).toEqual([])
    const worldSkill = upgraded.listCreativeCapabilities(project.id).find((item) => item.taskScopes.includes('世界设定'))!
    expect(upgraded.saveAssistantSkillConfiguration({ projectId: project.id, stage: 'world', enabled: true, providerId: null, capabilityIds: [worldSkill.id] }))
      .toMatchObject({ projectId: project.id, stage: 'world', capabilityIds: [worldSkill.id] })
    upgraded.close()

    const inspection = new Database(path, { readonly: true })
    // user_version 13 = 在任务级模型覆盖表（12）之后新增通用助手引导会话表；旧库升级后行为不变。
    expect(inspection.pragma('user_version', { simple: true })).toBe(14)
    expect((inspection.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='novel_assistant_guide_sessions'").get() as { count: number }).count).toBe(1)
    expect((inspection.prepare('SELECT count(*) AS count FROM novel_assistant_skill_configs WHERE project_id=?').get(project.id) as { count: number }).count).toBe(1)
    expect((inspection.prepare('SELECT count(*) AS count FROM novel_assistant_task_configs WHERE project_id=?').get(project.id) as { count: number }).count).toBe(0)
    inspection.close()
    for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(`${path}${suffix}`) } catch { /* 测试清理 */ } }
  })

  it('删除项目时级联清理自定义技能、启停配置和阶段装配', () => {
    const path = `${process.env.TEMP ?? '.'}/mojing-skill-cascade-${Date.now()}-${Math.random().toString(16).slice(2)}.db`
    const database = new NovelDatabaseService(path), project = makeNovel(1)
    database.createProject(project)
    const skill = database.createCustomCreativeCapability(project.id, {
      name: '项目清理测试', description: '仅用于验证项目删除。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保持项目隔离。'
    })
    database.saveCreativeCapabilityConfiguration({ projectId: project.id, capabilityId: skill.id, enabled: false })
    database.saveAssistantSkillConfiguration({ projectId: project.id, stage: 'writing', enabled: true, providerId: null, capabilityIds: [skill.id] })
    database.removeProject(project.id)
    database.close()

    const inspection = new Database(path, { readonly: true })
    for (const table of ['novel_custom_creative_capabilities', 'novel_creative_capability_configs', 'novel_assistant_skill_configs']) {
      expect((inspection.prepare(`SELECT count(*) AS count FROM ${table} WHERE project_id=?`).get(project.id) as { count: number }).count).toBe(0)
    }
    inspection.close()
    for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(`${path}${suffix}`) } catch { /* 测试清理 */ } }
  })

  it('阶段技能配置为缺失项目、跨项目能力和错误阶段返回明确错误码', () => {
    const database = new NovelDatabaseService(':memory:'), first = makeNovel(1), second = makeNovel(2)
    database.createProject(first)
    database.createProject(second)
    const skill = database.createCustomCreativeCapability(first.id, {
      name: '正文边界', description: '只约束正文创作。', taskScopes: ['正文创作'], contextScopes: [],
      permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保持人物口吻一致。'
    })
    const captureCode = (action: () => unknown): string | undefined => {
      try { action(); return undefined } catch (error) { return (error as { code?: string }).code }
    }
    expect(captureCode(() => database.saveAssistantSkillConfiguration({ projectId: 'missing-project', stage: 'writing', enabled: true, providerId: null, capabilityIds: [] }))).toBe('SKILL_PROJECT_NOT_FOUND')
    expect(captureCode(() => database.saveAssistantSkillConfiguration({ projectId: second.id, stage: 'writing', enabled: true, providerId: null, capabilityIds: [skill.id] }))).toBe('SKILL_UNKNOWN_CAPABILITY')
    expect(captureCode(() => database.saveAssistantSkillConfiguration({ projectId: first.id, stage: 'world', enabled: true, providerId: null, capabilityIds: [skill.id] }))).toBe('SKILL_SCOPE_MISMATCH')
    expect(captureCode(() => database.saveAssistantSkillConfiguration({ projectId: first.id, stage: 'writing', enabled: true, providerId: null, capabilityIds: Array.from({ length: 13 }, (_, index) => `skill-${index}`) }))).toBe('SKILL_LIMIT_EXCEEDED')
    expect(captureCode(() => database.saveAssistantSkillConfiguration({ projectId: first.id, stage: 'unknown', enabled: true, providerId: null, capabilityIds: [] } as never))).toBe('SKILL_INVALID_CONFIGURATION')
    database.close()
  })
})
