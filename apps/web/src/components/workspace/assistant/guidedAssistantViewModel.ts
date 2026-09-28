/**
 * 引导态视图模型与结果落点映射（纯函数）。
 *
 * 只把 `useAssistantGuide` 的真实状态翻译成界面要显示的阶段，
 * 不做任何请求，也不伪造进度：题数只取已确认回答的真实条数。
 * 结果只给「去哪个既有页面看」的落点，**不代表已经采用，也不等于允许导出**。
 */
import type {
  AssistantGuideResultRef,
  AssistantGuideSession,
  AssistantGuideStatus
} from '../../../../../../packages/contracts/src'
import type { WorkspaceNavigationTarget } from '../workspaceNavigation'

export type GuidedPhase =
  | 'checking'
  | 'waiting'
  | 'analyzing'
  | 'generating'
  | 'needs-review'
  | 'question'
  | 'ready'
  | 'result'
  | 'ended'
  | 'error'

/** 面板头部使用的作者可读阶段名；避免让不同状态只靠颜色或布局差异来区分。 */
export function guidedPhaseLabel(phase: GuidedPhase): string {
  switch (phase) {
    case 'checking': return '读取中'
    case 'waiting': return '尚未开始'
    case 'analyzing': return '分析中'
    case 'generating': return '结果整理中'
    case 'needs-review': return '需要复核'
    case 'question': return '问题中'
    case 'ready': return '可生成'
    case 'result': return '候选待确认'
    case 'ended': return '已结束'
    case 'error': return '失败，可重试'
  }
}

export type GuidedQuestionView = {
  id: string
  text: string
  whyNow: string
  options: Array<{ id: string; label: string; reason: string }>
}

export type GuidedAnalysisView = {
  summary: string
  strengths: Array<{ title: string; evidenceRefs: string[] }>
  gaps: Array<{ key: string; title: string; impact: string; evidenceRefs: string[] }>
}

export type GuidedAssistantViewModel = {
  phase: GuidedPhase
  /** 是否有请求在途：用于禁用重复提交，但不清空作者输入。 */
  busy: boolean
  /** 已经确认的回答条数（真实计数）。 */
  completedCount: number
  focus: string
  analysis?: GuidedAnalysisView
  question?: GuidedQuestionView
  customAnswer: string
  error?: { code: string; message: string; retryable: boolean }
  retry: { available: boolean; label: string }
  resultRef?: AssistantGuideResultRef
  hasSession: boolean
  currentLookupSettled: boolean
}

/** 视图模型只依赖这些状态字段；调用方直接传 `useAssistantGuide` 的返回值即可。 */
export type GuidedAssistantSource = {
  session: AssistantGuideSession | null
  pendingAction: string | null
  error: { code: string; message: string; retryable: boolean } | null
  customAnswer: string
  currentLookupSettled: boolean
}

/**
 * 可以重试的会话状态。
 *
 * 与 Task 6 的引导状态机保持一致：只有这些状态下重试才有意义
 * （`分析中` / `生成中` 表示上次请求没走完；`失败` / `需要复核` 表示作者需要再推进一次）。
 */
const RETRYABLE_GUIDE_STATUSES: readonly AssistantGuideStatus[] = ['分析中', '生成中', '失败', '需要复核']

/** 重试入口是否可用，以及按钮该写什么。没有会话或已有请求在途时不可用。 */
export function guideRetryState(
  session: AssistantGuideSession | null,
  pendingAction: string | null
): { available: boolean; label: string } {
  if (!session || pendingAction !== null) return { available: false, label: '' }
  if (!RETRYABLE_GUIDE_STATUSES.includes(session.status)) return { available: false, label: '' }
  return { available: true, label: session.status === '生成中' ? '重试生成' : '重试分析' }
}

export function buildGuidedAssistantViewModel(source: GuidedAssistantSource): GuidedAssistantViewModel {
  const session = source.session
  const turn = session?.turn ?? null
  const retry = guideRetryState(session, source.pendingAction)
  const base = {
    busy: source.pendingAction !== null,
    completedCount: session?.confirmedAnswers.length ?? 0,
    focus: turn?.focus ?? '',
    analysis: turn
      ? { summary: turn.analysisSummary, strengths: turn.strengths, gaps: turn.gaps }
      : undefined,
    question: turn?.question
      ? {
          id: turn.question.id,
          text: turn.question.text,
          whyNow: turn.question.whyNow,
          options: turn.question.options
        }
      : undefined,
    customAnswer: source.customAnswer,
    retry,
    resultRef: session?.resultRef ?? undefined,
    hasSession: session !== null,
    currentLookupSettled: source.currentLookupSettled
  }

  let phase: GuidedPhase
  if (!session) {
    if (source.pendingAction !== null) phase = 'analyzing'
    else phase = source.currentLookupSettled ? 'waiting' : 'checking'
  } else if (session.resultRef) {
    phase = 'result'
  } else if (session.status === '分析中') {
    phase = 'analyzing'
  } else if (session.status === '生成中') {
    phase = 'generating'
  } else if (session.status === '需要复核') {
    phase = 'needs-review'
  } else if (session.status === '失败') {
    phase = 'error'
  } else if (session.status === '已结束') {
    phase = 'ended'
  } else if (session.status === '可生成' || turn?.readyToComplete) {
    phase = 'ready'
  } else if (turn?.question) {
    phase = 'question'
  } else if (session.confirmedAnswers.length > 0) {
    // 有已确认的回答，却问不出下一题（例如旧会话迁入）：如实要求重新分析，而不是永久等待。
    phase = 'needs-review'
  } else {
    phase = 'waiting'
  }

  const error = source.error
    ? source.error
    : session?.status === '失败' && session.error
      ? { code: 'GUIDE_FAILED', message: session.error, retryable: retry.available }
      : undefined

  return error ? { ...base, phase, error } : { ...base, phase }
}

/** 结果落点的两种形态：跳到既有页面，或回到自由创作里的候选面板。 */
export type GuideResultSurface =
  | { kind: 'navigate'; label: string; detail: string; target: WorkspaceNavigationTarget }
  | { kind: 'free'; label: string; detail: string }

/**
 * 结果 → 既有界面的唯一落点。
 *
 * 这里**只**给跳转，不提供第二套采用：正式内容是候选、提案或任务，
 * 必须在各自的唯一入口里由作者确认后才会生效。
 */
export function guideResultSurface(resultRef: AssistantGuideResultRef): GuideResultSurface {
  switch (resultRef.kind) {
    case 'assistant-draft':
      return {
        kind: 'free',
        label: '去候选草稿',
        detail: '这份初稿仍然是候选，只有在自由创作的候选面板里看过差异、确认采用后，才会写入正式内容。'
      }
    case 'world-setting-proposal':
      return {
        kind: 'navigate',
        label: '去扩展世界观',
        detail: '这是一条设定提案，确认之后才会进入正式世界观。',
        target: { stageId: 'world', subnavId: 'world-expansion' }
      }
    case 'revision-proposal':
      return {
        kind: 'navigate',
        label: '去 AI 修改候选',
        detail: '这是一条修改候选，确认之后才会应用到正文。',
        target: { stageId: 'delivery', subnavId: 'revision-candidates' }
      }
    case 'chapter-analysis':
      return {
        kind: 'navigate',
        label: '去记忆变更提案',
        detail: '本章分析任务已经排队；分析结果会进入记忆变更提案与伏笔中心，需要你逐条确认。',
        target: { stageId: 'memory', subnavId: 'memory-proposals' }
      }
    case 'generation-job':
      return {
        kind: 'navigate',
        label: '去正文编辑',
        detail: '生成任务已登记；结果会作为正文候选等待确认，不会自动覆盖正文。',
        target: { stageId: 'writing', subnavId: 'prose-editor' }
      }
    case 'export-precheck':
      return {
        kind: 'navigate',
        label: '去导出成稿',
        detail: '这是一次只读的导出预检，不代表已经允许导出。',
        target: { stageId: 'delivery', subnavId: 'export-manuscript' }
      }
  }
}

/** 结果引用的人类可读名称：只陈述结果本身，不暗示已经采用。 */
export function guideResultReferenceLabel(resultRef: AssistantGuideResultRef): string {
  const short = (id: string): string => id.slice(0, 8)
  switch (resultRef.kind) {
    case 'assistant-draft':
      return `候选草稿（${short(resultRef.draftId)}）`
    case 'world-setting-proposal':
      return `设定提案（${short(resultRef.proposalId)}）`
    case 'revision-proposal':
      return `修改候选（${short(resultRef.proposalId)}）`
    case 'generation-job':
      return `生成任务（${short(resultRef.jobId)}）`
    case 'chapter-analysis':
      return `本章分析任务（${short(resultRef.taskId)}）`
    case 'export-precheck':
      return `只读导出预检（版本 ${resultRef.projectRevision} · ${resultRef.format}）`
  }
}
