import { createHash } from 'node:crypto'
import {
  type AssistantRunPreview, type AssistantSelection, type AssistantTarget, type AssistantTargetKind, type AssistantTaskType,
  type ChapterOutline, type CreativeAssistantSkillStage, type EffectiveRunConfig, type NovelProject,
  type AssistantSkillLoadReceipt, type VersionRef, type WorkflowContext, type WorkflowIntent
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'
import {
  buildCreativeSkillPrompt, isCreativeCapabilityAllowedForStage, DEFAULT_STAGE_SEATS, MAX_RUNTIME_SKILLS
} from './creativeSkillRuntime'

/**
 * 任务白名单不是任意命令：每个任务只能在指定栏目、指定目标类型上运行，
 * 也只能写回它自己声明的目标类型。服务端按这张表重算，客户端说了不算。
 */
export type AssistantTaskRule = {
  stages: readonly CreativeAssistantSkillStage[]
  targetKinds: readonly AssistantTargetKind[]
  writable: readonly AssistantTargetKind[]
  /** 只有真正写正文的任务才加载文风，普通讨论不被文风支配（D4/D5）。 */
  requiresStyle: boolean
}

export const ASSISTANT_TASK_RULES: Record<AssistantTaskType, AssistantTaskRule> = {
  自由讨论: { stages: ['idea', 'world', 'outline', 'writing', 'memory', 'delivery'], targetKinds: ['story-core', 'outline', 'volume', 'chapter', 'beat', 'storyline', 'world', 'world-entry'], writable: [], requiresStyle: false },
  引导构建: { stages: ['idea'], targetKinds: ['story-core'], writable: [], requiresStyle: false },
  初纲生成: { stages: ['idea', 'outline'], targetKinds: ['story-core', 'outline'], writable: ['story-core', 'outline', 'volume', 'storyline'], requiresStyle: false },
  局部修改: { stages: ['outline'], targetKinds: ['outline', 'volume', 'chapter', 'beat', 'storyline'], writable: ['outline', 'volume', 'chapter', 'beat', 'storyline'], requiresStyle: false },
  正文生成: { stages: ['writing'], targetKinds: ['chapter'], writable: ['chapter'], requiresStyle: true },
  正文润色: { stages: ['writing'], targetKinds: ['chapter'], writable: ['chapter'], requiresStyle: true },
  章节分析: { stages: ['writing', 'memory'], targetKinds: ['chapter'], writable: [], requiresStyle: false },
  世界观提案: { stages: ['world'], targetKinds: ['world', 'world-entry'], writable: ['world', 'world-entry'], requiresStyle: false },
  连续性检查: { stages: ['memory', 'delivery'], targetKinds: ['outline', 'volume', 'chapter', 'storyline'], writable: [], requiresStyle: false }
}

export const DEFAULT_ASSISTANT_TASK: AssistantTaskType = '自由讨论'

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }

function outlineChapters(project: NovelProject): ChapterOutline[] {
  return (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
}

function findVolume(project: NovelProject, objectId: string) {
  return project.outline?.volumes.find((volume) => volume.id === objectId || String(volume.volumeNumber) === objectId)
}

/**
 * 解析并校验助手目标。
 *
 * 只认**稳定身份**：卷用卷 id（兼容卷号字符串），章用章 id（章纲与正文共用），
 * 步骤额外带 beatId。找不到、类型不符或属于别的项目一律拒绝——
 * 「选中第二卷」绝不能解析成第一卷，也不允许跨项目读取。
 */
export function describeAssistantTarget(project: NovelProject, target: AssistantTarget): { label: string; readRefs: string[]; writableRefs: string[] } {
  if (target.projectId !== project.id) throw fail('ASSISTANT_TARGET_PROJECT_MISMATCH', '该创作对象不属于当前小说项目。')
  const base = [`project:${project.id}`]
  switch (target.kind) {
    case 'story-core':
      return { label: '故事核心', readRefs: [...base, 'seed', 'settings'], writableRefs: ['story-core'] }
    case 'outline':
      return {
        label: '总纲与卷纲',
        readRefs: [...base, 'outline:synopsis', ...(project.outline?.volumes ?? []).map((volume) => `volume:${volume.id}`)],
        writableRefs: ['outline']
      }
    case 'volume': {
      const volume = findVolume(project, target.objectId)
      if (!volume) throw fail('ASSISTANT_TARGET_NOT_FOUND', '找不到该卷，它可能已被删除或结构调整后合并。')
      return {
        label: `第${volume.volumeNumber}卷《${volume.title || '未命名'}》`,
        readRefs: [...base, `volume:${volume.id}`, ...volume.chapters.map((chapter) => `chapter:${chapter.id}`)],
        writableRefs: [`volume:${volume.id}`]
      }
    }
    case 'chapter': {
      const card = outlineChapters(project).find((chapter) => chapter.id === target.objectId)
      const body = project.chapters.find((chapter) => chapter.id === target.objectId)
      if (!card && !body) throw fail('ASSISTANT_TARGET_NOT_FOUND', '找不到该章节，它可能已被删除或结构调整后合并。')
      const number = body?.chapterNumber ?? card?.chapterNumber ?? 0
      const title = body?.title ?? card?.title ?? '未命名'
      return {
        label: `第${number}章《${title || '未命名'}》`,
        readRefs: [...base, `chapter:${target.objectId}`, ...(body ? ['chapter-body:' + body.id] : []), ...(card ? ['chapter-plan:' + card.id] : [])],
        writableRefs: [`chapter:${target.objectId}`]
      }
    }
    case 'beat': {
      const card = outlineChapters(project).find((chapter) => chapter.id === target.objectId)
      const beat = card?.beats.find((item) => item.id === target.beatId)
      if (!card || !beat) throw fail('ASSISTANT_TARGET_NOT_FOUND', '找不到该剧情步骤，它可能已被删除或重新生成。')
      return {
        label: `第${card.chapterNumber}章《${card.title || '未命名'}》·${beat.title || '未命名步骤'}`,
        readRefs: [...base, `chapter:${card.id}`, `beat:${beat.id}`],
        writableRefs: [`beat:${beat.id}`]
      }
    }
    case 'storyline': {
      const line = (project.storylines ?? []).find((item) => item.id === target.objectId)
      if (!line) throw fail('ASSISTANT_TARGET_NOT_FOUND', '找不到该故事线，它可能已被删除。')
      return { label: `故事线《${line.title}》`, readRefs: [...base, `storyline:${line.id}`], writableRefs: [`storyline:${line.id}`] }
    }
    case 'world':
      return {
        label: '世界观正式设定',
        readRefs: [...base, 'world:bible', 'world:constraints'],
        writableRefs: ['world']
      }
    case 'world-entry': {
      const entry = project.worldBible?.entries.find((item) => item.id === target.objectId)
      if (!entry) throw fail('ASSISTANT_TARGET_NOT_FOUND', '找不到该设定条目，它可能已被删除。')
      return { label: `${entry.type}·${entry.name}`, readRefs: [...base, `world-entry:${entry.id}`], writableRefs: [`world-entry:${entry.id}`] }
    }
    default: {
      const never: never = target
      throw fail('ASSISTANT_TARGET_NOT_FOUND', `不支持的创作对象：${JSON.stringify(never)}。`)
    }
  }
}

export function styleVersionRef(project: NovelProject): VersionRef | null {
  const snapshot = project.settings.styleProfileSnapshot
  if (!snapshot) return null
  return {
    id: snapshot.profileId,
    version: snapshot.capturedAt,
    digest: createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex').slice(0, 32)
  }
}

export function buildWorkflowContext(input: {
  project: NovelProject
  target: AssistantTarget
  taskType: AssistantTaskType
  stage: CreativeAssistantSkillStage
  intent?: WorkflowIntent
  selection?: AssistantSelection
}): WorkflowContext {
  const rule = ASSISTANT_TASK_RULES[input.taskType]
  if (!rule.stages.includes(input.stage)) {
    throw fail('ASSISTANT_TASK_STAGE_MISMATCH', `“${input.taskType}”不能在「${input.stage}」栏目执行。`)
  }
  if (!rule.targetKinds.includes(input.target.kind)) {
    throw fail('ASSISTANT_TASK_TARGET_MISMATCH', `“${input.taskType}”不能以${input.target.kind}为目标。`)
  }
  const described = describeAssistantTarget(input.project, input.target)
  const writableKinds = rule.writable.filter((kind) => kind === input.target.kind)
  return {
    projectRevision: input.project.revision,
    target: input.target,
    targetLabel: described.label,
    intent: input.intent ?? (rule.writable.length ? 'revise' : 'discuss'),
    taskType: input.taskType,
    readRefs: dedupe([...described.readRefs, ...stageReadRefs(input.stage)]),
    writableRefs: writableKinds.length ? described.writableRefs.filter((ref) => writableKinds.some((kind) => ref.startsWith(`${kind}:`) || ref === kind)) : [],
    selection: input.selection ?? null
  }
}

/** 栏目级的公共读取范围；只列作者本栏目本来就在看的资料，不扩大发送面。 */
function stageReadRefs(stage: CreativeAssistantSkillStage): string[] {
  if (stage === 'writing' || stage === 'memory') return ['memory:formal', 'world:rules', 'plot-threads']
  if (stage === 'world') return ['world:rules', 'world:timeline']
  if (stage === 'delivery') return ['memory:formal', 'review-issues', 'plot-threads']
  if (stage === 'outline' || stage === 'idea') return ['plot-threads']
  return []
}

export interface ResolvedAssistantRun {
  context: WorkflowContext
  effective: EffectiveRunConfig
  /** 本次实际拼进请求里的技能数据块；越权或超限的技能根本不会出现在里面。 */
  skillPrompt: string
  /** 仅在 provider 成功返回后由调用方执行，记录本次真正生效的技能阶段。 */
  markLoaded?: () => AssistantSkillLoadReceipt
}

function selectSkills(database: NovelDatabaseService, project: NovelProject, stage: CreativeAssistantSkillStage, taskType: AssistantTaskType): { capabilities: ReturnType<NovelDatabaseService['listCreativeCapabilities']>; skipped: EffectiveRunConfig['skipped'] } {
  const taskConfig = database.getAssistantTaskConfiguration(project.id, taskType)
  const config = database.getAssistantSkillConfiguration(project.id, stage)
  const fallbackSeat = config ? undefined : database.getCreativeSeat(project.id, DEFAULT_STAGE_SEATS[stage])
  const skipped: EffectiveRunConfig['skipped'] = []

  if (taskConfig?.enabled === false || config?.enabled === false || fallbackSeat?.enabled === false) {
    return { capabilities: [], skipped: [] }
  }
  // 任务覆盖优先于阶段默认：只有显式配置过 capabilityIds 的任务才接管技能选择。
  const ids = taskConfig?.capabilityIds ?? config?.capabilityIds ?? fallbackSeat?.capabilityIds ?? []
  const all = new Map(database.listCreativeCapabilities(project.id).map((item) => [item.id, item]))
  const selected: ReturnType<NovelDatabaseService['listCreativeCapabilities']> = []
  for (const id of new Set(ids)) {
    if (selected.length >= MAX_RUNTIME_SKILLS) {
      skipped.push({ id, name: id, reason: `单次调用最多加载 ${MAX_RUNTIME_SKILLS} 项技能。` })
      continue
    }
    const capability = all.get(id)
    if (!capability) { skipped.push({ id, name: id, reason: '技能不存在，可能已被删除。' }); continue }
    if (!capability.enabled) { skipped.push({ id: capability.id, name: capability.name, reason: '该技能已停用。' }); continue }
    if (!isCreativeCapabilityAllowedForStage(stage, capability)) { skipped.push({ id: capability.id, name: capability.name, reason: '该技能不适用于当前栏目。' }); continue }
    selected.push(capability)
  }
  // 序列化超限不能静默截断：从后往前丢弃，逐条说明未加载原因。
  while (selected.length > 0) {
    try { buildCreativeSkillPrompt(selected); break } catch {
      const dropped = selected.pop()!
      skipped.push({ id: dropped.id, name: dropped.name, reason: '技能文字总量超过本次调用上限，未加载。' })
    }
  }
  return { capabilities: selected, skipped }
}

export function resolveEffectiveRunConfig(input: {
  database: NovelDatabaseService
  project: NovelProject
  stage: CreativeAssistantSkillStage
  taskType: AssistantTaskType
  explicitProviderId?: string
}): { effective: EffectiveRunConfig; skillPrompt: string; markLoaded?: () => AssistantSkillLoadReceipt } {
  const { database, project, stage, taskType } = input
  const rule = ASSISTANT_TASK_RULES[taskType]
  const taskConfig = database.getAssistantTaskConfiguration(project.id, taskType)
  const stageConfig = database.getAssistantSkillConfiguration(project.id, stage)
  const fallbackSeat = stageConfig ? undefined : database.getCreativeSeat(project.id, DEFAULT_STAGE_SEATS[stage])

  const preferredId = input.explicitProviderId ?? taskConfig?.providerId ?? stageConfig?.providerId ?? fallbackSeat?.providerId
  const provider = preferredId ? database.getProvider(preferredId) : database.getProvider()
  const source: EffectiveRunConfig['source'] = input.explicitProviderId
    ? (taskConfig?.providerId === input.explicitProviderId ? '任务覆盖' : '项目默认')
    : taskConfig?.providerId ? '任务覆盖'
      : (stageConfig?.providerId ?? fallbackSeat?.providerId) ? '项目默认'
        : provider ? '全局默认' : '未配置'

  const unavailable = !provider
    ? { code: 'MODEL_NOT_CONFIGURED', message: '还没有可用的模型服务，请先在全局设置里配置模型服务与密钥。' }
    : !provider.hasApiKey
      ? { code: 'MODEL_KEY_MISSING', message: `模型服务“${provider.name}”还没有配置密钥，本次调用不会发送。` }
      : null

  const { capabilities, skipped } = selectSkills(database, project, stage, taskType)
  const skillPrompt = capabilities.length ? buildCreativeSkillPrompt(capabilities) : ''
  const markLoaded = capabilities.length
    ? () => database.markCreativeSkillsLoaded(project.id, stage, capabilities)
    : undefined
  const style = rule.requiresStyle ? styleVersionRef(project) : null

  return {
    effective: {
      providerId: provider?.id ?? '',
      providerName: provider?.name ?? '',
      model: provider?.model ?? '',
      taskType,
      source,
      skills: capabilities.map((item) => ({ id: item.id, version: item.skillVersion ?? '1.0', digest: item.sourceDigest ?? creativeDigestOf(item.id, item.skillVersion ?? '1.0') })),
      style,
      skipped,
      unavailable
    },
    skillPrompt,
    markLoaded
  }
}

function creativeDigestOf(id: string, version: string): string {
  return createHash('sha256').update(`${id}@${version}`, 'utf8').digest('hex').slice(0, 32)
}

/** 调用前的完整预览：不消耗模型调用，只把服务端将要读取/写入/加载的内容算清楚。 */
export function resolveAssistantRun(input: {
  database: NovelDatabaseService
  project: NovelProject
  stage: CreativeAssistantSkillStage
  target: AssistantTarget
  taskType: AssistantTaskType
  intent?: WorkflowIntent
  selection?: AssistantSelection
  explicitProviderId?: string
}): ResolvedAssistantRun {
  const context = buildWorkflowContext({
    project: input.project, target: input.target, taskType: input.taskType,
    stage: input.stage, intent: input.intent, selection: input.selection
  })
  const { effective, skillPrompt, markLoaded } = resolveEffectiveRunConfig({
    database: input.database, project: input.project, stage: input.stage,
    taskType: input.taskType, explicitProviderId: input.explicitProviderId
  })
  return { context, effective, skillPrompt, markLoaded }
}

function dedupe(items: string[]): string[] { return [...new Set(items)] }

export type AssistantRunPreviewResponse = AssistantRunPreview
