import { z } from 'zod'
import { ChapterLineAssignmentsSchema, NovelStorylineSchema, RollingOutlineWindowSchema } from './novelStoryline'
import { WorldExpansionProposalSchema } from './novelWorldExpansion'

export const GenreTemplateSchema = z.enum(['通用', '玄幻修仙', '科幻', '历史架空', '都市', '悬疑'])
export const CanonStatusSchema = z.enum(['草稿', '定稿'])
export const RhetoricIntensitySchema = z.number().int().min(0).max(4).default(1)

/** 工作区模式：引导模式逐步给出下一步建议，标准模式保留完整工具栏。 */
export const NovelCreationModeSchema = z.enum(['引导创作', '标准创作']).default('标准创作')
export const WritingDetailSchema = z.enum(['简洁', '标准', '细腻']).default('标准')
export const WritingGenerationModeSchema = z.enum(['快速生成', '协作生成']).default('协作生成')
export const StoryDirectionFieldStatusSchema = z.enum(['作者已确定', '暂时采用', '尚未确定'])
export const StoryDirectionFieldStatusesSchema = z.object({
  genreDirection: StoryDirectionFieldStatusSchema.optional(), logline: StoryDirectionFieldStatusSchema.optional(),
  protagonistIdentity: StoryDirectionFieldStatusSchema.optional(), protagonistSituation: StoryDirectionFieldStatusSchema.optional(),
  protagonistGoal: StoryDirectionFieldStatusSchema.optional(), mainObstacle: StoryDirectionFieldStatusSchema.optional(),
  specialPremise: StoryDirectionFieldStatusSchema.optional(), cost: StoryDirectionFieldStatusSchema.optional(),
  failureConsequence: StoryDirectionFieldStatusSchema.optional(), centralMystery: StoryDirectionFieldStatusSchema.optional(),
  readingExperience: StoryDirectionFieldStatusSchema.optional(), openingSituation: StoryDirectionFieldStatusSchema.optional()
})
export const StoryDirectionCardSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(160),
  premise: z.string().max(2_000),
  protagonistHook: z.string().max(2_000),
  coreConflict: z.string().max(2_000),
  emotionalPromise: z.string().max(2_000),
  openingSituation: z.string().max(2_000),
  /** 完整故事方向字段；旧卡片读取时补空值，并继续保留上方精简兼容字段。 */
  genreDirection: z.string().max(1_000).optional(),
  logline: z.string().max(2_000).optional(),
  protagonistIdentity: z.string().max(2_000).optional(),
  protagonistSituation: z.string().max(2_000).optional(),
  protagonistGoal: z.string().max(2_000).optional(),
  mainObstacle: z.string().max(2_000).optional(),
  specialPremise: z.string().max(2_000).optional(),
  cost: z.string().max(2_000).optional(),
  failureConsequence: z.string().max(2_000).optional(),
  centralMystery: z.string().max(2_000).optional(),
  readingExperience: z.string().max(2_000).optional(),
  fieldStatuses: StoryDirectionFieldStatusesSchema.optional(),
  unresolvedQuestions: z.array(z.string().max(500)).max(12).default([]),
  status: z.enum(['候选', '已采用', '已归档']).default('候选'),
  createdAt: z.string(),
  updatedAt: z.string()
})

/**
 * 可复用文风只记录抽象写作特征，不保存上传小说的正文或可复刻句段。
 * 这样既能跨项目复用，也能避免把外部作品当成逐句仿写材料。
 */
export const StyleProfileTraitsSchema = z.object({
  sentenceRhythm: z.string().max(1_000).default(''),
  narrativeDistance: z.string().max(1_000).default(''),
  dialogueStyle: z.string().max(1_000).default(''),
  descriptionStyle: z.string().max(1_000).default(''),
  pacing: z.string().max(1_000).default(''),
  diction: z.string().max(1_000).default(''),
  paragraphPattern: z.string().max(1_000).default(''),
  rhetoric: z.string().max(1_000).default('')
})
export const StyleProfileDraftSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().max(2_000).default(''),
  traits: StyleProfileTraitsSchema,
  guidelines: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  avoidPatterns: z.array(z.string().trim().min(1).max(500)).max(20).default([])
})
export const StyleProfileSchema = StyleProfileDraftSchema.extend({
  id: z.string(), sourceKind: z.enum(['用户创建', 'AI 抽象学习']), sourceName: z.string().max(240).default(''),
  sourceDigest: z.string().max(128).default(''), sourceCharacterCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(), updatedAt: z.string()
})
export const StyleProfileSnapshotSchema = StyleProfileDraftSchema.extend({
  profileId: z.string(), sourceKind: z.enum(['用户创建', 'AI 抽象学习']), capturedAt: z.string()
})
export const StyleProfileUsageSchema = z.object({
  id: z.string(), projectId: z.string(), profileId: z.string(), profileName: z.string(),
  action: z.enum(['绑定', '停用']), revision: z.number().int().nonnegative(), createdAt: z.string()
})
/**
 * 样文来源类型。DOCX / EPUB 走**文件导入**路径（服务端在内存里取文）；
 * 「粘贴」路径只接受纯文本，所以正文型入参仍排除 EPUB（见 ImportStyleSampleSchema）。
 */
export const StyleSampleKindSchema = z.enum(['粘贴', 'TXT', 'Markdown', 'DOCX', '项目正文', 'EPUB'])

/* ------------------------------ 章后分析任务（D6/D7） ------------------------------ */

export const ChapterAnalysisStatusSchema = z.enum(['等待', '运行中', '完成', '失败', '过期', '取消'])
/**
 * 章后分析结果**分类归属**（D6）：
 * 摘要 → 分析记录（不冒充作者确认记忆）；状态/设定 → 设定候选；伏笔 → 伏笔候选；问题 → 待审问题。
 */
export const ChapterAnalysisResultSchema = z.object({
  summary: z.string().max(4_000),
  memoryCandidates: z.array(z.object({ content: z.string().max(2_000), evidence: z.string().max(1_000) })).max(20),
  settingCandidates: z.array(z.object({ name: z.string().max(200), reason: z.string().max(1_000), inferred: z.boolean() })).max(20),
  foreshadowCandidates: z.array(z.object({ title: z.string().max(200), evidence: z.string().max(1_000) })).max(20),
  reviewFindings: z.array(z.object({ title: z.string().max(200), detail: z.string().max(2_000), severity: z.enum(['高', '中', '低']) })).max(20)
})
export const ChapterAnalysisTaskSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), chapterId: z.string().min(1),
  /** 固定下来的章节源指纹 + 上下文版本：源码一变，旧结果就过期。 */
  sourceDigest: z.string().min(1).max(128), contextVersion: z.number().int().nonnegative(),
  trigger: z.enum(['手动分析', '交接后自动']),
  status: ChapterAnalysisStatusSchema,
  result: ChapterAnalysisResultSchema.nullable().default(null),
  error: z.string().max(1_000).nullable().default(null),
  createdAt: z.string(), startedAt: z.string().nullable().default(null), endedAt: z.string().nullable().default(null)
})
export const CreateChapterAnalysisSchema = z.object({
  chapterId: z.string().min(1),
  trigger: z.enum(['手动分析', '交接后自动']).default('手动分析')
}).strict()
export const UpdateChapterAnalysisSchema = z.object({
  status: ChapterAnalysisStatusSchema.optional(),
  result: ChapterAnalysisResultSchema.nullable().optional(),
  error: z.string().max(1_000).nullable().optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional()
}).strict()

export type ChapterAnalysisStatus = z.infer<typeof ChapterAnalysisStatusSchema>
export type ChapterAnalysisResult = z.infer<typeof ChapterAnalysisResultSchema>
export type ChapterAnalysisTask = z.infer<typeof ChapterAnalysisTaskSchema>
export type CreateChapterAnalysis = z.infer<typeof CreateChapterAnalysisSchema>
export type UpdateChapterAnalysis = z.infer<typeof UpdateChapterAnalysisSchema>
export const StyleSampleKindInputSchema = z.enum(['粘贴', 'TXT', 'Markdown', 'DOCX', '项目正文', 'EPUB'])
/** 导入样文的一段；作者只把勾选的段落发给模型。 */
export const StyleSampleSegmentSchema = z.object({
  id: z.string().min(1), label: z.string().min(1).max(120),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  characterCount: z.number().int().nonnegative(), excerpt: z.string().max(200)
}).refine((item) => item.end >= item.start, { message: '段落结束不能早于开始。' })
export const StyleSampleSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(240), kind: StyleSampleKindSchema,
  text: z.string().max(400_000), digest: z.string().min(1).max(128),
  segments: z.array(StyleSampleSegmentSchema).max(500),
  createdAt: z.string()
})
export const StyleSamplePreviewSchema = z.object({
  name: z.string().min(1).max(240), kind: StyleSampleKindSchema, digest: z.string().min(1).max(128),
  characterCount: z.number().int().nonnegative(),
  segments: z.array(StyleSampleSegmentSchema).max(500),
  warnings: z.array(z.string()).max(20)
})
export const ImportStyleSampleSchema = z.object({
  name: z.string().trim().min(1).max(240),
  kind: StyleSampleKindSchema.exclude(['EPUB']),
  content: z.string().max(400_000)
}).strict()
/**
 * 文件型样文导入（TXT / Markdown / DOCX / EPUB）。
 * `dataBase64` 是文件原始字节的 base64；长度上限按 64MB 二进制取整
 * （`4 * ceil(64 * 1024 * 1024 / 3) = 89_478_488`）。真正的 60MB 上限由服务端取文时再判。
 */
export const STYLE_FILE_DATA_BASE64_MAX = 89_478_488
export const ImportStyleSampleFileSchema = z.object({
  name: z.string().trim().min(1).max(240),
  filename: z.string().trim().min(1).max(260),
  kind: z.enum(['TXT', 'Markdown', 'DOCX', 'EPUB']),
  dataBase64: z.string().min(1).max(STYLE_FILE_DATA_BASE64_MAX)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, '文件内容必须是 base64 编码。')
}).strict()
export const AnalyzeStyleSampleSchema = z.object({
  sampleId: z.string().min(1),
  segmentIds: z.array(z.string().min(1)).max(500).min(1),
  profileName: z.string().trim().min(1).max(120),
  providerId: z.string().min(1).optional()
}).strict()
/** 同场景试写：只有「是否加载当前画像」这一项不同，不给伪造相似度。 */
export const StyleTrialSchema = z.object({
  id: z.string().min(1), scenario: z.string().min(1).max(2_000),
  withoutProfile: z.string().min(1).max(20_000), withProfile: z.string().min(1).max(20_000),
  profileId: z.string().min(1), profileVersion: z.string().min(1), createdAt: z.string()
})
export const CreateStyleTrialSchema = z.object({
  scenario: z.string().trim().min(1).max(2_000),
  chapterId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional()
}).strict()

export const BindStyleProfileSchema = z.object({
  profileId: z.string().min(1),
  /** 绑定的是**快照**：之后画像被修改，本项目仍用这一版，直到作者明确更新。 */
  capturedAt: z.string().optional()
}).strict()

export const WorldEntryTypeSchema = z.enum([
  '角色', '修行体系', '国家', '货币', '势力', '地点', '种族', '宗教', '文化',
  '历史', '历法', '科技魔法', '物品', '自定义'
])

export const NovelSettingsSchema = z.object({
  genreTemplate: GenreTemplateSchema,
  targetWords: z.number().int().min(1_000).max(20_000_000),
  plannedVolumes: z.number().int().min(1).max(100),
  plannedChapters: z.number().int().min(1).max(10_000),
  pointOfView: z.enum(['第一人称', '第三人称限知', '第三人称全知', '多视角']),
  tense: z.enum(['过去时', '现在时', '混合']),
  audience: z.string().max(500),
  style: z.string().max(2_000),
  contentLimits: z.string().max(2_000),
  /** AI 正文生成时的修辞密度偏好；旧项目缺少该字段时采用“克制”。 */
  rhetoricIntensity: RhetoricIntensitySchema,
  /** 正文生成的控制项；全部为软约束，用户仍可逐章调整。 */
  writingDetail: WritingDetailSchema.optional(),
  writingGenerationMode: WritingGenerationModeSchema.optional(),
  chapterTargetWords: z.number().int().min(200).max(20_000).optional(),
  /**
   * 章后交接成功后自动分析本章（D6）。默认关闭；开启会在首次开启时说明发送范围与模型调用，
   * 自动保存（防抖）永远不会触发分析。
   */
  chapterAutoAnalyze: z.boolean().optional(),
  /** 文风库绑定采用快照，完整 JSON 备份在没有全局文风库时仍可复现生成约束。 */
  activeStyleProfileId: z.string().optional(),
  styleProfileSnapshot: StyleProfileSnapshotSchema.optional(),
  language: z.string().max(40).default('简体中文')
}).superRefine((settings, context) => {
  if (settings.activeStyleProfileId && settings.styleProfileSnapshot && settings.activeStyleProfileId !== settings.styleProfileSnapshot.profileId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['styleProfileSnapshot', 'profileId'], message: '文风快照与当前选择不一致。' })
  }
})

export const RHETORIC_GUIDANCE = [
  { label: '极少', description: '普通信息直接叙述，仅在关键情绪或主题意象处偶尔使用修辞。', instruction: '以动作、对白、具体观察和因果直接推进；普通段落原则上不主动添加显性比喻、拟人或通感，必要的核心意象可以保留。' },
  { label: '克制（推荐）', description: '以动作、事实和对话为主，关键处少量使用修辞。', instruction: '优先直接描述动作、对白、声音和可观察事实；只在关键情绪或核心意象处少量使用比喻等修辞，避免连续三段重复同类表达。' },
  { label: '均衡', description: '保持自然叙述，同时为关键情绪和环境增加适量画面感。', instruction: '允许自然、适量的比喻和意象，但修辞必须服务情节、人物或氛围，不能替代事实与因果，也不要连续堆叠。' },
  { label: '丰富', description: '允许更明显的形象化表达，但仍要保证清楚易读。', instruction: '可以使用较丰富的意象和修辞建立统一氛围，但每处都要有叙事作用；普通动作仍应清楚直接，避免为了华丽而堆砌。' },
  { label: '浓烈', description: '偏向诗化和强烈意象，只适合明确追求这种风格的段落。', instruction: '允许浓郁、诗化的修辞表达，但不得牺牲主语、事实、人物动机和因果；不得每句强行添加意象，也不得连续重复同类修辞。' }
] as const

export function rhetoricGuidance(level: number | undefined): (typeof RHETORIC_GUIDANCE)[number] & { level: number } {
  const safeLevel = Number.isInteger(level) && level !== undefined ? Math.min(4, Math.max(0, level)) : 1
  return { level: safeLevel, ...RHETORIC_GUIDANCE[safeLevel]! }
}

export const WorldRelationSchema = z.object({
  id: z.string(),
  targetEntryId: z.string(),
  type: z.string().max(80),
  description: z.string().max(1_000)
})

const TextMapSchema = z.record(z.string(), z.string())
const TextListMapSchema = z.record(z.string(), z.array(z.string()))

export const CharacterDetailsSchema = z.object({
  role: z.string(), identity: z.string(), appearance: z.string(), personality: z.string(),
  values: z.array(z.string()), boundaries: z.array(z.string()), goal: z.string(), weakness: z.string(),
  secret: z.string(), speechStyle: z.string(), arc: z.string()
})
export const CultivationDetailsSchema = z.object({
  paths: z.array(z.object({
    name: z.string(), principle: z.string(), realms: z.array(z.object({
      name: z.string(), stages: z.array(z.string()), breakthrough: z.string(), lifespan: z.string(),
      abilities: z.array(z.string()), costs: z.array(z.string()), counters: z.array(z.string()), resources: z.array(z.string())
    }))
  })),
  techniques: z.array(z.string()), professions: z.array(z.string()), universalRules: z.array(z.string())
})
export const NationDetailsSchema = z.object({
  government: z.string(), powerStructure: z.string(), succession: z.string(), administration: z.array(z.string()),
  laws: z.array(z.string()), military: z.string(), population: z.string(), diplomacy: z.array(z.string()),
  classes: z.array(z.string()), finance: z.string(), territories: z.array(z.string())
})
export const CurrencyDetailsSchema = z.object({
  issuer: z.string(), material: z.string(), denominations: z.array(z.object({ name: z.string(), ratio: z.number().positive() })),
  circulation: z.array(z.string()), taxation: z.string(), trade: z.string(), priceAnchors: z.array(z.string()), restrictions: z.array(z.string())
})
export const GenericDetailsSchema = z.object({ fields: TextMapSchema, lists: TextListMapSchema })

const WorldEntryBaseSchema = z.object({
  id: z.string(), name: z.string().min(1).max(120), aliases: z.array(z.string()), tags: z.array(z.string()),
  summary: z.string(), notes: z.string(), locked: z.boolean().default(false), aiVisibility: z.enum(['始终可见', '按需召回', '仅审校', '永不发送']).default('按需召回'),
  relations: z.array(WorldRelationSchema), customFields: TextMapSchema.default({})
})

export const WorldEntrySchema = z.discriminatedUnion('type', [
  WorldEntryBaseSchema.extend({ type: z.literal('角色'), details: CharacterDetailsSchema }),
  WorldEntryBaseSchema.extend({ type: z.literal('修行体系'), details: CultivationDetailsSchema }),
  WorldEntryBaseSchema.extend({ type: z.literal('国家'), details: NationDetailsSchema }),
  WorldEntryBaseSchema.extend({ type: z.literal('货币'), details: CurrencyDetailsSchema }),
  ...(['势力', '地点', '种族', '宗教', '文化', '历史', '历法', '科技魔法', '物品', '自定义'] as const)
    .map((type) => WorldEntryBaseSchema.extend({ type: z.literal(type), details: GenericDetailsSchema }))
])

export const TimelineEventSchema = z.object({
  id: z.string(), dateLabel: z.string(), order: z.number(), title: z.string(), description: z.string(),
  entryIds: z.array(z.string()), locked: z.boolean().default(false)
})

export const WorldBibleSchema = z.object({
  status: CanonStatusSchema, summary: z.string(), premise: z.string(), themes: z.array(z.string()),
  rules: z.array(z.string()), geography: z.string(), historySummary: z.string(), entries: z.array(WorldEntrySchema),
  timeline: z.array(TimelineEventSchema), updatedAt: z.string()
})

/** 用户确认的术语边界；AI 提取的内容默认待确认，不能直接成为正式约束。 */
export const WorldFieldEvidenceSchema = z.object({ fieldPath: z.string().min(1), excerpt: z.string().min(1) })
export const WorldConstraintSchema = z.object({
  id: z.string(), term: z.string().min(1).max(120), definition: z.string().min(1).max(2_000),
  notDefinition: z.string().max(2_000).default(''), entityType: z.string().max(120).default(''),
  allowedUsages: z.array(z.string().min(1).max(500)).max(30).default([]),
  forbiddenUsages: z.array(z.object({ phrase: z.string().min(1).max(240), reason: z.string().min(1).max(1_000), suggestedReplacement: z.string().max(1_000).default('') })).max(30).default([]),
  unresolvedQuestions: z.array(z.string().min(1).max(500)).max(30).default([]),
  facts: z.array(z.object({ subject: z.string().min(1).max(120), relation: z.string().min(1).max(120), object: z.string().min(1).max(500), polarity: z.enum(['允许', '禁止']) })).max(30).default([]),
  source: WorldFieldEvidenceSchema, status: z.enum(['待确认', '已确认', '已锁定', '已拒绝']).default('待确认'), createdAt: z.string(), updatedAt: z.string()
})

/** 世界观字段中的可见证据；fieldPath 使用稳定字段路径，界面只显示对应的中文标签。 */
export const WorldQualityFindingSchema = z.object({
  id: z.string(), type: z.enum(['术语误用', '主语指代', '搭配不当', '设定冲突', '无依据事实', '重复啰嗦', '文本异常']),
  severity: z.enum(['高', '中', '低']), confidence: z.number().min(0).max(1), evidence: WorldFieldEvidenceSchema,
  constraintIds: z.array(z.string()).default([]), explanation: z.string().min(1).max(2_000), suggestedReplacement: z.string().max(4_000).optional(),
  suggestionType: z.enum(['可直接应用', '需要作者决定']).optional(), aiSuggestionReason: z.string().max(2_000).optional(),
  alternativeSuggestions: z.array(z.string().min(1).max(4_000)).max(3).optional(),
  baseFieldDigest: z.string().min(1), status: z.enum(['待处理', '已接受', '已忽略', '已失效']).default('待处理'),
  source: z.enum(['本地规则', 'AI 语义审校']), createdAt: z.string()
})

export const SceneBeatSchema = z.object({
  id: z.string(), order: z.number().int().positive(), title: z.string(), purpose: z.string(), conflict: z.string(), outcome: z.string(),
  location: z.string().default(''), timeframe: z.string().default(''), characterIds: z.array(z.string()).default([]),
  reveal: z.string().default(''), threadActions: z.array(z.string()).default([])
})
export const BeatStatusSchema = z.enum(['未生成', '待确认', '已确认'])
export const BeatFindingSchema = z.object({
  id: z.string(), beatId: z.string().optional(), severity: z.enum(['高', '中', '低']),
  category: z.enum(['目标不清', '场景过载', '人物缺失', '时空不明', '因果断裂', '伏笔冲突']),
  message: z.string(), suggestion: z.string(), status: z.enum(['待处理', '已接受', '已忽略']).default('待处理'),
  suggestedBeat: SceneBeatSchema.optional()
})
const ChapterOutlineBaseSchema = z.object({
  id: z.string(), volumeNumber: z.number().int().positive(), chapterNumber: z.number().int().positive(), title: z.string(),
  /** chapterNumber 只表示阅读顺序；故事时间单独保存，调序时不会被静默改写。 */
  storyTime: z.string().max(500).optional(), narrativeMode: z.enum(['顺叙', '倒叙', '插叙', '回忆']).optional(),
  pov: z.string(), objective: z.string(), conflict: z.string(), turningPoint: z.string(), reveal: z.string(), endingHook: z.string(),
  characterIds: z.array(z.string()), setupThreadIds: z.array(z.string()), payoffThreadIds: z.array(z.string()), beats: z.array(SceneBeatSchema),
  status: z.enum(['未规划', '已规划', '已写作', '已定稿']).default('已规划'), beatStatus: BeatStatusSchema.optional(),
  /** 上游总纲/卷纲/节拍改变后，仅标记下游复核，不自动重写正文。 */
  downstreamReviewStatus: z.enum(['正常', '待复核']).optional(), downstreamReviewReason: z.string().optional(),
  /** 章纲与剧情步骤生成时记录的上游摘要；摘要变化只触发复核提醒。 */
  sourceVolumeDigest: z.string().optional(), beatSourceOutlineDigest: z.string().optional(),
  beatFindings: z.array(BeatFindingSchema).default([]),
  /** 每章的主线/辅助线分配；通常为 1 条主线、最多 2 条辅助线。 */
  lineAssignments: ChapterLineAssignmentsSchema.optional()
})
export const ChapterOutlineSchema = ChapterOutlineBaseSchema.transform((chapter) => ({
  ...chapter,
  beatStatus: chapter.beatStatus ?? (chapter.beats.length ? '已确认' as const : '未生成' as const)
}))
export const VolumeOutlineSchema = z.object({
  id: z.string(), volumeNumber: z.number().int().positive(), title: z.string(), goal: z.string(), climax: z.string(), resolution: z.string(), chapters: z.array(ChapterOutlineSchema)
})
export const NovelOutlineSchema = z.object({
  status: CanonStatusSchema, synopsis: z.string(), themes: z.array(z.string()), mainConflict: z.string(), endingDirection: z.string(),
  volumes: z.array(VolumeOutlineSchema), updatedAt: z.string(),
  /** 当前近期详细章纲窗口；窗口滚动不会删除卷级粗略事件节点。 */
  rollingWindow: RollingOutlineWindowSchema.optional()
})

/**
 * 大纲结构调整的操作类型。它们只生成待确认候选，不直接修改正式大纲或正文。
 * chapterId 使用章纲稳定身份；chapterNumber 只是给作者看的显示编号。
 */
export const OutlineStructureOperationSchema = z.enum(['插入章节', '删除章节', '调序', '跨卷移动', '拆分章节', '合并章节', '卷排序', '删除卷'])
export const OutlineStructureEditRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(), operation: OutlineStructureOperationSchema,
  chapterId: z.string().min(1).optional(), otherChapterId: z.string().min(1).optional(),
  relativeChapterId: z.string().min(1).optional(), position: z.enum(['之前', '之后']).optional(),
  targetVolumeNumber: z.number().int().positive().optional(),
  title: z.string().trim().max(240).optional(), reason: z.string().trim().max(1_000).optional(),
  /** 插入章节只接收作者明确提供的规划字段；缺失内容保持空白，不能由结构操作擅自生成。 */
  chapterDraft: z.object({
    title: z.string().trim().max(240).optional(), storyTime: z.string().max(500).optional(), narrativeMode: z.enum(['顺叙', '倒叙', '插叙', '回忆']).optional(),
    pov: z.string().max(240).optional(), objective: z.string().max(2_000).optional(),
    conflict: z.string().max(2_000).optional(), turningPoint: z.string().max(2_000).optional(), reveal: z.string().max(2_000).optional(),
    endingHook: z.string().max(2_000).optional(), characterIds: z.array(z.string().min(1)).max(100).optional(),
    setupThreadIds: z.array(z.string().min(1)).max(100).optional(), payoffThreadIds: z.array(z.string().min(1)).max(100).optional()
  }).optional(),
  /** 拆章位置按原章纲剧情步骤编号计数，从第一步之后拆分。 */
  splitAfterBeat: z.number().int().positive().optional(),
  /**
   * 拆分时原章正文归属哪张结果章纲。
   * 默认「前半」：前半沿用原章纲的稳定身份，原正文、章节记忆、伏笔与事件线关联原样跟随，
   * 是保留现有稳定身份的最小方案；选「后半」时先把关联改挂到后半，再单独确认。
   */
  splitBodySide: z.enum(['前半', '后半']).optional(),
  /**
   * 合并时两份正文如何保留。后章已有正文时**必须由作者明确选择**，不提供默认值：
   * 「拼接」把后章段落按顺序并入合并后章节的同一份正文；「保留为无章纲」把后章正文
   * 留成没有对应章纲的记录，需作者自行处理。缺省表示尚未决定，此时拒绝生成候选。
   */
  mergeBodyStrategy: z.enum(['拼接', '保留为无章纲']).optional(),
  /** 卷级操作的目标卷；「卷排序」里指被移动的卷，「删除卷」里指被删除的卷。 */
  volumeNumber: z.number().int().positive().optional(),
  /** 「卷排序」的参照卷。 */
  relativeVolumeNumber: z.number().int().positive().optional(),
  /**
   * 「删除卷」时该卷内还有章纲（但都没有正文、剧情步骤与引用）时的显式确认。
   * 缺省为 false：不勾选就不会移除这些章纲，避免顺手丢掉规划。
   */
  confirmVolumeChapters: z.boolean().optional()
}).superRefine((value, context) => {
  const requireField = (field: keyof typeof value, message: string) => {
    if (!value[field]) context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message })
  }
  const isVolumeOperation = value.operation === '卷排序' || value.operation === '删除卷'
  if (value.operation !== '插入章节' && !isVolumeOperation) requireField('chapterId', '该结构调整必须指定目标章节。')
  if (value.operation === '卷排序') {
    requireField('volumeNumber', '卷排序必须指定要移动的卷。')
    requireField('relativeVolumeNumber', '卷排序必须指定参照卷。')
    requireField('position', '卷排序必须指定放在参照卷之前或之后。')
  }
  if (value.operation === '删除卷') requireField('volumeNumber', '删除卷必须指定要删除的卷。')
  if (value.operation === '调序') {
    requireField('relativeChapterId', '调序必须指定参照章节。')
    requireField('position', '调序必须指定放在参照章节之前或之后。')
  }
  if (value.operation === '跨卷移动') requireField('targetVolumeNumber', '跨卷移动必须指定目标卷。')
  if (value.operation === '合并章节') requireField('otherChapterId', '合并章节必须指定另一章。')
  if (value.operation === '拆分章节') requireField('splitAfterBeat', '拆分章节必须指定剧情步骤拆分位置。')
  if (value.operation === '插入章节' && value.relativeChapterId && !value.position) requireField('position', '插入章节指定参照章时必须指定插入位置。')
  if (value.operation === '插入章节' && !value.relativeChapterId && !value.targetVolumeNumber) requireField('targetVolumeNumber', '没有参照章时必须指定插入到哪一卷。')
})
export const OutlineStructureImpactSchema = z.object({
  operation: OutlineStructureOperationSchema, summary: z.string(), risk: z.enum(['低', '中', '高']),
  affectedChapterIds: z.array(z.string()), affectedChapterNumbers: z.array(z.number().int().positive()),
  affectedOutlineCount: z.number().int().nonnegative(), affectedBodyCount: z.number().int().nonnegative(),
  affectedMemoryCount: z.number().int().nonnegative(), affectedThreadCount: z.number().int().nonnegative(), affectedReviewCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()), changes: z.array(z.string()), createdAt: z.string(),
  /**
   * 结构变更造成的身份归并：被退休的身份 → 接管它的身份。
   * 应用候选时据此改写全部关联（正文、章节记忆、伏笔、审稿问题、事件线章节关联），
   * 否则会留下指向已消失身份的悬空引用。joinBlocks 表示被退休正文的段落要按顺序并入接管正文。
   */
  identityMerges: z.array(z.object({
    kind: z.enum(['章纲', '正文']), from: z.string().min(1), to: z.string().min(1), joinBlocks: z.boolean().optional()
  })).optional(),
  /** 拆分/合并时原正文归属的中文说明，供作者在确认执行前核对。 */
  bodyHandling: z.string().optional()
})

export const ProseBlockSchema = z.object({ id: z.string(), text: z.string() })
export const ChapterHandoffStatusSchema = z.enum(['未交接', '已完成待复盘', '已交接', '需补写']).default('未交接')
export const ChapterRetroSchema = z.object({
  planResult: z.enum(['已按计划完成', '实现方式变化', '计划未兑现', '计划外新增', '高风险冲突']).optional(),
  actualResult: z.string().max(2_000).default(''),
  deviationReason: z.string().max(2_000).default(''),
  nextAdjustment: z.string().max(2_000).default(''),
  confirmedAt: z.string().optional()
}).optional()
export const ChapterSchema = z.object({
  id: z.string(), volumeNumber: z.number().int().positive(), chapterNumber: z.number().int().positive(), title: z.string(),
  blocks: z.array(ProseBlockSchema), status: z.enum(['草稿', '待审校', '定稿']), sourceDigest: z.string().default(''), updatedAt: z.string(),
  handoffStatus: ChapterHandoffStatusSchema.optional(),
  retro: ChapterRetroSchema
})

export const NovelMemorySourceSchema = z.object({ chapterId: z.string(), blockId: z.string().optional(), excerpt: z.string() })
/**
 * 章节候选的场景质量问题。与世界观审校分开建模，避免把正文问题误当成
 * 世界设定问题；所有问题都绑定候选摘要，候选被作者修改后即可失效。
 */
export const SceneQualityFindingSchema = z.object({
  id: z.string(), chapterId: z.string(), beatId: z.string().optional(), sceneIndex: z.number().int().nonnegative().optional(),
  category: z.enum(['文本异常', '术语冲突', '人物缺失', '场景错位', '知识越界', '因果不清', '表达问题']),
  severity: z.enum(['高', '中', '低']), confidence: z.number().min(0).max(1),
  evidence: NovelMemorySourceSchema,
  explanation: z.string().min(1).max(2_000), suggestedReplacement: z.string().max(4_000).optional(),
  baseCandidateDigest: z.string().min(1), status: z.enum(['待处理', '已接受', '已忽略', '已失效']).default('待处理'),
  source: z.enum(['本地规则', 'AI 深度审校']), resolutionReason: z.string().max(1_000).optional(), createdAt: z.string()
})
/**
 * 记忆的事实视角。客观事实描述故事世界实际发生的状态，角色认知只表示
 * 某个角色在当时知道、相信或误解的内容；两者不能在召回时混为一谈。
 */
export const MemoryPerspectiveSchema = z.enum(['客观事实', '角色认知'])
const ChapterApplicabilityFields = {
  appliesFromChapter: z.number().int().positive().optional(),
  appliesThroughChapter: z.number().int().positive().optional(),
  replacesId: z.string().min(1).optional()
}
const ChapterApplicabilitySchema = z.object(ChapterApplicabilityFields).superRefine((value, context) => {
  if (value.appliesFromChapter && value.appliesThroughChapter && value.appliesThroughChapter < value.appliesFromChapter) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['appliesThroughChapter'], message: '适用结束章节不能早于开始章节。' })
  }
})
export const CharacterStateSchema = z.object({
  id: z.string(), characterId: z.string(), characterName: z.string(), location: z.string(), ability: z.string(), physicalState: z.string(),
  emotion: z.string(), goal: z.string(), knowledge: z.array(z.string()), relationships: z.array(z.string()), source: NovelMemorySourceSchema,
  /** 默认保持旧数据的客观状态语义；角色认知必须显式标记并注明已知角色。 */
  perspective: MemoryPerspectiveSchema.optional(),
  knownToCharacterIds: z.array(z.string()).optional(),
  knowledgeEvidence: z.array(NovelMemorySourceSchema).optional(),
  ...ChapterApplicabilityFields
}).superRefine((value, context) => {
  const parsed = ChapterApplicabilitySchema.safeParse(value)
  if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue(issue))
  if (value.replacesId === value.id) context.addIssue({ code: z.ZodIssueCode.custom, path: ['replacesId'], message: '角色状态不能替换自身。' })
})
export const StoryFactSchema = z.object({
  id: z.string(), category: z.enum(['事件', '角色', '关系', '道具', '秘密', '时间线', '世界规则']), content: z.string(),
  certainty: z.enum(['正式', '未决', '推测', '废弃']), locked: z.boolean().default(false), source: NovelMemorySourceSchema,
  /** 事实与角色知道的事实分轨；knownToCharacterIds 为空表示尚未指定知情角色。 */
  perspective: MemoryPerspectiveSchema.optional(),
  knownToCharacterIds: z.array(z.string()).optional(),
  knowledgeEvidence: z.array(NovelMemorySourceSchema).optional(),
  ...ChapterApplicabilityFields
}).superRefine((value, context) => {
  const parsed = ChapterApplicabilitySchema.safeParse(value)
  if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue(issue))
  if (value.replacesId === value.id) context.addIssue({ code: z.ZodIssueCode.custom, path: ['replacesId'], message: '剧情事实不能替换自身。' })
})
export const ChapterMemorySchema = z.object({
  id: z.string(), chapterId: z.string(), chapterNumber: z.number().int().positive(), status: z.enum(['正式', '需更新', '待复核']),
  sourceDigest: z.string(), summary: z.string(), keyEvents: z.array(z.string()), characterStates: z.array(CharacterStateSchema),
  facts: z.array(StoryFactSchema), objectStates: z.array(z.string()), timelineEvents: z.array(z.string()), styleSignals: z.array(z.string()),
  editHistory: z.array(z.object({ changedAt: z.string(), summary: z.string(), keyEvents: z.array(z.string()) })).optional(), updatedAt: z.string()
})

export const MemoryProposalSchema = z.object({
  id: z.string(), projectId: z.string(), chapterId: z.string(), sourceDigest: z.string(), category: z.enum(['章节摘要', '角色状态', '剧情事实', '关系变化', '知识变化', '道具状态', '时间事件', '伏笔']),
  targetId: z.string().optional(), before: z.unknown().optional(), baseTargetDigest: z.string().optional(), reason: z.string().optional(), candidate: z.unknown(), source: NovelMemorySourceSchema,
  ...ChapterApplicabilityFields,
  confidence: z.number().min(0).max(1), risk: z.enum(['高', '中', '低']), status: z.enum(['待确认', '已接受', '已拒绝', '已失效']), createdAt: z.string()
}).superRefine((value, context) => {
  const parsed = ChapterApplicabilitySchema.safeParse(value)
  if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue(issue))
})

/**
 * 记忆提案批量接受的状态。批量必须全成或全不成：任一提案失效、冲突、
 * 项目版本或来源正文变化时，整批都不写入正式记忆。
 */
export const MemoryProposalAcceptanceStateSchema = z.enum([
  '可接受', '提案不存在', '提案已失效', '提案状态冲突', '项目版本变化', '来源正文变化', '目标正式值变化', '缺少原文证据', '重复提案'
])
export const MemoryProposalBatchBlockerSchema = z.object({
  proposalId: z.string().min(1), code: MemoryProposalAcceptanceStateSchema, message: z.string().min(1)
})
export const MemoryProposalBatchResolveResultSchema = z.object({
  status: z.enum(['全部成功', '全部回滚']),
  appliedProposalIds: z.array(z.string().min(1)),
  blockers: z.array(MemoryProposalBatchBlockerSchema),
  committedRevision: z.number().int().nonnegative().optional()
}).superRefine((value, context) => {
  if (value.status === '全部成功') {
    if (value.blockers.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockers'], message: '全部成功时不允许存在阻断项。' })
    if (!value.appliedProposalIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['appliedProposalIds'], message: '全部成功时必须有已接受的提案。' })
    if (value.committedRevision === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['committedRevision'], message: '全部成功时必须返回写入后的项目版本。' })
  } else {
    if (value.appliedProposalIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['appliedProposalIds'], message: '全部回滚时不允许报告任何已写入提案。' })
    if (!value.blockers.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockers'], message: '全部回滚时必须说明阻断原因。' })
    if (value.committedRevision !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['committedRevision'], message: '全部回滚时不允许返回项目版本。' })
  }
})

/** 规划批量接受所需的提案事实；由 core 从数据库读取，不含任何真实正文。 */
export interface MemoryProposalFact {
  id: string
  status: '待确认' | '已接受' | '已拒绝' | '已失效'
  baseRevision?: number
  sourceDigest?: string
  currentSourceDigest?: string
  proposalTargetDigest?: string
  currentTargetDigest?: string
  hasSourceEvidence?: boolean
}

export interface MemoryProposalBatchDecision {
  proposalId: string
  status: '已接受' | '已拒绝'
  /** 作者在批量接受前调整过的候选；缺省时使用提案自带候选。 */
  candidate?: unknown
}

/**
 * 纯确定性规划：只判断这一批能否整体写入，不做任何写入。返回“全部回滚”时，
 * 调用方必须保持正式记忆、提案状态与项目版本原样。
 */
export function planMemoryProposalBatch(
  decisions: readonly MemoryProposalBatchDecision[], facts: readonly MemoryProposalFact[], currentRevision: number
): z.infer<typeof MemoryProposalBatchResolveResultSchema> {
  const blockers: MemoryProposalBatchBlocker[] = []
  const byId = new Map(facts.map((fact) => [fact.id, fact]))
  const seen = new Set<string>()
  for (const decision of decisions) {
    if (seen.has(decision.proposalId)) {
      blockers.push({ proposalId: decision.proposalId, code: '重复提案', message: '同一批中存在重复的提案决定。' })
      continue
    }
    seen.add(decision.proposalId)
    const fact = byId.get(decision.proposalId)
    if (!fact) { blockers.push({ proposalId: decision.proposalId, code: '提案不存在', message: '提案不存在或已被删除。' }); continue }
    if (fact.status === '已失效') { blockers.push({ proposalId: fact.id, code: '提案已失效', message: '提案已失效，必须重新分析后再处理。' }); continue }
    if (fact.status !== '待确认') { blockers.push({ proposalId: fact.id, code: '提案状态冲突', message: `提案当前状态为${fact.status}，不能再次处理。` }); continue }
    if (decision.status === '已拒绝') continue
    if (fact.baseRevision !== undefined && fact.baseRevision !== currentRevision) {
      blockers.push({ proposalId: fact.id, code: '项目版本变化', message: '项目版本已变化，需要重新校验提案依据。' }); continue
    }
    if (fact.currentSourceDigest !== undefined && fact.sourceDigest !== undefined && fact.currentSourceDigest !== fact.sourceDigest) {
      blockers.push({ proposalId: fact.id, code: '来源正文变化', message: '来源正文已变化，提案依据失效。' }); continue
    }
    if (fact.proposalTargetDigest !== undefined && fact.currentTargetDigest !== undefined && fact.proposalTargetDigest !== fact.currentTargetDigest) {
      blockers.push({ proposalId: fact.id, code: '目标正式值变化', message: '目标正式值已变化，需要三方对照后再决定。' }); continue
    }
    if (fact.hasSourceEvidence === false) {
      blockers.push({ proposalId: fact.id, code: '缺少原文证据', message: '提案缺少原文证据，不能写入正式记忆。' }); continue
    }
  }
  if (blockers.length) return { status: '全部回滚', appliedProposalIds: [], blockers }
  return { status: '全部成功', appliedProposalIds: decisions.map((decision) => decision.proposalId), blockers: [], committedRevision: currentRevision }
}

export const PlotThreadRevisionSchema = z.object({
  id: z.string(), changedAt: z.string(), fromStatus: z.string(), toStatus: z.string(),
  chapterId: z.string().optional(), reason: z.string(), evidence: NovelMemorySourceSchema.optional()
})

/**
 * 伏笔专用证据池。旧项目把埋设、推进和回收证据分别放在三个字段中，
 * 新结构把它们统一成可筛选、可解释的记录；旧字段仍然保留以兼容旧备份。
 */
export const PlotThreadEvidencePhaseSchema = z.enum(['埋设', '推进', '回收', '旁证', '冲突'])
export const PlotThreadEvidenceStatusSchema = z.enum(['有效', '待核实', '已失效'])
export const PlotThreadEvidenceSchema = z.object({
  id: z.string().min(1), phase: PlotThreadEvidencePhaseSchema, chapterId: z.string().min(1),
  blockId: z.string().optional(), excerpt: z.string().min(1).max(4_000),
  note: z.string().max(2_000).default(''),
  source: z.enum(['正文', '作者记录', 'AI提取', '审校']).default('作者记录'),
  confidence: z.number().min(0).max(1).default(1), status: PlotThreadEvidenceStatusSchema.default('有效'),
  createdAt: z.string().optional()
})

export const PlotThreadCognitionCharacterSchema = z.object({
  characterId: z.string().optional(), characterName: z.string().max(120).default(''),
  knowledge: z.string().max(2_000), evidenceIds: z.array(z.string()).default([])
})
/** 分开记录读者、主角和其他人物所知内容，避免“认知差”只有一段无法核对的文字。 */
export const PlotThreadCognitionSchema = z.object({
  reader: z.string().max(2_000).default(''), protagonist: z.string().max(2_000).default(''),
  otherCharacters: z.array(PlotThreadCognitionCharacterSchema).max(100).default([]),
  gapSummary: z.string().max(2_000).default(''), updatedAt: z.string().optional()
})

export const PlotThreadReadinessLevelSchema = z.enum(['未准备', '正在准备', '接近回收', '可以回收', '已回收', '已归档'])
/** 回收准备度快照；score 之外必须保留满足项、缺口和下一步，便于作者判断依据。 */
export const PlotThreadReadinessSchema = z.object({
  score: z.number().min(0).max(1), level: PlotThreadReadinessLevelSchema,
  fulfilled: z.array(z.string().max(500)).max(20).default([]),
  gaps: z.array(z.string().max(500)).max(20).default([]),
  basis: z.array(z.string().max(500)).max(30).default([]),
  recommendation: z.string().max(1_000).default(''), assessedAt: z.string().optional()
})
export const NovelPlotThreadSchema = z.object({
  id: z.string(), title: z.string(), detail: z.string(), characterIds: z.array(z.string()),
  status: z.enum(['计划', '已埋设', '推进中', '已回收', '已放弃', '逾期']), setupChapterId: z.string().optional(), setupMethod: z.string().default(''), setupEvidence: NovelMemorySourceSchema.optional(),
  targetPayoffChapter: z.number().int().positive().optional(), resolutionChapterId: z.string().optional(), resolutionMethod: z.string().default(''), resolutionEvidence: NovelMemorySourceSchema.optional(),
  progress: z.array(z.object({ id: z.string(), chapterId: z.string(), description: z.string(), source: NovelMemorySourceSchema })).default([]),
  /** 伏笔回收前的作者可见风险信息；旧项目没有时保持空值。 */
  revealReadiness: z.number().min(0).max(1).optional(), cognitiveGap: z.string().optional(),
  /** 新版统一证据池；从旧字段读取时由 core 归一化，不要求旧 JSON 迁移。 */
  evidencePool: z.array(PlotThreadEvidenceSchema).max(10_000).optional(),
  /** 结构化认知差和准备度说明；均为可选以保持旧项目无损读取。 */
  cognition: PlotThreadCognitionSchema.optional(), readiness: PlotThreadReadinessSchema.optional(),
  /** 放弃采用归档语义，保留证据和状态历史；恢复时清理 archivedAt 而不删除证据。 */
  archiveReason: z.string().max(1_000).optional(), archivedFromStatus: z.string().optional(),
  revisionHistory: z.array(PlotThreadRevisionSchema).optional(), archivedAt: z.string().optional(), updatedAt: z.string()
})

export const NovelBranchSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), baseChapterId: z.string(), chapters: z.array(ChapterSchema),
  status: z.enum(['构思中', '可比较', '已采用', '已归档']), createdAt: z.string(), updatedAt: z.string(),
  /** 生成分支时的项目版本与来源正文摘要；旧分支缺少时标记“需要重新比较”，不猜“最新”。 */
  baseRevision: z.number().int().nonnegative().optional(), sourceDigest: z.string().optional()
})

export const BranchFreshnessStateSchema = z.enum(['最新', '需要重新比较', '来源缺失'])
/**
 * 分支新鲜度：正式正文或来源变化后必须重新比较，采用分支仍然只生成修改候选。
 */
export function branchFreshness(
  branch: Pick<NovelBranch, 'sourceDigest'>,
  current: { revision: number; sourceDigest?: string }
): z.infer<typeof BranchFreshnessStateSchema> {
  if (!branch.sourceDigest || !current.sourceDigest) return '来源缺失'
  return branch.sourceDigest === current.sourceDigest ? '最新' : '需要重新比较'
}

/**
 * 审稿问题的处理方式。它是作者对“这件事是怎么被处理的”的记录，
 * 与问题状态分开保存：应用了修改候选不等于问题已经完成。
 */
export const ReviewResolutionMethodSchema = z.enum([
  '正文已手动修复', '候选已应用并复核', '无需修改', '重复问题', '风险已知仍忽略', '暂不处理', '其他'
])
export const ReviewResolutionSchema = z.object({
  method: ReviewResolutionMethodSchema,
  /** 处理理由；忽略类处理必须填写，供日后复核。 */
  reason: z.string().trim().max(2_000).default(''),
  resolvedAt: z.string(),
  /** 本次处理关联的修改候选；只做关联表达，不改写候选自身状态。 */
  proposalIds: z.array(z.string()).default([]),
  /** 声明“正文已手动修复”时必须附上新的正文证据。 */
  evidence: z.array(NovelMemorySourceSchema).default([])
}).superRefine((value, context) => {
  if (!value.reason && (value.method === '风险已知仍忽略' || value.method === '其他')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: '该处理方式必须填写处理理由。' })
  }
  if (value.method === '正文已手动修复' && value.evidence.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'], message: '记录“正文已手动修复”时必须关联新的正文证据。' })
  }
})

export const ReviewItemSchema = z.object({
  id: z.string(), chapterId: z.string().optional(), category: z.enum(['逻辑', '节奏', '角色', '文风', '连续性', '伏笔', '世界规则']),
  severity: z.enum(['高', '中', '低']), title: z.string(), description: z.string(), evidence: z.array(NovelMemorySourceSchema), recommendation: z.string(),
  status: z.enum(['待处理', '已完成', '已忽略']), createdAt: z.string(),
  /** 处理记录。旧问题没有该字段时保持缺失，不补造处理方式或时间。 */
  resolution: ReviewResolutionSchema.optional(),
  /** 与该问题关联的修改候选；仅表示关联关系，不表示问题已处理。 */
  linkedProposalIds: z.array(z.string()).optional()
})

/**
 * 审稿问题处理记录的完整度。旧项目里已标记完成/忽略但没有处理记录的问题
 * 会被标记为“缺少处理记录”，界面据此提示补录，而不是伪造一条完成记录。
 */
export const ReviewResolutionStateSchema = z.enum(['待处理', '已记录', '缺少处理记录'])
export function reviewResolutionState(item: Pick<ReviewItem, 'status' | 'resolution'>): z.infer<typeof ReviewResolutionStateSchema> {
  if (item.status === '待处理') return '待处理'
  return item.resolution ? '已记录' : '缺少处理记录'
}

/**
 * 正文段落补丁。补丁只使用稳定段落 ID 和明确的插入/替换/删除操作，
 * 并携带生成时的章节与逐段摘要；正文或目标段落变化后补丁必须失效，
 * 永远不能按字符串位置强制替换正文。
 */
export const ProsePatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('插入'), anchorBlockId: z.string().min(1), position: z.enum(['之前', '之后']), blocks: z.array(ProseBlockSchema).min(1).max(200) }),
  z.object({ op: z.literal('替换'), blockId: z.string().min(1), blocks: z.array(ProseBlockSchema).min(1).max(200) }),
  z.object({ op: z.literal('删除'), blockId: z.string().min(1) })
])
export const ProsePatchSchema = z.object({
  id: z.string().min(1), chapterId: z.string().min(1), baseRevision: z.number().int().nonnegative(),
  /** 生成补丁时的整章正文摘要；不一致即整体失效，禁止按字符偏移替换。 */
  baseChapterDigest: z.string().min(1),
  /** 生成补丁时每个被引用段落的摘要，用于逐段校验。 */
  baseBlockDigests: z.record(z.string(), z.string()).default({}),
  operations: z.array(ProsePatchOperationSchema).min(1).max(200),
  reason: z.string().max(2_000).default(''), createdAt: z.string().optional(),
  /** 补丁来源的审稿问题或修改候选，仅作关联表达。 */
  reviewId: z.string().min(1).optional(), proposalId: z.string().min(1).optional()
})
export const ProsePatchStateSchema = z.enum(['可应用', '章节不匹配', '正文已变化', '顺序冲突', '段落缺失', '段落已变化'])
export const ProsePatchBlockerSchema = z.object({
  code: ProsePatchStateSchema, blockId: z.string().optional(), message: z.string()
})
export const ProsePatchCheckSchema = z.object({
  state: ProsePatchStateSchema, applicable: z.boolean(), checkedAt: z.string(),
  currentRevision: z.number().int().nonnegative(), currentChapterDigest: z.string(),
  blockers: z.array(ProsePatchBlockerSchema)
})

/** 稳定段落摘要：只取决于段落 ID 与文本，不依赖位置。 */
export function proseBlockDigest(block: Pick<ProseBlock, 'id' | 'text'>): string {
  return fnv1a(`${block.id}\u0000${block.text}`)
}
export function chapterProseDigest(blocks: readonly Pick<ProseBlock, 'id' | 'text'>[]): string {
  return fnv1a(blocks.map((block) => `${block.id}\u0000${block.text}`).join('\u0001'))
}
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export interface ProsePatchTarget {
  chapterId: string
  revision: number
  chapterDigest: string
  blocks: ProseBlock[]
}

/**
 * 纯确定性校验：不写任何数据，也不调用 AI。返回的状态直接决定界面能否提供“应用”入口。
 */
export function validateProsePatch(patch: ProsePatch, target: ProsePatchTarget, checkedAt = new Date().toISOString()): ProsePatchCheck {
  const blockers: ProsePatchBlocker[] = []
  const fail = (code: ProsePatchBlocker['code'], message: string, blockId?: string): ProsePatchCheck => {
    blockers.push({ code, message, ...(blockId ? { blockId } : {}) })
    return { state: code, applicable: false, checkedAt, currentRevision: target.revision, currentChapterDigest: target.chapterDigest, blockers }
  }
  if (patch.chapterId !== target.chapterId) return fail('章节不匹配', '补丁目标章节与当前章节不一致。')
  if (patch.baseChapterDigest !== target.chapterDigest) return fail('正文已变化', '补丁生成后正文已变化，需要重新生成补丁。')

  const referenced: string[] = []
  for (const operation of patch.operations) {
    const blockId = operation.op === '插入' ? operation.anchorBlockId : operation.blockId
    if (referenced.includes(blockId)) {
      return fail('顺序冲突', `同一次补丁对段落 ${blockId} 存在多个操作。`, blockId)
    }
    referenced.push(blockId)
  }
  const present = new Map(target.blocks.map((block) => [block.id, block]))
  for (const blockId of referenced) {
    if (!present.has(blockId)) return fail('段落缺失', `段落 ${blockId} 在当前正文中不存在。`, blockId)
  }
  for (const blockId of referenced) {
    const baseDigest = patch.baseBlockDigests[blockId]
    if (!baseDigest) continue
    const block = present.get(blockId)!
    if (proseBlockDigest(block) !== baseDigest) return fail('段落已变化', `段落 ${blockId} 已被修改，补丁不能套用。`, blockId)
  }
  return { state: '可应用', applicable: true, checkedAt, currentRevision: target.revision, currentChapterDigest: target.chapterDigest, blockers }
}

/** 应用补丁；校验不通过时原样返回失败原因，绝不修改正文。 */
export function applyProsePatch(patch: ProsePatch, target: ProsePatchTarget, checkedAt = new Date().toISOString()):
  { ok: true; blocks: ProseBlock[]; check: ProsePatchCheck } | { ok: false; check: ProsePatchCheck } {
  const check = validateProsePatch(patch, target, checkedAt)
  if (!check.applicable) return { ok: false, check }
  let blocks = target.blocks.map((block) => ({ ...block }))
  for (const operation of patch.operations) {
    if (operation.op === '替换') {
      blocks = blocks.flatMap((block) => (block.id === operation.blockId ? operation.blocks.map((next) => ({ ...next })) : [block]))
      continue
    }
    if (operation.op === '删除') {
      blocks = blocks.filter((block) => block.id !== operation.blockId)
      continue
    }
    const index = blocks.findIndex((block) => block.id === operation.anchorBlockId)
    blocks = [...blocks.slice(0, operation.position === '之后' ? index + 1 : index), ...operation.blocks.map((next) => ({ ...next })), ...blocks.slice(operation.position === '之后' ? index + 1 : index)]
  }
  return { ok: true, blocks, check }
}

export const NovelProjectStatusSchema = z.enum(['待规划', '世界观草稿', '大纲草稿', '创作中', '已完成'])
const NovelProjectBaseSchema = z.object({
  schemaVersion: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]).transform(() => 7 as const), id: z.string(), title: z.string().min(1).max(120), seed: z.string(), settings: NovelSettingsSchema,
  status: NovelProjectStatusSchema, revision: z.number().int().nonnegative(),
  worldBible: WorldBibleSchema.optional(), outline: NovelOutlineSchema.optional(), chapters: z.array(ChapterSchema),
  creationMode: NovelCreationModeSchema.optional(),
  directionCards: z.array(StoryDirectionCardSchema).max(30).optional(),
  activeDirectionCardId: z.string().optional(),
  directionQuestions: z.array(z.string().max(500)).max(12).optional(),
  /** “重新提问”后的作者回答。与问题按下标对应，旧项目缺少时视为空回答。 */
  directionQuestionAnswers: z.array(z.string().max(2_000)).max(12).optional(),
  archived: z.boolean().optional(), archivedAt: z.string().optional(),
  memories: z.array(ChapterMemorySchema), plotThreads: z.array(NovelPlotThreadSchema), branches: z.array(NovelBranchSchema), reviews: z.array(ReviewItemSchema),
  /** 可跨卷、跨章纲批次延续的调查、战争、营救等重要事件线。 */
  storylines: z.array(NovelStorylineSchema).optional(),
  /** 新增世界实体先保存为候选，应用后仍保留影响分析和过渡计划。 */
  worldExpansionProposals: z.array(WorldExpansionProposalSchema).optional(),
  // 旧版 schemaVersion 2—6 读取时统一升级为 7，并补充新增默认字段；旧正文和版本历史不丢失。
  worldConstraints: z.array(WorldConstraintSchema).default([]),
  worldQualityFindings: z.array(WorldQualityFindingSchema).default([]),
  createdAt: z.string(), updatedAt: z.string()
})
export const NovelProjectSchema = NovelProjectBaseSchema.superRefine((project, context) => {
  const chapterNumbers = new Set<number>()
  project.chapters.forEach((chapter, index) => {
    if (chapterNumbers.has(chapter.chapterNumber)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['chapters', index, 'chapterNumber'], message: `第 ${chapter.chapterNumber} 章重复。` })
    chapterNumbers.add(chapter.chapterNumber)
  })
})

export const NovelProjectSummarySchema = z.object({
  description: z.string().optional(),
  id: z.string(), title: z.string(), status: NovelProjectStatusSchema, genreTemplate: GenreTemplateSchema,
  chapterCount: z.number().int().nonnegative(), wordCount: z.number().int().nonnegative(), pendingMemoryCount: z.number().int().nonnegative(), updatedAt: z.string(), archived: z.boolean().default(false),
  /** 项目大厅展示用的轻量摘要；不复制正文、世界观或历史数据。 */
  creationMode: NovelCreationModeSchema.default('标准创作'),
  planningProgress: z.number().int().min(0).max(100).default(0),
  writingProgress: z.number().int().min(0).max(100).default(0),
  health: z.object({
    pendingMemory: z.number().int().nonnegative().default(0),
    unresolvedThreads: z.number().int().nonnegative().default(0),
    overdueThreads: z.number().int().nonnegative().default(0),
    pendingReviews: z.number().int().nonnegative().default(0),
    staleOutlineCards: z.number().int().nonnegative().default(0),
    recoverableJobs: z.number().int().nonnegative().default(0)
  }).default({})
})

export const NovelVersionSummarySchema = z.object({
  id: z.string(), projectId: z.string(), revision: z.number().int().nonnegative(), reason: z.string(), source: z.string(), createdAt: z.string()
})

export function emptyWorldDetails(type: z.infer<typeof WorldEntryTypeSchema>): z.infer<typeof WorldEntrySchema>['details'] {
  if (type === '角色') return { role: '', identity: '', appearance: '', personality: '', values: [], boundaries: [], goal: '', weakness: '', secret: '', speechStyle: '', arc: '' }
  if (type === '修行体系') return { paths: [], techniques: [], professions: [], universalRules: [] }
  if (type === '国家') return { government: '', powerStructure: '', succession: '', administration: [], laws: [], military: '', population: '', diplomacy: [], classes: [], finance: '', territories: [] }
  if (type === '货币') return { issuer: '', material: '', denominations: [], circulation: [], taxation: '', trade: '', priceAnchors: [], restrictions: [] }
  return { fields: {}, lists: {} }
}

export type GenreTemplate = z.infer<typeof GenreTemplateSchema>
export type NovelSettings = z.infer<typeof NovelSettingsSchema>
export type NovelCreationMode = z.infer<typeof NovelCreationModeSchema>
export type WritingDetail = z.infer<typeof WritingDetailSchema>
export type WritingGenerationMode = z.infer<typeof WritingGenerationModeSchema>
export type StoryDirectionFieldStatus = z.infer<typeof StoryDirectionFieldStatusSchema>
export type StoryDirectionFieldStatuses = z.infer<typeof StoryDirectionFieldStatusesSchema>
export type StoryDirectionFieldKey = keyof StoryDirectionFieldStatuses
export type StoryDirectionCard = z.infer<typeof StoryDirectionCardSchema>
export type StyleProfileTraits = z.infer<typeof StyleProfileTraitsSchema>
export type StyleProfileDraft = z.infer<typeof StyleProfileDraftSchema>
export type StyleProfile = z.infer<typeof StyleProfileSchema>
export type StyleProfileSnapshot = z.infer<typeof StyleProfileSnapshotSchema>
export type StyleProfileUsage = z.infer<typeof StyleProfileUsageSchema>
export type StyleSampleKind = z.infer<typeof StyleSampleKindSchema>
export type StyleSampleSegment = z.infer<typeof StyleSampleSegmentSchema>
export type StyleSample = z.infer<typeof StyleSampleSchema>
export type StyleSamplePreview = z.infer<typeof StyleSamplePreviewSchema>
export type ImportStyleSample = z.infer<typeof ImportStyleSampleSchema>
export type ImportStyleSampleFile = z.infer<typeof ImportStyleSampleFileSchema>
export type AnalyzeStyleSample = z.infer<typeof AnalyzeStyleSampleSchema>
export type BindStyleProfile = z.infer<typeof BindStyleProfileSchema>
export type StyleTrial = z.infer<typeof StyleTrialSchema>
export type CreateStyleTrial = z.infer<typeof CreateStyleTrialSchema>
export type WorldEntryType = z.infer<typeof WorldEntryTypeSchema>
export type WorldEntry = z.infer<typeof WorldEntrySchema>
export type WorldBible = z.infer<typeof WorldBibleSchema>
export type WorldFieldEvidence = z.infer<typeof WorldFieldEvidenceSchema>
export type WorldConstraint = z.infer<typeof WorldConstraintSchema>
export type WorldQualityFinding = z.infer<typeof WorldQualityFindingSchema>
export type SceneQualityFinding = z.infer<typeof SceneQualityFindingSchema>
export type SceneBeat = z.infer<typeof SceneBeatSchema>
export type BeatStatus = z.infer<typeof BeatStatusSchema>
export type BeatFinding = z.infer<typeof BeatFindingSchema>
export type NovelOutline = z.infer<typeof NovelOutlineSchema>
export type VolumeOutline = z.infer<typeof VolumeOutlineSchema>
export type ChapterOutline = z.infer<typeof ChapterOutlineSchema>
export type OutlineStructureOperation = z.infer<typeof OutlineStructureOperationSchema>
export type OutlineStructureEditRequest = z.infer<typeof OutlineStructureEditRequestSchema>
export type OutlineStructureImpact = z.infer<typeof OutlineStructureImpactSchema>
export type Chapter = z.infer<typeof ChapterSchema>
export type ChapterHandoffStatus = z.infer<typeof ChapterHandoffStatusSchema>
export type ChapterRetro = z.infer<typeof ChapterRetroSchema>
export type ProseBlock = z.infer<typeof ProseBlockSchema>
export type ProsePatch = z.infer<typeof ProsePatchSchema>
export type ProsePatchOperation = z.infer<typeof ProsePatchOperationSchema>
export type ProsePatchState = z.infer<typeof ProsePatchStateSchema>
export type ProsePatchBlocker = z.infer<typeof ProsePatchBlockerSchema>
export type ProsePatchCheck = z.infer<typeof ProsePatchCheckSchema>
export type ChapterMemory = z.infer<typeof ChapterMemorySchema>
export type CharacterState = z.infer<typeof CharacterStateSchema>
export type StoryFact = z.infer<typeof StoryFactSchema>
export type MemoryPerspective = z.infer<typeof MemoryPerspectiveSchema>
export type MemoryProposalAcceptanceState = z.infer<typeof MemoryProposalAcceptanceStateSchema>
export type MemoryProposalBatchBlocker = z.infer<typeof MemoryProposalBatchBlockerSchema>
export type MemoryProposalBatchResolveResult = z.infer<typeof MemoryProposalBatchResolveResultSchema>
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>
export type NovelPlotThread = z.infer<typeof NovelPlotThreadSchema>
export type NovelBranch = z.infer<typeof NovelBranchSchema>
export type BranchFreshnessState = z.infer<typeof BranchFreshnessStateSchema>
export type PlotThreadRevision = z.infer<typeof PlotThreadRevisionSchema>
export type PlotThreadEvidence = z.infer<typeof PlotThreadEvidenceSchema>
export type PlotThreadEvidencePhase = z.infer<typeof PlotThreadEvidencePhaseSchema>
export type PlotThreadCognition = z.infer<typeof PlotThreadCognitionSchema>
export type PlotThreadReadiness = z.infer<typeof PlotThreadReadinessSchema>
export type NovelProject = z.infer<typeof NovelProjectSchema>
export type NovelProjectSummary = z.infer<typeof NovelProjectSummarySchema>
export type NovelVersionSummary = z.infer<typeof NovelVersionSummarySchema>
export type ReviewItem = z.infer<typeof ReviewItemSchema>
export type ReviewResolution = z.infer<typeof ReviewResolutionSchema>
export type ReviewResolutionMethod = z.infer<typeof ReviewResolutionMethodSchema>
export type ReviewResolutionState = z.infer<typeof ReviewResolutionStateSchema>
