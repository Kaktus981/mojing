import { describe, expect, it, vi } from 'vitest'
import type { CreativeAssistantSkillStage, CreativeTaskScope } from '../../contracts/src'
import { providerConfigDigest, type ProviderService, type StructuredGenerationRequest } from './ai/provider'
import { CREATIVE_SKILL_SYSTEM_RULE } from './creativeSkillRuntime'
import { NovelDatabaseService } from './novelDatabase'
import { NovelGenerationService } from './novelGeneration'
import { makeNovel } from './novelTestFactory'

type CapturedRequest = StructuredGenerationRequest<unknown> & { schemaName: string }

function equipSkill(
  database: NovelDatabaseService,
  projectId: string,
  stage: CreativeAssistantSkillStage,
  scope: CreativeTaskScope,
  marker: string,
  providerId: string | null = null
): void {
  const skill = database.createCustomCreativeCapability(projectId, {
    name: `${stage}阶段校验技能`,
    description: `${marker} 的阶段说明。`,
    taskScopes: [scope],
    contextScopes: [],
    permission: '只读分析',
    constraints: [],
    taskPreferences: [],
    skillText: `${marker}：只为当前项目提供创作参考。`,
    skillVersion: '1'
  })
  database.saveAssistantSkillConfiguration({ projectId, stage, enabled: true, providerId, capabilityIds: [skill.id] })
}

function confirmSingleBeat(project: ReturnType<typeof makeNovel>): void {
  const card = project.outline!.volumes[0]!.chapters[0]!
  card.beats = [{
    id: `beat-${project.id}`, order: 1, title: '藏起古钟', purpose: '保护线索', conflict: '守卫靠近',
    outcome: '林砚成功藏起古钟', location: '旧城', timeframe: '夜晚', characterIds: ['char-1'], reveal: '', threadActions: []
  }]
  card.beatStatus = '已确认'
}

describe('小说生成链中的文字 Skill', () => {
  it('普通生成、术语提取、世界审校、章节审校和记忆提取均按阶段注入 user 数据块', async () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    confirmSingleBeat(project)
    database.createProject(project)
    equipSkill(database, project.id, 'world', '世界设定', 'WORLD_SKILL_MARKER')
    equipSkill(database, project.id, 'writing', '正文创作', 'WRITING_SKILL_MARKER')
    equipSkill(database, project.id, 'memory', '记忆', 'MEMORY_SKILL_MARKER')

    const worldProposal = database.saveRevision({
      id: 'world-skill-audit', projectId: project.id, kind: 'world-foundation', target: 'worldBible',
      baseRevision: project.revision, summary: '世界观候选', candidate: project.worldBible, status: '待处理', createdAt: new Date().toISOString()
    })
    const chapterProposal = database.saveRevision({
      id: 'chapter-skill-audit', projectId: project.id, kind: 'chapter', target: 'chapter', targetId: project.chapters[0]!.id,
      baseRevision: project.revision, summary: '章节候选', candidate: project.chapters[0], status: '待处理', createdAt: new Date().toISOString()
    })
    const requests: CapturedRequest[] = []
    const generate = vi.fn(async (request: CapturedRequest): Promise<unknown> => {
      requests.push(request)
      if (request.schemaName === 'mojing_world_semantic_audit' || request.schemaName === 'mojing_chapter_quality_audit') return { findings: [] }
      if (request.schemaName === 'mojing_scene_prose') return { paragraphs: ['林砚听见守卫靠近，把古钟藏进木箱。'] }
      if (request.schemaName === 'mojing_memory_extraction') return { summary: '林砚藏起古钟。', keyEvents: [], characterStates: [], facts: [], objectStates: [], timelineEvents: [], plotThreads: [] }
      if (request.schemaName === 'mojing_world_constraint_extraction') return { constraints: [] }
      throw new Error(`未处理的测试 Schema：${request.schemaName}`)
    })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)

    await generation.run(project.id, { kind: 'world-audit', proposalId: worldProposal.id, baseRevision: project.revision })
    await generation.run(project.id, { kind: 'chapter-quality-audit', proposalId: chapterProposal.id, baseRevision: project.revision })
    await generation.run(project.id, { kind: 'chapter', chapterId: project.chapters[0]!.id, baseRevision: project.revision })
    await generation.run(project.id, { kind: 'memory-extraction', chapterId: project.chapters[0]!.id, baseRevision: project.revision })
    await generation.run(project.id, { kind: 'world-constraint-extraction', baseRevision: project.revision })

    const bySchema = new Map(requests.map((request) => [request.schemaName, request]))
    for (const schemaName of ['mojing_world_semantic_audit', 'mojing_world_constraint_extraction']) {
      expect(bySchema.get(schemaName)?.user).toContain('WORLD_SKILL_MARKER')
    }
    for (const schemaName of ['mojing_chapter_quality_audit', 'mojing_scene_prose']) {
      expect(bySchema.get(schemaName)?.user).toContain('WRITING_SKILL_MARKER')
    }
    expect(bySchema.get('mojing_memory_extraction')?.user).toContain('MEMORY_SKILL_MARKER')
    for (const request of requests) {
      expect(request.user).toContain('<author_skill_guidance>')
      expect(request.system).toContain(CREATIVE_SKILL_SYSTEM_RULE)
      expect(request.system).not.toMatch(/WORLD_SKILL_MARKER|WRITING_SKILL_MARKER|MEMORY_SKILL_MARKER/)
    }
    database.close()
  })

  it('并发项目各自持有请求级 Skill 包装，不会串用另一个项目的技能', async () => {
    const database = new NovelDatabaseService(':memory:')
    const first = makeNovel(1), second = makeNovel(1)
    confirmSingleBeat(first); confirmSingleBeat(second)
    database.createProject(first); database.createProject(second)
    equipSkill(database, first.id, 'writing', '正文创作', 'FIRST_PROJECT_SKILL')
    equipSkill(database, second.id, 'writing', '正文创作', 'SECOND_PROJECT_SKILL')

    const requests: CapturedRequest[] = []
    const generate = vi.fn(async (request: CapturedRequest): Promise<unknown> => {
      requests.push(request)
      await new Promise((resolve) => setTimeout(resolve, request.usageContext?.projectId === first.id ? 5 : 0))
      return { paragraphs: ['林砚把古钟收好，转身离开。'] }
    })
    const generation = new NovelGenerationService(database, { generate } as unknown as ProviderService)
    await Promise.all([
      generation.run(first.id, { kind: 'chapter', chapterId: first.chapters[0]!.id, baseRevision: first.revision }),
      generation.run(second.id, { kind: 'chapter', chapterId: second.chapters[0]!.id, baseRevision: second.revision })
    ])

    expect(requests).toHaveLength(2)
    const firstRequest = requests.find((request) => request.usageContext?.projectId === first.id)!
    const secondRequest = requests.find((request) => request.usageContext?.projectId === second.id)!
    expect(firstRequest.user).toContain('FIRST_PROJECT_SKILL')
    expect(firstRequest.user).not.toContain('SECOND_PROJECT_SKILL')
    expect(secondRequest.user).toContain('SECOND_PROJECT_SKILL')
    expect(secondRequest.user).not.toContain('FIRST_PROJECT_SKILL')
    expect(firstRequest.system).not.toMatch(/FIRST_PROJECT_SKILL|SECOND_PROJECT_SKILL/)
    expect(secondRequest.system).not.toMatch(/FIRST_PROJECT_SKILL|SECOND_PROJECT_SKILL/)
    database.close()
  })

  it('估算使用阶段 Skill 指定的模型及其对应长输出实测，不受其他模型记录挤占', () => {
    const database = new NovelDatabaseService(':memory:')
    const project = makeNovel(1)
    database.createProject(project)
    const selected = database.saveProvider({
      id: 'skill-selected-provider', name: 'Skill 指定模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'selected',
      contextWindow: 64_000, maxOutputTokens: 8_000, outputTokenParameter: 'auto', supportsStreaming: true,
      supportsJsonSchema: false, hasApiKey: false
    })
    const unrelated = database.saveProvider({
      id: 'unrelated-provider', name: '其他模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'unrelated',
      contextWindow: 32_000, maxOutputTokens: 4_000, outputTokenParameter: 'auto', supportsStreaming: true,
      supportsJsonSchema: false, hasApiKey: false
    })
    equipSkill(database, project.id, 'world', '世界设定', 'SELECTED_PROVIDER_SKILL', selected.id)
    const now = Date.now()
    database.insertProviderOutputTest({
      providerId: selected.id, providerName: selected.name, model: selected.model, baseUrl: selected.baseUrl,
      contextWindow: selected.contextWindow, outputTokenParameter: selected.outputTokenParameter ?? 'auto',
      supportsStreaming: selected.supportsStreaming, supportsJsonSchema: selected.supportsJsonSchema, testMode: '流式',
      targetOutputTokens: 9_000, outputTokens: 8_500, finishReason: 'stop', ok: true, message: '测试通过', latencyMs: 10,
      configDigest: providerConfigDigest(selected), testedAt: new Date(now - 86_400_000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString()
    })
    for (let index = 0; index < 30; index += 1) {
      database.insertProviderOutputTest({
        providerId: unrelated.id, providerName: unrelated.name, model: unrelated.model, baseUrl: unrelated.baseUrl,
        contextWindow: unrelated.contextWindow, outputTokenParameter: unrelated.outputTokenParameter ?? 'auto',
        supportsStreaming: unrelated.supportsStreaming, supportsJsonSchema: unrelated.supportsJsonSchema, testMode: '流式',
        targetOutputTokens: 9_000, outputTokens: 8_200, finishReason: 'stop', ok: true, message: '其他模型测试', latencyMs: 10,
        configDigest: providerConfigDigest(unrelated), testedAt: new Date(now - index * 1_000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString()
      })
    }

    const estimate = new NovelGenerationService(database, {} as ProviderService).estimate(project.id, {
      kind: 'world-constraint-extraction', baseRevision: project.revision
    })
    expect(estimate.contextWindow).toBeGreaterThan(40_000)
    expect(estimate.outputCapability).toMatchObject({ status: '已验证', sampleCount: 1, maxOutputTokens: 8_500 })
    expect(estimate.warnings.some((warning) => warning.includes('本次将加载 1 项创作技能'))).toBe(true)
    database.close()
  })
})
