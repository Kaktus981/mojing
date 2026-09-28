import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  ApplyNovelRevisionSchema, ChapterOutlineSchema, ChapterSchema, CreateNovelInputSchema, MemoryProposalSchema, NovelBranchSchema, NovelGenerationRequestSchema,
  NovelOutlineSchema, NovelProjectSchema, OutlineStructureEditRequestSchema, NovelVersionRestoreRequestSchema, ResolveMemoryProposalSchema, MemoryProposalBatchResolveRequestSchema, ManualMemoryRevisionRequestSchema, ResolveWorldQualityFindingSchema, SaveNovelRequestSchema, UpdateNovelRevisionSchema, VolumeOutlineSchema,
  ReviewItemSchema, WorldBibleSchema, WorldEntrySchema, WorldExpansionProposalSchema, StoryDirectionCandidateSchema, WritingSpecsCandidateSchema, NovelOrchestrationPlanRequestSchema, type NovelGenerationEvent,
  CreateCreativeCapabilityInputSchema, CreateWorldExpansionSchema, CreativeSeatConfigurationSchema, UpdateCreativeCapabilityInputSchema,
  CreativeChatSendSchema, CreativeChatStageSchema,
  AssistantRunPreviewRequestSchema, AssistantTaskTypeSchema, ApplyAssistantDraftSchema, CreateAssistantDraftSchema,
  UpdateAssistantDraftSchema, AnswerGuideSlotSchema, CreateChapterAnalysisSchema, CreateLocalRevisionSchema,
  GenerateLocalRevisionSchema,
  AnswerAssistantGuideSchema, assistantGuideScopeKey, AssistantGuideDomainSchema, CompleteAssistantGuideSchema, StartAssistantGuideSchema,
  ChapterAnalysisResultSchema, LocalRevisionCandidateSchema, LocalRevisionScopeSchema, InitialOutlineCandidateSchema,
  AnalyzeStyleSampleSchema, BindStyleProfileSchema, CreateStyleTrialSchema, ImportStyleSampleFileSchema, ImportStyleSampleSchema, StyleProfileDraftSchema,
  CreativeSkillImportInputSchema, InstallCreativeSkillInputSchema, CreativeSkillRemoteImportInputSchema, InstallCreativeSkillRemoteInputSchema,
  type NovelGenerationJob, type NovelGenerationRequest, type NovelProject, type NovelRevisionProposal
} from '../../../packages/contracts/src'
import { ProviderConfigInputSchema } from '../../../packages/contracts/src/schemas'
import { AssistantGuideVersionConflictError, NovelDatabaseService, NovelRevisionConflictError } from '../../../packages/core/src/novelDatabase'
import { NovelGenerationService, styleProfileInstruction } from '../../../packages/core/src/novelGeneration'
import { applyAcceptedMemory, chapterDigest, explainMemoryRecall, memoryRevisionTarget, memoryRevisionTargetDigest } from '../../../packages/core/src/novelMemory'
import { previewOutlineStructureEdit, retargetProjectAfterStructureEdit } from '../../../packages/core/src/novelPlanning'
import { previewWorldExpansion } from '../../../packages/core/src/worldExpansion'
import { applyWorldQualityRecommendation, isWorldQualityFindingStale } from '../../../packages/core/src/worldQuality'
import { defaultSettings, exportNovel, importNovelBuffer } from '../../../packages/core/src/novelImportExport'
import { ProviderService } from '../../../packages/core/src/ai/provider'
import { buildNovelOrchestrationPlan } from '../../../packages/core/src/novelOrchestrator'
import type { SecretStore } from '../../../packages/core/src/secrets'
import { CreativeOrchestrationService } from './creativeOrchestration'
import { CreativeChatService } from '../../../packages/core/src/creativeChat'
import { resolveAssistantRun } from '../../../packages/core/src/assistantWorkflow'
import { applyAssistantDraft, buildAdoptPreview, saveAssistantDraft, updateAssistantDraft } from '../../../packages/core/src/assistantCandidates'
import { answerGuideSlot, effectiveAnswers, ensureGuideSession, getGuideSession, guideReadiness, nextGuideQuestion, saveInitialOutlineDraft } from '../../../packages/core/src/outlineGuide'
import { localRevisionChangesFromCandidate, saveScopedRevisionDraft } from '../../../packages/core/src/localRevision'
import {
  cancelChapterAnalysis, chapterSourceDigest, completeChapterAnalysis, enqueueChapterAnalysis, failChapterAnalysis,
  markStaleAnalyses, startChapterAnalysis
} from '../../../packages/core/src/chapterAnalysis'
import { createManualStyleProfile, previewStyleSample, saveStyleSample, selectedSampleText, updateStyleProfileVersion } from '../../../packages/core/src/styleLibrary'
import { extractSampleTextFromFile } from '../../../packages/core/src/styleSampleFile'
import { adoptSettingProposal, createSettingProposal, findSimilarEntries, hasIgnoredSameEvidence, listSettingProposals, rejectSettingProposal, updateSettingProposal } from '../../../packages/core/src/settingProposals'
import { installCreativeSkill, installRemoteCreativeSkill, listCreativeSkillCatalog, listCreativeSkillVersions, previewCreativeSkillWithExisting, previewRemoteCreativeSkillWithExisting, previewRemoteCreativeSkillUpdate, rollbackCreativeSkill, syncCapabilityStageAssignments, updateCreativeSkill, updateRemoteCreativeSkill, type RemoteSkillFetcher } from '../../../packages/core/src/creativeSkillRuntime'
import { AssistantGuideService } from '../../../packages/core/src/assistantGuideService'
import { assistantGuideAdapters } from '../../../packages/core/src/assistantGuideAdapters'
import { getCurrentAssistantGuide } from '../../../packages/core/src/assistantGuide'

export interface MojingServerOptions { databasePath?: string; secretStore: SecretStore; sessionToken: string; allowedOrigin: string; remoteSkillFetcher?: RemoteSkillFetcher }
export interface MojingServer { app: FastifyInstance; database: NovelDatabaseService }

class JobRegistry {
  private jobs = new Map<string, { controller: AbortController; listeners: Set<(event: NovelGenerationEvent) => void>; last?: NovelGenerationEvent }>()
  constructor(private readonly generation: NovelGenerationService, private readonly database: NovelDatabaseService) {}
  start(projectId: string, request: NovelGenerationRequest, resumeOfJobId?: string): string {
    const id = randomUUID(), controller = new AbortController(), estimate = this.generation.estimate(projectId, request)
    this.database.createGenerationJob(id, projectId, request.kind, estimate, request, resumeOfJobId)
    this.jobs.set(id, { controller, listeners: new Set(), last: { type: 'progress', progress: { jobId: id, projectId, kind: request.kind, message: '任务已进入生成队列。', progress: 0 } } })
    const emit = (event: NovelGenerationEvent): void => { const job = this.jobs.get(id); if (!job) return; job.last = event; job.listeners.forEach((listener) => listener(event)) }
    queueMicrotask(() => {
      if (!this.database.startGenerationJob(id)) return
      emit({ type: 'progress', progress: { jobId: id, projectId, kind: request.kind, message: '正在启动生成任务…', progress: 2 } })
      void this.generation.run(projectId, request, controller.signal, (message, progress) => {
        if (this.database.appendGenerationJobProgress(id, progress, message)) emit({ type: 'progress', progress: { jobId: id, projectId, kind: request.kind, message, progress } })
      }).then((result) => {
        if (this.database.completeGenerationJob(id, result)) emit({ type: 'completed', ...result })
      }).catch((error) => {
        if (controller.signal.aborted) return
        const apiError = { code: (error as { code?: string }).code ?? 'GENERATION_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true }
        if (this.database.failGenerationJob(id, apiError)) emit({ type: 'failed', error: apiError })
      })
    })
    return id
  }
  resume(id: string): { jobId: string; resumedFromJobId: string } {
    const job = this.database.getGenerationJob(id), stored = this.database.getGenerationRequest(id)
    if (!job || !stored || !job.resumable) throw Object.assign(new Error('该任务没有可用的恢复信息。'), { code: 'JOB_NOT_RESUMABLE' })
    return { jobId: this.start(stored.projectId, stored.request, id), resumedFromJobId: id }
  }
  has(id: string): boolean { return Boolean(this.database.getGenerationJob(id)) }
  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !this.database.cancelGenerationJob(id)) return
    job.controller.abort(); job.last = { type: 'canceled' }; job.listeners.forEach((listener) => listener(job.last!))
  }
  subscribe(id: string, listener: (event: NovelGenerationEvent) => void): () => void {
    const job = this.jobs.get(id)
    if (job) { job.listeners.add(listener); if (job.last) queueMicrotask(() => listener(job.last!)); return () => job.listeners.delete(listener) }
    const persisted = this.database.getGenerationJob(id)
    if (persisted) queueMicrotask(() => listener(toGenerationEvent(persisted)))
    return () => {}
  }
}

/**
 * 「项目不存在」是客户端可纠正的状态，必须与「后端故障」分开。
 * 兜底的 500 会让前端无法区分「这条作品已被删除」和「服务真的坏了」，
 * 只能对用户显示含义模糊的失败提示。
 */
class NovelNotFoundError extends Error {
  readonly code = 'NOVEL_NOT_FOUND'
  constructor(id: string) { super(`找不到小说项目 ${id}，它可能已被删除。`) }
}

/**
 * core 的 getProject 对不存在的项目抛的是**无 code 的普通 Error**，HTTP 层无法据以判定 404。
 * 这里只在真的抛错时回查一次项目列表（正常路径不额外查询）：
 * 项目确实不存在 → 转成 NOVEL_NOT_FOUND；列表里仍在却读失败 → 原样抛出，让它继续报 500。
 */
function requireProject(database: NovelDatabaseService, id: string): NovelProject {
  try {
    return database.getProject(id)
  } catch (error) {
    if (database.listProjects().some((item) => item.id === id)) throw error
    throw new NovelNotFoundError(id)
  }
}

export async function createMojingServer(options: MojingServerOptions): Promise<MojingServer> {
  const app = Fastify({ logger: false })
  const database = new NovelDatabaseService(options.databasePath)
  const provider = new ProviderService(database, options.secretStore)
  const generation = new NovelGenerationService(database, provider)
  const jobs = new JobRegistry(generation, database)
  const orchestration = new CreativeOrchestrationService(database, jobs)
  const creativeChat = new CreativeChatService(database, provider)
  const assistantGuides = new AssistantGuideService(database, provider, assistantGuideAdapters(database))
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || origin === options.allowedOrigin), credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'] })
  await app.register(multipart, { limits: { files: 1, fileSize: 20 * 1024 * 1024, parts: 4 } })
  app.addHook('onRequest', async (request, reply) => { if (request.url === '/api/health') return; const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''; if (!sameToken(supplied, options.sessionToken)) await reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: '本机 API 会话无效。', retryable: false } }) })
  // 状态码按语义分层：冲突/需人工决策 → 409；资源不存在 → 404（`*_NOT_FOUND` 统一约定，含 NOVEL_NOT_FOUND）；入参不合法 → 400；其余才是 500。
  // 409 = 「当前状态不允许这次操作」；400 = 请求本身可纠正（对象不存在、跨项目、任务与栏目不匹配、模型未配置）。
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: string }).code ?? (error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR')
    const isConflict = error instanceof NovelRevisionConflictError || error instanceof AssistantGuideVersionConflictError || code.startsWith('ORCHESTRATION_') || ['PLANNING_REQUIRED','WORLD_REQUIRED','WORLD_QUALITY_CONFLICT','WORLD_QUALITY_FINDING_STALE','JOB_NOT_RESUMABLE','REVISION_ALREADY_APPLIED','RESTORE_PREVIEW_STALE'].includes(code) || (code.startsWith('OUTLINE_') && !code.endsWith('_NOT_FOUND'))
    const isUnprocessable = code.startsWith('ASSISTANT_GUIDE_TARGET_') || ['ASSISTANT_GUIDE_PROJECT_MISMATCH','ASSISTANT_GUIDE_RESULT_TARGET_INVALID','ASSISTANT_GUIDE_RESULT_KIND_INVALID','ASSISTANT_GUIDE_SCOPE_MISMATCH','ASSISTANT_GUIDE_QUESTION_MISMATCH','ASSISTANT_GUIDE_OPTION_INVALID','ASSISTANT_GUIDE_NOT_READY'].includes(code)
    const isBadRequest = ['ASSISTANT_TARGET_PROJECT_MISMATCH','ASSISTANT_TASK_STAGE_MISMATCH','ASSISTANT_TASK_TARGET_MISMATCH','ASSISTANT_TASK_UNKNOWN','MODEL_NOT_CONFIGURED','MODEL_KEY_MISSING','DRAFT_NOT_FOUND','DRAFT_VERSION_STALE','DRAFT_ALREADY_APPLIED','DRAFT_ADOPT_BLOCKED','DRAFT_PREVIEW_STALE','DRAFT_DISCARDED','DRAFT_EMPTY','DRAFT_TARGET_MISSING','DRAFT_PROJECT_MISMATCH','DRAFT_CHANGE_UNKNOWN','DRAFT_SCOPE_VIOLATION','STYLE_SAMPLE_EMPTY','STYLE_SAMPLE_TOO_SHORT','STYLE_SEGMENT_REQUIRED','STYLE_PROFILE_EMPTY','STYLE_PROFILE_NOT_FOUND','STYLE_SAMPLE_NOT_FOUND','STYLE_PROFILE_NOT_BOUND','STYLE_FILE_ENCRYPTED','STYLE_FILE_NOT_ZIP','STYLE_FILE_NOT_EPUB','STYLE_FILE_NO_TEXT','STYLE_FILE_TOO_LARGE','STYLE_FILE_UNSUPPORTED','CHAPTER_NOT_FOUND','SETTING_PROPOSAL_NOT_FOUND','SETTING_PROPOSAL_CLOSED','ANALYSIS_NOT_FOUND','ANALYSIS_CLOSED','WORLD_ENTRY_LOCKED','WORLD_EXPANSION_STALE','WORLD_EXPANSION_CONFLICT','SKILL_REMOTE_URL_INVALID','SKILL_REMOTE_NOT_SKILL_MD','SKILL_REMOTE_REF_REQUIRED','SKILL_REMOTE_REF_INVALID','SKILL_REMOTE_REF_MISMATCH','SKILL_REMOTE_FETCH_FAILED','SKILL_TOO_LARGE','SKILL_DIGEST_MISMATCH','SKILL_UNSUPPORTED_FILE','SKILL_INVALID_JSON','SKILL_UNSUPPORTED_FIELD','SKILL_INVALID_INPUT','SKILL_EMPTY','SKILL_UNKNOWN_CAPABILITY','SKILL_SCOPE_MISMATCH','SKILL_LIMIT_EXCEEDED','SKILL_INVALID_CONFIGURATION','SKILL_NOT_EDITABLE','SKILL_SOURCE_NOT_REMOTE','SKILL_SOURCE_MISMATCH','SKILL_UPDATE_PREVIEW_REQUIRED','SKILL_UPDATE_PREVIEW_STALE'].includes(code)
    const message = error instanceof Error ? error.message : String(error)
    const modelUnavailable = /503|502|504|upstream|temporar|超时|无法连接模型服务|模型流式输出中途断开/i.test(message)
    const status = isConflict ? 409 : code.endsWith('_NOT_FOUND') ? 404 : isUnprocessable ? 422 : (error instanceof z.ZodError || isBadRequest) ? 400 : modelUnavailable ? 503 : 500
    void reply.status(status).send({ error: { code, message, retryable: status >= 500, details: error instanceof z.ZodError ? error.flatten() : undefined } })
  })

  app.get('/api/health', async () => ({ ok: true, product: '墨境' }))
  app.get('/api/novels', async () => database.listProjects())
  app.post('/api/novels', async (request, reply) => { const input = CreateNovelInputSchema.parse(request.body), now = new Date().toISOString(); const project = NovelProjectSchema.parse({ schemaVersion: 4, id: randomUUID(), title: input.title, seed: input.seed, settings: input.settings ?? defaultSettings(), status: '待规划', revision: 0, chapters: [], memories: [], plotThreads: [], branches: [], reviews: [], createdAt: now, updatedAt: now }); return reply.status(201).send(database.createProject(project)) })
  app.post('/api/novels/import', async (request, reply) => { const upload = await request.file(); if (!upload) throw new Error('请选择需要导入的小说文件。'); return reply.status(201).send(database.createProject(await importNovelBuffer(upload.filename, await upload.toBuffer()))) })
  app.get('/api/novels/:id', async (request) => requireProject(database, IdParams.parse(request.params).id))
  app.put('/api/novels/:id', async (request) => { const id = IdParams.parse(request.params).id, body = SaveNovelRequestSchema.parse(request.body); if (body.document.id !== id) throw new Error('请求路径与项目编号不一致。'); requireProject(database, id); return database.saveProject(body.document, body.baseRevision) })
  app.delete('/api/novels/:id', async (request, reply) => { database.removeProject(IdParams.parse(request.params).id); return reply.status(204).send() })
  // 归档 / 恢复：只切换 archived 标记，不删除项目与证据（见 novelDatabase.setProjectArchived）。
  app.put('/api/novels/:id/archive', async (request) => { const id = IdParams.parse(request.params).id, { archived } = z.object({ archived: z.boolean() }).parse(request.body); requireProject(database, id); return database.setProjectArchived(id, archived) })

  app.get('/api/novels/:id/versions', async (request) => database.listVersions(IdParams.parse(request.params).id))
  app.post('/api/novels/:id/checkpoints', async (request, reply) => { const id = IdParams.parse(request.params).id, reason = z.object({ reason: z.string().trim().min(1).max(200).default('手动检查点') }).parse(request.body ?? {}).reason; return reply.status(201).send(database.snapshot(requireProject(database, id), reason, '手动检查点')) })
  app.get('/api/novels/:id/versions/:versionId', async (request) => { const p = VersionParams.parse(request.params); return database.getVersion(p.id, p.versionId) })
  /**
   * 受控恢复的差异预览：只读比对，绑定目标快照与当前稿的内容摘要。
   * 作者确认后才走下面的 restore；两处都用同一份摘要，旧预览无法执行。
   */
  app.get('/api/novels/:id/versions/:versionId/restore-preview', async (request) => {
    const p = VersionParams.parse(request.params)
    return database.previewVersionRestore(p.id, p.versionId, new Date().toISOString())
  })
  app.post('/api/novels/:id/versions/:versionId/restore', async (request) => {
    const p = VersionParams.parse(request.params)
    const body = NovelVersionRestoreRequestSchema.parse(request.body ?? {})
    return database.restoreVersionWithPreview({ projectId: p.id, versionId: p.versionId, expectedDigest: body.previewDigest })
  })
  app.delete('/api/novels/:id/versions/:versionId', async (request, reply) => { const p = VersionParams.parse(request.params); database.removeVersion(p.id, p.versionId); return reply.status(204).send() })

  app.get('/api/providers', async () => provider.list())
  app.put('/api/providers', async (request) => provider.save(ProviderConfigInputSchema.parse(request.body)))
  app.post('/api/providers/test', async (request) => provider.test(ProviderConfigInputSchema.parse(request.body)))
  app.get('/api/usage', async () => database.listUsage())

  app.post('/api/novels/:id/generations/estimate', async (request) => generation.estimate(IdParams.parse(request.params).id, NovelGenerationRequestSchema.parse(request.body)))
  app.post('/api/novels/:id/generations', async (request, reply) => { const id = IdParams.parse(request.params).id; return reply.status(202).send({ jobId: jobs.start(id, NovelGenerationRequestSchema.parse(request.body)) }) })
  app.get('/api/novels/:id/generation-jobs', async (request) => database.listGenerationJobs(IdParams.parse(request.params).id))
  app.get('/api/novels/:id/recoverable-jobs', async (request) => database.listRecoverableGenerationJobs(IdParams.parse(request.params).id))
  app.get('/api/jobs/:jobId', async (request, reply) => { const job = database.getGenerationJob(JobParams.parse(request.params).jobId); return job ?? reply.status(404).send({ error: { code: 'JOB_NOT_FOUND', message: '生成任务不存在。', retryable: false } }) })
  app.get('/api/jobs/:jobId/events', async (request, reply) => { const { jobId } = JobParams.parse(request.params); if (!jobs.has(jobId)) return reply.status(404).send({ error: { code: 'JOB_NOT_FOUND', message: '生成任务不存在或已过期。', retryable: false } }); for (const name of ['access-control-allow-origin', 'access-control-allow-credentials', 'vary']) { const value = reply.getHeader(name); if (value !== undefined) reply.raw.setHeader(name, String(value)) } reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }); const unsubscribe = jobs.subscribe(jobId, (event) => { reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); if (event.type !== 'progress') reply.raw.end() }); request.raw.on('close', unsubscribe) })
  app.delete('/api/jobs/:jobId', async (request, reply) => { jobs.cancel(JobParams.parse(request.params).jobId); return reply.status(204).send() })
  app.post('/api/jobs/:jobId/resume', async (request, reply) => reply.status(202).send(jobs.resume(JobParams.parse(request.params).jobId)))

  app.get('/api/novels/:id/revision-proposals', async (request) => database.listRevisions(IdParams.parse(request.params).id, true))
  app.post('/api/novels/:id/branches/:branchId/adopt', async (request, reply) => {
    const { id, branchId } = BranchParams.parse(request.params), body = z.object({ currentRevision: z.number().int().nonnegative(), branchChapterId: z.string().optional() }).parse(request.body)
    const project = database.getProject(id)
    if (project.revision !== body.currentRevision) throw new NovelRevisionConflictError(body.currentRevision, project.revision)
    const branch = project.branches.find((item) => item.id === branchId)
    if (!branch) throw new Error('找不到剧情分支。')
    if (branch.status === '已归档' || branch.status === '已采用') throw new Error('该分支已归档或已采用，不能重复采用。')
    const source = project.chapters.find((item) => item.id === branch.baseChapterId)
    const branchChapter = body.branchChapterId ? branch.chapters.find((item) => item.id === body.branchChapterId) : branch.chapters.at(-1)
    if (!source || !branchChapter) throw new Error('该分支还没有可采用的备选章节。')
    const proposal: NovelRevisionProposal = { id: randomUUID(), projectId: id, kind: 'branch', target: 'chapter', targetId: source.id, baseRevision: project.revision, summary: `采用剧情分支“${branch.name}”替换第 ${source.chapterNumber} 章`, candidate: { ...branchChapter, id: source.id, volumeNumber: source.volumeNumber, chapterNumber: source.chapterNumber }, status: '待处理', createdAt: new Date().toISOString() }
    return reply.status(201).send(database.saveRevision(proposal))
  })
  /**
   * 大纲结构预览：调序 / 跨卷移动 / 删除 / 拆分 / 合并都先在这里产出候选项与中文影响摘要。
   * 这个端点只写候选，不改正式大纲；作者确认后仍走既有 `/api/revisions/:id/apply` 门禁。
   */
  app.post('/api/novels/:id/outline-structure/preview', async (request, reply) => {
    const id = IdParams.parse(request.params).id
    const project = requireProject(database, id)
    const input = OutlineStructureEditRequestSchema.parse(request.body)
    const preview = previewOutlineStructureEdit(project, input)
    const proposal: NovelRevisionProposal = {
      id: randomUUID(), projectId: id, kind: 'outline', target: 'outline', targetId: 'structure',
      baseRevision: project.revision, summary: `结构调整：${preview.impact.summary}`,
      candidate: preview.candidate, status: '待处理',
      structureOperation: input.operation, structureImpact: preview.impact,
      createdAt: new Date().toISOString()
    }
    database.saveRevision(proposal)
    return reply.status(201).send({ proposal, impact: preview.impact })
  })

  app.post('/api/revisions/:proposalId/apply', async (request) => applyRevision(database, ProposalParams.parse(request.params).proposalId, ApplyNovelRevisionSchema.parse(request.body)))
  app.post('/api/novels/:id/revisions/batch', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const input = z.object({
      currentRevision: z.number().int().nonnegative(),
      decisions: z.array(z.object({ proposalId: z.string().min(1), action: z.enum(['应用', '放弃']) })).min(1).max(30)
    }).parse(request.body)
    const project = database.getProject(projectId)
    if (project.revision !== input.currentRevision) throw new NovelRevisionConflictError(input.currentRevision, project.revision)
    const proposals = input.decisions.map((decision) => database.getRevision(decision.proposalId))
    const ids = new Set<string>()
    const targets = new Set<string>()
    for (const [index, proposal] of proposals.entries()) {
      if (proposal.projectId !== projectId) throw new Error('这批候选中含有其他项目的内容。')
      if (ids.has(proposal.id)) throw new Error('同一批中不能重复处理同一候选。')
      ids.add(proposal.id)
      if (proposal.status !== '待处理') throw new Error('这批候选中有已处理或已冲突的内容，请重新选择。')
      if (input.decisions[index]!.action !== '应用') continue
      if (proposal.baseRevision !== project.revision) throw new Error('候选基于旧版项目，请逐条核对后再应用。')
      if (proposal.qualityFindings?.some((item) => item.status === '待处理' && item.severity === '高')) throw new Error('候选还有高风险设定冲突，请逐条处理。')
      const target = `${proposal.target}:${proposal.targetId ?? ''}`
      if (targets.has(target)) throw new Error('多条候选会修改同一目标，请逐条决定应用顺序。')
      targets.add(target)
    }
    return database.runRevisionBatch(() => {
      let revision = project.revision
      for (const [index, decision] of input.decisions.entries()) {
        const proposal = proposals[index]!
        if (decision.action === '应用') {
          revision = applyRevision(database, proposal.id, { currentRevision: revision, allowConflict: false, allowQualityConflict: false }, project.revision).revision
        } else {
          database.saveRevision({ ...proposal, status: '已拒绝' })
          database.markGenerationProposalHandled(proposal.id)
        }
      }
      return { status: '全部成功' as const, processedIds: input.decisions.map((item) => item.proposalId), committedRevision: revision }
    })
  })
  app.put('/api/revisions/:proposalId', async (request) => updateRevision(database, ProposalParams.parse(request.params).proposalId, UpdateNovelRevisionSchema.parse(request.body).candidate))
  app.put('/api/revisions/:proposalId/quality/:findingId', async (request) => { const params = QualityParams.parse(request.params); return resolveWorldQuality(database, params.proposalId, params.findingId, ResolveWorldQualityFindingSchema.parse(request.body)) })
  app.delete('/api/revisions/:proposalId', async (request, reply) => { const id = ProposalParams.parse(request.params).proposalId, proposal = database.getRevision(id); database.saveRevision({ ...proposal, status: '已拒绝' }); database.markGenerationProposalHandled(id); return reply.status(204).send() })
  app.get('/api/novels/:id/memory-proposals', async (request) => database.listMemoryProposals(IdParams.parse(request.params).id))
  app.get('/api/novels/:id/memory-health', async (request) => database.memoryHealth(IdParams.parse(request.params).id))
  app.get('/api/novels/:id/creative-conversations', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const query = z.object({ stage: CreativeChatStageSchema.optional() }).parse(request.query)
    return database.listCreativeConversations(projectId, query.stage)
  })
  app.get('/api/novels/:id/creative-conversations/:conversationId/messages', async (request) => {
    const params = ConversationParams.parse(request.params)
    return database.listCreativeMessages(params.id, params.conversationId)
  })
  app.post('/api/novels/:id/creative-chat', async (request) => {
    const projectId = IdParams.parse(request.params).id
    return creativeChat.send(projectId, CreativeChatSendSchema.parse(request.body))
  })
  /**
   * 调用前的「本次使用」预览：不消耗模型调用，只把服务端将要读取/写入的范围、
   * 实际加载的技能版本和模型来源算清楚，供界面如实展示（D5）。
   */
  app.post('/api/novels/:id/assistant-runs/preview', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const input = AssistantRunPreviewRequestSchema.parse(request.body)
    if (input.target.projectId !== projectId) throw Object.assign(new Error('该创作对象不属于当前小说项目。'), { code: 'ASSISTANT_TARGET_PROJECT_MISMATCH' })
    const { context, effective } = resolveAssistantRun({
      database, project, stage: input.stage, target: input.target, taskType: input.taskType,
      intent: input.intent, selection: input.selection
    })
    return { context, effective }
  })
  app.post('/api/novels/:id/assistant-guides/start', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    const input = StartAssistantGuideSchema.parse(request.body)
    const before = input.target.projectId === projectId
      ? getCurrentAssistantGuide(database, projectId, input.domain, assistantGuideScopeKey(input.domain, input.target))
      : undefined
    const session = await assistantGuides.start(projectId, input)
    return reply.status(before ? 200 : 201).send(session)
  })
  app.get('/api/novels/:id/assistant-guides/current', async (request) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    const query = z.object({ domain: AssistantGuideDomainSchema, scopeKey: z.string().trim().min(1).max(500) }).parse(request.query)
    return getCurrentAssistantGuide(database, projectId, query.domain, query.scopeKey) ?? null
  })
  app.put('/api/novels/:id/assistant-guides/:sessionId/answer', async (request) => {
    const { id: projectId, sessionId } = GuideSessionParams.parse(request.params)
    requireProject(database, projectId)
    return assistantGuides.answer(projectId, sessionId, AnswerAssistantGuideSchema.parse(request.body))
  })
  app.post('/api/novels/:id/assistant-guides/:sessionId/reanalyze', async (request) => {
    const { id: projectId, sessionId } = GuideSessionParams.parse(request.params)
    requireProject(database, projectId)
    const input = CompleteAssistantGuideSchema.parse(request.body)
    return assistantGuides.reanalyze(projectId, sessionId, input.expectedVersion)
  })
  app.post('/api/novels/:id/assistant-guides/:sessionId/complete', async (request) => {
    const { id: projectId, sessionId } = GuideSessionParams.parse(request.params)
    requireProject(database, projectId)
    return assistantGuides.complete(projectId, sessionId, CompleteAssistantGuideSchema.parse(request.body))
  })
  app.post('/api/novels/:id/assistant-guides/:sessionId/restart', async (request) => {
    const { id: projectId, sessionId } = GuideSessionParams.parse(request.params)
    requireProject(database, projectId)
    const input = CompleteAssistantGuideSchema.parse(request.body)
    return assistantGuides.restart(projectId, sessionId, input.expectedVersion)
  })
  app.get('/api/novels/:id/assistant-task-configurations', async (request) => {
    const projectId = IdParams.parse(request.params).id
    database.getProject(projectId)
    return database.listAssistantTaskConfigurations(projectId)
  })
  app.put('/api/novels/:id/assistant-task-configurations/:taskType', async (request) => {
    const { id: projectId, taskType } = TaskParams.parse(request.params)
    database.getProject(projectId)
    const parsed = AssistantTaskTypeSchema.safeParse(decodeURIComponent(taskType))
    if (!parsed.success) throw Object.assign(new Error('未知的任务类型。'), { code: 'ASSISTANT_TASK_UNKNOWN' })
    const body = z.object({
      enabled: z.boolean().optional(),
      providerId: z.string().min(1).nullable().optional(),
      capabilityIds: z.array(z.string().min(1).max(120)).max(12).nullable().optional()
    }).strict().parse(request.body)
    const current = database.getAssistantTaskConfiguration(projectId, parsed.data)
    return database.saveAssistantTaskConfiguration({
      projectId, taskType: parsed.data,
      enabled: body.enabled ?? current?.enabled ?? true,
      providerId: body.providerId === null ? undefined : (body.providerId ?? current?.providerId),
      capabilityIds: body.capabilityIds === null ? undefined : (body.capabilityIds ?? current?.capabilityIds)
    })
  })
  app.delete('/api/novels/:id/assistant-task-configurations/:taskType', async (request, reply) => {
    const { id: projectId, taskType } = TaskParams.parse(request.params)
    const parsed = AssistantTaskTypeSchema.safeParse(decodeURIComponent(taskType))
    if (!parsed.success) throw Object.assign(new Error('未知的任务类型。'), { code: 'ASSISTANT_TASK_UNKNOWN' })
    database.removeAssistantTaskConfiguration(projectId, parsed.data)
    return reply.status(204).send()
  })
  app.delete('/api/novels/:id/creative-conversations/:conversationId', async (request, reply) => {
    const params = ConversationParams.parse(request.params)
    database.removeCreativeConversation(params.id, params.conversationId)
    return reply.status(204).send()
  })
  app.post('/api/novels/:id/agent-plans/preview', async (request) => buildNovelOrchestrationPlan(database.getProject(IdParams.parse(request.params).id), NovelOrchestrationPlanRequestSchema.parse(request.body)))
  app.get('/api/novels/:id/creative-seats', async (request) => {
    const projectId = IdParams.parse(request.params).id
    database.getProject(projectId)
    return {
      seats: database.listCreativeSeats(projectId),
      capabilities: database.listCreativeCapabilities(projectId),
      capabilityConfigurations: database.listCreativeCapabilityConfigurations(projectId)
    }
  })
  app.get('/api/novels/:id/creative-skills', async (request) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    return listCreativeSkillCatalog(database, projectId)
  })
  app.put('/api/novels/:id/creative-seat-configurations/:seatId', async (request) => {
    const { id: projectId, seatId } = SeatParams.parse(request.params)
    database.getProject(projectId)
    const input = CreativeSeatConfigurationSchema.omit({ projectId: true, seatId: true, updatedAt: true }).parse(request.body)
    return database.saveCreativeSeatConfiguration({ ...input, projectId, seatId })
  })
  app.put('/api/novels/:id/creative-seats/:seatId', async (request) => {
    const { id: projectId, seatId } = SeatParams.parse(request.params)
    const input = CreativeSeatConfigurationSchema.omit({ projectId: true, seatId: true, updatedAt: true }).parse(request.body)
    database.saveCreativeSeatConfiguration({ ...input, projectId, seatId })
    return { seats: database.listCreativeSeats(projectId), capabilities: database.listCreativeCapabilities(projectId) }
  })
  app.put('/api/novels/:id/creative-capability-configurations/:capabilityId', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    database.getProject(projectId)
    const input = z.object({ enabled: z.boolean() }).strict().parse(request.body)
    return database.saveCreativeCapabilityConfiguration({ projectId, capabilityId, enabled: input.enabled })
  })
  app.put('/api/novels/:id/creative-capabilities/:capabilityId/enabled', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    const input = z.object({ enabled: z.boolean() }).strict().parse(request.body)
    database.saveCreativeCapabilityConfiguration({ projectId, capabilityId, enabled: input.enabled })
    const capability = database.listCreativeCapabilities(projectId).find((item) => item.id === capabilityId)
    if (capability) syncCapabilityStageAssignments(database, projectId, capability, input.enabled)
    return database.listCreativeCapabilities(projectId).find((item) => item.id === capabilityId)
  })
  app.post('/api/novels/:id/creative-capabilities', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    database.getProject(projectId)
    return reply.status(201).send(database.createCustomCreativeCapability(projectId, CreateCreativeCapabilityInputSchema.parse(request.body)))
  })
  app.put('/api/novels/:id/creative-capabilities/:capabilityId', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    database.getProject(projectId)
    return database.updateCustomCreativeCapability(projectId, capabilityId, UpdateCreativeCapabilityInputSchema.parse(request.body))
  })
  app.delete('/api/novels/:id/creative-capabilities/:capabilityId', async (request, reply) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    database.removeCustomCreativeCapability(projectId, capabilityId)
    return reply.status(204).send()
  })
  /**
   * 技能导入两步走：先预览（含库内重复提示），作者确认后才安装。
   * 安装默认停用——导入本身不会让任何文字进入模型调用。
   */
  app.post('/api/novels/:id/creative-skills/preview', async (request) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    const input = CreativeSkillImportInputSchema.parse(request.body)
    return previewCreativeSkillWithExisting(database, projectId, input)
  })
  app.post('/api/novels/:id/creative-skills/install', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    const input = InstallCreativeSkillInputSchema.parse(request.body)
    return reply.status(201).send(installCreativeSkill(database, projectId, input))
  })
  app.post('/api/novels/:id/creative-skills/remote/preview', async (request) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    return previewRemoteCreativeSkillWithExisting(database, projectId, CreativeSkillRemoteImportInputSchema.parse(request.body), options.remoteSkillFetcher)
  })
  app.post('/api/novels/:id/creative-skills/remote/install', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    return reply.status(201).send(await installRemoteCreativeSkill(database, projectId, InstallCreativeSkillRemoteInputSchema.parse(request.body), options.remoteSkillFetcher))
  })
  app.post('/api/novels/:id/creative-capabilities/:capabilityId/update/preview', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    requireProject(database, projectId)
    return previewRemoteCreativeSkillUpdate(database, projectId, capabilityId, CreativeSkillRemoteImportInputSchema.parse(request.body), options.remoteSkillFetcher)
  })
  app.get('/api/novels/:id/creative-capabilities/:capabilityId/versions', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    requireProject(database, projectId)
    return listCreativeSkillVersions(database, projectId, capabilityId)
  })
  app.put('/api/novels/:id/creative-capabilities/:capabilityId/update', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    requireProject(database, projectId)
    const input = request.body
    if (input && typeof input === 'object' && 'url' in input) {
      return updateRemoteCreativeSkill(database, projectId, capabilityId, InstallCreativeSkillRemoteInputSchema.parse(input), options.remoteSkillFetcher)
    }
    return updateCreativeSkill(database, projectId, capabilityId, UpdateCreativeCapabilityInputSchema.parse(input))
  })
  app.post('/api/novels/:id/creative-capabilities/:capabilityId/rollback', async (request) => {
    const { id: projectId, capabilityId } = CapabilityParams.parse(request.params)
    requireProject(database, projectId)
    const input = z.object({ versionId: z.string().min(1) }).strict().parse(request.body)
    return rollbackCreativeSkill(database, projectId, capabilityId, input.versionId)
  })
  /**
   * 工作草稿（D3）：生成只落草稿，采用走「重新预览 + 摘要校验 + 单事务」。
   * 草稿不是正式内容，也不在这里再造一个草稿中心——界面就地展示。
   */
  app.get('/api/novels/:id/assistant-drafts', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const query = z.object({ scopeKey: z.string().optional() }).parse(request.query ?? {})
    requireProject(database, projectId)
    return database.listAssistantDrafts(projectId, query.scopeKey)
  })
  app.get('/api/novels/:id/assistant-candidate-records', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const query = z.object({ scopeKey: z.string().optional() }).parse(request.query ?? {})
    requireProject(database, projectId)
    return database.listAssistantCandidateRecords(projectId, query.scopeKey)
  })
  /** 大纲引导（D1/D2）：一次只问一个缺口；只有故事想法是硬条件。 */
  app.get('/api/novels/:id/outline-guide', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const session = getGuideSession(database, project.id)
    return {
      session: session ?? null,
      question: session ? nextGuideQuestion(project, session) : null,
      readiness: guideReadiness(project, session)
    }
  })
  app.post('/api/novels/:id/outline-guide/start', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const session = ensureGuideSession(database, project)
    return reply.status(201).send({ session, question: nextGuideQuestion(project, session), readiness: guideReadiness(project, session) })
  })
  app.put('/api/novels/:id/outline-guide/answers', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const input = AnswerGuideSlotSchema.parse(request.body)
    const session = answerGuideSlot({
      database, project, slot: input.slot, state: input.state, value: input.value, source: input.source
    })
    return { session, question: nextGuideQuestion(project, session), readiness: guideReadiness(project, session) }
  })
  /**
   * 生成初步大纲候选：模型失败时原样返回错误，**保留引导讨论与旧草稿**，不吞错返回成功。
   */
  app.post('/api/novels/:id/outline-guide/generate', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const session = ensureGuideSession(database, project)
    const readiness = guideReadiness(project, session)
    const candidate = await provider.generate({
      system: '你是大纲编辑助手。只根据作者已经给出的信息组织一部长篇小说的初步大纲；缺失的信息必须列为待确认，不得编造具体事实。',
      user: `故事想法：${project.seed}\n题材：${project.settings.genreTemplate}\n视角：${project.settings.pointOfView}\n已知信息：${effectiveAnswers(project, session).map((item) => `${item.slot}=${item.value || item.state}`).join('；')}\n待确认：${readiness.pending.join('、') || '无'}\n只输出：一句话故事核心、开端/发展/转折/高潮/结局五段骨架、建议卷数与每卷一句目标、主要故事线。不要生成章节列表、世界观词条、伏笔或正文。`,
      schema: InitialOutlineCandidateSchema,
      schemaName: 'mojing_initial_outline',
      temperature: 0.6,
      maxOutputTokens: 3_000,
      usageContext: { projectId: project.id, operation: '初步大纲候选' }
    })
    const saved = saveInitialOutlineDraft({
      database, project, candidate, session,
      sourceDigest: createHash('sha256').update(JSON.stringify(candidate), 'utf8').digest('hex').slice(0, 32)
    })
    return reply.status(201).send({ draftId: saved.draftId, pending: saved.pending, candidate })
  })
  /**
   * 局部修改 / 分批细化（D1/D3）：作者声明改哪一步，服务端就只写哪一步。
   * 越界变更在创建草稿这一步就被拒绝，不会留到采用时才说不行。
   */
  /**
   * 局部修改生成（D1/D3）：作者说要改什么 → 模型只输出改动文字 →
   * 服务端按稳定 ID 映射成领域变更 → 再过一遍范围校验才落草稿。
   */
  app.post('/api/novels/:id/outline-revisions/generate', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const input = GenerateLocalRevisionSchema.parse(request.body)
    if (input.scope.projectId !== projectId) throw Object.assign(new Error('该创作对象不属于当前小说项目。'), { code: 'ASSISTANT_TARGET_PROJECT_MISMATCH' })
    const described = describeScopeForPrompt(project, input.scope)
    const candidate = await provider.generate({
      system: '你是大纲编辑助手。只按作者指定的范围做最小修改；不要新增章节、不要改动范围之外的任何内容，也不要编造新对象 ID。',
      user: `修改范围：${described.label}\n范围类型：${input.scope.kind}\n${described.detail}\n作者要求：${input.instruction}\n只输出改动后的文字；范围外的对象不要出现。`,
      schema: LocalRevisionCandidateSchema,
      schemaName: 'mojing_local_revision',
      temperature: 0.55,
      maxOutputTokens: 2_500,
      usageContext: { projectId: project.id, operation: '局部修改候选' }
    })
    const changes = localRevisionChangesFromCandidate({ project, scope: input.scope, candidate })
    return reply.status(201).send(saveScopedRevisionDraft({
      database, project, scope: input.scope, changes,
      batchChapterIds: input.batchChapterIds,
      sourceDigest: createHash('sha256').update(JSON.stringify(candidate), 'utf8').digest('hex').slice(0, 32),
      summary: candidate.summary
    }))
  })
  app.post('/api/novels/:id/outline-revisions/draft', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const input = CreateLocalRevisionSchema.parse(request.body)
    if (input.scope.projectId !== projectId) throw Object.assign(new Error('该创作对象不属于当前小说项目。'), { code: 'ASSISTANT_TARGET_PROJECT_MISMATCH' })
    return reply.status(201).send(saveScopedRevisionDraft({
      database, project, scope: input.scope, changes: input.changes,
      batchChapterIds: input.batchChapterIds, sourceDigest: input.sourceDigest, summary: input.summary
    }))
  })
  app.post('/api/novels/:id/assistant-drafts', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const input = CreateAssistantDraftSchema.parse(request.body)
    if (input.target.projectId !== projectId) throw Object.assign(new Error('该创作对象不属于当前小说项目。'), { code: 'ASSISTANT_TARGET_PROJECT_MISMATCH' })
    const { draft, keptAuthorEdits } = saveAssistantDraft({
      database, project, target: input.target, taskType: input.taskType, stage: input.stage,
      changes: input.changes, dependencyGroups: input.dependencyGroups,
      sourceDigest: input.sourceDigest, summary: input.summary
    })
    return reply.status(201).send({ draft, keptAuthorEdits })
  })
  app.get('/api/novels/:id/assistant-drafts/:draftId/preview', async (request) => {
    const { id: projectId, draftId } = DraftParams.parse(request.params)
    const project = requireProject(database, projectId)
    const draft = database.getAssistantDraftById(projectId, draftId)
    if (!draft) throw Object.assign(new Error('找不到这份工作草稿。'), { code: 'DRAFT_NOT_FOUND' })
    return buildAdoptPreview({ project, draft })
  })
  app.put('/api/novels/:id/assistant-drafts/:draftId', async (request) => {
    const { id: projectId, draftId } = DraftParams.parse(request.params)
    const project = requireProject(database, projectId)
    const input = UpdateAssistantDraftSchema.parse(request.body)
    return updateAssistantDraft({ database, project, draftId, version: input.version, changes: input.changes, summary: input.summary })
  })
  app.post('/api/novels/:id/assistant-drafts/:draftId/apply', async (request) => {
    const { id: projectId, draftId } = DraftParams.parse(request.params)
    const input = ApplyAssistantDraftSchema.parse(request.body)
    return applyAssistantDraft({ database, projectId, draftId, expectedVersion: input.expectedVersion, expectedPreviewDigest: input.expectedPreviewDigest })
  })
  app.delete('/api/novels/:id/assistant-drafts/:draftId', async (request, reply) => {
    const { id: projectId, draftId } = DraftParams.parse(request.params)
    const draft = database.getAssistantDraftById(projectId, draftId)
    if (!draft) throw Object.assign(new Error('找不到这份工作草稿。'), { code: 'DRAFT_NOT_FOUND' })
    // 放弃只是把草稿标为已放弃并保留候选记录，不删除任何正式内容。
    database.saveAssistantDraft({ ...draft, status: '已放弃', updatedAt: new Date().toISOString() })
    return reply.status(204).send()
  })
  app.post('/api/novels/:id/orchestration-runs', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    return reply.status(201).send(orchestration.create(projectId, NovelOrchestrationPlanRequestSchema.parse(request.body)))
  })
  app.get('/api/novels/:id/orchestration-runs', async (request) => orchestration.list(IdParams.parse(request.params).id))
  app.get('/api/orchestration-runs/:runId', async (request, reply) => orchestration.get(RunParams.parse(request.params).runId) ?? reply.status(404).send({ error: { code: 'ORCHESTRATION_NOT_FOUND', message: '找不到指定的工序运行。', retryable: false } }))
  app.post('/api/orchestration-runs/:runId/start', async (request) => orchestration.start(RunParams.parse(request.params).runId))
  app.post('/api/orchestration-runs/:runId/pause', async (request) => orchestration.pause(RunParams.parse(request.params).runId))
  app.post('/api/orchestration-runs/:runId/resume', async (request) => orchestration.resume(RunParams.parse(request.params).runId))
  app.post('/api/orchestration-runs/:runId/cancel', async (request) => orchestration.cancel(RunParams.parse(request.params).runId))
  app.post('/api/orchestration-runs/:runId/steps/:stepId/execute', async (request, reply) => { const { runId, stepId } = RunStepParams.parse(request.params); return reply.status(202).send(orchestration.executeStep(runId, stepId)) })
  app.post('/api/orchestration-runs/:runId/steps/:stepId/retry', async (request) => { const { runId, stepId } = RunStepParams.parse(request.params); return orchestration.retryStep(runId, stepId) })
  app.get('/api/novels/:id/memory-recall', async (request) => {
    const id = IdParams.parse(request.params).id
    const query = z.object({ chapterNumber: z.coerce.number().int().positive(), characterIds: z.string().optional() }).parse(request.query)
    const project = database.getProject(id)
    return explainMemoryRecall(project.memories, query.chapterNumber, { perspective: '全部', characterIds: query.characterIds?.split(',').map((item) => item.trim()).filter(Boolean) })
  })
  app.get('/api/novels/:id/mentions', async (request) => { const id = IdParams.parse(request.params).id, { entryId } = z.object({ entryId: z.string().optional() }).parse(request.query); return database.listMentions(id, entryId) })
  app.put('/api/memory-proposals/:proposalId', async (request) => resolveMemory(database, ProposalParams.parse(request.params).proposalId, ResolveMemoryProposalSchema.parse(request.body)))
  app.post('/api/novels/:id/memory-proposals/batch', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const input = MemoryProposalBatchResolveRequestSchema.parse(request.body)
    return database.resolveMemoryProposalBatch(projectId, input.currentRevision, input.decisions)
  })
  app.get('/api/novels/:id/memory-proposals/manual-baseline', async (request) => {
    const project = database.getProject(IdParams.parse(request.params).id)
    const query = z.object({ chapterId: z.string().min(1), category: ManualMemoryRevisionRequestSchema.innerType().shape.category, targetId: z.string().optional() }).parse(request.query)
    const chapter = project.chapters.find((item) => item.id === query.chapterId)
    if (!chapter) throw new Error('找不到要修订的章节。')
    const before = memoryRevisionTarget(project, query.chapterId, query.category, query.targetId)
    return { currentRevision: project.revision, sourceDigest: chapterDigest(chapter), baseTargetDigest: memoryRevisionTargetDigest(before), before }
  })
  app.post('/api/novels/:id/memory-proposals/manual', async (request, reply) => {
    const project = database.getProject(IdParams.parse(request.params).id)
    const input = ManualMemoryRevisionRequestSchema.parse(request.body)
    if (project.revision !== input.currentRevision) throw new NovelRevisionConflictError(input.currentRevision, project.revision)
    const chapter = project.chapters.find((item) => item.id === input.chapterId)
    if (!chapter) throw new Error('找不到要修订的章节。')
    if (chapterDigest(chapter) !== input.sourceDigest) throw new Error('章节正文已经变化，请重新打开修订。')
    const before = memoryRevisionTarget(project, input.chapterId, input.category, input.targetId)
    if (memoryRevisionTargetDigest(before) !== input.baseTargetDigest) throw new Error('正式记忆已经变化，请重新打开修订。')
    if (['章节摘要', '道具状态', '时间事件'].includes(input.category) && (typeof input.candidate !== 'string' || !input.candidate.trim())) {
      throw new Error('修订内容不能为空。')
    }
    const block = chapter.blocks.find((item) => item.text.trim())
    if (!block) throw new Error('章节尚无正文证据，不能提交分析记忆修订。')
    const proposal = MemoryProposalSchema.parse({
      id: randomUUID(), projectId: project.id, chapterId: chapter.id, sourceDigest: input.sourceDigest,
      category: input.category, targetId: input.targetId, before, baseTargetDigest: input.baseTargetDigest,
      reason: input.reason, candidate: input.candidate,
      source: { chapterId: chapter.id, blockId: block.id, excerpt: block.text.slice(0, 4_000) },
      confidence: 1, risk: '中', status: '待确认', createdAt: new Date().toISOString()
    })
    const check = structuredClone(project)
    applyAcceptedMemory(check, proposal)
    NovelProjectSchema.parse(check)
    database.saveMemoryProposals([proposal])
    return reply.status(201).send({ proposalId: proposal.id, status: '待确认', appliedToCanonical: false })
  })

  /* ------------------------------ 文笔工坊（D4） ------------------------------ */
  app.get('/api/style-samples', async () => database.listStyleSamples())
  /** 导入样文：只做纯文本规范化与切段，不调用任何模型。 */
  app.post('/api/style-samples', async (request, reply) => {
    const input = ImportStyleSampleSchema.parse(request.body)
    return reply.status(201).send(saveStyleSample(database, input))
  })
  app.post('/api/style-samples/preview', async (request) => previewStyleSample(ImportStyleSampleSchema.parse(request.body)))
  /**
   * 文件型样文导入：TXT / Markdown / DOCX / EPUB 的取文发生在**服务端内存**里，
   * 不写文件系统、不调用模型。base64 后的 60MB 文件需要更大请求体，故仅这两条路由放宽默认 1MiB 限制。
   */
  const STYLE_FILE_BODY_LIMIT = 96 * 1024 * 1024
  app.post('/api/style-samples/preview-file', { bodyLimit: STYLE_FILE_BODY_LIMIT }, async (request) => {
    const input = ImportStyleSampleFileSchema.parse(request.body)
    const extracted = await extractSampleTextFromFile({ kind: input.kind, filename: input.filename, data: Buffer.from(input.dataBase64, 'base64') })
    const preview = previewStyleSample({ name: input.name, kind: input.kind, content: extracted.text })
    return { ...preview, warnings: [...preview.warnings, ...extracted.warnings].slice(0, 20) }
  })
  app.post('/api/style-samples/import-file', { bodyLimit: STYLE_FILE_BODY_LIMIT }, async (request, reply) => {
    const input = ImportStyleSampleFileSchema.parse(request.body)
    const extracted = await extractSampleTextFromFile({ kind: input.kind, filename: input.filename, data: Buffer.from(input.dataBase64, 'base64') })
    return reply.status(201).send(saveStyleSample(database, { name: input.name, kind: input.kind, content: extracted.text }))
  })
  app.delete('/api/style-samples/:sampleId', async (request, reply) => {
    database.removeStyleSample(SampleParams.parse(request.params).sampleId)
    return reply.status(204).send()
  })
  app.get('/api/style-profiles', async () => database.listStyleProfiles())
  /** 手写画像：不需要模型，随时可建可保存。 */
  app.post('/api/style-profiles', async (request, reply) => {
    const draft = StyleProfileDraftSchema.parse(request.body)
    return reply.status(201).send(createManualStyleProfile(database, draft))
  })
  app.put('/api/style-profiles/:profileId', async (request) => {
    const { profileId } = ProfileParams.parse(request.params)
    return updateStyleProfileVersion(database, profileId, StyleProfileDraftSchema.partial().parse(request.body))
  })
  app.delete('/api/style-profiles/:profileId', async (request, reply) => {
    database.removeStyleProfile(ProfileParams.parse(request.params).profileId)
    return reply.status(204).send()
  })
  /**
   * 分析样文：只把作者勾选的片段发给模型，返回候选画像（不自动绑定）。
   * 证据是所选片段的真实标签与开头，不虚构相似度或「训练成功」。
   */
  app.post('/api/style-profiles/analyze', async (request, reply) => {
    const input = AnalyzeStyleSampleSchema.parse(request.body)
    const sample = database.getStyleSample(input.sampleId)
    if (!sample) throw Object.assign(new Error('找不到这份样文，请重新导入。'), { code: 'STYLE_SAMPLE_NOT_FOUND' })
    const selected = selectedSampleText(sample, input.segmentIds)
    const draft = await generation.extractStyleProfile({
      name: input.profileName, sourceName: sample.name, text: selected.text, providerId: input.providerId
    })
    const profile = database.createStyleProfile(draft, {
      kind: 'AI 抽象学习', name: sample.name, digest: sample.digest, characterCount: selected.sentCharacterCount
    })
    return reply.status(201).send({ profile, evidence: selected.evidence, sentCharacterCount: selected.sentCharacterCount })
  })
  /** 绑定采用**快照**：之后画像改了，本项目仍用这一版，直到作者明确更新。 */
  app.get('/api/novels/:id/style-profile/usage', async (request) => {
    const projectId = IdParams.parse(request.params).id
    requireProject(database, projectId)
    return database.listStyleProfileUsage(projectId)
  })
  app.post('/api/novels/:id/style-profile/bind', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const body = BindStyleProfileSchema.parse(request.body)
    const project = requireProject(database, projectId)
    const profile = database.getStyleProfile(body.profileId)
    if (!profile) throw Object.assign(new Error('找不到该文风范本。'), { code: 'STYLE_PROFILE_NOT_FOUND' })
    const snapshot = {
      profileId: profile.id, name: profile.name, description: profile.description, traits: profile.traits,
      guidelines: profile.guidelines, avoidPatterns: profile.avoidPatterns,
      sourceKind: profile.sourceKind, capturedAt: body.capturedAt ?? new Date().toISOString()
    }
    return database.saveStyleProfileBinding(
      { ...project, settings: { ...project.settings, activeStyleProfileId: profile.id, styleProfileSnapshot: snapshot } },
      project.revision, { action: '绑定', profileId: profile.id, profileName: profile.name }
    )
  })
  app.delete('/api/novels/:id/style-profile/bind', async (request) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    if (!project.settings.activeStyleProfileId) return project
    const settings = { ...project.settings }
    delete settings.activeStyleProfileId
    delete settings.styleProfileSnapshot
    return database.saveStyleProfileBinding({ ...project, settings }, project.revision, {
      action: '停用', profileId: project.settings.activeStyleProfileId,
      profileName: project.settings.styleProfileSnapshot?.name ?? '文风画像'
    })
  })
  /* ------------------------------ 文笔工坊结束 ------------------------------ */

  /**
   * 同场景试写（D4）：两份短文走**同一条真实调用路径**，只有「是否加载当前画像」不同。
   * 结果只作为候选返回，绝不写入正式正文；不给伪造的相似度分数。
   */
  app.post('/api/novels/:id/style-trials', async (request, reply) => {
    const projectId = IdParams.parse(request.params).id
    const project = requireProject(database, projectId)
    const input = CreateStyleTrialSchema.parse(request.body)
    const snapshot = project.settings.styleProfileSnapshot
    if (!snapshot) throw Object.assign(new Error('还没有绑定文风画像，无法试写。'), { code: 'STYLE_PROFILE_NOT_BOUND' })
    const chapter = input.chapterId ? project.chapters.find((item) => item.id === input.chapterId) : undefined
    if (input.chapterId && !chapter) throw Object.assign(new Error('找不到该章节。'), { code: 'CHAPTER_NOT_FOUND' })
    const common = `场景要求：${input.scenario}\n章节：${chapter ? `第${chapter.chapterNumber}章《${chapter.title}》` : '未指定'}\n题材：${project.settings.genreTemplate}\n视角：${project.settings.pointOfView}\n只写一段短文，不要输出解释。`
    const schema = z.object({ text: z.string().min(1).max(20_000) })
    const call = (withProfile: boolean) => provider.generate({
      system: '你是小说写作助手。只按场景要求写一段中文短文。',
      user: withProfile
        ? `${common}\n${styleProfileInstruction(project)}`
        : `${common}\n本次不加载任何文风画像，按通用平实写法处理。`,
      schema, schemaName: 'mojing_style_trial', temperature: 0.7,
      maxOutputTokens: 1_200, providerId: input.providerId,
      usageContext: { projectId: project.id, operation: withProfile ? '试写（加载画像）' : '试写（不加载画像）' }
    })
    const [withoutProfile, withProfile] = [await call(false), await call(true)]
    return reply.status(201).send({
      id: `trial-${randomUUID()}`, scenario: input.scenario,
      withoutProfile: withoutProfile.text, withProfile: withProfile.text,
      profileId: snapshot.profileId, profileVersion: snapshot.capturedAt, createdAt: new Date().toISOString()
    })
  })

  /* ------------------------------ 设定提案（D6） ------------------------------ */
  app.get('/api/novels/:id/setting-proposals', async (request) => listSettingProposals(requireProject(database, IdParams.parse(request.params).id)))
  /** 建提案前先看相似项；不自动合并，只提示。 */
  app.post('/api/novels/:id/setting-proposals/preview', async (request) => {
    const project = requireProject(database, IdParams.parse(request.params).id)
    const raw = CreateWorldExpansionSchema.parse(request.body)
    return { preview: previewWorldExpansion(project, raw), similar: findSimilarEntries(project, raw), ignoredBefore: hasIgnoredSameEvidence(project, raw) }
  })
  app.post('/api/novels/:id/setting-proposals', async (request, reply) => {
    const project = requireProject(database, IdParams.parse(request.params).id)
    const raw = CreateWorldExpansionSchema.parse(request.body)
    return reply.status(201).send(createSettingProposal({ database, project, raw }))
  })
  app.put('/api/novels/:id/setting-proposals/:proposalId', async (request) => {
    const { id: projectId, proposalId } = SettingParams.parse(request.params)
    const project = requireProject(database, projectId)
    const patch = z.object({
      title: WorldExpansionProposalSchema.shape.title.optional(),
      reason: WorldExpansionProposalSchema.shape.reason.optional(),
      proposedEntries: z.array(z.unknown()).min(1).max(100).optional(),
      source: WorldExpansionProposalSchema.shape.source.optional(),
      evidence: WorldExpansionProposalSchema.shape.evidence.optional()
    }).strict().parse(request.body)
    return updateSettingProposal({ database, project, proposalId, patch })
  })
  app.post('/api/novels/:id/setting-proposals/:proposalId/adopt', async (request) => {
    const { id: projectId, proposalId } = SettingParams.parse(request.params)
    const project = requireProject(database, projectId)
    const { allowRisk } = z.object({ allowRisk: z.boolean().optional() }).parse(request.body ?? {})
    return adoptSettingProposal({ database, project, proposalId, allowRisk })
  })
  app.delete('/api/novels/:id/setting-proposals/:proposalId', async (request) => {
    const { id: projectId, proposalId } = SettingParams.parse(request.params)
    // 返回忽略后的最新项目：界面才能立刻把提案从待确认列表里去掉。
    return rejectSettingProposal({ database, project: requireProject(database, projectId), proposalId })
  })
  /* ------------------------------ 设定提案结束 ------------------------------ */

  /* ------------------------------ 章后分析任务（D6） ------------------------------ */
  app.get('/api/novels/:id/chapter-analyses', async (request) => {
    const { id: projectId } = IdParams.parse(request.params)
    const query = z.object({ chapterId: z.string().optional() }).parse(request.query ?? {})
    const project = requireProject(database, projectId)
    // 列表前先把源码已变的任务标过期，界面看到的状态才是真的。
    markStaleAnalyses(database, project, query.chapterId)
    return database.listChapterAnalyses(projectId, query.chapterId)
  })
  /** 手动「分析本章」：先落任务再跑；重复源指纹直接复用，不重复扣费。 */
  app.post('/api/novels/:id/chapter-analyses', async (request, reply) => {
    const { id: projectId } = IdParams.parse(request.params)
    const project = requireProject(database, projectId)
    const input = CreateChapterAnalysisSchema.parse(request.body)
    const chapter = project.chapters.find((item) => item.id === input.chapterId)
    if (!chapter) throw Object.assign(new Error('找不到该章节。'), { code: 'CHAPTER_NOT_FOUND' })
    const { task, deduped } = enqueueChapterAnalysis({ database, project, chapterId: input.chapterId, trigger: input.trigger })
    if (!deduped) void runChapterAnalysis(database, provider, projectId, task.id)
    return reply.status(deduped ? 200 : 201).send(task)
  })
  app.post('/api/novels/:id/chapter-analyses/:analysisId/cancel', async (request) => {
    const { id: projectId, analysisId } = AnalysisParams.parse(request.params)
    requireProject(database, projectId)
    return cancelChapterAnalysis(database, analysisId)
  })
  app.post('/api/novels/:id/chapter-analyses/:analysisId/retry', async (request, reply) => {
    const { id: projectId, analysisId } = AnalysisParams.parse(request.params)
    requireProject(database, projectId)
    const existing = database.getChapterAnalysis(analysisId)
    if (!existing) throw Object.assign(new Error('找不到该分析任务。'), { code: 'ANALYSIS_NOT_FOUND' })
    const project = database.getProject(projectId)
    // 重试必须用**当前**源码与版本，不沿用旧指纹。
    const fresh = database.createChapterAnalysis({
      ...existing, id: `analysis-${randomUUID()}`, sourceDigest: chapterSourceDigest(project, existing.chapterId),
      contextVersion: project.revision, status: '等待', result: null, error: null,
      createdAt: new Date().toISOString(), startedAt: null, endedAt: null
    })
    void runChapterAnalysis(database, provider, projectId, fresh.id)
    return reply.status(201).send(fresh)
  })
  /**
   * 把一次章后分析的**质量发现**列入待审问题：必须由作者显式点击触发，
   * 只把 `result.reviewFindings` 作为「待处理」问题写入 `project.reviews`（走统一保存通道，带版本校验），
   * 不自动采用、不改正文；同一章同一标题的问题只写一次。
   */
  app.post('/api/novels/:id/chapter-analyses/:analysisId/review-items', async (request, reply) => {
    const { id: projectId, analysisId } = AnalysisParams.parse(request.params)
    const project = requireProject(database, projectId)
    const task = database.getChapterAnalysis(analysisId)
    if (!task || task.projectId !== projectId) throw Object.assign(new Error('找不到该分析任务。'), { code: 'ANALYSIS_NOT_FOUND' })
    const findings = task.result?.reviewFindings ?? []
    if (task.status !== '完成' || findings.length === 0) throw Object.assign(new Error('这次分析还没有可列入的质量发现。'), { code: 'NO_REVIEW_FINDINGS' })
    const now = new Date().toISOString()
    const added: string[] = []
    let candidate = project
    for (const finding of findings) {
      if (candidate.reviews.some((item) => item.chapterId === task.chapterId && item.title === finding.title)) continue
      candidate = {
        ...candidate,
        reviews: [...candidate.reviews, {
          id: randomUUID(), chapterId: task.chapterId, category: '连续性' as const, severity: finding.severity,
          title: finding.title, description: finding.detail, evidence: [], recommendation: '', status: '待处理' as const, createdAt: now
        }]
      }
      added.push(finding.title)
    }
    if (added.length === 0) return reply.status(200).send({ added, project: candidate })
    const saved = database.saveProject(candidate, project.revision, '列入待审问题', '章后分析')
    return reply.status(201).send({ added, project: saved })
  })
  /* ------------------------------ 章后分析结束 ------------------------------ */

  app.get('/api/novels/:id/export', async (request, reply) => { const id = IdParams.parse(request.params).id, { format } = z.object({ format: z.enum(['json', 'docx', 'txt', 'md']) }).parse(request.query); const project = database.getProject(id), buffer = await exportNovel(project, format); const type = format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'; return reply.header('Content-Type', type).header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(project.title)}.${format}`).send(buffer) })
  app.addHook('onClose', async () => database.close())
  return { app, database }
}

function applyRevision(database: NovelDatabaseService, id: string, input: z.infer<typeof ApplyNovelRevisionSchema>, batchBaseRevision?: number) {
  const proposal = database.getRevision(id), project = database.getProject(proposal.projectId)
  // 重复确认不能执行两次：候选一旦应用就终态，第二次请求必须被拒绝。
  if (proposal.status === '已应用') throw Object.assign(new Error('该候选已经应用过了，不会重复执行。'), { code: 'REVISION_ALREADY_APPLIED' })
  if (project.revision !== input.currentRevision && !input.allowConflict) { database.saveRevision({ ...proposal, status: '已冲突' }); throw new NovelRevisionConflictError(input.currentRevision, project.revision) }
  if ((proposal.target === 'directionCards' || proposal.target === 'settings') && proposal.baseRevision !== (batchBaseRevision ?? project.revision) && !input.allowConflict) {
    database.saveRevision({ ...proposal, status: '已冲突' })
    throw new NovelRevisionConflictError(proposal.baseRevision, project.revision)
  }
  const blocking = (proposal.qualityFindings ?? []).filter((item) => item.status === '待处理' && item.severity === '高')
  if (blocking.length && !input.allowQualityConflict) throw Object.assign(new Error(`候选仍有 ${blocking.length} 个高风险设定冲突，请先处理或明确带风险应用。`), { code: 'WORLD_QUALITY_CONFLICT' })
  const candidate = structuredClone(project)
  if (proposal.target === 'directionCards') {
    const direction = StoryDirectionCandidateSchema.parse(proposal.candidate)
    const existing = new Set((candidate.directionCards ?? []).map((item) => item.id))
    if (direction.cards.some((item) => existing.has(item.id))) throw new Error('方向卡候选与已有卡片重复，请重新生成。')
    if ((candidate.directionCards?.length ?? 0) + direction.cards.length > 30) throw new Error('方向卡最多 30 张，请先整理已有卡片。')
    candidate.directionCards = [...(candidate.directionCards ?? []), ...direction.cards]
    const oldAnswers = new Map((candidate.directionQuestions ?? []).map((question, index) => [question, candidate.directionQuestionAnswers?.[index] ?? '']))
    candidate.directionQuestions = direction.questions
    candidate.directionQuestionAnswers = direction.questions.map((question) => oldAnswers.get(question) ?? '')
  }
  else if (proposal.target === 'settings') candidate.settings = { ...candidate.settings, ...WritingSpecsCandidateSchema.parse(proposal.candidate) }
  else if (proposal.target === 'worldBible') {
    const complete = WorldBibleSchema.safeParse(proposal.candidate)
    if (complete.success) candidate.worldBible = complete.data
    else { const entry = WorldEntrySchema.parse(proposal.candidate); if (!candidate.worldBible) throw new Error('请先建立世界观主体。'); const index = candidate.worldBible.entries.findIndex((item) => item.id === entry.id); if (index < 0) candidate.worldBible.entries.push(entry); else candidate.worldBible.entries[index] = entry; candidate.worldBible.status = '草稿'; candidate.worldBible.updatedAt = new Date().toISOString() }
    candidate.status = candidate.outline ? '大纲草稿' : '世界观草稿'
    if (proposal.qualityFindings?.length) candidate.worldQualityFindings = [...candidate.worldQualityFindings, ...proposal.qualityFindings]
  } else if (proposal.target === 'outline') {
    if (proposal.kind === 'outline-volume' || proposal.targetId?.startsWith('volume:')) {
      const volume = VolumeOutlineSchema.parse(proposal.candidate)
      if (!candidate.outline) throw new Error('请先应用总纲与卷级规划。')
      const index = candidate.outline.volumes.findIndex((item) => item.volumeNumber === volume.volumeNumber)
      if (index < 0) candidate.outline.volumes.push(volume); else candidate.outline.volumes[index] = volume
      candidate.outline.volumes.sort((a, b) => a.volumeNumber - b.volumeNumber)
      addOutlineReviewTasks(candidate, volume.chapters.map((item) => item.chapterNumber), `第 ${volume.volumeNumber} 卷章纲发生变化`)
    } else if (proposal.kind === 'scene-beats' || proposal.targetId?.startsWith('chapter:')) {
      const chapter = ChapterOutlineSchema.parse(proposal.candidate)
      if (!candidate.outline) throw new Error('请先应用小说大纲。')
      const existing = candidate.outline.volumes.flatMap((item) => item.chapters).find((item) => item.id === chapter.id || item.chapterNumber === chapter.chapterNumber)
      if (!existing) throw new Error('找不到剧情步骤对应的章纲。')
      Object.assign(existing, chapter)
      addOutlineReviewTasks(candidate, [chapter.chapterNumber], `第 ${chapter.chapterNumber} 章剧情步骤发生变化`)
    } else {
      const outline = NovelOutlineSchema.parse(proposal.candidate)
      if (proposal.kind === 'outline-foundation' && candidate.outline) {
        outline.volumes.forEach((volume) => { volume.chapters = candidate.outline?.volumes.find((item) => item.volumeNumber === volume.volumeNumber)?.chapters ?? [] })
      }
      candidate.outline = outline
      if (proposal.structureOperation) {
        // 结构变更会重排章号、并可能退休某些章纲/正文身份；
        // 只见大纲不搬关联，就会让正文、章节记忆、伏笔与事件线指向别的章或留下悬空引用。
        Object.assign(candidate, retargetProjectAfterStructureEdit(candidate, outline, {
          identityMerges: proposal.structureImpact?.identityMerges
        }).project)
      }
      addOutlineReviewTasks(candidate, outline.volumes.flatMap((volume) => volume.chapters.map((item) => item.chapterNumber)), '小说总纲或卷级规划发生变化')
    }
    if (candidate.outline) { candidate.outline.status = '草稿'; candidate.outline.updatedAt = new Date().toISOString() }
    candidate.status = '大纲草稿'
  }
  else if (proposal.target === 'chapter') { const chapter = ChapterSchema.parse(proposal.candidate); const index = candidate.chapters.findIndex((item) => item.id === proposal.targetId); if (index < 0) candidate.chapters.push(chapter); else candidate.chapters[index] = chapter; candidate.status = '创作中' }
  else if (proposal.targetId === 'reviews') candidate.reviews = z.object({ reviews: z.array(ReviewItemSchema) }).parse(proposal.candidate).reviews
  else { const branch = NovelBranchSchema.parse(proposal.candidate); const index = candidate.branches.findIndex((item) => item.id === branch.id); if (index < 0) candidate.branches.push(branch); else candidate.branches[index] = branch }
  const forced = blocking.length && input.allowQualityConflict
  // 项目内容 + revision、恢复前快照、候选状态、生成任务在同一事务内提交：
  // 中途失败必须整体回滚，不能留下「项目已改但候选仍待处理」的半完成状态。
  return database.applyAcceptedRevision({
    project: candidate,
    baseRevision: project.revision,
    reason: `应用候选前：${proposal.summary}${forced ? '（作者确认忽略高风险问题）' : ''}`,
    source: forced ? `AI 候选强制应用：${input.qualityConflictReason ?? '作者已在界面确认'}` : 'AI 候选应用',
    proposal
  })
}

function updateRevision(database: NovelDatabaseService, id: string, candidate: unknown): NovelRevisionProposal {
  const proposal = database.getRevision(id)
  if (proposal.status !== '待处理' && proposal.status !== '已冲突') throw new Error(`该候选当前为“${proposal.status}”，不能继续修改。`)
  let parsed: unknown
  if (proposal.target === 'directionCards') parsed = StoryDirectionCandidateSchema.parse(candidate)
  else if (proposal.target === 'settings') parsed = WritingSpecsCandidateSchema.parse(candidate)
  else if (proposal.target === 'worldBible') {
    const world = WorldBibleSchema.safeParse(candidate)
    parsed = world.success ? world.data : WorldEntrySchema.parse(candidate)
  } else if (proposal.target === 'outline') {
    parsed = proposal.kind === 'outline-volume' || proposal.targetId?.startsWith('volume:') ? VolumeOutlineSchema.parse(candidate)
      : proposal.kind === 'scene-beats' || proposal.targetId?.startsWith('chapter:') ? ChapterOutlineSchema.parse(candidate)
      : NovelOutlineSchema.parse(candidate)
  }
  else if (proposal.target === 'chapter') parsed = ChapterSchema.parse(candidate)
  else if (proposal.targetId === 'reviews') parsed = z.object({ reviews: z.array(ReviewItemSchema) }).parse(candidate)
  else parsed = NovelBranchSchema.parse(candidate)
  const findings = (proposal.qualityFindings ?? []).map((finding) => {
    if (proposal.target !== 'worldBible') return finding
    const complete = WorldBibleSchema.safeParse(parsed)
    return complete.success && !isWorldQualityFindingStale(finding, complete.data) ? finding : { ...finding, status: '已失效' as const }
  })
  return database.saveRevision({ ...proposal, candidate: parsed, qualityFindings: findings, status: '待处理' })
}

function resolveWorldQuality(database: NovelDatabaseService, proposalId: string, findingId: string, input: z.infer<typeof ResolveWorldQualityFindingSchema>): NovelRevisionProposal {
  const proposal = database.getRevision(proposalId), finding = (proposal.qualityFindings ?? []).find((item) => item.id === findingId)
  if (!finding) throw new Error('找不到需要处理的世界观问题。')
  if (finding.status !== '待处理') throw new Error(`该问题当前为“${finding.status}”。`)
  const world = WorldBibleSchema.parse(proposal.candidate)
  let candidate = world
  if (input.action === '接受修复') candidate = applyWorldQualityRecommendation(world, finding, input.replacement ?? finding.suggestedReplacement ?? '')
  const qualityFindings = (proposal.qualityFindings ?? []).map((item) => {
    if (item.id === finding.id) return { ...item, status: input.action === '接受修复' ? '已接受' as const : '已忽略' as const }
    return input.action === '接受修复' && isWorldQualityFindingStale(item, candidate) ? { ...item, status: '已失效' as const } : item
  })
  return database.saveRevision({ ...proposal, candidate, qualityFindings })
}

function resolveMemory(database: NovelDatabaseService, id: string, input: z.infer<typeof ResolveMemoryProposalSchema>) {
  const proposal = MemoryProposalSchema.parse(database.getMemoryProposal(id)), project = database.getProject(proposal.projectId)
  if (project.revision !== input.currentRevision) throw new NovelRevisionConflictError(input.currentRevision, project.revision)
  if (proposal.status !== '待确认') throw new Error(`该记忆提案当前为“${proposal.status}”。`)
  if (input.status === '已接受') {
    if (proposal.baseTargetDigest && memoryRevisionTargetDigest(memoryRevisionTarget(project, proposal.chapterId, proposal.category, proposal.targetId)) !== proposal.baseTargetDigest) {
      throw new Error('正式记忆已经变化，请重新打开修订。')
    }
    applyAcceptedMemory(project, proposal, input.candidate)
  }
  const saved = input.status === '已接受' ? database.saveProject(project, project.revision, '确认章节记忆', '用户确认') : project
  database.updateMemoryProposal({ ...proposal, status: input.status })
  database.markMemoryProposalHandled(id)
  return saved
}

/** 给模型的范围说明：只描述范围内现状，不把范围外内容喂给模型。 */
function describeScopeForPrompt(project: NovelProject, scope: z.infer<typeof LocalRevisionScopeSchema>): { label: string; detail: string } {
  const chapters = (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
  if (scope.kind === 'volume') {
    const volume = project.outline?.volumes.find((item) => item.id === scope.objectId)
    return { label: `第${volume?.volumeNumber ?? '?'}卷`, detail: `本卷目标：${volume?.goal ?? '（空）'}；本卷章：${volume?.chapters.map((item) => `${item.id}（第${item.chapterNumber}章）`).join('、') ?? '无'}` }
  }
  if (scope.kind === 'chapter') {
    const card = chapters.find((item) => item.id === scope.objectId)
    return { label: `第${card?.chapterNumber ?? '?'}章`, detail: `章纲 ID：${scope.objectId}；当前目标：${card?.objective ?? '（空）'}；当前冲突：${card?.conflict ?? '（空）'}` }
  }
  if (scope.kind === 'beat') {
    const card = chapters.find((item) => item.id === scope.objectId)
    const beat = card?.beats.find((item) => item.id === scope.beatId)
    return { label: `第${card?.chapterNumber ?? '?'}章 · ${beat?.title ?? '步骤'}`, detail: `章纲 ID：${scope.objectId}；步骤 ID：${scope.beatId}；当前目的：${beat?.purpose ?? '（空）'}` }
  }
  const line = (project.storylines ?? []).find((item) => item.id === scope.objectId)
  return { label: `故事线《${line?.title ?? '?'}》`, detail: `故事线 ID：${scope.objectId}；必要性：${line?.whyNecessary ?? '（空）'}` }
}

/**
 * 跑一次章后分析：任务状态独立，失败只影响这条任务，不影响已保存的正文。
 * 结果全部是候选，不写入正式记忆、世界观或伏笔。
 */
async function runChapterAnalysis(
  database: NovelDatabaseService,
  providerService: ProviderService,
  projectId: string,
  taskId: string
): Promise<void> {
  const task = database.getChapterAnalysis(taskId)
  if (!task) return
  try {
    startChapterAnalysis(database, taskId)
    const project = database.getProject(projectId)
    const chapter = project.chapters.find((item) => item.id === task.chapterId)
    if (!chapter) throw new Error('找不到该章节。')
    const text = chapter.blocks.map((block) => block.text).join('\n').slice(0, 12_000)
    const fresh = database.getChapterAnalysis(taskId)
    if (!fresh || fresh.status !== '运行中') return
    const result = ChapterAnalysisResultSchema.parse(await providerService.generate({
      system: '你是长篇小说的章节分析员。只依据给出的正文做分析；摘要、状态、设定和伏笔都是**候选**，不得当成作者已确认的事实。没有依据的设定必须标为推测。',
      user: `第${chapter.chapterNumber}章《${chapter.title}》正文：\n${text}\n\n请输出：一段中文摘要；本章确立的状态与事实候选（带正文依据）；新出现或需要补充的设定候选（无依据的标 inferred）；伏笔候选（带依据）；发现的连续性与质量问题。`,
      schema: ChapterAnalysisResultSchema, schemaName: 'mojing_chapter_analysis', temperature: 0.3,
      maxOutputTokens: 2_000, usageContext: { projectId, operation: '章后分析' }
    }))
    // 源码在分析期间被改动 → 结果过期，不作为当前结论。
    if (chapterSourceDigest(database.getProject(projectId), task.chapterId) !== task.sourceDigest) {
      database.updateChapterAnalysis(taskId, { status: '过期', error: '分析期间章节又被修改，结果不作为当前结论。' })
      return
    }
    completeChapterAnalysis(database, taskId, result)
  } catch (error) {
    failChapterAnalysis(database, taskId, error instanceof Error ? error.message : String(error))
  }
}

function addOutlineReviewTasks(project: z.infer<typeof NovelProjectSchema>, chapterNumbers: number[], reason: string): void {
  const now = new Date().toISOString()
  for (const chapterNumber of new Set(chapterNumbers)) {
    const outlineCard = project.outline?.volumes.flatMap((volume) => volume.chapters).find((item) => item.chapterNumber === chapterNumber)
    if (outlineCard) {
      outlineCard.downstreamReviewStatus = '待复核'
      outlineCard.downstreamReviewReason = reason
    }
    const chapter = project.chapters.find((item) => item.chapterNumber === chapterNumber && item.blocks.some((block) => block.text.trim()))
    if (!chapter || project.reviews.some((item) => item.chapterId === chapter.id && item.status === '待处理' && item.title === '规划变化后复核正文')) continue
    project.reviews.push({ id: randomUUID(), chapterId: chapter.id, category: '连续性', severity: '中', title: '规划变化后复核正文', description: `${reason}，已有正文不会被自动重写。`, evidence: [], recommendation: '对照新规划检查本章；如需调整，请生成修改候选或手动编辑。', status: '待处理', createdAt: now })
  }
}

const IdParams = z.object({ id: z.string() }), TaskParams = z.object({ id: z.string(), taskType: z.string().min(1) }), SampleParams = z.object({ sampleId: z.string().min(1) }), ProfileParams = z.object({ profileId: z.string().min(1) }), SettingParams = z.object({ id: z.string(), proposalId: z.string().min(1) }), DraftParams = z.object({ id: z.string(), draftId: z.string().min(1) }), AnalysisParams = z.object({ id: z.string(), analysisId: z.string().min(1) }), VersionParams = z.object({ id: z.string(), versionId: z.string() }), BranchParams = z.object({ id: z.string(), branchId: z.string() }), ProposalParams = z.object({ proposalId: z.string() }), QualityParams = z.object({ proposalId: z.string(), findingId: z.string() }), JobParams = z.object({ jobId: z.string() }), SeatParams = z.object({ id: z.string(), seatId: z.string() }), CapabilityParams = z.object({ id: z.string(), capabilityId: z.string() }), RunParams = z.object({ runId: z.string() }), RunStepParams = z.object({ runId: z.string(), stepId: z.string() }), ConversationParams = z.object({ id: z.string(), conversationId: z.string() }), GuideSessionParams = z.object({ id: z.string(), sessionId: z.string().min(1) })
function sameToken(left: string, right: string): boolean { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }

function toGenerationEvent(job: NovelGenerationJob): NovelGenerationEvent {
  if (job.status === '失败') return { type: 'failed', error: job.error ?? { code: 'GENERATION_FAILED', message: job.message, retryable: true } }
  if (job.status === '取消') return { type: 'canceled' }
  if (job.status === '完成' || job.status === '待确认') return { type: 'completed', proposalId: job.proposalId, memoryProposalIds: job.memoryProposalIds }
  return { type: 'progress', progress: { jobId: job.id, projectId: job.projectId, kind: job.kind, message: job.message, progress: job.progress } }
}
