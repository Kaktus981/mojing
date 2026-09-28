import { z } from 'zod'

/**
 * 世界观扩展先作为独立候选保存。它描述新增资料如何接入已有正文，
 * 但不会把过渡说明自动写进章节正文。
 */
export const WorldExpansionStatusSchema = z.enum(['待确认', '已应用', '已拒绝', '已过期'])
export const WorldExpansionTransitionSchema = z.object({
  chapterNumber: z.number().int().positive(),
  purpose: z.string().min(1).max(1_000),
  changes: z.array(z.enum(['新增线索', '新增人物', '新增地点', '新增势力', '规则解释', '关系变化', '伏笔铺垫', '资源变化', '无变化'])).max(8).default([]),
  suggestion: z.string().max(2_000).default('')
})
export const WorldExpansionConflictSchema = z.object({
  kind: z.enum(['名称重复', '既有规则冲突', '正文尚无铺垫', '大纲引用缺失', '未知']),
  message: z.string().min(1).max(2_000),
  severity: z.enum(['高', '中', '低']),
  relatedChapterIds: z.array(z.string()).max(100).default([])
})
/**
 * 世界观扩展的因果推导链。它只记录“从新增设定到故事呈现”的可审阅中间结论，
 * 不会把推导内容自动写入世界观或正文。AI 生成的链条默认待确认，作者可以逐项修改。
 */
export const WorldCausalLayerSchema = z.enum(['底层规则', '社会影响', '人物与势力', '剧情呈现'])
export const WorldCausalLinkSchema = z.object({
  id: z.string(),
  layer: WorldCausalLayerSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2_000),
  sourceEntryIds: z.array(z.string()).max(100).default([]),
  status: z.enum(['待确认', '作者确认', '作者否决']).default('待确认')
})
/** 提案来源：手动暂存 / AI 建议 / 正文发现（D6）。 */
export const SettingProposalSourceSchema = z.enum(['手动暂存', 'AI 建议', '正文发现'])
/** 原文定位；没有原文依据时必须显式标为推测，不能冒充事实。 */
export const SettingProposalEvidenceSchema = z.object({
  chapterId: z.string().min(1).optional(),
  chapterNumber: z.number().int().positive().optional(),
  excerpt: z.string().max(1_000),
  inferred: z.boolean()
})

export const WorldExpansionProposalSchema = z.object({
  id: z.string(),
  source: SettingProposalSourceSchema.default('手动暂存'),
  evidence: SettingProposalEvidenceSchema.nullable().default(null), title: z.string().min(1).max(200), reason: z.string().min(1).max(2_000),
  baseRevision: z.number().int().nonnegative(), baseWorldDigest: z.string().min(1),
  proposedEntries: z.array(z.unknown()).max(100).default([]), sourceChapterIds: z.array(z.string()).max(100).default([]),
  plannedChapterNumbers: z.array(z.number().int().positive()).max(500).default([]),
  transitionPlan: z.array(WorldExpansionTransitionSchema).max(500).default([]),
  affectedChapterIds: z.array(z.string()).max(10_000).default([]), affectedOutlineChapterIds: z.array(z.string()).max(10_000).default([]),
  conflicts: z.array(WorldExpansionConflictSchema).max(500).default([]),
  /** 影响链和未决问题是解释材料，不是自动生效的正式设定。 */
  causalChain: z.array(WorldCausalLinkSchema).max(500).optional(),
  unresolvedQuestions: z.array(z.string().max(500)).max(100).optional(),
  affectedMemoryIds: z.array(z.string()).max(10_000).optional(),
  affectedThreadIds: z.array(z.string()).max(10_000).optional(),
  affectedStorylineIds: z.array(z.string()).max(10_000).optional(),
  impactSummary: z.string().min(1).max(4_000),
  status: WorldExpansionStatusSchema.default('待确认'), createdAt: z.string(), updatedAt: z.string()
})
/** 同名或高度相似的已有条目：只提示合并方向，绝不自动合并。 */
export const WorldSettingSimilaritySchema = z.object({
  entryId: z.string(), name: z.string(), type: z.string(), locked: z.boolean(),
  reason: z.enum(['同名', '别名相同', '名称相近'])
})

export const CreateWorldExpansionSchema = z.object({
  source: SettingProposalSourceSchema.default('手动暂存'),
  evidence: SettingProposalEvidenceSchema.nullable().default(null),
  title: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(2_000),
  proposedEntries: z.array(z.unknown()).min(1).max(100), sourceChapterIds: z.array(z.string()).max(100).default([]),
  plannedChapterNumbers: z.array(z.number().int().positive()).max(500).default([]),
  transitionPlan: z.array(WorldExpansionTransitionSchema).max(500).default([]),
  causalChain: z.array(WorldCausalLinkSchema).max(500).optional(),
  unresolvedQuestions: z.array(z.string().max(500)).max(100).optional()
})

export type SettingProposalSource = z.infer<typeof SettingProposalSourceSchema>
export type SettingProposalEvidence = z.infer<typeof SettingProposalEvidenceSchema>
export type WorldSettingSimilarity = z.infer<typeof WorldSettingSimilaritySchema>
export type WorldExpansionStatus = z.infer<typeof WorldExpansionStatusSchema>
export type WorldExpansionTransition = z.infer<typeof WorldExpansionTransitionSchema>
export type WorldExpansionConflict = z.infer<typeof WorldExpansionConflictSchema>
export type WorldCausalLayer = z.infer<typeof WorldCausalLayerSchema>
export type WorldCausalLink = z.infer<typeof WorldCausalLinkSchema>
export type WorldExpansionProposal = z.infer<typeof WorldExpansionProposalSchema>
export type CreateWorldExpansion = z.input<typeof CreateWorldExpansionSchema>
