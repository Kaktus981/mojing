import { describe, expect, it } from 'vitest'
import type { NovelProject } from '../../contracts/src'
import { NovelProjectSchema } from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import { ASSISTANT_TASK_RULES, describeAssistantTarget, resolveAssistantRun, resolveEffectiveRunConfig } from './assistantWorkflow'

/** 造一个两卷项目：第二卷只有第 2 章，用来验证「选中第二卷不会读到第一卷」。 */
function twoVolumeProject(): NovelProject {
  const base = makeNovel(2)
  const cloned = structuredClone(base) as NovelProject
  const [, second] = cloned.chapters
  cloned.outline!.volumes = [
    {
      ...cloned.outline!.volumes[0]!, id: 'v1', volumeNumber: 1, title: '旧城',
      chapters: [cloned.outline!.volumes[0]!.chapters[0]!]
    },
    {
      id: 'v2', volumeNumber: 2, title: '潮汐', goal: '', climax: '', resolution: '',
      chapters: [{ ...cloned.outline!.volumes[0]!.chapters[1]!, id: second!.id }]
    }
  ]
  return NovelProjectSchema.parse(cloned)
}

describe('助手精确作用域', () => {
  it('选中第二卷时读取范围只含第二卷，不会把第一卷当目标', () => {
    const project = twoVolumeProject()
    const described = describeAssistantTarget(project, { kind: 'volume', projectId: project.id, objectId: 'v2' })
    expect(described.label).toContain('第2卷')
    expect(described.readRefs).toContain('volume:v2')
    expect(described.readRefs).toContain(`chapter:${project.chapters[1]!.id}`)
    expect(described.readRefs).not.toContain('volume:v1')
    expect(described.readRefs).not.toContain(`chapter:${project.chapters[0]!.id}`)
  })

  it('不存在的卷、章、步骤和故事线一律拒绝，不回退到别的对象', () => {
    const project = twoVolumeProject()
    expect(() => describeAssistantTarget(project, { kind: 'volume', projectId: project.id, objectId: 'v9' })).toThrowError(/找不到该卷/)
    expect(() => describeAssistantTarget(project, { kind: 'chapter', projectId: project.id, objectId: 'chapter-404' })).toThrowError(/找不到该章节/)
    expect(() => describeAssistantTarget(project, { kind: 'beat', projectId: project.id, objectId: project.chapters[0]!.id, beatId: 'beat-404' })).toThrowError(/找不到该剧情步骤/)
    expect(() => describeAssistantTarget(project, { kind: 'storyline', projectId: project.id, objectId: 'line-404' })).toThrowError(/找不到该故事线/)
  })

  it('跨项目对象直接拒绝，不读取别的项目内容', () => {
    const project = twoVolumeProject()
    const error = (): unknown => {
      try { describeAssistantTarget(project, { kind: 'chapter', projectId: 'other-project', objectId: project.chapters[0]!.id }); return null } catch (caught) { return caught }
    }
    expect((error() as Error).message).toMatch(/不属于当前小说项目/)
  })

  it('任务只能在允许的栏目和目标类型上运行', () => {
    const project = twoVolumeProject()
    expect(() => resolveAssistantRun({
      database: new NovelDatabaseService(':memory:'), project, stage: 'world',
      target: { kind: 'story-core', projectId: project.id }, taskType: '引导构建'
    })).toThrowError(/不能在/)
    expect(() => resolveAssistantRun({
      database: new NovelDatabaseService(':memory:'), project, stage: 'outline',
      target: { kind: 'world', projectId: project.id }, taskType: '局部修改'
    })).toThrowError(/不能以/)
  })

  it('自由讨论没有可写范围，局部修改只写当前目标', () => {
    const project = twoVolumeProject()
    const database = new NovelDatabaseService(':memory:')
    database.createProject(project)
    const chapterId = project.chapters[1]!.id
    const discuss = resolveAssistantRun({ database, project, stage: 'outline', target: { kind: 'chapter', projectId: project.id, objectId: chapterId }, taskType: '自由讨论' })
    expect(discuss.context.writableRefs).toEqual([])
    const revise = resolveAssistantRun({ database, project, stage: 'outline', target: { kind: 'chapter', projectId: project.id, objectId: chapterId }, taskType: '局部修改' })
    expect(revise.context.writableRefs).toEqual([`chapter:${chapterId}`])
    expect(revise.context.readRefs).toContain('project:' + project.id)
    database.close()
  })

  it('初纲生成会列出全部受影响对象，不是任意跨模块写权限', () => {
    expect(ASSISTANT_TASK_RULES['初纲生成'].writable).toEqual(['story-core', 'outline', 'volume', 'storyline'])
    expect(ASSISTANT_TASK_RULES['初纲生成'].targetKinds).toEqual(['story-core', 'outline'])
  })
})

describe('实际调用配置', () => {
  it('没有配置模型服务时如实报告不可用，不静默换服务', () => {
    const project = twoVolumeProject()
    const database = new NovelDatabaseService(':memory:')
    database.createProject(project)
    const { effective } = resolveEffectiveRunConfig({ database, project, stage: 'outline', taskType: '局部修改' })
    expect(effective.unavailable?.code).toBe('MODEL_NOT_CONFIGURED')
    expect(effective.model).toBe('')
    expect(effective.source).toBe('未配置')
    database.close()
  })

  it('缺少密钥的服务明确说明，不假装可用', () => {
    const project = twoVolumeProject()
    const database = new NovelDatabaseService(':memory:')
    database.createProject(project)
    const provider = database.saveProvider({ name: '测试服务', baseUrl: 'http://127.0.0.1:1/v1', model: 'test-model', contextWindow: 8_000, supportsStreaming: false, supportsJsonSchema: false, hasApiKey: false })
    const { effective } = resolveEffectiveRunConfig({ database, project, stage: 'outline', taskType: '局部修改', explicitProviderId: provider.id })
    expect(effective.unavailable?.code).toBe('MODEL_KEY_MISSING')
    expect(effective.model).toBe('test-model')
    database.close()
  })

  it('任务覆盖优先于项目默认，界面来源与实际来源一致', () => {
    const project = twoVolumeProject()
    const database = new NovelDatabaseService(':memory:')
    database.createProject(project)
    const projectDefault = database.saveProvider({ name: '默认服务', baseUrl: 'http://127.0.0.1:1/v1', model: 'default-model', contextWindow: 8_000, supportsStreaming: false, supportsJsonSchema: false, hasApiKey: true })
    const taskOverride = database.saveProvider({ name: '专用服务', baseUrl: 'http://127.0.0.1:2/v1', model: 'task-model', contextWindow: 8_000, supportsStreaming: false, supportsJsonSchema: false, hasApiKey: true })
    database.saveAssistantSkillConfiguration({ projectId: project.id, stage: 'writing', enabled: true, providerId: projectDefault.id, capabilityIds: [] })
    database.saveAssistantTaskConfiguration({ projectId: project.id, taskType: '正文生成', enabled: true, providerId: taskOverride.id })

    const writing = resolveEffectiveRunConfig({ database, project, stage: 'writing', taskType: '正文生成' })
    expect(writing.effective.model).toBe('task-model')
    expect(writing.effective.source).toBe('任务覆盖')

    const other = resolveEffectiveRunConfig({ database, project, stage: 'writing', taskType: '正文润色' })
    expect(other.effective.model).toBe('default-model')
    expect(other.effective.source).toBe('项目默认')
    database.close()
  })

  it('停用或不适用技能会给出具体未加载原因，不静默截断', () => {
    const project = twoVolumeProject()
    const database = new NovelDatabaseService(':memory:')
    database.createProject(project)
    const writing = database.createCustomCreativeCapability(project.id, { name: '正文护栏', description: '只做正文建议。', taskScopes: ['正文创作'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [], skillText: '保持人物口吻一致。', skillVersion: '2.0' })
    const worldOnly = database.createCustomCreativeCapability(project.id, { name: '世界边界', description: '只做世界建议。', taskScopes: ['世界设定'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [], skillText: '不得改写已确认事实。', skillVersion: '1.0' })
    // 阶段装配本身会拦住不适用的能力，因此「不适用」只能经任务覆盖进入运行时：
    // 这正是越权配置必须被运行时拒绝、并说明未加载原因的那条路径。
    database.saveAssistantSkillConfiguration({ projectId: project.id, stage: 'writing', enabled: true, providerId: null, capabilityIds: [writing.id] })
    database.saveAssistantTaskConfiguration({ projectId: project.id, taskType: '正文生成', enabled: true, capabilityIds: [writing.id, worldOnly.id] })

    const run = resolveAssistantRun({ database, project, stage: 'writing', target: { kind: 'chapter', projectId: project.id, objectId: project.chapters[0]!.id }, taskType: '正文生成' })
    const skippedReasons = run.effective.skipped.map((item) => item.reason).join('；')
    expect(skippedReasons).toMatch(/不适用于当前栏目/)
    expect(run.effective.skills.map((item) => item.id)).toEqual([writing.id])
    expect(run.effective.skills[0]!.version).toBe('2.0')
    expect(run.skillPrompt).toContain('author_skill_guidance')
    expect(run.skillPrompt).not.toContain('世界边界')

    database.saveCreativeCapabilityConfiguration({ projectId: project.id, capabilityId: writing.id, enabled: false })
    const disabled = resolveEffectiveRunConfig({ database, project, stage: 'writing', taskType: '正文生成' })
    expect(disabled.effective.skills).toEqual([])
    expect(disabled.effective.skipped.map((item) => item.reason).join('；')).toMatch(/已停用/)
    database.close()
  })

  it('只有写正文的任务才带文风版本，普通讨论不被文风支配', () => {
    const project = twoVolumeProject()
    const database = new NovelDatabaseService(':memory:')
    database.createProject(project)
    const withStyle = structuredClone(project)
    withStyle.settings.activeStyleProfileId = 'profile-1'
    withStyle.settings.styleProfileSnapshot = {
      profileId: 'profile-1', name: '冷静克制', description: '', traits: { sentenceRhythm: '短句', dialogueStyle: '少修饰', descriptionStyle: '白描' } as never,
      guidelines: [], avoidPatterns: [], sourceKind: '用户创建', capturedAt: '2026-09-15T00:00:00.000Z'
    }
    const writing = resolveEffectiveRunConfig({ database, project: NovelProjectSchema.parse(withStyle), stage: 'writing', taskType: '正文生成' })
    expect(writing.effective.style?.id).toBe('profile-1')
    const discussion = resolveEffectiveRunConfig({ database, project: NovelProjectSchema.parse(withStyle), stage: 'writing', taskType: '自由讨论' })
    expect(discussion.effective.style).toBeNull()
    database.close()
  })
})
