import { create } from 'zustand'
import type { EntityMention, MemoryProposal, MemoryProposalBatchDecision, NovelGenerationEstimate, NovelGenerationJob, NovelGenerationProgress, NovelGenerationRequest, NovelMemoryHealth, NovelOrchestrationPlan, NovelOrchestrationPlanRequest, NovelProject, NovelProjectSummary, NovelRevisionProposal, NovelVersionSummary, OutlineStructureEditRequest, OutlineStructurePreviewResponse } from '../../../packages/contracts/src'
import { MojingHttpError, mojingClient, type NovelVersionRestorePreviewPayload } from './api/mojingClient'

export type MojingStage = 'ai-workbench' | 'creative-seats' | 'history' | 'idea' | 'world' | 'outline' | 'writing' | 'memory' | 'delivery'

interface NovelState {
  summariesState: 'idle' | 'loading' | 'ready' | 'error'; summariesError?: string; summariesErrorKind?: 'load' | 'refresh'; hallFeedback?: string; hallImportError?: string; hallCreateError?: string; hallDeleteError?: string; hallActionError?: { action: 'archive' | 'restore'; message: string }
  summaries: NovelProjectSummary[]; project?: NovelProject; revisions: NovelRevisionProposal[]; memoryProposals: MemoryProposal[]; versions: NovelVersionSummary[]; restorePreview?: NovelVersionRestorePreviewPayload; restorePreviewState: '空闲' | '正在加载' | '预览失败'; restorePreviewError?: string; generationJobs: NovelGenerationJob[]; mentions: EntityMention[]; memoryHealth?: NovelMemoryHealth; orchestrationPlan?: NovelOrchestrationPlan
  stage: MojingStage; selectedChapterId?: string; activeJobId?: string; busy: boolean; saveState: '已保存' | '正在保存' | '未保存' | '保存失败'; progress?: NovelGenerationProgress; lastEstimate?: NovelGenerationEstimate; error?: string; notice?: string
  /**
   * 保存这条链路**自己**的错误。与 `restorePreviewState` / `restorePreviewError` 同一范式：
   * 状态与错误信息成对，不借全局 `error` 表达「保存失败」—— 否则任何一处别的动作失败，
   * 正文区都会误报「保存失败」。只在保存失败时写入，保存成功（含重试成功）时清空。
   */
  saveError?: string
  /**
   * 从项目大厅重新打开项目时的恢复目标（上次看到的栏目 + 二级页）。
   * 只在 `openProject` 里写入、`closeProject` 里清空，供 WorkspacePage 初始化导航用；
   * 不是持久化数据，也不参与服务端契约。
   */
  restoredTarget?: { stage: MojingStage; subnavId: string }
  initialize(): Promise<void>; createProject(input: Parameters<typeof mojingClient.novels.create>[0]): Promise<void>; importProject(file: File): Promise<void>; openProject(id: string): Promise<void>; closeProject(): Promise<void>; removeProject(id: string, title?: string, confirmed?: boolean): Promise<boolean>; archiveProject(id: string, archived: boolean): Promise<boolean>
  setStage(stage: MojingStage): void; selectChapter(id: string): void; rememberWorkspaceTarget(target: { stage: MojingStage; subnavId: string }): void; updateProject(mutator: (draft: NovelProject) => void, analyzeChapterId?: string): void; persistNow(): Promise<NovelProject | undefined>
  estimateGeneration(request: Omit<NovelGenerationRequest, 'baseRevision'>): Promise<NovelGenerationEstimate | undefined>; generate(request: Omit<NovelGenerationRequest, 'baseRevision'>, options?: { skipConfirmation?: boolean }): Promise<void>; resumeGeneration(jobId: string): Promise<void>; cancelGeneration(jobId?: string): Promise<void>; updateRevision(id: string, candidate: unknown): Promise<boolean>; applyRevision(id: string): Promise<void>; rejectRevision(id: string): Promise<void>; resolveRevisionBatch(ids: string[], action: '应用' | '放弃'): Promise<void>; resolveRevisionQuality(id: string, findingId: string, action: '接受修复' | '忽略', replacement?: string): Promise<void>; resolveMemory(id: string, status: '已接受' | '已拒绝', candidate?: unknown): Promise<void>; resolveMemoryBatch(decisions: MemoryProposalBatchDecision[]): Promise<void>; createManualMemoryProposal(chapterId: string, candidate: string, reason: string): Promise<boolean>
  adoptBranch(branchId: string, branchChapterId?: string): Promise<void>
  /** 服务端已经保存过的项目整体替换（如绑定/停用文风范本）：不产生第二次保存。 */
  replaceProject(next: NovelProject): void
  /**
   * 采用工作草稿（D3）：作者必须在界面上看过差异，并把**那一刻**的草稿版本与预览摘要带过来。
   * 这里不重新算预览，也不允许「点一下就把另一份预览应用掉」。
   * 返回 true 表示服务端已采用；false 表示没写入，调用方要保留草稿、预览与提示。
   */
  applyAssistantDraft(draftId: string, confirmation: { version: number; previewDigest: string }): Promise<boolean>
  planOrchestration(request: NovelOrchestrationPlanRequest): Promise<NovelOrchestrationPlan | undefined>; clearOrchestrationPlan(): void
  /** 大纲结构编辑预览：只产出候选与影响摘要，作者确认后才走 applyRevision 正式应用。 */
  previewOutlineStructure(input: OutlineStructureEditRequest): Promise<OutlineStructurePreviewResponse | undefined>
  /** 检查点名称可选：不传时使用兼容默认值「手动检查点」。 */
  createCheckpoint(reason?: string): Promise<void>
  /** 恢复差异预览：绑定当前稿与目标快照，旧预览会被服务端拒绝。 */
  previewVersionRestore(versionId: string): Promise<NovelVersionRestorePreviewPayload | undefined>
  restoreVersion(id: string): Promise<void>; removeVersion(id: string): Promise<void>; exportProject(format: 'json' | 'docx' | 'txt' | 'md'): Promise<void>; refreshAuxiliary(): Promise<void>; dismiss(target?: 'error' | 'notice' | 'hallFeedback' | 'hallImportError' | 'hallCreateError' | 'hallDeleteError' | 'hallActionError'): void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let analysisTimer: ReturnType<typeof setTimeout> | undefined
let pendingAnalysisChapterId: string | undefined
let scheduledAnalysisChapterId: string | undefined
/** 恢复执行中标记：阻止并发重复恢复。 */
let restoring = false
/** 采用工作草稿执行中标记：阻止重复点击造成二次写入。 */
let applyingAssistantDraft = false
let editSequence = 0
let persistPromise: Promise<NovelProject | undefined> | undefined
const analyzedDigests = new Map<string, string>()
/**
 * 「记得上次看到哪儿」：按项目 id 记住上次选中的章与所在栏目/二级页。
 * 刻意只用模块级内存：不写 localStorage（测试环境没有）、不落库、不改服务端契约。
 * `closeProject` 不会清它，所以「工作区 → 返回项目大厅 → 再进同一项目」能回到原位。
 */
const workspaceSelection = new Map<string, { chapterId?: string; stage?: MojingStage; subnavId?: string }>()

function optimisticSummary(project: NovelProject): NovelProjectSummary {
  const description = Array.from((project.outline?.synopsis.trim() || project.seed.trim()).replace(/\s+/g, ' ')).slice(0, 160).join('') || undefined
  const wordCount = project.chapters.reduce((sum, chapter) => sum + chapter.blocks.reduce((chapterSum, block) => chapterSum + block.text.replace(/\s/g, '').length, 0), 0)
  const targetWords = Math.max(1, project.settings.targetWords || 1)
  const planningProgress = Math.min(100, (project.worldBible ? 50 : 0) + (project.outline ? 30 : 0) + (project.worldBible?.status === '定稿' ? 10 : 0) + (project.outline?.status === '定稿' ? 10 : 0))
  const unresolvedThreads = project.plotThreads.filter((item) => !['已回收', '已放弃'].includes(item.status)).length
  const overdueThreads = project.plotThreads.filter((item) => item.status === '逾期').length
  const pendingReviews = project.reviews.filter((item) => item.status === '待处理').length
  return {
    description, id: project.id, title: project.title, status: project.status, genreTemplate: project.settings.genreTemplate,
    chapterCount: project.chapters.length, wordCount, pendingMemoryCount: 0, updatedAt: project.updatedAt,
    archived: Boolean(project.archived), creationMode: '标准创作', planningProgress, writingProgress: Math.min(100, Math.round((wordCount / targetWords) * 100)),
    health: { pendingMemory: 0, unresolvedThreads, overdueThreads, pendingReviews, staleOutlineCards: 0, recoverableJobs: 0 }
  }
}

/** 服务端变更成功后先保留本地结果，再刷新大厅列表；刷新失败不撤销已成功的变更。 */
async function refreshSummariesAfterMutation(
  get: () => NovelState,
  set: (partial: Partial<NovelState>) => void,
  project: NovelProject,
  notice: string
): Promise<void> {
  const summary = optimisticSummary(project)
  set({ project, summaries: [summary, ...get().summaries.filter((item) => item.id !== project.id)], summariesState: 'ready', summariesError: undefined, summariesErrorKind: undefined, hallFeedback: notice, notice })
  try { set({ summaries: await mojingClient.novels.list(), summariesState: 'ready', summariesError: undefined, summariesErrorKind: undefined }) }
  catch (error) { set({ summariesState: 'error', summariesError: friendly(error), summariesErrorKind: 'refresh', notice: `${notice} 项目列表暂时未刷新，返回大厅后可重试。` }) }
}

/** 记录/更新当前项目记住的导航目标，保留同一记录里已有的其它字段。 */
function rememberSelectionForCurrentProject(state: NovelState, patch: { chapterId?: string; stage?: MojingStage; subnavId?: string }): void {
  const projectId = state.project?.id
  if (!projectId) return
  workspaceSelection.set(projectId, { ...workspaceSelection.get(projectId), ...patch })
}

export const useNovelStore = create<NovelState>((set, get) => ({
  summariesState: 'idle',
  summaries: [], revisions: [], memoryProposals: [], versions: [], restorePreviewState: '空闲', generationJobs: [], mentions: [], stage: 'idea', busy: false, saveState: '已保存',
  async initialize() {
    if (get().summariesState === 'loading') return
    const retryKind = get().summariesErrorKind
    set({ summariesState: 'loading', summariesError: undefined })
    try { set({ summaries: await mojingClient.novels.list(), summariesState: 'ready', summariesErrorKind: undefined, hallFeedback: retryKind === 'refresh' ? undefined : get().hallFeedback }) }
    catch (error) { set({ summariesState: 'error', summariesError: friendly(error), summariesErrorKind: retryKind ?? 'load' }) }
  },
  async createProject(input) {
    const previousCreateError = get().hallCreateError
    set({ hallCreateError: undefined, error: get().error === previousCreateError ? undefined : get().error })
    try {
      const project = await mojingClient.novels.create(input)
      set({ stage: 'idea', selectedChapterId: undefined, restoredTarget: undefined, generationJobs: [], mentions: [], orchestrationPlan: undefined })
      await refreshSummariesAfterMutation(get, set, project, '小说项目已创建。')
    } catch (error) { const message = friendlyCreateError(error); set({ hallCreateError: message, error: message }) }
  },
  async importProject(file) {
    set({ hallImportError: undefined })
    try {
      const project = await mojingClient.novels.importFile(file)
      const planningNotice = project.worldBible && project.outline ? `已完整导入 ${project.chapters.length} 章，以及世界观、大纲、记忆和伏笔资料。` : `已导入 ${project.chapters.length} 章原文；请先建立世界观和大纲。`
      set({ stage: 'idea', selectedChapterId: project.chapters[0]?.id, restoredTarget: undefined, generationJobs: [], orchestrationPlan: undefined })
      await refreshSummariesAfterMutation(get, set, project, planningNotice)
    } catch (error) { const message = friendlyImportError(error); set({ hallImportError: message, error: message }) }
  },
  async openProject(id) {
    try {
      const project = await mojingClient.novels.get(id)
      /**
       * 恢复「上次看到哪儿」。记忆只存在模块级 Map 里，可能缺失，也可能指向已被删除的章：
       *   - 章：只有命中的章还在才用它，否则回落到第一章；
       *   - 栏目：`writing` 依赖具体章，命中的章不在就视为与数据矛盾，退回按数据推算的栏目；
       *     其它栏目不依赖单章，可以直接恢复。
       */
      const remembered = workspaceSelection.get(id)
      const rememberedChapter = remembered?.chapterId
        ? project.chapters.find((chapter) => chapter.id === remembered.chapterId)
        : undefined
      const selectedChapterId = rememberedChapter?.id ?? project.chapters[0]?.id
      const stageUsable = remembered?.stage !== undefined && (remembered.stage !== 'writing' || rememberedChapter !== undefined)
      const stage: MojingStage = stageUsable ? remembered!.stage! : project.chapters.length ? 'writing' : 'idea'
      const restoredTarget = stageUsable ? { stage, subnavId: remembered?.subnavId ?? '' } : undefined
      set({ project, selectedChapterId, orchestrationPlan: undefined, restorePreview: undefined, restorePreviewState: '空闲', restorePreviewError: undefined, stage, restoredTarget })
      await get().refreshAuxiliary()
    } catch (error) { set({ error: friendly(error) }) }
  },
  async closeProject() {
    if (get().activeJobId) await get().cancelGeneration()
    if (saveTimer) clearTimeout(saveTimer)
    if (analysisTimer) clearTimeout(analysisTimer)
    analysisTimer = undefined; scheduledAnalysisChapterId = undefined
    const saved = await get().persistNow()
    if (get().project && !saved) return
    if (analysisTimer) clearTimeout(analysisTimer)
    analysisTimer = undefined; scheduledAnalysisChapterId = undefined
    // 只清运行时状态：`workspaceSelection` 刻意保留，「返回项目大厅 → 再进同一项目」才能回到原处。
    set({ project: undefined, revisions: [], memoryProposals: [], versions: [], restorePreview: undefined, restorePreviewState: '空闲', restorePreviewError: undefined, generationJobs: [], mentions: [], memoryHealth: undefined, orchestrationPlan: undefined, selectedChapterId: undefined, activeJobId: undefined, stage: 'idea', restoredTarget: undefined })
    await get().initialize()
  },
  async removeProject(id, title, confirmed = false) {
    const projectTitle = title?.trim() || get().summaries.find((item) => item.id === id)?.title || '这个小说项目'
    if (!confirmed && !window.confirm(`确定永久删除「${projectTitle}」吗？此操作不可撤销。`)) return false
    const previousDeleteError = get().hallDeleteError
    set({ hallDeleteError: undefined, hallFeedback: undefined, notice: undefined, error: get().error === previousDeleteError ? undefined : get().error })
    try {
      await mojingClient.novels.remove(id)
      set({ summaries: get().summaries.filter((item) => item.id !== id), hallFeedback: '小说项目已删除。', notice: '小说项目已删除。' })
      try { set({ summaries: await mojingClient.novels.list(), summariesState: 'ready', summariesError: undefined, summariesErrorKind: undefined }) }
      catch (error) { set({ summariesState: 'error', summariesError: friendly(error), summariesErrorKind: 'refresh', notice: '小说项目已删除；项目列表暂时未刷新，返回大厅后可重试。' }) }
      return true
    } catch (error) {
      const message = friendlyHallDeleteError(error)
      set({ hallDeleteError: message, error: message })
      return false
    }
  },
  // 归档不删除任何内容，只是把项目移出「全部项目」并可在「查看归档」中恢复。
  // 之前 MojingHome 读取了不存在的 store 字段，导致 ProjectLibrary 的归档按钮点击即 TypeError。
  async archiveProject(id, archived) {
    const action = archived ? 'archive' : 'restore'
    const feedback = archived ? '小说项目已归档，可在「已归档」中恢复。' : '小说项目已恢复到在写项目。'
    const previousActionError = get().hallActionError?.message
    set({ hallActionError: undefined, hallFeedback: undefined, notice: undefined, error: get().error === previousActionError ? undefined : get().error })
    try {
      const updated = await mojingClient.novels.archive(id, archived)
      const currentProject = get().project
      const existingSummary = get().summaries.find((item) => item.id === id)
      const updatedSummary = existingSummary ? { ...existingSummary, archived, updatedAt: updated.updatedAt } : optimisticSummary(updated)
      set({ summaries: [updatedSummary, ...get().summaries.filter((item) => item.id !== id)], project: currentProject?.id === id ? updated : currentProject, summariesState: 'ready', summariesError: undefined, summariesErrorKind: undefined, hallFeedback: feedback, notice: feedback })
      try { set({ summaries: await mojingClient.novels.list(), summariesState: 'ready', summariesError: undefined, summariesErrorKind: undefined }) }
      catch (error) { set({ summariesState: 'error', summariesError: friendly(error), summariesErrorKind: 'refresh', notice: `${feedback} 项目列表暂时未刷新，可重新同步。` }) }
      return true
    } catch (error) {
      const message = friendlyHallActionError(error, archived)
      set({ hallActionError: { action, message }, error: message })
      return false
    }
  },
  setStage(stage) { set({ stage }) },
  selectChapter(id) { const previous = get().selectedChapterId; if (previous && previous !== id && scheduledAnalysisChapterId === previous) queueMemoryAnalysis(get, previous, 0); rememberSelectionForCurrentProject(get(), { chapterId: id }); set({ selectedChapterId: id, stage: 'writing' }) },
  /** 记下当前项目的栏目/二级页，供下次 openProject 恢复（保留同一记录里已存的 chapterId）。 */
  rememberWorkspaceTarget(target) { rememberSelectionForCurrentProject(get(), { stage: target.stage, subnavId: target.subnavId }) },
  updateProject(mutator, analyzeChapterId) { const project = get().project; if (!project) return; const draft = structuredClone(project); mutator(draft); draft.updatedAt = new Date().toISOString(); editSequence += 1; if (analyzeChapterId) pendingAnalysisChapterId = analyzeChapterId; set({ project: draft, saveState: '未保存' }); if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => void get().persistNow(), 900) },
  async persistNow() {
    if (persistPromise) return persistPromise
    if (!get().project || get().saveState === '已保存') return get().project
    persistPromise = (async () => {
      while (true) {
        const project = get().project
        if (!project || get().saveState === '已保存') return project
        const sequence = editSequence
        if (saveTimer) clearTimeout(saveTimer)
        set({ saveState: '正在保存' })
        try {
          const saved = await mojingClient.novels.save(project, project.revision)
          // 只撤下这次已经恢复的保存错误，保留同时发生的其他操作错误。
          if (get().saveError && get().error === get().saveError) set({ error: undefined })
          const latest = get().project
          if (sequence !== editSequence && latest?.id === saved.id) {
            set({ project: { ...latest, revision: saved.revision }, saveState: '未保存', saveError: undefined })
            continue
          }
          set({ project: saved, saveState: '已保存', saveError: undefined })
          const chapterId = pendingAnalysisChapterId
          pendingAnalysisChapterId = undefined
          const chapter = saved.chapters.find((item) => item.id === chapterId)
          if (chapter && chapter.blocks.some((block) => block.text.trim()) && analyzedDigests.get(chapter.id) !== chapter.sourceDigest) queueMemoryAnalysis(get, chapter.id, 10_000)
          return saved
        } catch (error) {
          // 「保存失败」是独立状态，错误信息进 saveError（正文区只读它）。
          // 全局 error 仍照旧写入，全局提示的收敛属于第三阶段，这里不改动既有行为。
          const message = friendly(error)
          set({ saveState: '保存失败', saveError: message, error: message })
          return undefined
        }
      }
    })()
    try { return await persistPromise } finally { persistPromise = undefined }
  },
  async estimateGeneration(request) {
    const project = await get().persistNow(); if (!project) return undefined
    try {
      const estimate = await mojingClient.generations.estimate(project.id, { ...request, baseRevision: project.revision })
      set({ lastEstimate: estimate, error: undefined })
      return estimate
    } catch (error) { set({ error: friendly(error) }); return undefined }
  },
  async generate(request, options) {
    const project = await get().persistNow(); if (!project) return
    const prepared: NovelGenerationRequest = { ...request, baseRevision: project.revision }
    set({ busy: true, error: undefined })
    try {
      const estimate = await mojingClient.generations.estimate(project.id, prepared)
      set({ lastEstimate: estimate })
      if (request.kind !== 'memory-extraction' && !options?.skipConfirmation) {
        const summary = [`预计输入 ${estimate.estimatedInputTokens.toLocaleString()} Token`, ...estimate.warnings, `纳入：${estimate.entries.filter((item) => item.included).map((item) => item.title).join('、')}`].join('\n')
        if (!window.confirm(`${summary}\n\n确认开始本次 AI 任务？`)) { set({ busy: false }); return }
      }
      const acknowledged = estimate.warnings.length ? true : prepared.acknowledgedDraftPlanning
      const { jobId } = await mojingClient.generations.start(project.id, { ...prepared, acknowledgedDraftPlanning: acknowledged })
      set({ activeJobId: jobId })
      await new Promise<void>((resolve, reject) => { const unsubscribe = mojingClient.generations.subscribe(jobId, (event) => { if (event.type === 'progress') set({ progress: event.progress }); else { unsubscribe(); if (event.type === 'failed') reject(new Error(event.error.message)); else if (event.type === 'canceled') reject(new Error('任务已取消。')); else resolve() } }) })
      const fresh = await mojingClient.novels.get(project.id); if (request.kind === 'memory-extraction' && request.chapterId) { const chapter = fresh.chapters.find((item) => item.id === request.chapterId); if (chapter) analyzedDigests.set(chapter.id, chapter.sourceDigest) } const extractedConstraints = (request.kind === 'world-constraint-extraction' || (request.kind === 'world-foundation' && project.worldConstraints.length === 0)) && fresh.worldConstraints.some((item) => item.status === '待确认'); set({ project: fresh, notice: request.kind === 'memory-extraction' ? '章节记忆分析完成，请核对新提案。' : request.kind === 'world-repair-suggestion' ? 'AI 修改建议已生成，请在质量问题下方查看。' : extractedConstraints ? '已从故事种子提取核心术语边界。请确认后再生成世界观。' : 'AI 候选已生成，请确认后应用。' })
    } catch (error) { const message = friendly(error); if (message === '任务已取消。') set({ notice: message }); else if (request.kind !== 'memory-extraction' || !/配置.*模型|API Key/.test(message)) set({ error: message }) } finally { await get().refreshAuxiliary(); set({ busy: false, progress: undefined, activeJobId: undefined }) }
  },
  async cancelGeneration(jobId) { const target = jobId ?? get().activeJobId ?? get().generationJobs.find((item) => item.status === '运行中' || item.status === '等待')?.id; if (!target) return; try { await mojingClient.generations.cancel(target); set({ notice: '正在取消 AI 任务…' }) } catch (error) { set({ error: friendly(error) }) } },
  async resumeGeneration(jobId) {
    const project = get().project
    if (!project) return
    set({ busy: true, error: undefined })
    try {
      const resumed = await mojingClient.generations.resume(jobId)
      set({ activeJobId: resumed.jobId, notice: '已从上次保存的场景检查点继续任务。' })
      await new Promise<void>((resolve, reject) => {
        const unsubscribe = mojingClient.generations.subscribe(resumed.jobId, (event) => {
          if (event.type === 'progress') set({ progress: event.progress })
          else { unsubscribe(); if (event.type === 'failed') reject(new Error(event.error.message)); else if (event.type === 'canceled') reject(new Error('任务已取消。')); else resolve() }
        })
      })
      set({ project: await mojingClient.novels.get(project.id) })
    } catch (error) { set({ error: friendly(error) }) }
    finally { await get().refreshAuxiliary(); set({ busy: false, progress: undefined, activeJobId: undefined }) }
  },
  async updateRevision(id, candidate) { try { const updated = await mojingClient.revisions.update(id, candidate); set({ revisions: get().revisions.map((item) => item.id === id ? updated : item), notice: '候选修改已保存；正式内容尚未改变。' }); return true } catch (error) { set({ error: friendly(error) }); return false } },
  async previewOutlineStructure(input) { const project = get().project; if (!project) return undefined; try { const result = await mojingClient.novels.outlineStructure?.preview(project.id, input); if (!result) { set({ error: '当前客户端没有接通大纲结构预览。' }); return undefined }; set({ revisions: [...get().revisions.filter((item) => item.id !== result.proposal.id), result.proposal] }); return result } catch (error) { set({ error: friendly(error) }); return undefined } },
  async applyRevision(id) {
    const project = await get().persistNow()
    if (!project) return
    const proposal = get().revisions.find((item) => item.id === id)
    /**
     * 结构候选必须带**自己生成时的基线版本**：预览之后项目又变了，服务端就会判为冲突，
     * 由作者确认后才允许继续。AI 候选仍按当前版本提交，保持既有行为。
     */
    const baseRevision = proposal?.structureOperation ? proposal.baseRevision : project.revision
    try {
      let saved: NovelProject
      try {
        saved = await mojingClient.revisions.apply(id, baseRevision)
      } catch (error) {
        if (error instanceof MojingHttpError && error.code === 'WORLD_QUALITY_CONFLICT') {
          if (!window.confirm(`${error.message}\n\n仍要明确忽略这些问题并应用吗？本次决定会写入版本历史。`)) throw error
          saved = await mojingClient.revisions.apply(id, baseRevision, false, true)
        } else {
          if (!(error instanceof MojingHttpError) || error.status !== 409 || !window.confirm('项目在候选生成后已经变化。仍要应用候选吗？应用前会保存当前版本。')) throw error
          saved = await mojingClient.revisions.apply(id, baseRevision, true)
        }
      }
      let notice = 'AI 候选已完整应用；应用前的项目已保存到“历史记录”。'
      if (proposal?.structureOperation) {
        // 结构变更会重排章号；如实告知有多少正文暂时没有对应章纲，而不是假装一切对齐。
        const outlineNumbers = new Set((saved.outline?.volumes ?? []).flatMap((volume) => volume.chapters.map((chapter) => chapter.chapterNumber)))
        const orphanCount = saved.chapters.filter((chapter) => !outlineNumbers.has(chapter.chapterNumber)).length
        notice = '结构变更已应用；应用前的大纲已保存到「历史记录」。'
        if (orphanCount > 0) notice += `有 ${orphanCount} 章正文当前没有对应章纲，可在「章节规划」里补建章纲。`
      }
      set({ project: saved, notice })
      await get().refreshAuxiliary()
      if (proposal?.target === 'chapter' && proposal.targetId) queueMemoryAnalysis(get, proposal.targetId, 0)
    } catch (error) {
      if (!(error instanceof MojingHttpError && error.code === 'WORLD_QUALITY_CONFLICT')) set({ error: friendly(error) })
    }
  },
  async rejectRevision(id) { try { await mojingClient.revisions.reject(id); set({ revisions: get().revisions.filter((item) => item.id !== id), notice: '已放弃候选，原稿没有变化。' }) } catch (error) { set({ error: friendly(error) }) } },
  async resolveRevisionBatch(ids, action) {
    const project = await get().persistNow()
    if (!project || ids.length === 0) return
    set({ busy: true, error: undefined })
    try {
      await mojingClient.revisions.resolveBatch(project.id, project.revision, ids.map((proposalId) => ({ proposalId, action })))
      set({ project: await mojingClient.novels.get(project.id), notice: `已${action === '应用' ? '应用' : '放弃'} ${ids.length} 条候选。` })
      await get().refreshAuxiliary()
    } catch (error) { set({ error: friendly(error) }) }
    finally { set({ busy: false }) }
  },
  async resolveRevisionQuality(id, findingId, action, replacement) { try { const updated = await mojingClient.revisions.resolveQuality(id, findingId, action, replacement); set({ revisions: get().revisions.map((item) => item.id === id ? updated : item), notice: action === '接受修复' ? '已把局部修复写入候选，正式世界观尚未改变。' : '已忽略这条问题。' }) } catch (error) { set({ error: friendly(error) }) } },
  async resolveMemory(id, status, candidate) { const project = get().project; if (!project) return; try { const saved = await mojingClient.memory.resolve(id, status, project.revision, candidate); set({ project: saved, notice: status === '已接受' ? '记忆变更已写入正式记忆。' : '已拒绝记忆变更，正式记忆未改变。' }); await get().refreshAuxiliary() } catch (error) { set({ error: friendly(error) }) } },
  async resolveMemoryBatch(decisions) {
    const project = await get().persistNow()
    if (!project || decisions.length === 0) return
    set({ busy: true, error: undefined })
    try {
      const result = await mojingClient.memory.resolveBatch(project.id, project.revision, decisions)
      if (result.status === '全部回滚') {
        set({ error: result.blockers.map((item) => item.message).join('；') || '这批提案未写入，请重新检查。' })
        return
      }
      set({ notice: `已处理 ${decisions.length} 条记忆提案。` })
      try {
        set({ project: await mojingClient.novels.get(project.id) })
        await get().refreshAuxiliary()
      } catch (error) { set({ error: `批量处理已完成，但刷新失败：${friendly(error)}` }) }
    } catch (error) { set({ error: friendly(error) }) }
    finally { set({ busy: false }) }
  },
  async createManualMemoryProposal(chapterId, candidate, reason) {
    const project = await get().persistNow()
    if (!project) return false
    set({ busy: true, error: undefined })
    try {
      const baseline = await mojingClient.memory.manualBaseline(project.id, chapterId, '章节摘要')
      await mojingClient.memory.createManual(project.id, {
        chapterId, category: '章节摘要', candidate, reason,
        currentRevision: baseline.currentRevision,
        sourceDigest: baseline.sourceDigest,
        baseTargetDigest: baseline.baseTargetDigest
      })
      await get().refreshAuxiliary()
      set({ notice: '摘要修订已存为待确认提案，正式记忆尚未改变。' })
      return true
    } catch (error) {
      set({ error: friendly(error) })
      return false
    } finally { set({ busy: false }) }
  },
  async adoptBranch(branchId, branchChapterId) { const project = await get().persistNow(); if (!project) return; try { await mojingClient.branches.adopt(project.id, branchId, project.revision, branchChapterId); await get().refreshAuxiliary(); set({ notice: '已生成采用分支的正文差异候选；确认后才会替换正式章节。', stage: 'delivery' }) } catch (error) { set({ error: friendly(error) }) } },
  replaceProject(next) { const current = get().project; if (!current || current.id !== next.id) return; set({ project: next }) },
  async applyAssistantDraft(draftId, confirmation) {
    const project = get().project
    if (!project) return false
    if (applyingAssistantDraft) { set({ error: '上一次采用还在执行，请等它结束。' }); return false }
    /**
     * 采用前项目必须是已保存状态：若还有未落盘的修改，先把「保存」这一步交回给作者，
     * 否则保存会把项目版本推进，作者刚确认的那份预览就失效了——
     * 绝不允许在这里静默重算一份预览再直接写库。
     */
    if (get().saveState !== '已保存') {
      set({ error: '还有未保存的修改，请先保存，再重新确认差异后采用。' })
      return false
    }
    applyingAssistantDraft = true
    try {
      const applied = await mojingClient.assistantDrafts.apply(project.id, draftId, {
        expectedVersion: confirmation.version, expectedPreviewDigest: confirmation.previewDigest
      })
      set({ project: applied, notice: '已采用这份工作草稿；采用前的项目已保存到「版本历史」。' })
      await get().refreshAuxiliary()
      return true
    } catch (error) {
      set({ error: friendly(error) })
      return false
    } finally {
      applyingAssistantDraft = false
    }
  },
  async planOrchestration(request) { const project = await get().persistNow(); if (!project) return undefined; try { const orchestrationPlan = await mojingClient.orchestration.plan(project.id, request); set({ orchestrationPlan, error: undefined }); return orchestrationPlan } catch (error) { set({ error: friendly(error) }); return undefined } },
  clearOrchestrationPlan() { set({ orchestrationPlan: undefined }) },
  async createCheckpoint(reason) { const project = await get().persistNow(); if (!project) return; try { const name = reason?.trim() || '手动检查点'; await mojingClient.versions.checkpoint(project.id, name); await get().refreshAuxiliary(); set({ notice: `检查点「${name}」已创建。` }) } catch (error) { set({ error: friendly(error) }) } },
  async previewVersionRestore(versionId) {
    const project = get().project
    if (!project) return undefined
    /**
     * 换预览目标或重新预览时，先把上一条预览**作废**：旧预览绝不能继续为按钮放行。
     * 失败时同样清空，并留下明确原因 —— 不用旧数据兜底，也不用默认值伪装成功。
     */
    set({ restorePreviewState: '正在加载', restorePreviewError: undefined, restorePreview: undefined })
    try {
      const preview = await mojingClient.versions.restorePreview(project.id, versionId)
      /**
       * 这里只做「原样透传」：预览与当前稿是否还对得上，一律交给契约的 versionRestoreState()
       * 在渲染时判定（比较 preview.currentRevision 与项目当前 revision）。加载期间作者若动过稿，
       * 状态会自动落到「预览已过期」，按钮随之禁用 —— 不在 store 里偷偷放行。
       */
      set({ restorePreview: preview, restorePreviewState: '空闲' })
      return preview
    } catch (error) {
      const message = friendly(error)
      set({ error: message, restorePreview: undefined, restorePreviewState: '预览失败', restorePreviewError: message })
      return undefined
    }
  },
  /**
   * 受控恢复：必须先有绑定当前稿的差异预览，再带 currentRevision + previewDigest 提交。
   * 未保存的草稿一律先保存成功；执行中拒绝重复请求；服务端在单个事务里建恢复前快照并换内容。
   */
  async restoreVersion(id) {
    const project = get().project
    if (!project) return
    if (restoring) { set({ error: '上一次恢复还在执行，请等它结束。' }); return }
    if (get().saveState !== '已保存') {
      const saved = await get().persistNow()
      if (!saved) { set({ error: '当前修改没有保存成功，已取消恢复，避免用旧快照覆盖新输入。' }); return }
    }
    const preview = get().restorePreview
    if (!preview || preview.versionId !== id) {
      // 预览属于别的快照（或压根没有）→ 作废它，别让它继续为这条快照放行。
      set({ error: '请先在这个版本上运行差异预览，再执行恢复。', restorePreview: undefined, restorePreviewState: '空闲', restorePreviewError: undefined })
      return
    }
    if (preview.currentRevision !== get().project?.revision) {
      set({ error: '当前稿在这个预览之后又变了，请重新预览差异。', restorePreview: undefined, restorePreviewState: '空闲', restorePreviewError: undefined })
      return
    }
    // 服务端还会再校验一次 revision 与 previewDigest：旧预览即使漏到这里也会被拒绝。
    restoring = true
    try {
      const saved = await mojingClient.versions.restore(project.id, id, { currentRevision: preview.currentRevision, previewDigest: preview.previewDigest })
      set({ project: saved, restorePreview: undefined, restorePreviewState: '空闲', restorePreviewError: undefined, notice: `已恢复到第 ${preview.targetRevision} 版；恢复前的当前稿已存入版本历史。` })
      await get().refreshAuxiliary()
    } catch (error) {
      // 恢复失败时内容不变；预览一律作废，必须重新预览才能再提交。
      set({ error: friendly(error), restorePreview: undefined, restorePreviewState: '空闲', restorePreviewError: undefined })
    } finally {
      restoring = false
    }
  },
  async removeVersion(id) {
    const project = get().project
    const version = get().versions.find((item) => item.id === id)
    if (!project || !version) return
    const reason = versionReasonForConfirmation(version.reason)
    if (!window.confirm(`确定永久删除“版本 ${version.revision} · ${reason}”吗？\n\n只会删除这条版本快照，当前小说内容不会受到影响。删除后无法恢复。`)) return
    try {
      await mojingClient.versions.remove(project.id, id)
      set({ versions: get().versions.filter((item) => item.id !== id), notice: '版本快照已删除；当前小说内容未受影响。' })
    } catch (error) { set({ error: friendly(error) }) }
  },
  async exportProject(format) { const project = await get().project; if (!project) return; const saved = await get().persistNow(); if (!saved) { set({ error: get().error ?? '当前改动没有保存成功，已取消导出，避免导出旧稿。请先解决保存问题。' }); return } try { await mojingClient.export(saved.id, format); set({ notice: '导出文件已生成。' }) } catch (error) { set({ error: friendly(error) }) } },
  async refreshAuxiliary() { const project = get().project; if (!project) return; try { const [revisions, memoryProposals, versions, generationJobs, memoryHealth, mentions] = await Promise.all([mojingClient.revisions.list(project.id), mojingClient.memory.list(project.id), mojingClient.versions.list(project.id), mojingClient.generations.list(project.id).catch(() => []), mojingClient.memory.health(project.id), mojingClient.mentions.list(project.id)]); set({ revisions, memoryProposals, versions, generationJobs, memoryHealth, mentions }) } catch (error) { set({ error: friendly(error) }) } },
  dismiss(target) { set(target === 'error' ? { error: undefined } : target === 'notice' ? { notice: undefined } : target === 'hallFeedback' ? { hallFeedback: undefined, notice: get().notice === get().hallFeedback ? undefined : get().notice } : target === 'hallImportError' ? { hallImportError: undefined, error: get().error === get().hallImportError ? undefined : get().error } : target === 'hallCreateError' ? { hallCreateError: undefined, error: get().error === get().hallCreateError ? undefined : get().error } : target === 'hallDeleteError' ? { hallDeleteError: undefined, error: get().error === get().hallDeleteError ? undefined : get().error } : target === 'hallActionError' ? { hallActionError: undefined, error: get().error === get().hallActionError?.message ? undefined : get().error } : { error: undefined, notice: undefined }) }
}))

function friendly(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function friendlyCreateError(error: unknown): string {
  const message = friendly(error)
  return /failed to fetch|networkerror|fetch failed/i.test(message) ? '无法连接本机服务，请检查服务状态后重试创建。' : message
}
function friendlyImportError(error: unknown): string {
  const message = friendly(error)
  return /failed to fetch|networkerror|fetch failed/i.test(message) ? '无法连接本机服务，请检查服务状态后重新导入。' : message
}
function friendlyHallDeleteError(error: unknown): string {
  const message = friendly(error)
  return /failed to fetch|networkerror|fetch failed/i.test(message) ? '无法连接本机服务，请检查服务状态后重试删除。' : message
}
function friendlyHallActionError(error: unknown, archived: boolean): string {
  const message = friendly(error)
  if (/failed to fetch|networkerror|fetch failed/i.test(message)) return `无法连接本机服务，请检查服务状态后重试${archived ? '归档' : '恢复'}。`
  return message
}

function versionReasonForConfirmation(reason: string): string { return reason.trim() || '未命名快照' }

function queueMemoryAnalysis(get: () => NovelState, chapterId: string, delay: number): void {
  if (analysisTimer) clearTimeout(analysisTimer)
  scheduledAnalysisChapterId = chapterId
  analysisTimer = setTimeout(() => {
    analysisTimer = undefined
    scheduledAnalysisChapterId = undefined
    void get().generate({ kind: 'memory-extraction', chapterId, qualityProfile: 'economy', acknowledgedDraftPlanning: true })
  }, delay)
}
