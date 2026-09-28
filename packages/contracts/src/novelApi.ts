import { z } from 'zod'
import { MemoryPerspectiveSchema, MemoryProposalSchema, NovelCreationModeSchema, NovelMemorySourceSchema, NovelProjectSchema, NovelSettingsSchema, OutlineStructureEditRequestSchema, OutlineStructureImpactSchema, OutlineStructureOperationSchema, SceneQualityFindingSchema, StoryDirectionCardSchema, StyleProfileDraftSchema, WorldEntryTypeSchema, WorldQualityFindingSchema } from './novel'
import { WorldExpansionProposalSchema, type CreateWorldExpansion, type WorldExpansionProposal } from './novelWorldExpansion'
import { RollingOutlineWindowSchema } from './novelStoryline'
import { ProviderOutputCapabilitySchema, type ProviderConfigInput, type ProviderConfigPublic, type ProviderLongOutputTestInput, type ProviderLongOutputTestResult, type ProviderOutputTestRecord } from './provider'
import type { AnswerAssistantGuide, AssistantGuideDomain, AssistantGuideSession, StartAssistantGuide } from './assistantGuide'

export const CreateNovelInputSchema = z.object({ title: z.string().min(1).max(120), seed: z.string().min(1), settings: NovelSettingsSchema, creationMode: NovelCreationModeSchema.optional() })
export const SaveNovelRequestSchema = z.object({ document: NovelProjectSchema, baseRevision: z.number().int().nonnegative() })
export const NovelGenerationKindSchema = z.enum(['story-direction', 'writing-specs', 'world-foundation', 'world-section', 'world-constraint-extraction', 'world-audit', 'world-repair-suggestion', 'style-profile-extraction', 'outline-foundation', 'outline-volume', 'outline', 'scene-beats', 'chapter', 'chapter-revision', 'chapter-quality-audit', 'memory-extraction', 'memory-rebuild', 'continuity-audit', 'foreshadow-review', 'branch'])

export const CreateStyleProfileSchema = StyleProfileDraftSchema
export const UpdateStyleProfileSchema = StyleProfileDraftSchema.partial().refine((value) => Object.keys(value).length > 0, '请至少修改一项。')
export const StyleLearningJobStatusSchema = z.enum(['等待', '分析中', '待确认', '已应用', '失败'])
export const StyleLearningJobSchema = z.object({
  id: z.string(), status: StyleLearningJobStatusSchema, sourceName: z.string(), sourceDigest: z.string(), sourceCharacterCount: z.number().int().nonnegative(),
  requestedName: z.string(), providerId: z.string().optional(), candidate: StyleProfileDraftSchema.optional(), profileId: z.string().optional(),
  error: z.string().optional(), createdAt: z.string(), updatedAt: z.string()
})
export const ApplyStyleLearningJobSchema = z.object({ candidate: StyleProfileDraftSchema.optional() })
export const BindProjectStyleProfileSchema = z.object({ profileId: z.string().nullable() })
export const UpdateWorldExpansionSchema = WorldExpansionProposalSchema.pick({ title: true, reason: true, proposedEntries: true, sourceChapterIds: true, plannedChapterNumbers: true, transitionPlan: true, causalChain: true, unresolvedQuestions: true }).partial().refine((value) => Object.keys(value).length > 0, '请至少修改一项扩展内容。')
export const ApplyWorldExpansionSchema = z.object({ currentRevision: z.number().int().nonnegative(), allowRisk: z.boolean().default(false), reason: z.string().trim().max(1_000).optional() })
export const RollingOutlineWindowResponseSchema = z.object({ window: RollingOutlineWindowSchema, chapters: z.array(z.unknown()), beforeChapterIds: z.array(z.string()), afterChapterIds: z.array(z.string()), visibleStorylineIds: z.array(z.string()) })
export const NovelSearchResultSchema = z.object({ sourceId: z.string(), sourceType: z.string(), title: z.string(), body: z.string() })
export const NovelOrchestrationIntentSchema = z.enum(['章节创作', '长篇复核', '世界观审校', '大纲规划'])
export const NovelOrchestrationStepSchema = z.object({ id: z.string(), role: z.string(), title: z.string(), kind: NovelGenerationKindSchema, targetId: z.string().optional(), dependsOn: z.array(z.string()), status: z.enum(['可执行', '等待前置', '已满足', '需要作者确认']), reason: z.string(), evidence: z.array(z.string()), estimatedTokens: z.number().int().nonnegative() })
export const NovelOrchestrationPlanSchema = z.object({ id: z.string(), projectId: z.string(), intent: NovelOrchestrationIntentSchema, baseRevision: z.number().int().nonnegative(), localOnly: z.literal(true), policy: z.object({ maxParallel: z.number().int().min(1).max(3), requireHumanGate: z.literal(true), autoApply: z.literal(false) }), steps: z.array(NovelOrchestrationStepSchema), warnings: z.array(z.string()), createdAt: z.string() })
export const NovelOrchestrationPlanRequestSchema = z.object({ intent: NovelOrchestrationIntentSchema, chapterId: z.string().optional(), volumeNumber: z.number().int().positive().optional(), maxParallel: z.number().int().min(1).max(3).default(2) }).superRefine((value, context) => {
  if (value.intent === '章节创作' && !value.chapterId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['chapterId'], message: '章节创作必须指定章节。' })
  if (value.intent === '大纲规划' && !value.volumeNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['volumeNumber'], message: '大纲规划必须指定卷号。' })
})
export const NovelGenerationRequestSchema = z.object({
  kind: NovelGenerationKindSchema,
  baseRevision: z.number().int().nonnegative(),
  providerId: z.string().min(1).optional(),
  chapterId: z.string().optional(),
  volumeNumber: z.number().int().positive().optional(),
  branchId: z.string().optional(),
  proposalId: z.string().optional(),
  findingId: z.string().optional(),
  worldEntryType: WorldEntryTypeSchema.optional(),
  instruction: z.string().max(4_000).optional(),
  qualityProfile: z.enum(['economy', 'standard', 'detailed']).default('standard'),
  acknowledgedDraftPlanning: z.boolean().default(false),
  /** 作者明确确认继续使用已经过期、但尚未复核的规划。 */
  acknowledgedStalePlan: z.boolean().default(false)
}).superRefine((value, context) => {
  if (['scene-beats', 'chapter', 'chapter-revision', 'chapter-quality-audit', 'memory-extraction'].includes(value.kind) && !value.chapterId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['chapterId'], message: '该操作必须指定章节。' })
  if (value.kind === 'outline-volume' && !value.volumeNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['volumeNumber'], message: '生成卷内章纲必须指定卷号。' })
  if (value.kind === 'world-section' && !value.worldEntryType) context.addIssue({ code: z.ZodIssueCode.custom, path: ['worldEntryType'], message: '请指定世界观词条类型。' })
  if (value.kind === 'branch' && !value.branchId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['branchId'], message: '请指定剧情分支。' })
  if (value.kind === 'chapter-quality-audit' && !value.proposalId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['proposalId'], message: '章节质量审校必须指定章节候选。' })
})

/** AI 生成的故事方向只保存为待确认候选；应用前作者仍可逐项编辑。 */
export const StoryDirectionCandidateSchema = z.object({
  cards: z.array(StoryDirectionCardSchema).min(1).max(5),
  questions: z.array(z.string().max(500)).max(12).default([])
})
/** AI 只建议可推断的创作规格；用户的文风绑定和自动分析设置不在候选内。 */
export const WritingSpecsCandidateSchema = z.object({
  genreTemplate: z.enum(['通用', '玄幻修仙', '科幻', '历史架空', '都市', '悬疑']),
  targetWords: z.number().int().min(1_000).max(20_000_000),
  plannedVolumes: z.number().int().min(1).max(100),
  plannedChapters: z.number().int().min(1).max(10_000),
  pointOfView: z.enum(['第一人称', '第三人称限知', '第三人称全知', '多视角']),
  tense: z.enum(['过去时', '现在时', '混合']),
  audience: z.string().max(500),
  style: z.string().max(2_000),
  contentLimits: z.string().max(2_000),
  rhetoricIntensity: z.number().int().min(0).max(4)
})

/**
 * Context is assembled in five layers.  The layer is metadata for the
 * preview/audit ledger only; it is never injected as an instruction to the
 * model and therefore does not change the meaning of existing payloads.
 */
export const NovelMemoryLayerSchema = z.enum(['稳定事实', '动态状态', '剧情证据', '近期正文', '远期召回'])
export const NovelContextEntrySchema = z.object({
  id: z.string(), category: z.string(), title: z.string(), included: z.boolean(), reason: z.string(),
  authority: z.enum(['最高', '正式', '未确认', '参考']), estimatedTokens: z.number().int().nonnegative(), priority: z.number(), trimmed: z.boolean(),
  /** 五层记忆账本中的归属；旧任务没有此字段时仍可读取。 */
  layer: NovelMemoryLayerSchema.optional(),
  /** 供解释器跳转的证据；普通规格/规则条目可以为空。 */
  sourceRefs: z.array(NovelMemorySourceSchema).optional()
})
export const NovelContextLayerLedgerSchema = z.object({
  layer: NovelMemoryLayerSchema,
  title: z.string(),
  summary: z.string(),
  entries: z.array(NovelContextEntrySchema),
  includedCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative()
})
export const EntityMentionSchema = z.object({
  id: z.string(), projectId: z.string(), entryId: z.string(), entryName: z.string(), matchedText: z.string(),
  chapterId: z.string(), chapterNumber: z.number().int().positive(), blockId: z.string(), excerpt: z.string(), startOffset: z.number().int().nonnegative()
})
/**
 * 记忆召回的可解释记录。与生成上下文中的汇总条目不同，这个结构保留
 * 具体来源、事实视角和生效范围，供记忆面板解释“为什么召回了它”。
 */
export const NovelMemoryRecallSchema = z.object({
  memoryId: z.string(), itemId: z.string(), category: z.enum(['角色状态', '剧情事实']),
  perspective: MemoryPerspectiveSchema,
  source: NovelMemorySourceSchema, sourceChapterNumber: z.number().int().positive(),
  appliesFromChapter: z.number().int().positive(), appliesThroughChapter: z.number().int().positive().optional(),
  knownToCharacterIds: z.array(z.string()), item: z.unknown(), recallReason: z.string(),
  /** 状态与事实分别落在动态状态/剧情证据层，旧 API 结果默认为剧情证据。 */
  layer: NovelMemoryLayerSchema.default('剧情证据'),
  /** 记忆主体证据之外的认知证据；旧项目没有时为空数组。 */
  evidence: z.array(NovelMemorySourceSchema).default([])
})
export const NovelMemoryHealthSchema = z.object({
  pendingProposals: z.number().int().nonnegative(), staleMemories: z.number().int().nonnegative(), missingSummaries: z.number().int().nonnegative(),
  unresolvedThreads: z.number().int().nonnegative(), overdueThreads: z.number().int().nonnegative().default(0), unindexedChapters: z.number().int().nonnegative(), indexedMentions: z.number().int().nonnegative(),
  staleOutlineCards: z.number().int().nonnegative().default(0), pendingSceneQualityFindings: z.number().int().nonnegative().default(0),
  pendingWorldExpansions: z.number().int().nonnegative().default(0), storylineRisks: z.number().int().nonnegative().default(0),
  unresolvedReviews: z.number().int().nonnegative().default(0), activeJobs: z.number().int().nonnegative().default(0),
  failedJobs: z.number().int().nonnegative().default(0), recoverableJobs: z.number().int().nonnegative().default(0),
  lastFailureAt: z.string().optional(), lastSuccessAt: z.string().optional()
})
export const NovelGenerationEstimateSchema = z.object({ estimatedInputTokens: z.number().int().nonnegative(), estimatedOutputTokens: z.number().int().nonnegative(), contextWindow: z.number().int().positive(), warnings: z.array(z.string()), entries: z.array(NovelContextEntrySchema), layers: z.array(NovelContextLayerLedgerSchema).optional(), outputCapability: ProviderOutputCapabilitySchema.optional() })
export const NovelGenerationProgressSchema = z.object({ jobId: z.string(), projectId: z.string(), kind: NovelGenerationKindSchema, message: z.string(), progress: z.number().int().min(0).max(100) })
export const NovelGenerationJobStatusSchema = z.enum(['等待', '运行中', '待确认', '完成', '失败', '取消'])
export const NovelGenerationJobEventSchema = z.object({
  id: z.number().int().positive(), progress: z.number().int().min(0).max(100), message: z.string(), createdAt: z.string()
})
export const NovelGenerationJobErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() })
export const NovelGenerationJobSchema = z.object({
  id: z.string(), projectId: z.string(), kind: NovelGenerationKindSchema, status: NovelGenerationJobStatusSchema,
  progress: z.number().int().min(0).max(100), message: z.string(),
  estimatedInputTokens: z.number().int().nonnegative(), estimatedOutputTokens: z.number().int().nonnegative(),
  contextWindow: z.number().int().positive(), warnings: z.array(z.string()), contextEntries: z.array(NovelContextEntrySchema),
  proposalId: z.string().optional(), memoryProposalIds: z.array(z.string()), error: NovelGenerationJobErrorSchema.optional(),
  createdAt: z.string(), startedAt: z.string().optional(), endedAt: z.string().optional(), updatedAt: z.string(),
  request: NovelGenerationRequestSchema.optional(), resumable: z.boolean().optional(), resumeOfJobId: z.string().optional(), resumeCount: z.number().int().nonnegative().optional(),
  events: z.array(NovelGenerationJobEventSchema)
})
export const NovelRevisionProposalSchema = z.object({
  id: z.string(), projectId: z.string(), kind: NovelGenerationKindSchema, target: z.enum(['directionCards', 'settings', 'worldBible', 'outline', 'chapter', 'branch']), targetId: z.string().optional(),
  baseRevision: z.number().int().nonnegative(), summary: z.string(), candidate: z.unknown(), status: z.enum(['待处理', '已应用', '已拒绝', '已冲突']),
  qualityFindings: z.array(WorldQualityFindingSchema).optional(), sceneQualityFindings: z.array(SceneQualityFindingSchema).optional(),
  /** 结构调整候选的操作说明和影响摘要，正式应用仍走现有候选门禁。 */
  structureOperation: OutlineStructureOperationSchema.optional(), structureImpact: OutlineStructureImpactSchema.optional(), createdAt: z.string(),
  /**
   * 生成该候选的审稿问题稳定身份。应用候选只表示正文被修改，
   * 不会顺带把问题标记为完成；旧候选没有该字段时保持未关联。
   */
  reviewId: z.string().min(1).optional()
})
export const UpdateNovelRevisionSchema = z.object({ candidate: z.unknown() })
export const ApplyNovelRevisionSchema = z.object({
  currentRevision: z.number().int().nonnegative(), allowConflict: z.boolean().default(false), allowQualityConflict: z.boolean().default(false),
  qualityConflictReason: z.string().max(1_000).optional()
})
export const ResolveWorldQualityFindingSchema = z.object({ action: z.enum(['接受修复', '忽略']), replacement: z.string().max(20_000).optional() })
export const ResolveSceneQualityFindingSchema = z.object({
  action: z.enum(['接受修复', '忽略']), replacement: z.string().max(20_000).optional(), reason: z.string().trim().max(1_000).optional()
}).superRefine((value, context) => {
  if (value.action === '忽略' && !value.reason) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: '忽略场景质量问题时请说明原因。' })
})
export const ResolveMemoryProposalSchema = z.object({ status: z.enum(['已接受', '已拒绝']), currentRevision: z.number().int().nonnegative(), candidate: z.unknown().optional() })
/**
 * 记忆提案批量处理请求。批量语义是全成或全不成：任一决定失败时整批不写入，
 * 因此请求本身必须携带项目版本，且不允许对同一提案重复决定。
 */
export const MemoryProposalBatchResolveRequestSchema = z.object({
  currentRevision: z.number().int().nonnegative(),
  decisions: z.array(z.object({
    proposalId: z.string().min(1), status: z.enum(['已接受', '已拒绝']), candidate: z.unknown().optional()
  })).min(1).max(200)
}).superRefine((value, context) => {
  const seen = new Set<string>()
  value.decisions.forEach((decision, index) => {
    if (seen.has(decision.proposalId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['decisions', index, 'proposalId'], message: '同一批中不能重复决定同一个提案。' })
    seen.add(decision.proposalId)
  })
})
/**
 * 人工修订请求。它只创建待确认提案，绝不直接修改正式记忆；因此必须同时
 * 携带项目版本、来源正文摘要与目标正式值摘要，供接受前重新校验。
 */
export const ManualMemoryRevisionRequestSchema = z.object({
  currentRevision: z.number().int().nonnegative(),
  chapterId: z.string().min(1),
  category: z.enum(['章节摘要', '角色状态', '剧情事实', '关系变化', '知识变化', '道具状态', '时间事件', '伏笔']),
  targetId: z.string().min(1).optional(),
  baseTargetDigest: z.string().min(1),
  sourceDigest: z.string().min(1),
  candidate: z.unknown(),
  reason: z.string().trim().min(1).max(1_000)
}).superRefine((value, context) => {
  if (value.category !== '章节摘要' && !value.targetId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: '修订既有正式记忆时必须指定目标。' })
  }
})
export const ManualMemoryRevisionResultSchema = z.object({
  proposalId: z.string().min(1),
  status: z.literal('待确认'),
  /** 人工修订永远只生成提案，不存在直接写入正式记忆的路径。 */
  appliedToCanonical: z.literal(false)
})
export type ManualMemoryRevisionRequest = z.infer<typeof ManualMemoryRevisionRequestSchema>
export type ManualMemoryRevisionResult = z.infer<typeof ManualMemoryRevisionResultSchema>

/**
 * 真实导出格式；与 packages/core/src/novelImportExport.ts 的 exportNovel 保持一致。
 * 预检的错误码/警告码在 2026-09-14 追加了「存在缺失引用 / 空章节 / 未处理审稿问题」，
 * 都是向后兼容的枚举扩展：旧预检结果仍然合法，只是不会出现这些新码。
 */
export const NovelExportFormatSchema = z.enum(['docx', 'md', 'txt', 'json'])
export const ExportPrecheckBlockingCodeSchema = z.enum(['保存失败', '并发冲突', '项目结构损坏', '无可导出正文', '导出器失败', '存在缺失引用'])
export const ExportPrecheckWarningCodeSchema = z.enum(['高风险审稿问题', '草稿章节', '过期记忆', '逾期伏笔', '未应用候选', '空章节', '未处理审稿问题'])
/**
 * 导出前预检结果。它必须是本地确定性检查，绑定项目版本、目标格式与检查时间；
 * 项目内容、保存状态或目标格式变化后立即过期，界面不得继续显示“已就绪”。
 */
export const ExportPrecheckSchema = z.object({
  projectId: z.string().min(1),
  projectRevision: z.number().int().nonnegative(),
  format: NovelExportFormatSchema,
  checkedAt: z.string(),
  /** 预检永远不依赖 AI；出现其它来源即为非法状态。 */
  source: z.literal('本地预检'),
  blockers: z.array(z.object({ code: ExportPrecheckBlockingCodeSchema, message: z.string().min(1) })),
  warnings: z.array(z.object({ code: ExportPrecheckWarningCodeSchema, message: z.string().min(1), targetId: z.string().optional() }))
})
export const ExportPrecheckStateSchema = z.enum(['未检查', '已过期', '阻断', '可导出', '可导出含警告'])

/**
 * 纯确定性状态推导。JSON 完整备份只要能够安全序列化就始终允许导出，
 * 内容质量警告不会阻断它；DOCX/Markdown/TXT 的警告需要作者确认后再导出。
 */
export function exportPrecheckState(
  precheck: z.infer<typeof ExportPrecheckSchema> | undefined,
  context: { projectRevision: number; format: z.infer<typeof NovelExportFormatSchema> }
): z.infer<typeof ExportPrecheckStateSchema> {
  if (!precheck) return '未检查'
  if (precheck.projectRevision !== context.projectRevision || precheck.format !== context.format) return '已过期'
  if (precheck.blockers.length) return '阻断'
  if (precheck.format === 'json') return '可导出'
  return precheck.warnings.length ? '可导出含警告' : '可导出'
}

export function exportPrecheckAllowsExport(state: z.infer<typeof ExportPrecheckStateSchema>): boolean {
  return state === '可导出' || state === '可导出含警告'
}

/** 恢复前差异预览的覆盖范围；与项目内容面保持一致，避免只对比正文。 */
export const NovelVersionDiffScopeSchema = z.enum(['正文', '大纲', '世界观', '记忆', '伏笔', '审稿', '分支'])
export const NovelVersionDiffSummarySchema = z.object({
  scope: NovelVersionDiffScopeSchema,
  changed: z.number().int().nonnegative(), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative(),
  /** 面向作者的真实变化样例；不得包含演示文本。 */
  sample: z.array(z.string().max(500)).max(20)
})
/**
 * 受控事务恢复的差异预览。恢复请求必须携带本次预览摘要与当前 revision，
 * 任一内容变化即拒绝恢复并要求重新预览；恢复前会自动保存当前稿并创建安全快照。
 */
export const NovelVersionRestorePreviewSchema = z.object({
  projectId: z.string().min(1), versionId: z.string().min(1),
  targetRevision: z.number().int().nonnegative(), currentRevision: z.number().int().nonnegative(),
  previewDigest: z.string().min(1), createdAt: z.string(),
  diffs: z.array(NovelVersionDiffSummarySchema)
})
export const NovelVersionRestoreRequestSchema = z.object({
  currentRevision: z.number().int().nonnegative(),
  previewDigest: z.string().min(1)
})
export const VersionRestoreStateSchema = z.enum(['可恢复', '预览已过期', '预览缺失', '当前稿未保存'])

/**
 * 纯确定性判定：缺少预览、预览过期或当前稿未保存时一律不允许直接恢复。
 */
export function versionRestoreState(
  preview: z.infer<typeof NovelVersionRestorePreviewSchema> | undefined,
  request: z.infer<typeof NovelVersionRestoreRequestSchema> | undefined,
  current: { revision: number; hasUnsavedDraft: boolean }
): z.infer<typeof VersionRestoreStateSchema> {
  if (!preview || !request) return '预览缺失'
  if (request.currentRevision !== current.revision || preview.currentRevision !== current.revision) return '预览已过期'
  if (request.previewDigest !== preview.previewDigest) return '预览已过期'
  if (current.hasUnsavedDraft) return '当前稿未保存'
  return '可恢复'
}

export type CreateNovelInput = z.input<typeof CreateNovelInputSchema>
export type StyleLearningJob = z.infer<typeof StyleLearningJobSchema>
export type NovelGenerationKind = z.infer<typeof NovelGenerationKindSchema>
export type NovelOrchestrationIntent = z.infer<typeof NovelOrchestrationIntentSchema>
export type NovelOrchestrationStep = z.infer<typeof NovelOrchestrationStepSchema>
export type NovelOrchestrationPlan = z.infer<typeof NovelOrchestrationPlanSchema>
export type NovelOrchestrationPlanRequest = z.infer<typeof NovelOrchestrationPlanRequestSchema>
export type NovelGenerationRequest = z.input<typeof NovelGenerationRequestSchema>
export type StoryDirectionCandidate = z.infer<typeof StoryDirectionCandidateSchema>
export type WritingSpecsCandidate = z.infer<typeof WritingSpecsCandidateSchema>
export type RollingOutlineWindowResponse = z.infer<typeof RollingOutlineWindowResponseSchema>
export type NovelSearchResult = z.infer<typeof NovelSearchResultSchema>
export type NovelMemoryLayer = z.infer<typeof NovelMemoryLayerSchema>
export type NovelGenerationEstimate = z.infer<typeof NovelGenerationEstimateSchema>
export type NovelContextEntry = z.infer<typeof NovelContextEntrySchema>
export type NovelContextLayerLedger = z.infer<typeof NovelContextLayerLedgerSchema>
export type EntityMention = z.infer<typeof EntityMentionSchema>
export type NovelMemoryRecall = z.infer<typeof NovelMemoryRecallSchema>
export type NovelMemoryHealth = z.infer<typeof NovelMemoryHealthSchema>
export type NovelGenerationProgress = z.infer<typeof NovelGenerationProgressSchema>
export type NovelGenerationJobStatus = z.infer<typeof NovelGenerationJobStatusSchema>
export type NovelGenerationJobEvent = z.infer<typeof NovelGenerationJobEventSchema>
export type NovelGenerationJobError = z.infer<typeof NovelGenerationJobErrorSchema>
export type NovelGenerationJob = z.infer<typeof NovelGenerationJobSchema>
export type NovelRevisionProposal = z.infer<typeof NovelRevisionProposalSchema>
export type OutlineStructurePreviewResponse = { proposal: NovelRevisionProposal; impact: z.infer<typeof OutlineStructureImpactSchema> }
export type NovelGenerationEvent =
  | { type: 'progress'; progress: NovelGenerationProgress }
  | { type: 'completed'; proposalId?: string; memoryProposalIds?: string[] }
  | { type: 'failed'; error: { code: string; message: string; retryable: boolean } }
  | { type: 'canceled' }

export interface MojingClient {
  novels: {
    list(): Promise<import('./novel').NovelProjectSummary[]>
    create(input: CreateNovelInput): Promise<import('./novel').NovelProject>
    duplicate?(projectId: string): Promise<import('./novel').NovelProject>
    archive?(projectId: string, archived: boolean): Promise<import('./novel').NovelProject>
    search?(projectId: string, query: string, limit?: number): Promise<NovelSearchResult[]>
    importFile(file: File): Promise<import('./novel').NovelProject>
    get(id: string): Promise<import('./novel').NovelProject>
    save(document: import('./novel').NovelProject, baseRevision: number): Promise<import('./novel').NovelProject>
    remove(id: string): Promise<void>
    /** 可选能力：大纲结构编辑预览。 */
    outlineStructure?: {
      preview(projectId: string, input: z.input<typeof OutlineStructureEditRequestSchema>): Promise<OutlineStructurePreviewResponse>
    },
    /** 可选能力：世界扩写提案的列表、预览、应用与驳回。 */
    worldExpansions?: {
      list(projectId: string): Promise<WorldExpansionProposal[]>
      preview(projectId: string, input: CreateWorldExpansion): Promise<WorldExpansionProposal>
      update(projectId: string, expansionId: string, input: z.input<typeof UpdateWorldExpansionSchema>): Promise<WorldExpansionProposal>
      apply(projectId: string, expansionId: string, input: z.input<typeof ApplyWorldExpansionSchema>): Promise<import('./novel').NovelProject>
      reject(projectId: string, expansionId: string): Promise<WorldExpansionProposal>
    },
    /** 可选能力：滚动大纲窗口。 */
    rollingOutline?(projectId: string, chapterNumber: number, windowSize?: number): Promise<RollingOutlineWindowResponse>
  }
  generations: {
    estimate(projectId: string, request: NovelGenerationRequest): Promise<NovelGenerationEstimate>
    start(projectId: string, request: NovelGenerationRequest): Promise<{ jobId: string }>
    list(projectId: string): Promise<NovelGenerationJob[]>
    get(jobId: string): Promise<NovelGenerationJob>
    recoverable(projectId: string): Promise<NovelGenerationJob[]>
    resume(jobId: string): Promise<{ jobId: string; resumedFromJobId: string }>
    subscribe(jobId: string, callback: (event: NovelGenerationEvent) => void): () => void
    cancel(jobId: string): Promise<void>
  }
  providers: {
    list(): Promise<ProviderConfigPublic[]>
    save(input: ProviderConfigInput): Promise<ProviderConfigPublic>
    test(input: ProviderConfigInput): Promise<{ ok: boolean; message: string; latencyMs?: number }>
    /** 可选能力：长文本输出压力测试。 */
    testLongOutput?(input: ProviderLongOutputTestInput): Promise<ProviderLongOutputTestResult>
    /** 可选能力：读取历史输出测试记录。 */
    outputTests?(providerId?: string, limit?: number): Promise<ProviderOutputTestRecord[]>
  }
  revisions: {
    list(projectId: string): Promise<NovelRevisionProposal[]>
    update(id: string, candidate: unknown): Promise<NovelRevisionProposal>
    apply(id: string, currentRevision: number, allowConflict?: boolean, allowQualityConflict?: boolean): Promise<import('./novel').NovelProject>
    resolveQuality(id: string, findingId: string, action: '接受修复' | '忽略', replacement?: string): Promise<NovelRevisionProposal>
    reject(id: string): Promise<void>
  }
  memory: {
    list(projectId: string): Promise<z.infer<typeof MemoryProposalSchema>[]>
    resolve(id: string, status: '已接受' | '已拒绝', currentRevision: number, candidate?: unknown): Promise<import('./novel').NovelProject>
    health(projectId: string): Promise<NovelMemoryHealth>
    /** 可选能力：查询指定章节实际召回的记忆及其来源与原因。 */
    recall?(projectId: string, chapterNumber: number, characterIds?: string[]): Promise<NovelMemoryRecall[]>
    /** 可选能力：读取生成前五层上下文账本（包含纳入/排除及预算说明）。 */
    contextLedger?(projectId: string, chapterId?: string, tokenBudget?: number, includeWritingStyle?: boolean): Promise<NovelContextLayerLedger[]>
  }
  mentions: {
    list(projectId: string, entryId?: string): Promise<EntityMention[]>
  }
  creativeChat: {
    list(projectId: string, stage?: import('./creativeChat').CreativeChatStage): Promise<import('./creativeChat').CreativeConversation[]>
    messages(projectId: string, conversationId: string): Promise<import('./creativeChat').CreativeChatMessage[]>
    send(projectId: string, input: import('./creativeChat').CreativeChatSend): Promise<import('./creativeChat').CreativeChatResponse>
    remove(projectId: string, conversationId: string): Promise<void>
  }
  assistantGuides?: {
    current(projectId: string, domain: AssistantGuideDomain, scopeKey: string): Promise<AssistantGuideSession | null>
    start(projectId: string, input: StartAssistantGuide): Promise<AssistantGuideSession>
    answer(projectId: string, sessionId: string, input: AnswerAssistantGuide): Promise<AssistantGuideSession>
    reanalyze(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession>
    complete(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession>
    restart(projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession>
  }
}
