import { z } from 'zod'
import { CreativeAssistantSkillStageSchema } from './creativeSeats'
import { ChapterOutlineSchema, SceneBeatSchema, VolumeOutlineSchema } from './novel'
import { NovelStorylineSchema } from './novelStoryline'

/**
 * 助手工作流的共享契约（D1/D5）。
 *
 * 这里只定义**形状与白名单**，不定义权限：读写范围由服务端按任务枚举和对象归属重算，
 * 客户端传来的 `target` / `taskType` 只是「作者当前在看什么、想做什么」的报告。
 */

export const AssistantTargetKindSchema = z.enum([
  'story-core', 'outline', 'volume', 'chapter', 'beat', 'storyline', 'world', 'world-entry'
])
export const AssistantTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('story-core'), projectId: z.string().min(1) }),
  z.object({ kind: z.literal('outline'), projectId: z.string().min(1) }),
  z.object({ kind: z.literal('volume'), projectId: z.string().min(1), objectId: z.string().min(1) }),
  z.object({ kind: z.literal('chapter'), projectId: z.string().min(1), objectId: z.string().min(1) }),
  z.object({ kind: z.literal('beat'), projectId: z.string().min(1), objectId: z.string().min(1), beatId: z.string().min(1) }),
  z.object({ kind: z.literal('storyline'), projectId: z.string().min(1), objectId: z.string().min(1) }),
  z.object({ kind: z.literal('world'), projectId: z.string().min(1) }),
  z.object({ kind: z.literal('world-entry'), projectId: z.string().min(1), objectId: z.string().min(1) })
])

export const WorkflowIntentSchema = z.enum(['guide', 'discuss', 'revise'])

/** 目标类型的中文兜底名：界面永远不直接显示内部 kind。 */
export const ASSISTANT_TARGET_FALLBACK_LABEL: Record<AssistantTargetKind, string> = {
  'story-core': '故事核心', outline: '总纲与卷纲', volume: '当前卷', chapter: '当前章节',
  beat: '当前剧情步骤', storyline: '当前故事线', world: '世界观正式设定', 'world-entry': '设定条目'
}

/**
 * 任务类型是可枚举的白名单，不是任意命令。
 * 每个任务在 core 侧绑定了可用目标、可写目标和是否需要文风，见 `ASSISTANT_TASK_RULES`。
 */
export const AssistantTaskTypeSchema = z.enum([
  '自由讨论', '引导构建', '初纲生成', '局部修改', '正文生成', '正文润色', '章节分析', '世界观提案', '连续性检查'
])
/** 任务白名单的有序列表；界面与服务端共用同一份，避免各写一套。 */
export const ASSISTANT_TASK_TYPES = AssistantTaskTypeSchema.options

export const VersionRefSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  digest: z.string().min(1).max(128)
})

/** 一次模型调用成功后，服务端真正写入的技能加载收据。 */
export const AssistantSkillLoadReceiptSchema = z.object({
  stage: CreativeAssistantSkillStageSchema,
  capabilityIds: z.array(z.string().min(1)).max(12),
  loadedAt: z.string().datetime()
})

/**
 * 选区采用稳定段落 ID + 源指纹：章号会重排，段落 ID 不会。
 * 对象没有稳定 ID 时走 P01 的向后兼容身份解析，不允许用可重排的位置冒充身份。
 */
export const AssistantSelectionSchema = z.object({
  paragraphId: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sourceDigest: z.string().min(1).max(128)
}).refine((item) => item.end >= item.start, { message: '选区结束位置不能早于开始位置。' })

export const WorkflowContextSchema = z.object({
  projectRevision: z.number().int().nonnegative(),
  target: AssistantTargetSchema,
  /** 目标的中文标签，界面展示用；服务端解析，不信任客户端文案。 */
  targetLabel: z.string(),
  intent: WorkflowIntentSchema,
  taskType: AssistantTaskTypeSchema,
  readRefs: z.array(z.string().min(1)),
  writableRefs: z.array(z.string().min(1)),
  selection: AssistantSelectionSchema.nullable()
})

export const EffectiveRunConfigSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  model: z.string(),
  taskType: AssistantTaskTypeSchema,
  /** 模型选择的实际来源：任务覆盖优先于项目默认，避免界面说一套、请求走另一套。 */
  source: z.enum(['任务覆盖', '项目默认', '全局默认', '未配置']),
  skills: z.array(VersionRefSchema),
  style: VersionRefSchema.nullable(),
  /** 未加载的技能必须给出具体原因，不能静默截断后宣称完整使用。 */
  skipped: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })).max(30),
  unavailable: z.object({ code: z.string(), message: z.string() }).nullable()
})

/**
 * 会话/候选绑定的稳定作用域键。
 * 用稳定身份而不是章号：结构调整重排章号后，旧候选不会串到别的章上。
 */
export function assistantScopeKey(target: AssistantTarget): string {
  if (target.kind === 'beat') return `beat:${target.objectId}:${target.beatId}`
  if ('objectId' in target) return `${target.kind}:${target.objectId}`
  return `${target.kind}:`
}

/** 任务级覆盖：只对指定任务类型生效，优先级高于阶段/项目默认配置。 */
export const AssistantTaskConfigurationSchema = z.object({
  projectId: z.string().min(1),
  taskType: AssistantTaskTypeSchema,
  enabled: z.boolean(),
  providerId: z.string().min(1).nullable().optional(),
  /** 省略表示沿用阶段默认技能；空数组表示该任务明确不带技能。 */
  capabilityIds: z.array(z.string().min(1).max(120)).max(12).optional(),
  updatedAt: z.string()
}).strict()

export const AssistantRunPreviewRequestSchema = z.object({
  stage: CreativeAssistantSkillStageSchema,
  target: AssistantTargetSchema,
  taskType: AssistantTaskTypeSchema,
  intent: WorkflowIntentSchema.optional(),
  selection: AssistantSelectionSchema.optional()
}).strict()

export const AssistantRunPreviewSchema = z.object({
  context: WorkflowContextSchema,
  effective: EffectiveRunConfigSchema
})

export type AssistantTargetKind = z.infer<typeof AssistantTargetKindSchema>
export type AssistantTarget = z.infer<typeof AssistantTargetSchema>
export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>
export type AssistantTaskType = z.infer<typeof AssistantTaskTypeSchema>
export type VersionRef = z.infer<typeof VersionRefSchema>
export type AssistantSkillLoadReceipt = z.infer<typeof AssistantSkillLoadReceiptSchema>
export type AssistantSelection = z.infer<typeof AssistantSelectionSchema>
export type WorkflowContext = z.infer<typeof WorkflowContextSchema>
export type EffectiveRunConfig = z.infer<typeof EffectiveRunConfigSchema>
export type AssistantTaskConfiguration = z.infer<typeof AssistantTaskConfigurationSchema>
export type AssistantRunPreviewRequest = z.infer<typeof AssistantRunPreviewRequestSchema>
export type AssistantRunPreview = z.infer<typeof AssistantRunPreviewSchema>

/* ------------------------------ 工作草稿与候选（D3） ------------------------------ */

/**
 * 变更用**领域判别联合**，不是任意 patch 路径：
 * 服务端只能按这些形状写入，不接受「给我一个 JSON 路径我帮你改」。
 */
export const AssistantChangeKindSchema = z.enum(['story-core', 'outline', 'volume', 'chapter', 'beat', 'storyline'])

export const AssistantChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('story-core'), seed: z.string().max(8_000), direction: z.string().max(2_000).default('') }),
  z.object({ kind: z.literal('outline'), synopsis: z.string().max(8_000), mainConflict: z.string().max(4_000), endingDirection: z.string().max(4_000) }),
  z.object({ kind: z.literal('volume'), volume: VolumeOutlineSchema }),
  z.object({ kind: z.literal('chapter'), chapter: ChapterOutlineSchema }),
  z.object({ kind: z.literal('beat'), chapterId: z.string().min(1), beat: SceneBeatSchema }),
  z.object({ kind: z.literal('storyline'), storyline: NovelStorylineSchema })
])

export const AssistantDraftStatusSchema = z.enum(['草稿', '待确认', '已采用', '已放弃'])
export const AssistantDependencyGroupSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), changeIndexes: z.array(z.number().int().nonnegative()).min(1)
})

export const AssistantDraftSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), scopeKey: z.string().min(1),
  target: AssistantTargetSchema, taskType: AssistantTaskTypeSchema, stage: CreativeAssistantSkillStageSchema,
  baseRevision: z.number().int().nonnegative(), sourceDigest: z.string().min(1).max(128),
  /** 草稿自身版本：作者每改一次 +1；旧版本写回会被拒绝。 */
  version: z.number().int().positive(),
  authorEdited: z.boolean(),
  changes: z.array(AssistantChangeSchema).max(50),
  dependencyGroups: z.array(AssistantDependencyGroupSchema).max(20),
  status: AssistantDraftStatusSchema,
  summary: z.string().max(500),
  createdAt: z.string(), updatedAt: z.string()
})

export const AssistantAdoptItemSchema = z.object({
  changeIndex: z.number().int().nonnegative(), kind: AssistantChangeKindSchema,
  label: z.string(), action: z.enum(['新增', '修改', '删除', '未变化']),
  before: z.string().max(2_000), after: z.string().max(2_000), groupId: z.string()
})

export const AssistantAdoptPreviewSchema = z.object({
  draftId: z.string().min(1), version: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(), currentRevision: z.number().int().nonnegative(),
  /** 绑定「当前项目 + 草稿版本」的摘要：项目一变或草稿一改，旧预览立即失效。 */
  previewDigest: z.string().min(1).max(128),
  target: AssistantTargetSchema, targetLabel: z.string(),
  items: z.array(AssistantAdoptItemSchema),
  groups: z.array(AssistantDependencyGroupSchema),
  /** 只提示受影响的下游，不自动改写正文或章纲。 */
  downstream: z.array(z.object({ label: z.string(), reason: z.string() })).max(50),
  blockers: z.array(z.string()).max(20)
})

/** 可回看候选记录：只追加，作者改过的草稿不会被后来的生成静默覆盖。 */
export const AssistantCandidateRecordSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), scopeKey: z.string().min(1),
  taskType: AssistantTaskTypeSchema, version: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(), sourceDigest: z.string().min(1).max(128),
  summary: z.string().max(500),
  changes: z.array(AssistantChangeSchema).max(50),
  dependencyGroups: z.array(AssistantDependencyGroupSchema).max(20),
  status: z.enum(['待确认', '已采用', '已放弃']),
  createdAt: z.string(), updatedAt: z.string()
})

export const UpdateAssistantDraftSchema = z.object({
  version: z.number().int().positive(),
  changes: z.array(AssistantChangeSchema).max(50),
  summary: z.string().max(500).optional()
}).strict()

export const ApplyAssistantDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedPreviewDigest: z.string().min(1).max(128)
}).strict()

export const CreateAssistantDraftSchema = z.object({
  target: AssistantTargetSchema, taskType: AssistantTaskTypeSchema,
  stage: CreativeAssistantSkillStageSchema, sourceDigest: z.string().max(128).default(''),
  summary: z.string().max(500).default(''),
  changes: z.array(AssistantChangeSchema).max(50),
  dependencyGroups: z.array(AssistantDependencyGroupSchema).max(20).default([])
}).strict()

export type AssistantChangeKind = z.infer<typeof AssistantChangeKindSchema>
export type AssistantChange = z.infer<typeof AssistantChangeSchema>
export type AssistantDraftStatus = z.infer<typeof AssistantDraftStatusSchema>
export type AssistantDependencyGroup = z.infer<typeof AssistantDependencyGroupSchema>
export type AssistantDraft = z.infer<typeof AssistantDraftSchema>
export type AssistantAdoptItem = z.infer<typeof AssistantAdoptItemSchema>
export type AssistantAdoptPreview = z.infer<typeof AssistantAdoptPreviewSchema>
export type AssistantCandidateRecord = z.infer<typeof AssistantCandidateRecordSchema>
export type UpdateAssistantDraft = z.infer<typeof UpdateAssistantDraftSchema>
export type ApplyAssistantDraft = z.infer<typeof ApplyAssistantDraftSchema>
export type CreateAssistantDraft = z.infer<typeof CreateAssistantDraftSchema>

/* ------------------------------ 大纲引导与初纲（D1/D2） ------------------------------ */

export const GuideSlotSchema = z.enum(['protagonist', 'coreConflict', 'endingDirection'])
export const GuideAnswerStateSchema = z.enum(['已回答', '不确定', '已跳过'])
export const GuideAnswerSchema = z.object({
  slot: GuideSlotSchema,
  value: z.string().max(4_000),
  state: GuideAnswerStateSchema,
  /** 只有「作者填写 / 作者选择 / 来自项目已有内容」能成为已知事实；AI 建议未被点击前不算。 */
  source: z.enum(['作者填写', '作者选择', '来自项目']),
  updatedAt: z.string()
})
export const GuideQuestionSchema = z.object({
  slot: GuideSlotSchema,
  question: z.string(),
  /**
   * 为什么现在先问这一项：由故事种子、已有正式信息、作者已回答内容推导，必须能对作者讲清楚。
   * 缺口顺序不是固定模板，选项也不是把种子塞进模板拼出来的。
   */
  whyThisFirst: z.string().max(300),
  options: z.array(z.object({ label: z.string().max(200), reason: z.string().max(300) })).min(3).max(5),
  /** 永远允许「自己填写」与「暂时跳过」，不强制逐题闯关。 */
  allowSkip: z.literal(true)
})
export const GuideSessionSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1),
  answers: z.array(GuideAnswerSchema).max(10),
  askedSlots: z.array(GuideSlotSchema).max(10),
  status: z.enum(['进行中', '已生成', '已采用']),
  createdAt: z.string(), updatedAt: z.string()
})
/**
 * 引导当前视为「已知」的一项。
 *
 * 只有作者填写 / 作者选择 / 项目已有正式内容会出现在这里；AI 给的方向在点击前不算事实。
 * 作者随时能看见引导到底拿了什么当依据（模型不可用时也一样看得见）。
 */
export const GuideKnownItemSchema = z.object({
  slot: GuideSlotSchema,
  label: z.string().max(40),
  value: z.string().max(200),
  source: z.enum(['作者填写', '作者选择', '来自项目']),
  state: GuideAnswerStateSchema
})
export const GuideReadinessSchema = z.object({
  /** 故事想法是硬条件，单独列出。 */
  hasSeed: z.boolean(),
  answered: z.array(GuideSlotSchema),
  missing: z.array(GuideSlotSchema),
  /** 故事想法 + 三项中至少两项可用 → 可以生成初纲。 */
  canGenerate: z.boolean(),
  reason: z.string(),
  /** 未定的项必须显式标为待确认，不能由 AI 悄悄定案。 */
  pending: z.array(z.string()).max(20),
  /** 从故事种子里提炼的故事焦点，用来生成贴合当前故事的方向（不是整句种子）。 */
  focus: z.string().max(80),
  /** 当前已知信息清单，供作者核对引导的依据。 */
  known: z.array(GuideKnownItemSchema).max(6)
})
export const InitialOutlineCandidateSchema = z.object({
  core: z.string().max(2_000),
  skeleton: z.object({ 开端: z.string().max(2_000), 发展: z.string().max(2_000), 转折: z.string().max(2_000), 高潮: z.string().max(2_000), 结局: z.string().max(2_000) }),
  volumes: z.array(z.object({ volumeNumber: z.number().int().positive(), title: z.string().max(120), goal: z.string().max(1_000) })).max(20),
  storylines: z.array(z.object({ title: z.string().max(200), why: z.string().max(1_000) })).max(20),
  /** 缺失或作者选了「不确定」的项，原样列入待确认。 */
  pending: z.array(z.string()).max(20)
})
export const AnswerGuideSlotSchema = z.object({
  slot: GuideSlotSchema,
  state: GuideAnswerStateSchema,
  value: z.string().max(4_000).optional(),
  source: z.enum(['作者填写', '作者选择']).optional()
}).strict()

export type GuideSlot = z.infer<typeof GuideSlotSchema>
export type GuideAnswerState = z.infer<typeof GuideAnswerStateSchema>
export type GuideAnswer = z.infer<typeof GuideAnswerSchema>
export type GuideQuestion = z.infer<typeof GuideQuestionSchema>
export type GuideSession = z.infer<typeof GuideSessionSchema>
export type GuideReadiness = z.infer<typeof GuideReadinessSchema>
export type GuideKnownItem = z.infer<typeof GuideKnownItemSchema>
export type InitialOutlineCandidate = z.infer<typeof InitialOutlineCandidateSchema>
export type AnswerGuideSlot = z.infer<typeof AnswerGuideSlotSchema>

/* ------------------------------ 局部修改与分批细化（D1/D3） ------------------------------ */

/**
 * 局部修改的**声明范围**。
 * 作者说改某个步骤，服务端就只能写那个步骤；说改某卷，就只能碰那一卷里的章。
 */
export const LocalRevisionScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('volume'), projectId: z.string().min(1), objectId: z.string().min(1) }),
  z.object({ kind: z.literal('chapter'), projectId: z.string().min(1), objectId: z.string().min(1) }),
  z.object({ kind: z.literal('beat'), projectId: z.string().min(1), objectId: z.string().min(1), beatId: z.string().min(1) }),
  z.object({ kind: z.literal('storyline'), projectId: z.string().min(1), objectId: z.string().min(1) })
])
export const CreateLocalRevisionSchema = z.object({
  scope: LocalRevisionScopeSchema,
  /** 多章批次：只能包含作者明确选中的章纲 id，且所有章级/步骤级变更都必须落在其中。 */
  batchChapterIds: z.array(z.string().min(1)).max(50).optional(),
  changes: z.array(AssistantChangeSchema).max(50).min(1),
  sourceDigest: z.string().max(128).default(''),
  summary: z.string().max(500).default('')
}).strict()

/** 模型只能输出这些形状；服务端再把它映射成 `AssistantChange`，模型拿不到任意写入能力。 */
export const LocalRevisionCandidateSchema = z.object({
  summary: z.string().max(500),
  volumeGoal: z.string().max(1_000).optional(),
  chapterObjective: z.string().max(2_000).optional(),
  chapterConflict: z.string().max(2_000).optional(),
  chapters: z.array(z.object({ id: z.string().min(1), objective: z.string().max(2_000), conflict: z.string().max(2_000) })).max(50).optional(),
  beats: z.array(z.object({
    id: z.string().min(1), chapterId: z.string().min(1), title: z.string().max(200),
    purpose: z.string().max(2_000), conflict: z.string().max(2_000), outcome: z.string().max(2_000),
    order: z.number().int().positive(), location: z.string().max(200), timeframe: z.string().max(200),
    reveal: z.string().max(1_000)
  })).max(50).optional(),
  storylines: z.array(z.object({ id: z.string().min(1), title: z.string().max(200), whyNecessary: z.string().max(2_000) })).max(20).optional(),
  notes: z.array(z.string().max(500)).max(20).optional()
})
export const GenerateLocalRevisionSchema = z.object({
  scope: LocalRevisionScopeSchema,
  batchChapterIds: z.array(z.string().min(1)).max(50).optional(),
  instruction: z.string().min(1).max(2_000)
}).strict()

export type LocalRevisionScope = z.infer<typeof LocalRevisionScopeSchema>
export type CreateLocalRevision = z.infer<typeof CreateLocalRevisionSchema>
export type LocalRevisionCandidate = z.infer<typeof LocalRevisionCandidateSchema>
export type GenerateLocalRevision = z.infer<typeof GenerateLocalRevisionSchema>
