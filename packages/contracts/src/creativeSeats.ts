import { z } from 'zod'
import {
  NovelGenerationJobErrorSchema,
  NovelGenerationKindSchema,
  NovelOrchestrationPlanRequestSchema
} from './novelApi'

export const CreativeTaskScopeSchema = z.enum(['世界设定', '结构规划', '场景节拍', '正文创作', '连续性', '记忆', '伏笔', '中文审校'])
export const CreativeContextScopeSchema = z.enum(['故事种子', '正式世界观', '世界观候选', '定稿大纲', '章节正文', '正式记忆', '待确认提案', '伏笔证据', '实体出现记录'])
export const CreativeCapabilityPermissionSchema = z.enum(['只读分析', '生成候选', '建立提案'])
export const CreativeCapabilitySourceSchema = z.enum(['内置', '用户配置'])
/** 技能正文的保存来源；`remote` 始终伴随固定 URL/ref，不代表可执行插件。 */
export const CreativeCapabilitySourceKindSchema = z.enum(['local', 'remote'])
const CreativeSkillSourceUrlSchema = z.string().url().refine((value) => value.startsWith('https://'), '技能来源只允许 HTTPS。')

export const CreativeCapabilitySchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(40),
  description: z.string().min(1).max(500),
  taskScopes: z.array(CreativeTaskScopeSchema).min(1),
  contextScopes: z.array(CreativeContextScopeSchema),
  permission: CreativeCapabilityPermissionSchema,
  enabled: z.boolean(),
  source: CreativeCapabilitySourceSchema,
  constraints: z.array(z.string().min(1).max(500)).max(30),
  taskPreferences: z.array(z.string().min(1).max(500)).max(30),
  /** 纯文字技能正文；永远作为低优先级上下文，不是可执行插件。 */
  skillText: z.string().trim().min(1).max(12_000).optional(),
  skillVersion: z.string().min(1).max(40).optional(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceKind: CreativeCapabilitySourceKindSchema.optional(),
  sourceUrl: CreativeSkillSourceUrlSchema.optional(),
  sourceRef: z.string().trim().min(1).max(240).optional(),
  sourcePinnedAt: z.string().datetime().optional(),
  /** 最近一次进入阶段运行时的版本；仅是状态投影，不授予额外权限。 */
  loadedAt: z.string().datetime().optional(),
  loadedVersion: z.string().min(1).max(40).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})

/**
 * 用户配置能力只是创作约束和任务偏好，不是插件系统。
 * strict 会拒绝 command、script、module、tools 等任何未声明字段，
 * 因此配置内容不能变成可执行代码或扩大本机权限。
 */
export const CreateCreativeCapabilityInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(500),
  taskScopes: z.array(CreativeTaskScopeSchema).min(1),
  contextScopes: z.array(CreativeContextScopeSchema).max(20).default([]),
  permission: CreativeCapabilityPermissionSchema.default('只读分析'),
  constraints: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  taskPreferences: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  skillText: z.string().trim().min(1).max(12_000).optional(),
  skillVersion: z.string().trim().min(1).max(40).optional(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceKind: CreativeCapabilitySourceKindSchema.optional(),
  sourceUrl: CreativeSkillSourceUrlSchema.optional(),
  sourceRef: z.string().trim().min(1).max(240).optional(),
  sourcePinnedAt: z.string().datetime().optional()
}).strict('用户配置能力只能包含说明性约束和任务偏好，不能声明命令、脚本、模块或工具。')

export const UpdateCreativeCapabilityInputSchema = CreateCreativeCapabilityInputSchema.partial().extend({ enabled: z.boolean().optional() })
  .strict('用户配置能力只能包含说明性约束和任务偏好，不能声明命令、脚本、模块或工具。')

export const CreativeSeatPhaseSchema = z.enum(['设定阶段', '规划阶段', '写作阶段', '复核阶段', '归档阶段'])
export const CreativeSeatActionSchema = z.enum(['读取正式资料', '读取候选资料', '生成修改候选', '生成审校报告', '建立记忆提案', '更新运行状态'])
export const CreativeSeatSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(40),
  responsibility: z.string().min(1).max(500),
  phase: CreativeSeatPhaseSchema,
  enabled: z.boolean(),
  providerId: z.string().min(1).optional(),
  capabilityIds: z.array(z.string().min(1).max(120)),
  allowedActions: z.array(CreativeSeatActionSchema),
  locked: z.boolean()
})

export const CreativeSeatConfigurationSchema = z.object({
  projectId: z.string().min(1),
  seatId: z.string().min(1).max(120),
  enabled: z.boolean(),
  providerId: z.string().min(1).nullable().optional(),
  capabilityIds: z.array(z.string().min(1).max(120)),
  updatedAt: z.string()
})

export const CreativeCapabilityConfigurationSchema = z.object({
  projectId: z.string().min(1),
  capabilityId: z.string().min(1).max(120),
  enabled: z.boolean(),
  updatedAt: z.string()
})

export const CreativeAssistantSkillStageSchema = z.enum(['idea', 'world', 'outline', 'writing', 'memory', 'delivery'])
export const CreativeAssistantSkillConfigurationSchema = z.object({
  projectId: z.string().min(1),
  stage: CreativeAssistantSkillStageSchema,
  enabled: z.boolean(),
  providerId: z.string().min(1).nullable().optional(),
  capabilityIds: z.array(z.string().min(1).max(120)).max(12),
  updatedAt: z.string()
}).strict()
export const CreativeSkillImportInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(32_000)
}).strict()
export const CreativeSkillPreviewSchema = z.object({
  filename: z.string(), sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  capability: CreateCreativeCapabilityInputSchema,
  warnings: z.array(z.string()).max(20)
})
export const InstallCreativeSkillInputSchema = CreativeSkillImportInputSchema.extend({ expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()

/**
 * 导入预览结果：除规范化后的字段外，还要告诉作者「库里是不是已经有了」。
 * 重复导入只提示，不静默覆盖已有项。
 */
export const CreativeSkillPreviewResultSchema = z.object({
  preview: CreativeSkillPreviewSchema,
  existing: z.object({ id: z.string(), name: z.string(), enabled: z.boolean(), skillVersion: z.string().optional() }).nullable()
})

export const CreativeSkillRemoteImportInputSchema = z.object({
  url: CreativeSkillSourceUrlSchema,
  /** 远程地址中的分支 / tag / commit；安装时再次校验以防预览后漂移。 */
  expectedRef: z.string().trim().min(1).max(240).optional()
}).strict()
export const CreativeSkillRemoteSourceSchema = z.object({
  sourceKind: z.literal('remote'),
  sourceUrl: CreativeSkillSourceUrlSchema,
  sourceRef: z.string().min(1).max(240),
  sourcePinnedAt: z.string().datetime(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()
export const CreativeSkillRemotePreviewResultSchema = z.object({
  preview: CreativeSkillPreviewSchema,
  source: CreativeSkillRemoteSourceSchema,
  existing: z.object({ id: z.string(), name: z.string(), enabled: z.boolean(), skillVersion: z.string().optional() }).nullable()
})
export const CreativeSkillRemoteUpdatePreviewResultSchema = z.object({
  capabilityId: z.string().min(1),
  currentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  changed: z.boolean(),
  preview: CreativeSkillPreviewSchema,
  source: CreativeSkillRemoteSourceSchema
})
export const InstallCreativeSkillRemoteInputSchema = CreativeSkillRemoteImportInputSchema.extend({
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** 远程更新必须携带此前预览得到的摘要，检查与应用不能合并成一次无确认覆盖。 */
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()

/** 单项版本快照；回滚不会删除历史，而是追加一个新的 revision。 */
export const CreativeSkillVersionSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), capabilityId: z.string().min(1),
  revision: z.number().int().positive(), skillVersion: z.string().min(1).max(40),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/), sourceKind: CreativeCapabilitySourceKindSchema.optional(),
  sourceUrl: CreativeSkillSourceUrlSchema.optional(), sourceRef: z.string().min(1).max(240).optional(),
  sourcePinnedAt: z.string().datetime().optional(), capability: CreativeCapabilitySchema, createdAt: z.string().datetime(), active: z.boolean().optional()
}).strict()
export const CreativeSkillCatalogItemSchema = CreativeCapabilitySchema.extend({
  status: z.enum(['已停用', '已启用', '已加载']), loaded: z.boolean(), loadedStages: z.array(CreativeAssistantSkillStageSchema),
  loadedVersion: z.string().min(1).max(40).optional(), loadedAt: z.string().datetime().optional(), versionCount: z.number().int().nonnegative()
})

export const CreativeOrchestrationRunStatusSchema = z.enum(['草稿', '等待执行', '运行中', '暂停', '待作者确认', '完成', '失败', '取消'])
export const CreativeOrchestrationStepStatusSchema = z.enum(['等待前置', '可执行', '运行中', '待作者确认', '完成', '失败', '跳过', '取消'])

export const CreativeOrchestrationStepSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  order: z.number().int().nonnegative(),
  seatId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  kind: NovelGenerationKindSchema,
  targetId: z.string().optional(),
  dependsOn: z.array(z.string().min(1)),
  status: CreativeOrchestrationStepStatusSchema,
  reason: z.string().max(2_000),
  evidence: z.array(z.string().max(2_000)),
  estimatedTokens: z.number().int().nonnegative(),
  jobId: z.string().optional(),
  proposalId: z.string().optional(),
  memoryProposalIds: z.array(z.string()),
  error: NovelGenerationJobErrorSchema.optional(),
  attempt: z.number().int().nonnegative(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  updatedAt: z.string()
})

export const CreativeOrchestrationRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  request: NovelOrchestrationPlanRequestSchema,
  baseRevision: z.number().int().nonnegative(),
  status: CreativeOrchestrationRunStatusSchema,
  policy: z.object({
    maxParallel: z.number().int().min(1).max(3),
    requireHumanGate: z.literal(true),
    autoApply: z.literal(false)
  }),
  warnings: z.array(z.string()),
  steps: z.array(CreativeOrchestrationStepSchema),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  updatedAt: z.string()
})

export const UpdateCreativeOrchestrationRunSchema = z.object({
  status: CreativeOrchestrationRunStatusSchema.optional(),
  warnings: z.array(z.string()).optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional()
}).strict()

export const UpdateCreativeOrchestrationStepSchema = z.object({
  status: CreativeOrchestrationStepStatusSchema.optional(),
  jobId: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
  memoryProposalIds: z.array(z.string()).optional(),
  error: NovelGenerationJobErrorSchema.nullable().optional(),
  attempt: z.number().int().nonnegative().optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional()
}).strict()

export type CreativeTaskScope = z.infer<typeof CreativeTaskScopeSchema>
export type CreativeContextScope = z.infer<typeof CreativeContextScopeSchema>
export type CreativeCapabilityPermission = z.infer<typeof CreativeCapabilityPermissionSchema>
export type CreativeCapabilitySourceKind = z.infer<typeof CreativeCapabilitySourceKindSchema>
export type CreativeCapability = z.infer<typeof CreativeCapabilitySchema>
export type CreateCreativeCapabilityInput = z.input<typeof CreateCreativeCapabilityInputSchema>
export type UpdateCreativeCapabilityInput = z.input<typeof UpdateCreativeCapabilityInputSchema>
export type CreativeSeat = z.infer<typeof CreativeSeatSchema>
export type CreativeSeatConfiguration = z.infer<typeof CreativeSeatConfigurationSchema>
export type CreativeCapabilityConfiguration = z.infer<typeof CreativeCapabilityConfigurationSchema>
export type CreativeAssistantSkillStage = z.infer<typeof CreativeAssistantSkillStageSchema>
export type CreativeAssistantSkillConfiguration = z.infer<typeof CreativeAssistantSkillConfigurationSchema>
export type CreativeSkillImportInput = z.infer<typeof CreativeSkillImportInputSchema>
export type CreativeSkillPreview = z.infer<typeof CreativeSkillPreviewSchema>
export type InstallCreativeSkillInput = z.infer<typeof InstallCreativeSkillInputSchema>
export type CreativeSkillPreviewResult = z.infer<typeof CreativeSkillPreviewResultSchema>
export type CreativeSkillRemoteImportInput = z.infer<typeof CreativeSkillRemoteImportInputSchema>
export type CreativeSkillRemoteSource = z.infer<typeof CreativeSkillRemoteSourceSchema>
export type CreativeSkillRemotePreviewResult = z.infer<typeof CreativeSkillRemotePreviewResultSchema>
export type CreativeSkillRemoteUpdatePreviewResult = z.infer<typeof CreativeSkillRemoteUpdatePreviewResultSchema>
export type InstallCreativeSkillRemoteInput = z.infer<typeof InstallCreativeSkillRemoteInputSchema>
export type CreativeSkillVersion = z.infer<typeof CreativeSkillVersionSchema>
export type CreativeSkillCatalogItem = z.infer<typeof CreativeSkillCatalogItemSchema>
export type CreativeOrchestrationRunStatus = z.infer<typeof CreativeOrchestrationRunStatusSchema>
export type CreativeOrchestrationStepStatus = z.infer<typeof CreativeOrchestrationStepStatusSchema>
export type CreativeOrchestrationStep = z.infer<typeof CreativeOrchestrationStepSchema>
export type CreativeOrchestrationRun = z.infer<typeof CreativeOrchestrationRunSchema>
export type UpdateCreativeOrchestrationRun = z.infer<typeof UpdateCreativeOrchestrationRunSchema>
export type UpdateCreativeOrchestrationStep = z.infer<typeof UpdateCreativeOrchestrationStepSchema>
