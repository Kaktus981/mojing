import { z } from 'zod'
import { NovelGenerationKindSchema } from './novelApi'
import { AssistantRunPreviewSchema, AssistantSelectionSchema, AssistantSkillLoadReceiptSchema, AssistantTargetSchema, AssistantTaskTypeSchema, WorkflowIntentSchema } from './assistantWorkflow'

/** 创作对话只服务于当前项目，不会把聊天内容直接写入正文或设定。 */
export const CreativeChatStageSchema = z.enum(['idea', 'world', 'outline', 'writing', 'memory', 'delivery'])
export const CreativeChatModeSchema = z.enum(['灵感讨论', '问题分析', '生成准备', '综合协作'])
export const CreativeChatRoleSchema = z.enum(['user', 'assistant'])
export const ProjectAssistantModeContentSchema = z.object({
  title: z.string(), description: z.string(), prompts: z.array(z.string()).min(1).max(6), placeholder: z.string()
})
export const ProjectCreativeAssistantSchema = z.object({
  id: z.string(), projectId: z.string(), stage: CreativeChatStageSchema,
  name: z.string(), role: z.string(), welcome: z.string(), focusAreas: z.array(z.string()).min(1),
  modes: z.object({
    灵感讨论: ProjectAssistantModeContentSchema,
    问题分析: ProjectAssistantModeContentSchema,
    生成准备: ProjectAssistantModeContentSchema
  }),
  allowedGenerationKinds: z.array(NovelGenerationKindSchema),
  conversationCount: z.number().int().nonnegative()
})
export const CreativeChatReferenceSchema = z.object({ title: z.string(), reason: z.string() })
export const CreativeChatActionSchema = z.object({
  label: z.string(),
  instruction: z.string(),
  kind: NovelGenerationKindSchema,
  chapterId: z.string().optional(),
  volumeNumber: z.number().int().positive().optional(),
  worldEntryType: z.string().optional(),
  proposalId: z.string().optional(),
  findingId: z.string().optional()
})
export const CreativeChatMessageSchema = z.object({
  id: z.string(), conversationId: z.string(), role: CreativeChatRoleSchema,
  content: z.string(), mode: CreativeChatModeSchema, references: z.array(CreativeChatReferenceSchema),
  actions: z.array(CreativeChatActionSchema), projectRevision: z.number().int().nonnegative(), createdAt: z.string()
})
export const CreativeConversationSchema = z.object({
  id: z.string(), projectId: z.string(), assistantId: z.string(), stage: CreativeChatStageSchema, targetId: z.string(),
  title: z.string(), createdAt: z.string(), updatedAt: z.string(), messageCount: z.number().int().nonnegative()
})
/**
 * `target` / `taskType` / `selection` 是**作者当前作用域的报告**，不是权限声明：
 * 服务端会按任务白名单和对象归属重新解析，跨项目或不存在的目标一律拒绝。
 * 旧客户端不传这些字段时行为不变（`stage` 仍作为粗粒度阶段使用）。
 */
export const CreativeChatSendSchema = z.object({
  conversationId: z.string().optional(), assistantId: z.string().optional(), stage: CreativeChatStageSchema, targetId: z.string().optional(),
  mode: CreativeChatModeSchema, content: z.string().min(1).max(8_000), providerId: z.string().min(1).optional(),
  retainFailedConversation: z.boolean().optional().default(false),
  allowCandidateActions: z.boolean().optional().default(false),
  target: AssistantTargetSchema.optional(),
  taskType: AssistantTaskTypeSchema.optional(),
  intent: WorkflowIntentSchema.optional(),
  selection: AssistantSelectionSchema.optional()
})
export const CreativeChatReplySchema = z.object({
  answer: z.string(), references: z.array(CreativeChatReferenceSchema), actions: z.array(CreativeChatActionSchema)
})
export const CreativeChatResponseSchema = z.object({
  conversation: CreativeConversationSchema,
  messages: z.array(CreativeChatMessageSchema),
  /** 本次调用实际使用的上下文与配置；由服务端解析后回传，供界面如实展示。 */
  context: AssistantRunPreviewSchema.shape.context.optional(),
  effective: AssistantRunPreviewSchema.shape.effective.optional(),
  /** 只有模型调用成功后才返回；预览不会产生收据。 */
  skillLoadReceipt: AssistantSkillLoadReceiptSchema.optional()
})

export type CreativeChatStage = z.infer<typeof CreativeChatStageSchema>
export type CreativeChatMode = z.infer<typeof CreativeChatModeSchema>
export type ProjectAssistantModeContent = z.infer<typeof ProjectAssistantModeContentSchema>
export type ProjectCreativeAssistant = z.infer<typeof ProjectCreativeAssistantSchema>
export type CreativeChatReference = z.infer<typeof CreativeChatReferenceSchema>
export type CreativeChatAction = z.infer<typeof CreativeChatActionSchema>
export type CreativeChatMessage = z.infer<typeof CreativeChatMessageSchema>
export type CreativeConversation = z.infer<typeof CreativeConversationSchema>
export type CreativeChatSend = z.input<typeof CreativeChatSendSchema>
export type CreativeChatResponse = z.infer<typeof CreativeChatResponseSchema>
