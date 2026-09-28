import type {
  AiUsageRecord,
  AnswerAssistantGuide,
  AssistantGuideDomain,
  AssistantGuideSession,
  CreativeCapability, CreativeOrchestrationRun, CreativeSeat, CreateCreativeCapabilityInput, CreativeSkillPreviewResult,
  CreateNovelInput, EntityMention, MemoryProposal, MemoryProposalBatchResolveResult, MemoryProposalBatchDecision, ManualMemoryRevisionRequest, ManualMemoryRevisionResult, MojingClient, NovelGenerationEstimate, NovelGenerationEvent, NovelGenerationJob, NovelMemoryHealth,
  NovelMemoryRecall,
  NovelGenerationRequest, NovelProject, NovelProjectSummary, NovelRevisionProposal, NovelVersionSummary,
  NovelOrchestrationPlan, NovelOrchestrationPlanRequest,
  OutlineStructureEditRequest, OutlineStructurePreviewResponse,
  ProviderConfigInput, ProviderConfigPublic,
  StartAssistantGuide
} from '../../../../packages/contracts/src'
import type { CreativeChatMessage, CreativeChatResponse, CreativeChatSend, CreativeChatStage, CreativeConversation } from '../../../../packages/contracts/src'
import type {
  AssistantAdoptPreview, AssistantCandidateRecord, AssistantDraft, ApplyAssistantDraft, AssistantRunPreview,
  AnswerGuideSlot, AssistantRunPreviewRequest, AssistantTaskConfiguration, AssistantTaskType, CreateAssistantDraft,
  GenerateLocalRevision,
  AnalyzeStyleSample, ChapterAnalysisTask, CreateChapterAnalysis, CreateStyleTrial, CreateWorldExpansion,
  ImportStyleSample, ImportStyleSampleFile, StyleProfile, StyleProfileDraft, StyleProfileUsage,
  StyleSample, StyleSamplePreview, StyleTrial,
  WorldExpansionProposal, WorldSettingSimilarity,
  GuideQuestion, GuideReadiness, GuideSession, UpdateAssistantDraft
} from '../../../../packages/contracts/src'

/** 恢复差异预览（与 NovelVersionRestorePreviewSchema 一致）。 */
export type NovelVersionRestorePreviewPayload = {
  projectId: string; versionId: string; targetRevision: number; currentRevision: number
  previewDigest: string; createdAt: string
  diffs: Array<{ scope: string; changed: number; added: number; removed: number; sample: string[] }>
}

/** 技能中心第一阶段的可选远程来源与版本元数据。服务端仍可只返回旧能力字段。 */
export type RemoteCreativeSkillPreviewResult = CreativeSkillPreviewResult & {
  source: { sourceKind: 'remote'; sourceUrl: string; sourceRef: string; sourcePinnedAt: string; sourceDigest: string }
  sourceUrl?: string
  sourceRef?: string
  sourceKind?: 'remote' | '远程'
}
export type RemoteCreativeSkillUpdatePreviewResult = CreativeSkillPreviewResult & {
  capabilityId: string
  currentDigest: string
  changed: boolean
  source: { sourceKind: 'remote'; sourceUrl: string; sourceRef: string; sourcePinnedAt: string; sourceDigest: string }
}
export type CreativeSkillVersionRecord = {
  id: string
  version?: string
  skillVersion?: string
  revision?: number
  sourceDigest: string
  sourceUrl?: string
  sourceRef?: string
  createdAt: string
  active?: boolean
}
export type CreativeSkillCatalogRecord = CreativeCapability & {
  status?: '已停用' | '已启用' | '已加载' | string
  loaded?: boolean
  loadedStages?: string[]
  loadedAt?: string
  versionCount?: number
}

export class MojingHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable: boolean, readonly details?: unknown) { super(message) }
}

export class HttpMojingClient implements MojingClient {
  private readonly apiBaseUrl: string
  private readonly token: string
  constructor(config = resolveRuntimeConfig()) { this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, ''); this.token = config.token }

  novels = {
    list: (): Promise<NovelProjectSummary[]> => this.request('/api/novels'),
    create: (input: CreateNovelInput): Promise<NovelProject> => this.request('/api/novels', { method: 'POST', body: input }),
    importFile: async (file: File): Promise<NovelProject> => { const body = new FormData(); body.append('file', file, file.name); return this.request('/api/novels/import', { method: 'POST', formData: body }) },
    get: (id: string): Promise<NovelProject> => this.request(`/api/novels/${encodeURIComponent(id)}`),
    save: (document: NovelProject, baseRevision: number): Promise<NovelProject> => this.request(`/api/novels/${encodeURIComponent(document.id)}`, { method: 'PUT', body: { document, baseRevision } }),
    remove: (id: string): Promise<void> => this.request(`/api/novels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // Archiving keeps the project and all of its evidence; it only flips the
    // `archived` / `archivedAt` flags. Restoring is the same call with `false`.
    archive: (id: string, archived: boolean): Promise<NovelProject> => this.request(`/api/novels/${encodeURIComponent(id)}/archive`, { method: 'PUT', body: { archived } }),
    /**
     * 大纲结构编辑预览：只产出候选项与影响摘要，正式变更仍需作者确认后走候选应用。
     */
    outlineStructure: {
      preview: (projectId: string, input: OutlineStructureEditRequest): Promise<OutlineStructurePreviewResponse> =>
        this.request(`/api/novels/${encodeURIComponent(projectId)}/outline-structure/preview`, { method: 'POST', body: input })
    }
  }
  generations = {
    estimate: (projectId: string, request: NovelGenerationRequest): Promise<NovelGenerationEstimate> => this.request(`/api/novels/${encodeURIComponent(projectId)}/generations/estimate`, { method: 'POST', body: request }),
    start: (projectId: string, request: NovelGenerationRequest): Promise<{ jobId: string }> => this.request(`/api/novels/${encodeURIComponent(projectId)}/generations`, { method: 'POST', body: request }),
    list: (projectId: string): Promise<NovelGenerationJob[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/generation-jobs`),
    recoverable: (projectId: string): Promise<NovelGenerationJob[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/recoverable-jobs`),
    get: (jobId: string): Promise<NovelGenerationJob> => this.request(`/api/jobs/${encodeURIComponent(jobId)}`),
    resume: (jobId: string): Promise<{ jobId: string; resumedFromJobId: string }> => this.request(`/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' }),
    subscribe: (jobId: string, callback: (event: NovelGenerationEvent) => void): (() => void) => { const controller = new AbortController(); void this.consumeEvents(jobId, callback, controller.signal); return () => controller.abort() },
    cancel: (jobId: string): Promise<void> => this.request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
  }
  revisions = {
    list: (projectId: string): Promise<NovelRevisionProposal[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/revision-proposals`),
    update: (id: string, candidate: unknown): Promise<NovelRevisionProposal> => this.request(`/api/revisions/${encodeURIComponent(id)}`, { method: 'PUT', body: { candidate } }),
    apply: (id: string, currentRevision: number, allowConflict = false, allowQualityConflict = false): Promise<NovelProject> => this.request(`/api/revisions/${encodeURIComponent(id)}/apply`, { method: 'POST', body: { currentRevision, allowConflict, allowQualityConflict, qualityConflictReason: allowQualityConflict ? '作者已在候选质量面板确认忽略高风险问题' : undefined } }),
    resolveQuality: (id: string, findingId: string, action: '接受修复' | '忽略', replacement?: string): Promise<NovelRevisionProposal> => this.request(`/api/revisions/${encodeURIComponent(id)}/quality/${encodeURIComponent(findingId)}`, { method: 'PUT', body: { action, replacement } }),
    reject: (id: string): Promise<void> => this.request(`/api/revisions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    resolveBatch: (projectId: string, currentRevision: number, decisions: Array<{ proposalId: string; action: '应用' | '放弃' }>): Promise<{ status: '全部成功'; processedIds: string[]; committedRevision: number }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/revisions/batch`, { method: 'POST', body: { currentRevision, decisions } })
  }
  branches = {
    adopt: (projectId: string, branchId: string, currentRevision: number, branchChapterId?: string): Promise<NovelRevisionProposal> => this.request(`/api/novels/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/adopt`, { method: 'POST', body: { currentRevision, branchChapterId } })
  }
  memory = {
    list: (projectId: string): Promise<MemoryProposal[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/memory-proposals`),
    resolve: (id: string, status: '已接受' | '已拒绝', currentRevision: number, candidate?: unknown): Promise<NovelProject> => this.request(`/api/memory-proposals/${encodeURIComponent(id)}`, { method: 'PUT', body: { status, currentRevision, candidate } }),
    resolveBatch: (projectId: string, currentRevision: number, decisions: MemoryProposalBatchDecision[]): Promise<MemoryProposalBatchResolveResult> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/memory-proposals/batch`, { method: 'POST', body: { currentRevision, decisions } }),
    manualBaseline: (projectId: string, chapterId: string, category: ManualMemoryRevisionRequest['category'], targetId?: string): Promise<{ currentRevision: number; sourceDigest: string; baseTargetDigest: string; before: unknown }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/memory-proposals/manual-baseline?chapterId=${encodeURIComponent(chapterId)}&category=${encodeURIComponent(category)}${targetId ? `&targetId=${encodeURIComponent(targetId)}` : ''}`),
    createManual: (projectId: string, input: ManualMemoryRevisionRequest): Promise<ManualMemoryRevisionResult> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/memory-proposals/manual`, { method: 'POST', body: input }),
    health: (projectId: string): Promise<NovelMemoryHealth> => this.request(`/api/novels/${encodeURIComponent(projectId)}/memory-health`),
    recall: (projectId: string, chapterNumber: number, characterIds: string[] = []): Promise<NovelMemoryRecall[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/memory-recall?chapterNumber=${chapterNumber}${characterIds.length ? `&characterIds=${encodeURIComponent(characterIds.join(','))}` : ''}`)
  }
  mentions = {
    list: (projectId: string, entryId?: string): Promise<EntityMention[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/mentions${entryId ? `?entryId=${encodeURIComponent(entryId)}` : ''}`)
  }
  orchestration = {
    plan: (projectId: string, request: NovelOrchestrationPlanRequest): Promise<NovelOrchestrationPlan> => this.request(`/api/novels/${encodeURIComponent(projectId)}/agent-plans/preview`, { method: 'POST', body: request })
  }
  creativeChat = {
    list: (projectId: string, stage?: CreativeChatStage): Promise<CreativeConversation[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-conversations${stage ? `?stage=${encodeURIComponent(stage)}` : ''}`),
    messages: (projectId: string, conversationId: string): Promise<CreativeChatMessage[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-conversations/${encodeURIComponent(conversationId)}/messages`),
    send: (projectId: string, input: CreativeChatSend): Promise<CreativeChatResponse> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-chat`, { method: 'POST', body: input }),
    remove: (projectId: string, conversationId: string): Promise<void> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
  }
  assistantGuides = {
    current: (projectId: string, domain: AssistantGuideDomain, scopeKey: string): Promise<AssistantGuideSession | null> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-guides/current?domain=${encodeURIComponent(domain)}&scopeKey=${encodeURIComponent(scopeKey)}`),
    start: (projectId: string, input: StartAssistantGuide): Promise<AssistantGuideSession> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-guides/start`, { method: 'POST', body: input }),
    answer: (projectId: string, sessionId: string, input: AnswerAssistantGuide): Promise<AssistantGuideSession> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-guides/${encodeURIComponent(sessionId)}/answer`, { method: 'PUT', body: input }),
    reanalyze: (projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-guides/${encodeURIComponent(sessionId)}/reanalyze`, { method: 'POST', body: { expectedVersion } }),
    complete: (projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-guides/${encodeURIComponent(sessionId)}/complete`, { method: 'POST', body: { expectedVersion } }),
    restart: (projectId: string, sessionId: string, expectedVersion: number): Promise<AssistantGuideSession> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-guides/${encodeURIComponent(sessionId)}/restart`, { method: 'POST', body: { expectedVersion } })
  }
  /** 调用前预览「本次使用」：只读计算，不发起模型调用。 */
  assistantRuns = {
    preview: (projectId: string, input: AssistantRunPreviewRequest): Promise<AssistantRunPreview> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-runs/preview`, { method: 'POST', body: input })
  }
  /** 任务级模型/技能覆盖（任务专用选择 > 项目默认）。 */
  assistantTasks = {
    list: (projectId: string): Promise<AssistantTaskConfiguration[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-task-configurations`),
    save: (projectId: string, taskType: AssistantTaskType, input: { enabled?: boolean; providerId?: string | null; capabilityIds?: string[] | null }): Promise<AssistantTaskConfiguration> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-task-configurations/${encodeURIComponent(taskType)}`, { method: 'PUT', body: input }),
    remove: (projectId: string, taskType: AssistantTaskType): Promise<void> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-task-configurations/${encodeURIComponent(taskType)}`, { method: 'DELETE' })
  }
  /** 技能导入：先预览（含重复提示），确认后再安装（安装默认停用）。 */
  creativeSkills = {
    catalog: (projectId: string): Promise<CreativeSkillCatalogRecord[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-skills`),
    preview: (projectId: string, input: { filename: string; content: string }): Promise<CreativeSkillPreviewResult> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-skills/preview`, { method: 'POST', body: input }),
    install: (projectId: string, input: { filename: string; content: string; expectedDigest?: string }): Promise<CreativeCapability> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-skills/install`, { method: 'POST', body: input }),
    remotePreview: (projectId: string, input: { url: string; expectedRef?: string }): Promise<RemoteCreativeSkillPreviewResult> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-skills/remote/preview`, { method: 'POST', body: input }),
    remoteInstall: (projectId: string, input: { url: string; expectedRef?: string; expectedDigest?: string }): Promise<CreativeCapability> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-skills/remote/install`, { method: 'POST', body: input }),
    versions: (projectId: string, capabilityId: string): Promise<CreativeSkillVersionRecord[]> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}/versions`),
    remoteUpdatePreview: (projectId: string, capabilityId: string, input: { url: string; expectedRef?: string }): Promise<RemoteCreativeSkillUpdatePreviewResult> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}/update/preview`, { method: 'POST', body: input }),
    updateRemote: (projectId: string, capabilityId: string, input: { url?: string; expectedRef?: string; expectedDigest?: string; previewDigest?: string }): Promise<CreativeCapability> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}/update`, { method: 'PUT', body: input }),
    rollback: (projectId: string, capabilityId: string, versionId: string): Promise<CreativeCapability> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}/rollback`, { method: 'POST', body: { versionId } })
  }
  /** 工作草稿与候选（D3）：草稿不是正式内容，采用必须走预览摘要校验。 */
  assistantDrafts = {
    list: (projectId: string, scopeKey?: string): Promise<AssistantDraft[]> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-drafts${scopeKey ? `?scopeKey=${encodeURIComponent(scopeKey)}` : ''}`),
    create: (projectId: string, input: CreateAssistantDraft): Promise<{ draft: AssistantDraft; keptAuthorEdits: boolean }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-drafts`, { method: 'POST', body: input }),
    preview: (projectId: string, draftId: string): Promise<AssistantAdoptPreview> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-drafts/${encodeURIComponent(draftId)}/preview`),
    update: (projectId: string, draftId: string, input: UpdateAssistantDraft): Promise<AssistantDraft> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-drafts/${encodeURIComponent(draftId)}`, { method: 'PUT', body: input }),
    apply: (projectId: string, draftId: string, input: ApplyAssistantDraft): Promise<NovelProject> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-drafts/${encodeURIComponent(draftId)}/apply`, { method: 'POST', body: input }),
    discard: (projectId: string, draftId: string): Promise<void> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }),
    records: (projectId: string, scopeKey?: string): Promise<AssistantCandidateRecord[]> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/assistant-candidate-records${scopeKey ? `?scopeKey=${encodeURIComponent(scopeKey)}` : ''}`)
  }
  /** 大纲引导与初纲候选（D1/D2）。 */
  outlineGuide = {
    get: (projectId: string): Promise<{ session: GuideSession | null; question: GuideQuestion | null; readiness: GuideReadiness }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/outline-guide`),
    start: (projectId: string): Promise<{ session: GuideSession; question: GuideQuestion | null; readiness: GuideReadiness }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/outline-guide/start`, { method: 'POST' }),
    answer: (projectId: string, input: AnswerGuideSlot): Promise<{ session: GuideSession; question: GuideQuestion | null; readiness: GuideReadiness }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/outline-guide/answers`, { method: 'PUT', body: input }),
    generate: (projectId: string): Promise<{ draftId: string; pending: string[] }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/outline-guide/generate`, { method: 'POST' })
  }
  /** 局部修改 / 分批细化（D1/D3）：范围由服务端校验，模型只能给出改动文字。 */
  outlineRevisions = {
    generate: (projectId: string, input: GenerateLocalRevision): Promise<{ draft: AssistantDraft; keptAuthorEdits: boolean }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/outline-revisions/generate`, { method: 'POST', body: input })
  }
  /** 文笔工坊（D4）：导入样文零模型请求，只有分析勾选片段才发送。 */
  styleSamples = {
    list: (): Promise<StyleSample[]> => this.request('/api/style-samples'),
    preview: (input: ImportStyleSample): Promise<StyleSamplePreview> => this.request('/api/style-samples/preview', { method: 'POST', body: input }),
    create: (input: ImportStyleSample): Promise<StyleSample> => this.request('/api/style-samples', { method: 'POST', body: input }),
    /** 文件型样文（TXT / Markdown / DOCX / EPUB）：取文在服务端内存里完成，同样零模型请求。 */
    previewFile: (input: ImportStyleSampleFile): Promise<StyleSamplePreview> => this.request('/api/style-samples/preview-file', { method: 'POST', body: input }),
    createFile: (input: ImportStyleSampleFile): Promise<StyleSample> => this.request('/api/style-samples/import-file', { method: 'POST', body: input }),
    remove: (sampleId: string): Promise<void> => this.request(`/api/style-samples/${encodeURIComponent(sampleId)}`, { method: 'DELETE' })
  }
  styleProfiles = {
    list: (): Promise<StyleProfile[]> => this.request('/api/style-profiles'),
    usage: (projectId: string): Promise<StyleProfileUsage[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/style-profile/usage`),
    create: (draft: StyleProfileDraft): Promise<StyleProfile> => this.request('/api/style-profiles', { method: 'POST', body: draft }),
    update: (profileId: string, patch: Partial<StyleProfileDraft>): Promise<StyleProfile> =>
      this.request(`/api/style-profiles/${encodeURIComponent(profileId)}`, { method: 'PUT', body: patch }),
    remove: (profileId: string): Promise<void> => this.request(`/api/style-profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' }),
    /** 只发送勾选片段；返回候选画像与实际证据，不自动绑定。 */
    analyze: (input: AnalyzeStyleSample): Promise<{ profile: StyleProfile; evidence: string[]; sentCharacterCount: number }> =>
      this.request('/api/style-profiles/analyze', { method: 'POST', body: input }),
    bind: (projectId: string, profileId: string): Promise<NovelProject> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/style-profile/bind`, { method: 'POST', body: { profileId } }),
    unbind: (projectId: string): Promise<NovelProject> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/style-profile/bind`, { method: 'DELETE' }),
    /** 同场景试写：两份都走真实调用路径，结果只作为候选，不写入正文。 */
    trial: (projectId: string, input: CreateStyleTrial): Promise<StyleTrial> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/style-trials`, { method: 'POST', body: input })
  }
  /** 设定提案（D6）：手动暂存 / AI 建议 / 正文发现统一收纳。 */
  settingProposals = {
    list: (projectId: string): Promise<WorldExpansionProposal[]> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/setting-proposals`),
    preview: (projectId: string, input: CreateWorldExpansion): Promise<{ preview: unknown; similar: WorldSettingSimilarity[]; ignoredBefore: boolean }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/setting-proposals/preview`, { method: 'POST', body: input }),
    create: (projectId: string, input: CreateWorldExpansion): Promise<{ proposal: WorldExpansionProposal; similar: WorldSettingSimilarity[] }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/setting-proposals`, { method: 'POST', body: input }),
    update: (projectId: string, proposalId: string, patch: Record<string, unknown>): Promise<WorldExpansionProposal> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/setting-proposals/${encodeURIComponent(proposalId)}`, { method: 'PUT', body: patch }),
    adopt: (projectId: string, proposalId: string): Promise<NovelProject> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/setting-proposals/${encodeURIComponent(proposalId)}/adopt`, { method: 'POST', body: {} }),
    reject: (projectId: string, proposalId: string): Promise<NovelProject> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/setting-proposals/${encodeURIComponent(proposalId)}`, { method: 'DELETE' })
  }
  /** 章后分析任务（D6）：先保存成功再分析；重复源指纹去重。 */
  chapterAnalyses = {
    list: (projectId: string, chapterId?: string): Promise<ChapterAnalysisTask[]> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/chapter-analyses${chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : ''}`),
    create: (projectId: string, input: CreateChapterAnalysis): Promise<ChapterAnalysisTask> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/chapter-analyses`, { method: 'POST', body: input }),
    cancel: (projectId: string, analysisId: string): Promise<ChapterAnalysisTask> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/chapter-analyses/${encodeURIComponent(analysisId)}/cancel`, { method: 'POST', body: {} }),
    retry: (projectId: string, analysisId: string): Promise<ChapterAnalysisTask> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/chapter-analyses/${encodeURIComponent(analysisId)}/retry`, { method: 'POST', body: {} }),
    /** 把这次分析的质量发现列入待审问题（作者显式触发；走统一保存通道，带版本校验）。 */
    reviewItems: (projectId: string, analysisId: string): Promise<{ added: string[]; project: NovelProject }> =>
      this.request(`/api/novels/${encodeURIComponent(projectId)}/chapter-analyses/${encodeURIComponent(analysisId)}/review-items`, { method: 'POST', body: {} })
  }
  creativeSeats = {
    list: (projectId: string): Promise<{ seats: CreativeSeat[]; capabilities: CreativeCapability[] }> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-seats`),
    update: (projectId: string, seatId: string, input: Pick<CreativeSeat, 'enabled' | 'providerId' | 'capabilityIds'>): Promise<{ seats: CreativeSeat[]; capabilities: CreativeCapability[] }> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-seats/${encodeURIComponent(seatId)}`, { method: 'PUT', body: input }),
    setCapabilityEnabled: (projectId: string, capabilityId: string, enabled: boolean): Promise<CreativeCapability> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}/enabled`, { method: 'PUT', body: { enabled } }),
    createCapability: (projectId: string, input: CreateCreativeCapabilityInput): Promise<CreativeCapability> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities`, { method: 'POST', body: input }),
    /** 编辑用户配置能力（内置能力服务端会拒绝）；改动会生成新的 updatedAt/摘要版本。 */
    updateCapability: (projectId: string, capabilityId: string, input: Partial<CreateCreativeCapabilityInput> & { enabled?: boolean }): Promise<CreativeCapability> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}`, { method: 'PUT', body: input }),
    removeCapability: (projectId: string, capabilityId: string): Promise<void> => this.request(`/api/novels/${encodeURIComponent(projectId)}/creative-capabilities/${encodeURIComponent(capabilityId)}`, { method: 'DELETE' })
  }
  orchestrationRuns = {
    list: (projectId: string): Promise<CreativeOrchestrationRun[]> => this.request(`/api/novels/${encodeURIComponent(projectId)}/orchestration-runs`),
    get: (runId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}`),
    create: (projectId: string, request: NovelOrchestrationPlanRequest): Promise<CreativeOrchestrationRun> => this.request(`/api/novels/${encodeURIComponent(projectId)}/orchestration-runs`, { method: 'POST', body: request }),
    start: (runId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}/start`, { method: 'POST' }),
    pause: (runId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}/pause`, { method: 'POST' }),
    resume: (runId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' }),
    cancel: (runId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),
    executeStep: (runId: string, stepId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/execute`, { method: 'POST' }),
    retryStep: (runId: string, stepId: string): Promise<CreativeOrchestrationRun> => this.request(`/api/orchestration-runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/retry`, { method: 'POST' })
  }
  providers = {
    list: (): Promise<ProviderConfigPublic[]> => this.request('/api/providers'),
    save: (input: ProviderConfigInput): Promise<ProviderConfigPublic> => this.request('/api/providers', { method: 'PUT', body: input }),
    test: (input: ProviderConfigInput): Promise<{ ok: boolean; message: string; latencyMs?: number }> => this.request('/api/providers/test', { method: 'POST', body: input })
  }
  /** 本机服务自检：健康检查无需会话令牌，用于设置中心「模型 API」栏判断服务是否可达。 */
  system = {
    health: (): Promise<MojingHealth> => this.request('/api/health')
  }
  /** 全局模型用量流水（跨项目），设置中心「任务历史」栏的用量汇总来源。 */
  usage = {
    list: (): Promise<AiUsageRecord[]> => this.request('/api/usage')
  }
  versions = {
    list: (id: string): Promise<NovelVersionSummary[]> => this.request(`/api/novels/${encodeURIComponent(id)}/versions`),
    checkpoint: (id: string, reason: string): Promise<NovelVersionSummary> => this.request(`/api/novels/${encodeURIComponent(id)}/checkpoints`, { method: 'POST', body: { reason } }),
    /**
     * 受控恢复的差异预览：只读比对，返回绑定当前稿与目标快照的 previewDigest。
     * 恢复时必须原样回传这个摘要，旧预览会被服务端拒绝。
     */
    restorePreview: (id: string, versionId: string): Promise<NovelVersionRestorePreviewPayload> => this.request(`/api/novels/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore-preview`),
    restore: (id: string, versionId: string, body: { currentRevision: number; previewDigest: string }): Promise<NovelProject> => this.request(`/api/novels/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST', body }),
    remove: (id: string, versionId: string): Promise<void> => this.request(`/api/novels/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, { method: 'DELETE' })
  }
  export = async (id: string, format: 'json' | 'docx' | 'txt' | 'md'): Promise<void> => {
    const response = await fetch(`${this.apiBaseUrl}/api/novels/${encodeURIComponent(id)}/export?format=${format}`, { headers: this.headers() })
    if (!response.ok) throw await this.readError(response)
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
    link.href = url; link.download = responseFileName(response.headers.get('content-disposition')) ?? `墨境小说.${format}`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  private headers(): Headers { return new Headers({ Authorization: `Bearer ${this.token}` }) }
  private async request<T>(path: string, options: { method?: string; body?: unknown; formData?: FormData } = {}): Promise<T> {
    const headers = this.headers(); if (options.body !== undefined) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${this.apiBaseUrl}${path}`, { method: options.method ?? 'GET', headers, body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) })
    if (!response.ok) throw await this.readError(response)
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  private async readError(response: Response): Promise<MojingHttpError> { const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } }; return new MojingHttpError(response.status, body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? `请求失败（${response.status}）`, body.error?.retryable ?? false, body.error?.details) }
  private async consumeEvents(jobId: string, callback: (event: NovelGenerationEvent) => void, signal: AbortSignal): Promise<void> {
    try { const response = await fetch(`${this.apiBaseUrl}/api/jobs/${encodeURIComponent(jobId)}/events`, { headers: this.headers(), signal }); if (!response.ok) throw await this.readError(response); if (!response.body) throw new Error('当前环境无法读取生成进度。'); const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = ''; while (true) { const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const blocks = pending.split('\n\n'); pending = blocks.pop() ?? ''; blocks.forEach((block) => { const line = block.split('\n').find((item) => item.startsWith('data: ')); if (line) callback(JSON.parse(line.slice(6)) as NovelGenerationEvent) }) } } catch (error) { if (!signal.aborted) callback({ type: 'failed', error: { code: 'STREAM_ERROR', message: error instanceof Error ? error.message : String(error), retryable: true } }) }
  }
}

/** GET /api/health 的响应（apps/api/src/mojingServer.ts 中定义，无独立 zod 契约）。 */
export type MojingHealth = { ok: boolean; product: string }

export function resolveRuntimeConfig(): { apiBaseUrl: string; token: string } {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return { apiBaseUrl: hash.get('mojingApi') ?? import.meta.env.VITE_MOJING_API_URL ?? 'http://localhost:8787', token: hash.get('mojingToken') ?? import.meta.env.VITE_MOJING_SESSION_TOKEN ?? 'mojing-dev-local' }
}

function responseFileName(value: string | null): string | undefined { const match = value?.match(/filename\*=UTF-8''([^;]+)/i); return match?.[1] ? decodeURIComponent(match[1]) : undefined }

export const mojingClient = new HttpMojingClient()
