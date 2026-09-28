import { z } from 'zod'

/**
 * 跨章节剧情线的最小结构。
 *
 * 它与“伏笔”不同：伏笔记录一个待回收的信息点，剧情线记录一个需要
 * 经历过程、产生状态变化并最终收束的长期事件（调查、营救、战争等）。
 * 所有字段都是作者可编辑的资料，不会自动把规划变成正式正文。
 */
export const StorylineStatusSchema = z.enum(['未开始', '推进中', '等待条件', '计划暂停', '长期悬置', '已完成', '已放弃'])
export const StorylinePauseScopeSchema = z.enum(['下一章', '当前批次', '当前剧情阶段', '本卷', '指定后续卷', '等待事件触发', '作者暂未决定'])
export const StorylineReturnPositionSchema = z.enum(['下一章开头', '当前批次下一个可用章节', '当前剧情阶段下一节点', '本卷后半段', '指定后续卷', '等待条件满足后决定'])

export const StorylineEvidenceSchema = z.object({
  chapterId: z.string().min(1), blockId: z.string().optional(), excerpt: z.string().min(1)
})

export const StorylineKeyNodeSchema = z.object({
  id: z.string().min(1), title: z.string().min(1).max(200), description: z.string().max(2_000),
  targetChapterNumber: z.number().int().positive().optional(), status: z.enum(['未开始', '进行中', '已完成', '已取消']).default('未开始'),
  evidence: z.array(StorylineEvidenceSchema).default([])
})

export const StorylineChapterPlanSchema = z.object({
  chapterId: z.string().min(1), chapterNumber: z.number().int().positive(),
  subGoal: z.string().max(2_000), method: z.string().max(2_000), obstacle: z.string().max(2_000),
  outcome: z.string().max(2_000), nextTrigger: z.string().max(2_000),
  /** 至少写出一个可观察的变化，避免“做了事但剧情没有推进”。 */
  changes: z.array(z.enum(['信息', '目标', '关系', '风险', '资源', '地点', '势力', '伏笔', '决定', '人物认知', '无变化'])).max(12).default([]),
  status: z.enum(['计划', '已完成', '已跳过', '待复核']).default('计划'), sourceDigest: z.string().optional(),
  evidence: z.array(StorylineEvidenceSchema).default([])
})

/** 一章最多 1 条主线和 2 条辅助线；这是软性创作建议而非不可突破的全局上限。 */
export const ChapterLineAssignmentSchema = z.object({
  lineId: z.string().min(1), role: z.enum(['主线', '辅助线']), purpose: z.string().max(1_000).optional(),
  /** 允许作者说明高潮等例外；普通情况下仍由校验器给出提醒。 */
  exceptionReason: z.string().max(1_000).optional()
})

/**
 * 该数组只限制异常大的输入；“一主线、两辅助线”是软规则，不能在
 * 数据层硬拒绝阶段高潮等合理例外，具体提醒由 core 的评估工具生成。
 */
export const ChapterLineAssignmentsSchema = z.array(ChapterLineAssignmentSchema).max(12)

export const StorylinePauseSchema = z.object({
  reason: z.string().min(1).max(2_000), currentState: z.string().max(2_000), unresolvedQuestions: z.array(z.string().max(500)).max(20).default([]),
  returnCondition: z.string().max(2_000), expectedReturnPosition: StorylineReturnPositionSchema,
  expectedReturnChapterNumber: z.number().int().positive().optional(), latestAllowedChapterNumber: z.number().int().positive().optional(),
  scope: StorylinePauseScopeSchema, behindTheScenesChange: z.string().max(2_000).default(''), pausedAtChapterNumber: z.number().int().positive().optional()
})

export const NovelStorylineSchema = z.object({
  id: z.string().min(1), title: z.string().min(1).max(200), type: z.string().max(80), whyNecessary: z.string().max(2_000),
  startChapterId: z.string().optional(), startChapterNumber: z.number().int().positive().optional(), expectedEndChapterNumber: z.number().int().positive().optional(),
  openingState: z.string().max(2_000), finalGoal: z.string().max(2_000), endCondition: z.string().max(2_000),
  characterIds: z.array(z.string()).max(100).default([]), entryIds: z.array(z.string()).max(100).default([]), relatedPlotThreadIds: z.array(z.string()).max(100).default([]),
  keyNodes: z.array(StorylineKeyNodeSchema).max(200).default([]), chapterPlans: z.array(StorylineChapterPlanSchema).max(10_000).default([]),
  currentProgress: z.number().min(0).max(1).default(0), costPaid: z.string().max(2_000).default(''), unresolvedQuestions: z.array(z.string().max(500)).max(50).default([]),
  nextAction: z.string().max(2_000).default(''), status: StorylineStatusSchema.default('未开始'), pause: StorylinePauseSchema.optional(),
  evidenceChain: z.array(StorylineEvidenceSchema).default([]), updatedAt: z.string()
}).superRefine((line, context) => {
  if (line.status === '计划暂停' && !line.pause) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pause'], message: '剧情线暂停时必须记录暂停原因和返回条件。' })
  if (line.startChapterNumber && line.expectedEndChapterNumber && line.expectedEndChapterNumber < line.startChapterNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedEndChapterNumber'], message: '预计结束章节不能早于开始章节。' })
})

/** 近期详细章纲窗口的持久化描述；事件线本身可以超出该窗口。 */
export const RollingOutlineWindowSchema = z.object({
  currentChapterNumber: z.number().int().positive(), detailStartChapterNumber: z.number().int().positive(), detailEndChapterNumber: z.number().int().positive(),
  windowSize: z.number().int().min(10).max(30).default(20), coarseThroughChapterNumber: z.number().int().positive().optional(), updatedAt: z.string()
}).superRefine((window, context) => {
  if (window.detailEndChapterNumber < window.detailStartChapterNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['detailEndChapterNumber'], message: '详细规划结束章节不能早于开始章节。' })
  if (window.currentChapterNumber < window.detailStartChapterNumber || window.currentChapterNumber > window.detailEndChapterNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['currentChapterNumber'], message: '当前章节必须位于近期详细规划窗口内。' })
})

export type StorylineStatus = z.infer<typeof StorylineStatusSchema>
export type StorylinePause = z.infer<typeof StorylinePauseSchema>
export type StorylineKeyNode = z.infer<typeof StorylineKeyNodeSchema>
export type StorylineChapterPlan = z.infer<typeof StorylineChapterPlanSchema>
export type ChapterLineAssignment = z.infer<typeof ChapterLineAssignmentSchema>
export type NovelStoryline = z.infer<typeof NovelStorylineSchema>
export type RollingOutlineWindow = z.infer<typeof RollingOutlineWindowSchema>
