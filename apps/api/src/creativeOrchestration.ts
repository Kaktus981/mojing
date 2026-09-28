import {
  NovelGenerationRequestSchema,
  type CreativeOrchestrationRun,
  type CreativeOrchestrationStep,
  type NovelGenerationRequest,
  type NovelOrchestrationPlanRequest
} from '../../../packages/contracts/src'
import type { NovelDatabaseService } from '../../../packages/core/src/novelDatabase'
import { buildNovelOrchestrationPlan } from '../../../packages/core/src/novelOrchestrator'

export interface OrchestrationJobController {
  start(projectId: string, request: NovelGenerationRequest, resumeOfJobId?: string): string
  cancel(id: string): void
}

/**
 * 把只读预演计划变成可恢复的作者工序。该服务只在作者明确执行单步时
 * 启动既有生成任务；生成结果仍进入原有候选确认流程，永远不会自动应用。
 */
export class CreativeOrchestrationService {
  constructor(private readonly database: NovelDatabaseService, private readonly jobs: OrchestrationJobController) {}

  create(projectId: string, request: NovelOrchestrationPlanRequest): CreativeOrchestrationRun {
    const plan = buildNovelOrchestrationPlan(this.database.getProject(projectId), request)
    const now = new Date().toISOString()
    const steps: CreativeOrchestrationStep[] = plan.steps.map((step, index) => ({
      id: step.id,
      runId: plan.id,
      order: index + 1,
      seatId: seatIdFor(step.role),
      title: step.title,
      kind: step.kind,
      targetId: step.targetId,
      dependsOn: step.dependsOn,
      status: step.status === '已满足' ? '跳过' : step.status === '等待前置' ? '等待前置' : dependenciesSatisfied(step.dependsOn, plan.steps.map((item) => ({ id: item.id, status: item.status === '已满足' ? '跳过' : '等待前置' }))) ? '可执行' : '等待前置',
      reason: step.reason,
      evidence: step.evidence,
      estimatedTokens: step.estimatedTokens,
      memoryProposalIds: [],
      attempt: 0,
      createdAt: now,
      updatedAt: now
    }))
    refreshAvailableSteps(steps)
    return this.database.createCreativeOrchestrationRun({
      id: plan.id,
      projectId,
      request,
      baseRevision: plan.baseRevision,
      status: '草稿',
      policy: plan.policy,
      warnings: plan.warnings,
      steps,
      createdAt: now,
      updatedAt: now
    })
  }

  list(projectId: string): CreativeOrchestrationRun[] {
    return this.database.listCreativeOrchestrationRuns(projectId).map((run) => this.reconcile(run))
  }

  get(runId: string): CreativeOrchestrationRun | undefined {
    const run = this.database.getCreativeOrchestrationRun(runId)
    return run ? this.reconcile(run) : undefined
  }

  start(runId: string): CreativeOrchestrationRun {
    const run = this.requireRun(runId)
    if (!['草稿', '暂停'].includes(run.status)) throw orchestrationError('ORCHESTRATION_NOT_STARTABLE', '当前工序运行不能启动。')
    const now = new Date().toISOString()
    return this.database.updateCreativeOrchestrationRun(run.id, { status: '等待执行', startedAt: run.startedAt ?? now, endedAt: undefined })
  }

  pause(runId: string): CreativeOrchestrationRun {
    const run = this.reconcile(this.requireRun(runId))
    if (!['等待执行', '运行中', '待作者确认', '失败'].includes(run.status)) throw orchestrationError('ORCHESTRATION_NOT_PAUSABLE', '当前工序运行不能暂停。')
    return this.database.updateCreativeOrchestrationRun(run.id, { status: '暂停' })
  }

  resume(runId: string): CreativeOrchestrationRun {
    const run = this.reconcile(this.requireRun(runId))
    if (run.status !== '暂停') throw orchestrationError('ORCHESTRATION_NOT_PAUSED', '只有已暂停的工序运行可以继续。')
    return this.database.updateCreativeOrchestrationRun(run.id, { status: deriveRunStatus(run.steps) })
  }

  cancel(runId: string): CreativeOrchestrationRun {
    const run = this.reconcile(this.requireRun(runId))
    if (['完成', '取消'].includes(run.status)) return run
    for (const step of run.steps) {
      if (step.status === '运行中' && step.jobId) this.jobs.cancel(step.jobId)
      if (!isTerminalStep(step.status)) this.database.updateCreativeOrchestrationStep(run.id, step.id, { status: '取消', endedAt: new Date().toISOString() })
    }
    return this.database.updateCreativeOrchestrationRun(run.id, { status: '取消', endedAt: new Date().toISOString() })
  }

  executeStep(runId: string, stepId: string): CreativeOrchestrationRun {
    const run = this.reconcile(this.requireRun(runId))
    if (!['等待执行', '运行中', '失败'].includes(run.status)) throw orchestrationError('ORCHESTRATION_NOT_ACTIVE', '请先启动工序运行，且不要在暂停或等待作者确认时执行新步骤。')
    const step = requireStep(run, stepId)
    if (step.status !== '可执行') throw orchestrationError('ORCHESTRATION_STEP_NOT_READY', '该步骤尚未满足前置条件，或已经执行。')
    if (!dependenciesSatisfied(step.dependsOn, run.steps)) throw orchestrationError('ORCHESTRATION_DEPENDENCY_BLOCKED', '该步骤的前置工序尚未完成。')
    if (run.steps.filter((item) => item.status === '运行中').length >= run.policy.maxParallel) throw orchestrationError('ORCHESTRATION_PARALLEL_LIMIT', `当前已达到 ${run.policy.maxParallel} 个并行工序上限。`)
    const seat = this.database.getCreativeSeat(run.projectId, step.seatId)
    if (!seat?.enabled) throw orchestrationError('ORCHESTRATION_SEAT_DISABLED', '负责该步骤的创作席位已停用，请先在席位中心启用。')
    const enabledCapabilities = new Set(this.database.listCreativeCapabilities(run.projectId).filter((item) => item.enabled).map((item) => item.id))
    if (!seat.capabilityIds.some((id) => enabledCapabilities.has(id))) throw orchestrationError('ORCHESTRATION_CAPABILITY_DISABLED', '该席位没有可用能力，请先启用并装配至少一项能力。')
    const request = this.generationRequest(run, step)
    const jobId = this.jobs.start(run.projectId, request)
    this.database.updateCreativeOrchestrationStep(run.id, step.id, {
      status: '运行中', jobId, proposalId: null, memoryProposalIds: [], error: null,
      attempt: step.attempt + 1, startedAt: new Date().toISOString(), endedAt: null
    })
    this.database.updateCreativeOrchestrationRun(run.id, { status: '运行中', startedAt: run.startedAt ?? new Date().toISOString(), endedAt: null })
    return this.reconcile(this.requireRun(run.id))
  }

  retryStep(runId: string, stepId: string): CreativeOrchestrationRun {
    const run = this.reconcile(this.requireRun(runId)), step = requireStep(run, stepId)
    if (step.status !== '失败') throw orchestrationError('ORCHESTRATION_STEP_NOT_FAILED', '只有失败的步骤可以重试。')
    const status = dependenciesSatisfied(step.dependsOn, run.steps) ? '可执行' : '等待前置'
    this.database.updateCreativeOrchestrationStep(run.id, step.id, { status, jobId: null, proposalId: null, memoryProposalIds: [], error: null, startedAt: null, endedAt: null })
    this.database.updateCreativeOrchestrationRun(run.id, { status: '等待执行', endedAt: null })
    return this.requireRun(run.id)
  }

  private generationRequest(run: CreativeOrchestrationRun, step: CreativeOrchestrationStep): NovelGenerationRequest {
    const project = this.database.getProject(run.projectId)
    const seat = this.database.getCreativeSeat(run.projectId, step.seatId)
    const raw: Record<string, unknown> = {
      kind: step.kind,
      baseRevision: project.revision,
      providerId: seat?.providerId,
      qualityProfile: 'standard',
      acknowledgedDraftPlanning: true
    }
    if (['scene-beats', 'chapter', 'chapter-revision', 'memory-extraction'].includes(step.kind)) raw.chapterId = step.targetId ?? run.request.chapterId
    if (step.kind === 'outline-volume') raw.volumeNumber = run.request.volumeNumber
    if (step.kind === 'world-audit') {
      const proposal = this.database.listRevisions(run.projectId).find((item) => item.target === 'worldBible' && item.status === '待处理')
      if (!proposal) throw orchestrationError('ORCHESTRATION_INPUT_REQUIRED', '当前没有可审校的世界观候选。')
      raw.proposalId = proposal.id
    }
    return NovelGenerationRequestSchema.parse(raw)
  }

  private reconcile(run: CreativeOrchestrationRun): CreativeOrchestrationRun {
    if (run.status === '草稿' || run.status === '取消') return run
    let changed = false
    for (const step of run.steps) {
      if (!step.jobId || !['运行中', '待作者确认'].includes(step.status)) continue
      const job = this.database.getGenerationJob(step.jobId)
      if (!job) continue
      const patch: Partial<CreativeOrchestrationStep> = { proposalId: job.proposalId, memoryProposalIds: job.memoryProposalIds }
      if (job.status === '等待' || job.status === '运行中') patch.status = '运行中'
      else if (job.status === '待确认') patch.status = '待作者确认'
      else if (job.status === '完成') { patch.status = '完成'; patch.endedAt = job.endedAt ?? new Date().toISOString() }
      else if (job.status === '失败') { patch.status = '失败'; patch.error = job.error; patch.endedAt = job.endedAt ?? new Date().toISOString() }
      else if (job.status === '取消') { patch.status = '取消'; patch.endedAt = job.endedAt ?? new Date().toISOString() }
      if (patch.status !== step.status || patch.proposalId !== step.proposalId || JSON.stringify(patch.memoryProposalIds) !== JSON.stringify(step.memoryProposalIds)) {
        this.database.updateCreativeOrchestrationStep(run.id, step.id, patch)
        changed = true
      }
    }
    let latest = changed ? this.requireRun(run.id) : run
    if (refreshAvailableSteps(latest.steps)) {
      for (const step of latest.steps) this.database.updateCreativeOrchestrationStep(latest.id, step.id, { status: step.status })
      latest = this.requireRun(latest.id)
    }
    if (latest.status === '暂停') return latest
    const status = deriveRunStatus(latest.steps)
    if (status !== latest.status) latest = this.database.updateCreativeOrchestrationRun(latest.id, { status, endedAt: ['完成', '取消'].includes(status) ? new Date().toISOString() : undefined })
    return latest
  }

  private requireRun(runId: string): CreativeOrchestrationRun {
    const run = this.database.getCreativeOrchestrationRun(runId)
    if (!run) throw orchestrationError('ORCHESTRATION_NOT_FOUND', '找不到指定的工序运行。')
    return run
  }
}

function refreshAvailableSteps(steps: CreativeOrchestrationStep[]): boolean {
  let changed = false
  for (const step of steps) {
    if (!['等待前置', '可执行'].includes(step.status)) continue
    const status = dependenciesSatisfied(step.dependsOn, steps) ? '可执行' : '等待前置'
    if (step.status !== status) { step.status = status; changed = true }
  }
  return changed
}

function dependenciesSatisfied(ids: string[], steps: Array<{ id: string; status: string }>): boolean {
  return ids.every((id) => { const dependency = steps.find((step) => step.id === id); return dependency?.status === '完成' || dependency?.status === '跳过' })
}

function deriveRunStatus(steps: CreativeOrchestrationStep[]): CreativeOrchestrationRun['status'] {
  if (steps.every((step) => isTerminalStep(step.status))) return steps.some((step) => step.status === '失败') ? '失败' : steps.some((step) => step.status === '取消') ? '取消' : '完成'
  if (steps.some((step) => step.status === '运行中')) return '运行中'
  if (steps.some((step) => step.status === '待作者确认')) return '待作者确认'
  if (steps.some((step) => step.status === '失败')) return '失败'
  return '等待执行'
}

function isTerminalStep(status: CreativeOrchestrationStep['status']): boolean { return ['完成', '失败', '跳过', '取消'].includes(status) }
function requireStep(run: CreativeOrchestrationRun, id: string): CreativeOrchestrationStep {
  const step = run.steps.find((item) => item.id === id)
  if (!step) throw orchestrationError('ORCHESTRATION_STEP_NOT_FOUND', '找不到指定的工序步骤。')
  return step
}
function orchestrationError(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }
function seatIdFor(role: string): string {
  const ids: Record<string, string> = {
    '设定校准席': 'seat-world-steward', '结构规划席': 'seat-story-architect', '节拍规划席': 'seat-story-architect',
    '正文起草席': 'seat-prose-crafter', '连续性审阅席': 'seat-continuity-keeper', '记忆归档席': 'seat-memory-curator', '伏笔审阅席': 'seat-thread-tracker'
  }
  return ids[role] ?? 'seat-continuity-keeper'
}
