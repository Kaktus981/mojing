import { z } from 'zod'

export const ProjectSettingsSchema = z.object({
  episodeCount: z.number().int().min(1).max(60),
  episodeDurationSec: z.number().int().min(60).max(300),
  shotCount: z.number().int().min(8).max(40),
  aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  genre: z.string().max(80),
  audience: z.string().max(500),
  style: z.string().max(1000),
  pace: z.enum(['舒缓', '均衡', '紧凑', '高能']),
  contentLimits: z.string().max(1000),
  language: z.string().max(40),
  aiBudget: z.number().min(0).optional()
})

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>

export const AnalysisSchema = z.object({
  genre: z.string(),
  themes: z.array(z.string()),
  targetAudience: z.string(),
  coreConflict: z.string(),
  adaptationPotential: z.string(),
  strengths: z.array(z.string()),
  missingInformation: z.array(z.string()),
  risks: z.array(z.string())
})

export const StoryBibleSchema = z.object({
  premise: z.string(),
  logline: z.string(),
  worldRules: z.array(z.string()),
  themes: z.array(z.string()),
  tone: z.string(),
  visualStyle: z.string(),
  seasonArc: z.string(),
  continuityFacts: z.array(z.string())
})

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  identity: z.string(),
  appearance: z.string(),
  personality: z.string(),
  goal: z.string(),
  weakness: z.string(),
  secret: z.string(),
  speechStyle: z.string(),
  characterArc: z.string(),
  visualPrompt: z.string()
})

export const RelationshipSchema = z.object({
  id: z.string(),
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  relation: z.string(),
  tension: z.string()
})

export const EpisodeCardSchema = z.object({
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  objective: z.string(),
  mainConflict: z.string(),
  turningPoint: z.string(),
  endingHook: z.string(),
  continuitySetup: z.array(z.string()),
  continuityPayoff: z.array(z.string())
})

export const SeriesOutlineSchema = z.object({
  title: z.string(),
  seasonArc: z.string(),
  phaseBreaks: z.array(z.string()),
  episodes: z.array(EpisodeCardSchema)
})

export const EpisodeStructureStatusSchema = z.enum(['未规划', '已规划', '草稿', '待审校', '记忆未同步', '定稿'])

export const StoryMapCardSchema = z.object({
  id: z.string(),
  laneId: z.string(),
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  objective: z.string(),
  conflict: z.string(),
  turningPoint: z.string(),
  characterState: z.string(),
  endingHook: z.string(),
  targetId: z.string().optional(),
  status: EpisodeStructureStatusSchema
})

export const PlotlineLaneSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['主线', '支线', '人物弧光', '感情线', '伏笔线', '自定义']),
  color: z.string(),
  order: z.number().int().nonnegative(),
  cards: z.array(StoryMapCardSchema)
})

export const StoryMapLinkSchema = z.object({
  id: z.string(),
  fromCardId: z.string(),
  toCardId: z.string(),
  relation: z.enum(['因果', '推进', '回收', '冲突', '呼应']),
  note: z.string()
})

export const StoryMapSchema = z.object({
  lanes: z.array(PlotlineLaneSchema),
  links: z.array(StoryMapLinkSchema),
  updatedAt: z.string()
})

export const KnowledgeHolderStateSchema = z.object({
  holderId: z.string(),
  holderName: z.string(),
  state: z.enum(['不知道', '怀疑', '知道', '误解']),
  learnedEpisode: z.number().int().positive().optional(),
  note: z.string()
})

export const KnowledgeItemSchema = z.object({
  id: z.string(),
  information: z.string(),
  revealEpisode: z.number().int().positive().optional(),
  evidence: z.array(z.string()),
  holders: z.array(KnowledgeHolderStateSchema),
  locked: z.boolean().default(false)
})

export const EpisodeDependencySchema = z.object({
  id: z.string(),
  episodeNumber: z.number().int().positive(),
  dependsOnEpisodeNumber: z.number().int().positive(),
  type: z.enum(['顺序承接', '倒叙来源', '平行视角', '因果依赖', '伏笔回收']),
  note: z.string(),
  locked: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.episodeNumber === value.dependsOnEpisodeNumber) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dependsOnEpisodeNumber'], message: '分集不能依赖自身。' })
  }
})

export const AiVisibilityRuleSchema = z.object({
  id: z.string(),
  targetType: z.enum(['角色字段', '剧情事实', '信息揭露', '伏笔']),
  targetId: z.string(),
  field: z.string().optional(),
  label: z.string(),
  policy: z.enum(['始终可见', '指定集数后可见', '永不发送', '仅审校可见']),
  visibleFromEpisode: z.number().int().positive().optional(),
  note: z.string(),
  locked: z.boolean().default(false)
}).superRefine((value, context) => {
  if (value.policy === '指定集数后可见' && !value.visibleFromEpisode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['visibleFromEpisode'], message: '请填写开始对 AI 可见的集数。' })
  }
})

export const DialogueAlternativeSchema = z.object({
  id: z.string(),
  label: z.enum(['原版', '口语版', '强冲突版', '含蓄版', '自定义']),
  text: z.string(),
  createdBy: z.enum(['用户', 'AI']),
  createdAt: z.string()
})

export const DialogueSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  characterName: z.string(),
  type: z.enum(['对白', '旁白', '画外音', '内心独白']),
  text: z.string(),
  subtext: z.string(),
  alternatives: z.array(DialogueAlternativeSchema).nullable().optional(),
  activeAlternativeId: z.string().nullable().optional()
})

export const ShotSchema = z.object({
  id: z.string(),
  shotNumber: z.number().int().positive(),
  durationSec: z.number().min(0.5).max(60),
  shotSize: z.string(),
  cameraAngle: z.string(),
  cameraMovement: z.string(),
  composition: z.string(),
  action: z.string(),
  dialogues: z.array(DialogueSchema),
  soundEffect: z.string(),
  bgm: z.string(),
  transition: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  negativePrompt: z.string(),
  continuityRefs: z.array(z.string())
})

export const SceneSchema = z.object({
  id: z.string(),
  sceneNumber: z.number().int().positive(),
  heading: z.string(),
  location: z.string(),
  timeOfDay: z.string(),
  purpose: z.string(),
  characterIds: z.array(z.string()),
  shots: z.array(ShotSchema)
})

export const EpisodeScriptSchema = z.object({
  id: z.string(),
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  logline: z.string(),
  openingHook: z.string(),
  beats: z.array(z.string()),
  scenes: z.array(SceneSchema),
  endingHook: z.string(),
  status: z.enum(['草稿', '定稿'])
})

export const StoryBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  baseEpisodeNumber: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  episodes: z.array(EpisodeScriptSchema),
  status: z.enum(['构思中', '可比较', '已采用', '已归档']),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const MemorySyncTaskSchema = z.object({
  id: z.string(),
  episodeNumber: z.number().int().positive(),
  reason: z.string(),
  sourceRevision: z.number().int().nonnegative(),
  status: z.enum(['待处理', '已忽略']),
  createdAt: z.string()
})

export const ContentSyncSourceSchema = z.enum(['settings', 'storyBible', 'characters', 'relationships', 'seriesOutline'])
export const ContentSyncTargetSchema = z.enum(['storyBible', 'characters', 'outline', 'episodes'])
export const ContentSyncTaskSchema = z.object({
  id: z.string(),
  source: ContentSyncSourceSchema,
  label: z.string(),
  reason: z.string(),
  suggestedTargets: z.array(ContentSyncTargetSchema),
  status: z.enum(['待处理', '已忽略', '已完成']),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const ProductionAssetSchema = z.object({
  id: z.string(),
  type: z.enum(['角色', '地点', '道具', '服装', '表情', '特殊动作', '光线', '音效', '背景音乐', '可复用背景']),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  occurrences: z.array(z.object({
    episodeNumber: z.number().int().positive(),
    sceneId: z.string().optional(),
    shotId: z.string().optional()
  })),
  status: z.enum(['待整理', '已确认', '需更新']),
  reusable: z.boolean()
})

export const ProductionDifficultyReportSchema = z.object({
  episodeNumber: z.number().int().positive(),
  level: z.enum(['简单', '一般', '复杂', '极难']),
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()),
  reusableAssets: z.array(z.string()),
  suggestions: z.array(z.string()),
  updatedAt: z.string()
})

export const ImageProviderKindSchema = z.enum(['openai', 'comfyui'])
export const ImageTaskStatusSchema = z.enum(['等待', '准备中', '生成中', '完成', '失败', '已取消'])
export const ImageCandidateStatusSchema = z.enum(['候选', '当前版本', '已拒绝', '已删除'])

export const VisualAssetReferenceSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  type: z.enum(['角色', '地点', '道具', '服装']),
  label: z.string(),
  relativePath: z.string().optional(),
  locked: z.boolean().default(false),
  createdAt: z.string()
})

export const ImageCandidateSchema = z.object({
  id: z.string(),
  targetType: z.enum(['角色', '地点', '道具', '镜头']),
  targetId: z.string(),
  projectId: z.string(),
  episodeNumber: z.number().int().positive().optional(),
  prompt: z.string(),
  negativePrompt: z.string(),
  providerId: z.string(),
  model: z.string(),
  width: z.number().int().min(256).max(4096),
  height: z.number().int().min(256).max(4096),
  seed: z.number().int().nonnegative().optional(),
  referenceAssetIds: z.array(z.string()),
  relativePath: z.string().optional(),
  status: ImageCandidateStatusSchema,
  createdAt: z.string()
})

export const MemorySourceSchema = z.object({
  episodeNumber: z.number().int().positive(),
  sceneId: z.string().optional(),
  shotId: z.string().optional()
})

export const CharacterStateChangeSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  characterName: z.string(),
  location: z.string(),
  goal: z.string(),
  emotion: z.string(),
  physicalState: z.string(),
  costume: z.string().default(''),
  knowledge: z.array(z.string()),
  relationshipChanges: z.array(z.string()),
  effectiveFromEpisode: z.number().int().positive().optional(),
  effectiveUntilEpisode: z.number().int().positive().optional(),
  source: MemorySourceSchema
}).superRefine((value, context) => {
  if (value.effectiveUntilEpisode && value.effectiveFromEpisode && value.effectiveUntilEpisode < value.effectiveFromEpisode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveUntilEpisode'], message: '状态结束集数不能早于开始集数。' })
  }
})

export const ObjectStateChangeSchema = z.object({
  id: z.string(),
  name: z.string(),
  holder: z.string(),
  location: z.string(),
  state: z.string(),
  source: MemorySourceSchema
})

export const MemoryFactSchema = z.object({
  id: z.string(),
  category: z.enum(['事件', '角色', '道具', '关系', '秘密', '时间线', '世界规则']),
  content: z.string(),
  certainty: z.enum(['正式', '未决', '推测', '废弃']).default('正式'),
  validFromEpisode: z.number().int().positive().optional(),
  validUntilEpisode: z.number().int().positive().optional(),
  locked: z.boolean().default(false),
  source: MemorySourceSchema
}).superRefine((value, context) => {
  if (value.validUntilEpisode && value.validFromEpisode && value.validUntilEpisode < value.validFromEpisode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntilEpisode'], message: '事实失效集数不能早于生效集数。' })
  }
})

export const PlotThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(['伏笔', '悬念', '秘密', '冲突']),
  status: z.enum(['新建', '推进', '已回收', '已废弃']),
  detail: z.string(),
  setupEpisode: z.number().int().positive(),
  lastProgressEpisode: z.number().int().positive(),
  targetPayoffEpisode: z.number().int().positive().optional(),
  resolutionEpisode: z.number().int().positive().optional(),
  source: MemorySourceSchema
})

export const EpisodeMemorySchema = z.object({
  id: z.string(),
  episodeNumber: z.number().int().positive(),
  status: z.enum(['草稿', '正式', '需更新', '待复核']),
  sourceDigest: z.string(),
  summary: z.string(),
  openingState: z.string(),
  endingState: z.string(),
  keyEvents: z.array(z.string()),
  characterChanges: z.array(CharacterStateChangeSchema),
  objectChanges: z.array(ObjectStateChangeSchema),
  facts: z.array(MemoryFactSchema),
  plotThreads: z.array(PlotThreadSchema),
  createdAt: z.string(),
  confirmedAt: z.string().optional()
})

export const ProjectMemorySchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  episodes: z.array(EpisodeMemorySchema),
  updatedAt: z.string()
})

export const ContinuityEvidenceSchema = z.object({
  label: z.string(),
  excerpt: z.string(),
  source: MemorySourceSchema
})

export const ContinuityAuditFindingSchema = z.object({
  id: z.string(),
  category: z.enum(['人物记忆', '角色知识', '能力状态', '外貌细节', '名称数量', '叙事风格', '时间因果', '世界规则', '道具归属', '剧情依赖']),
  severity: z.enum(['高', '中', '低']),
  title: z.string(),
  description: z.string(),
  evidences: z.array(ContinuityEvidenceSchema).min(1),
  recommendation: z.string(),
  checkType: z.enum(['本地规则', 'AI语义审查']),
  status: z.enum(['待处理', '已完成', '已忽略']).default('待处理')
})

export const ContinuityAuditLedgerSchema = z.object({
  characterStates: z.array(z.string()),
  knowledgeStates: z.array(z.string()),
  objectStates: z.array(z.string()),
  timelineFacts: z.array(z.string()),
  openThreads: z.array(z.string())
})

export const ContinuityAuditReportSchema = z.object({
  id: z.string(),
  fromEpisode: z.number().int().positive(),
  toEpisode: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  status: z.enum(['运行中', '已暂停', '已完成', '需复核', '失败']),
  lastCompletedEpisode: z.number().int().nonnegative(),
  findings: z.array(ContinuityAuditFindingSchema),
  ledger: ContinuityAuditLedgerSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})

export const SuggestionSchema = z.object({
  id: z.string(),
  episodeNumber: z.number().int().positive().optional(),
  category: z.enum(['逻辑', '节奏', '角色', '对白', '视觉', '连续性', '追更钩子']),
  severity: z.enum(['高', '中', '低']),
  targetId: z.string(),
  term: z.string(),
  evidence: z.string(),
  rationale: z.string(),
  recommendation: z.string(),
  expectedEffect: z.string(),
  createdAt: z.string(),
  status: z.enum(['待处理', '已完成']).optional(),
  completedAt: z.string().optional()
})

export const ProjectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string().min(1).max(120),
  sourceText: z.string().min(1),
  sourceKind: z.enum(['idea', 'imported-script']).default('idea'),
  sourceFileName: z.string().optional(),
  settings: ProjectSettingsSchema,
  status: z.enum(['待分析', '设定完成', '创作中', '已完成']),
  revision: z.number().int().nonnegative(),
  analysis: AnalysisSchema.optional(),
  storyBible: StoryBibleSchema.optional(),
  characters: z.array(CharacterSchema),
  relationships: z.array(RelationshipSchema),
  seriesOutline: SeriesOutlineSchema.optional(),
  episodes: z.array(EpisodeScriptSchema).superRefine((episodes, context) => {
    const seen = new Set<number>()
    episodes.forEach((episode, index) => {
      if (seen.has(episode.episodeNumber)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'episodeNumber'], message: `第 ${episode.episodeNumber} 集重复，禁止覆盖已有分集。` })
      }
      seen.add(episode.episodeNumber)
    })
  }),
  projectMemory: ProjectMemorySchema.optional(),
  episodeDependencies: z.array(EpisodeDependencySchema).optional(),
  aiVisibilityRules: z.array(AiVisibilityRuleSchema).optional(),
  continuityAudits: z.array(ContinuityAuditReportSchema).optional(),
  storyMap: StoryMapSchema.optional(),
  knowledgeItems: z.array(KnowledgeItemSchema).optional(),
  branches: z.array(StoryBranchSchema).optional(),
  memorySyncTasks: z.array(MemorySyncTaskSchema).optional(),
  contentSyncTasks: z.array(ContentSyncTaskSchema).optional(),
  productionAssets: z.array(ProductionAssetSchema).optional(),
  productionDifficulty: z.array(ProductionDifficultyReportSchema).optional(),
  visualAssetReferences: z.array(VisualAssetReferenceSchema).optional(),
  imageCandidates: z.array(ImageCandidateSchema).optional(),
  suggestions: z.array(SuggestionSchema),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const ProjectSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: ProjectDocumentSchema.shape.status,
  episodeCount: z.number(),
  updatedAt: z.string(),
  finalizedEpisodeCount: z.number().int().nonnegative().default(0),
  highSuggestionCount: z.number().int().nonnegative().default(0)
})

/**
 * 注意：本文件与 `provider.ts` 各有一份 `ProviderConfigInputSchema`，两份必须保持一致。
 *
 * 服务端路由（apps/api/src/mojingServer.ts）与核心的 `ProviderService` 用的是不同的那一份；
 * z.object() 默认会**丢弃未声明的键**，所以只要其中一份漏写字段，该字段就会在到达业务逻辑前
 * 被静默丢掉（输出上限的 `maxOutputTokens` / `outputTokenParameter` 就是这样丢过一次）。
 * 双定义本身是历史遗留、待收口，这里先按「字段一致」补齐。
 */
export const ProviderConfigInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string().min(1).max(120),
  contextWindow: z.number().int().min(4096).max(2000000),
  maxOutputTokens: z.number().int().min(256).max(200_000).optional(),
  outputTokenParameter: z.enum(['auto', 'max_completion_tokens', 'max_tokens']).optional(),
  supportsStreaming: z.boolean(),
  supportsJsonSchema: z.boolean(),
  inputPricePerMillion: z.number().min(0).optional(),
  outputPricePerMillion: z.number().min(0).optional(),
  currency: z.enum(['CNY', 'USD']).default('CNY'),
  showCost: z.boolean().default(true),
  singleCallWarning: z.number().min(0).optional()
})

export const ProviderConfigPublicSchema = ProviderConfigInputSchema.omit({ apiKey: true }).extend({
  id: z.string(),
  hasApiKey: z.boolean()
})

export const VersionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  revision: z.number().int(),
  reason: z.string(),
  source: z.enum(['手动检查点', 'AI生成', 'AI改稿', '恢复版本', '定稿']),
  createdAt: z.string()
})

export const PatchOperationSchema = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string(),
  from: z.string().optional(),
  value: z.unknown().optional()
})

export const AnalysisCategorySchema = z.enum([
  'coreConflict',
  'adaptationPotential',
  'themes',
  'strengths',
  'missingInformation',
  'risks'
])

export const AnalysisRevisionTargetSchema = z.enum(['storyBible', 'characters', 'outline', 'episodes'])

export const AnalysisRevisionMetaSchema = z.object({
  category: AnalysisCategorySchema,
  mode: z.enum(['primary', 'sync']),
  targets: z.array(AnalysisRevisionTargetSchema).min(1),
  episodeNumbers: z.array(z.number().int().positive()).optional()
})

export const ContentSyncMetaSchema = z.object({
  taskId: z.string(),
  source: ContentSyncSourceSchema,
  targets: z.array(ContentSyncTargetSchema).min(1),
  episodeNumbers: z.array(z.number().int().positive()).optional()
})

export const RevisionProposalSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  episodeNumber: z.number().int().positive(),
  scope: z.string(),
  instruction: z.string(),
  sourceSuggestionId: z.string().optional(),
  baseRevision: z.number().int().nonnegative(),
  operations: z.array(PatchOperationSchema),
  summary: z.string(),
  suggestions: z.array(SuggestionSchema),
  analysisRevision: AnalysisRevisionMetaSchema.optional(),
  contentSync: ContentSyncMetaSchema.optional(),
  status: z.enum(['待处理', '已应用', '已放弃', '已冲突']),
  createdAt: z.string()
})

export const AiUsageRecordSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  episodeNumber: z.number().int().positive().optional(),
  providerId: z.string(),
  model: z.string(),
  operation: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative().optional(),
  currency: z.enum(['CNY', 'USD']),
  status: z.enum(['成功', '失败', '取消']),
  retryCount: z.number().int().nonnegative(),
  costKnown: z.boolean(),
  createdAt: z.string()
})

export type Analysis = z.infer<typeof AnalysisSchema>
export type StoryBible = z.infer<typeof StoryBibleSchema>
export type Character = z.infer<typeof CharacterSchema>
export type Relationship = z.infer<typeof RelationshipSchema>
export type EpisodeCard = z.infer<typeof EpisodeCardSchema>
export type SeriesOutline = z.infer<typeof SeriesOutlineSchema>
export type EpisodeStructureStatus = z.infer<typeof EpisodeStructureStatusSchema>
export type StoryMapCard = z.infer<typeof StoryMapCardSchema>
export type PlotlineLane = z.infer<typeof PlotlineLaneSchema>
export type StoryMapLink = z.infer<typeof StoryMapLinkSchema>
export type StoryMap = z.infer<typeof StoryMapSchema>
export type KnowledgeHolderState = z.infer<typeof KnowledgeHolderStateSchema>
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>
export type EpisodeDependency = z.infer<typeof EpisodeDependencySchema>
export type AiVisibilityRule = z.infer<typeof AiVisibilityRuleSchema>
export type DialogueAlternative = z.infer<typeof DialogueAlternativeSchema>
export type Dialogue = z.infer<typeof DialogueSchema>
export type Shot = z.infer<typeof ShotSchema>
export type Scene = z.infer<typeof SceneSchema>
export type EpisodeScript = z.infer<typeof EpisodeScriptSchema>
export type StoryBranch = z.infer<typeof StoryBranchSchema>
export type MemorySyncTask = z.infer<typeof MemorySyncTaskSchema>
export type ContentSyncSource = z.infer<typeof ContentSyncSourceSchema>
export type ContentSyncTarget = z.infer<typeof ContentSyncTargetSchema>
export type ContentSyncTask = z.infer<typeof ContentSyncTaskSchema>
export type ProductionAsset = z.infer<typeof ProductionAssetSchema>
export type ProductionDifficultyReport = z.infer<typeof ProductionDifficultyReportSchema>
export type ImageProviderKind = z.infer<typeof ImageProviderKindSchema>
export type ImageTaskStatus = z.infer<typeof ImageTaskStatusSchema>
export type ImageCandidateStatus = z.infer<typeof ImageCandidateStatusSchema>
export type VisualAssetReference = z.infer<typeof VisualAssetReferenceSchema>
export type ImageCandidate = z.infer<typeof ImageCandidateSchema>
export type MemorySource = z.infer<typeof MemorySourceSchema>
export type CharacterStateChange = z.infer<typeof CharacterStateChangeSchema>
export type ObjectStateChange = z.infer<typeof ObjectStateChangeSchema>
export type MemoryFact = z.infer<typeof MemoryFactSchema>
export type PlotThread = z.infer<typeof PlotThreadSchema>
export type EpisodeMemory = z.infer<typeof EpisodeMemorySchema>
export type ProjectMemory = z.infer<typeof ProjectMemorySchema>
export type ContinuityEvidence = z.infer<typeof ContinuityEvidenceSchema>
export type ContinuityAuditFinding = z.infer<typeof ContinuityAuditFindingSchema>
export type ContinuityAuditLedger = z.infer<typeof ContinuityAuditLedgerSchema>
export type ContinuityAuditReport = z.infer<typeof ContinuityAuditReportSchema>
export type Suggestion = z.infer<typeof SuggestionSchema>
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ProviderConfigInput = z.infer<typeof ProviderConfigInputSchema>
export type ProviderConfigPublic = z.infer<typeof ProviderConfigPublicSchema>
export type VersionSummary = z.infer<typeof VersionSummarySchema>
export type PatchOperation = z.infer<typeof PatchOperationSchema>
export type AnalysisCategory = z.infer<typeof AnalysisCategorySchema>
export type AnalysisRevisionTarget = z.infer<typeof AnalysisRevisionTargetSchema>
export type AnalysisRevisionMeta = z.infer<typeof AnalysisRevisionMetaSchema>
export type ContentSyncMeta = z.infer<typeof ContentSyncMetaSchema>
export type RevisionProposal = z.infer<typeof RevisionProposalSchema>
export type AiUsageRecord = z.infer<typeof AiUsageRecordSchema>

export const DEFAULT_SETTINGS: ProjectSettings = {
  episodeCount: 12,
  episodeDurationSec: 90,
  shotCount: 16,
  aspectRatio: '9:16',
  genre: '都市奇幻',
  audience: '18–35 岁短剧观众',
  style: '国风漫画、强情绪、电影感光影',
  pace: '紧凑',
  contentLimits: '避免低俗、仇恨、露骨色情和无意义暴力',
  language: '简体中文'
}

export function createProjectDocument(input: {
  id: string
  title: string
  sourceText: string
  settings?: Partial<ProjectSettings>
}): ProjectDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: input.id,
    title: input.title,
    sourceText: input.sourceText,
    sourceKind: 'idea',
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    status: '待分析',
    revision: 0,
    characters: [],
    relationships: [],
    episodes: [],
    knowledgeItems: [],
    episodeDependencies: [],
    aiVisibilityRules: [],
    continuityAudits: [],
    branches: [],
    memorySyncTasks: [],
    contentSyncTasks: [],
    productionAssets: [],
    productionDifficulty: [],
    visualAssetReferences: [],
    imageCandidates: [],
    suggestions: [],
    createdAt: now,
    updatedAt: now
  }
}

export function episodeDuration(episode: EpisodeScript): number {
  return episode.scenes.reduce(
    (total, scene) => total + scene.shots.reduce((sum, shot) => sum + shot.durationSec, 0),
    0
  )
}
