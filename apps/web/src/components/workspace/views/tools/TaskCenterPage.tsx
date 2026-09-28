import {
  Activity, ChevronRight, CirclePause, CirclePlay, Clock3, Compass, Gauge, Layers, LockKeyhole,
  Network, RefreshCw, Sparkles, X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  ChapterAnalysisTask, CreativeOrchestrationRun, CreativeOrchestrationRunStatus, CreativeOrchestrationStep,
  NovelMemoryHealth, NovelOrchestrationIntent, NovelProject
} from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'
import { useNovelStore } from '../../../../novelStore'
import { Btn, Card, Field, Status, Tag } from '../../../ui/Primitives'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'
import { getTaskCenterNextStep } from './taskCenterModel'

interface TodoMetric { label: string; count: number; detail: string; target: WorkspaceNavigationTarget }

const INTENT_OPTIONS: NovelOrchestrationIntent[] = ['章节创作', '长篇复核', '世界观审校', '大纲规划']
/** 尚未结束的任务会留在「正在处理」区；`草稿` 也是其中之一（已创建但还没点「开始任务」）。 */
const CURRENT_STATUSES: CreativeOrchestrationRunStatus[] = ['草稿', '等待执行', '运行中', '暂停', '待作者确认']

function runIsCurrent(status: CreativeOrchestrationRunStatus): boolean { return CURRENT_STATUSES.includes(status) }

function runStatusActions(status: CreativeOrchestrationRunStatus): string[] {
  if (status === '等待执行' || status === '运行中') return ['暂停', '取消']
  if (status === '暂停') return ['恢复', '取消']
  if (status === '待作者确认') return ['取消']
  return []
}

function runProgress(run: CreativeOrchestrationRun): number {
  if (run.steps.length === 0) return run.status === '完成' ? 100 : 0
  const done = run.steps.filter((step) => step.status === '完成' || step.status === '跳过').length
  return Math.round((done / run.steps.length) * 100)
}

function stepDependencySummary(step: CreativeOrchestrationStep, steps: CreativeOrchestrationStep[]): string {
  if (step.dependsOn.length === 0) return '无前置步骤'
  const titles = step.dependsOn.map((id) => steps.find((item) => item.id === id)?.title).filter((title): title is string => Boolean(title))
  return titles.length > 0 ? `依赖：${titles.join('、')}` : '无前置步骤'
}

/**
 * 项目待办与健康：**恰好 10 项**，每项都指向唯一处理入口。
 * 没有数据时计 0（显示「无需处理」），不虚构百分比或估算。
 */
function buildTodoMetrics(health: NovelMemoryHealth | undefined, project: NovelProject): TodoMetric[] {
  return [
    { label: '待确认记忆', count: health?.pendingProposals ?? 0, detail: '确认后才会进入正式上下文', target: { stageId: 'memory', subnavId: 'memory-proposals' } },
    { label: '需复核记忆', count: health?.staleMemories ?? 0, detail: '来源正文已经变化', target: { stageId: 'memory', subnavId: 'memory-ledger' } },
    { label: '缺少摘要', count: health?.missingSummaries ?? 0, detail: '会削弱远期章节召回', target: { stageId: 'memory', subnavId: 'memory-workbench' } },
    { label: '未索引正文', count: health?.unindexedChapters ?? 0, detail: '无法从词条跳转到出现位置', target: { stageId: 'writing', subnavId: 'prose-editor' } },
    { label: '未解决伏笔', count: health?.unresolvedThreads ?? 0, detail: `${health?.overdueThreads ?? 0} 条已经逾期`, target: { stageId: 'memory', subnavId: 'foreshadowing' } },
    { label: '待处理审稿', count: health?.unresolvedReviews ?? project.reviews.filter((item) => item.status === '待处理').length, detail: '连续性与表达问题待决定', target: { stageId: 'delivery', subnavId: 'review-issues' } },
    { label: '规划待复核', count: health?.staleOutlineCards ?? 0, detail: '上游规划改变后需要重新确认', target: { stageId: 'outline', subnavId: 'outline-foundation' } },
    { label: '场景质量问题', count: health?.pendingSceneQualityFindings ?? 0, detail: '高风险问题会阻止普通应用', target: { stageId: 'writing', subnavId: 'writing-handoff' } },
    { label: '世界观扩展候选', count: health?.pendingWorldExpansions ?? 0, detail: '新增设定等待影响分析确认', target: { stageId: 'world', subnavId: 'world-expansion' } },
    { label: '剧情线风险', count: health?.storylineRisks ?? project.plotThreads.filter((thread) => thread.status === '逾期').length, detail: '暂停、缺少返回位置或可能断线', target: { stageId: 'outline', subnavId: 'storylines' } }
  ]
}

const STATUS_TONE: Record<ChapterAnalysisTask['status'], 'ok' | 'amber' | 'danger'> = {
  完成: 'ok', 运行中: 'amber', 等待: 'amber', 失败: 'danger', 过期: 'danger', 取消: 'amber'
}

/** 结果归属的唯一跳转表：与 `analysisRouting` 的分类一致，只是放在界面侧。 */
const ROUTING: Array<{ label: string; target: WorkspaceNavigationTarget }> = [
  { label: '章节摘要与状态候选', target: { stageId: 'memory', subnavId: 'memory-proposals' } },
  { label: '设定候选', target: { stageId: 'world', subnavId: 'world-expansion' } },
  { label: '伏笔候选', target: { stageId: 'memory', subnavId: 'foreshadowing' } },
  { label: '质量发现', target: { stageId: 'delivery', subnavId: 'review-issues' } }
]

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。'
}

/**
 * 任务中心（D7）。
 *
 * 只做三件事：**看状态、取消/重试、跳到结果归属页**。
 * 它不复制候选编辑、不复制采用，也不复制版本恢复——那些仍然只在各自的唯一入口里。
 * 不虚构百分比：只显示真实状态与真实时间。
 *
 * 「自动流程」入口也渲染本页：连续任务启动（创建 → 开始 → 步骤执行/重试）与任务历史都留在这里。
 * 项目工具不在任务中心加载创作助手配置面板；这里只保留连续任务的启动与状态。
 * 任务不会自动覆盖正文——所有结果都以候选或提案返回，必须由作者确认。
 */
export function TaskCenterPage({
  project,
  onNavigate
}: {
  project: NovelProject
  onNavigate: (target: WorkspaceNavigationTarget) => void
}): React.JSX.Element {
  const jobs = useNovelStore((state) => state.generationJobs)
  const memoryHealth = useNovelStore((state) => state.memoryHealth)
  const refreshAuxiliary = useNovelStore((state) => state.refreshAuxiliary)
  const [analyses, setAnalyses] = useState<ChapterAnalysisTask[]>([])
  const [analysesError, setAnalysesError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()

  const [runs, setRuns] = useState<CreativeOrchestrationRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState('')
  const [intent, setIntent] = useState<NovelOrchestrationIntent>('章节创作')
  const [chapterId, setChapterId] = useState(project.chapters[0]?.id ?? '')
  const [volumeNumber, setVolumeNumber] = useState(project.outline?.volumes[0]?.volumeNumber ?? 1)
  const [runBusy, setRunBusy] = useState(false)
  const [runNotice, setRunNotice] = useState('')
  /** 最近一次「列入待审问题」的结果，按分析任务 id 记录。 */
  const [reviewNotice, setReviewNotice] = useState<{ analysisId: string; added: string[] }>()
  const [reviewBusy, setReviewBusy] = useState(false)

  const load = async (): Promise<void> => {
    const items = await mojingClient.chapterAnalyses.list(project.id)
    setAnalyses(items)
    setAnalysesError(undefined)
  }

  const loadRuns = async (): Promise<void> => {
    try {
      const result = await mojingClient.orchestrationRuns.list(project.id)
      setRuns(result ?? [])
      setSelectedRunId((current) => current && (result ?? []).some((item) => item.id === current) ? current : result?.[0]?.id ?? '')
    } catch (error) { setRunNotice(message(error)) }
  }

  useEffect(() => { void load().catch((error) => setAnalysesError(message(error))) }, [project.id])
  useEffect(() => { void refreshAuxiliary() }, [refreshAuxiliary, project.id])
  useEffect(() => { void loadRuns() }, [project.id])
  // 项目切换后，保证选中的章节/卷号仍然有效，避免拿着旧 id 去创建任务。
  useEffect(() => {
    setChapterId((current) => current && project.chapters.some((chapter) => chapter.id === current) ? current : project.chapters[0]?.id ?? '')
    setVolumeNumber((current) => current && project.outline?.volumes.some((volume) => volume.volumeNumber === current) ? current : project.outline?.volumes[0]?.volumeNumber ?? 1)
  }, [project.id, project.chapters, project.outline])

  async function act(action: () => Promise<unknown>): Promise<void> {
    setBusy(true); setFailure(undefined)
    try { await action(); await load() } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  /**
   * 把一次章后分析的质量发现列入待审问题：**只在作者显式点击后**才写入，
   * 走真实接口（服务端做版本校验并写入 project.reviews），不自动改稿。
   */
  async function listReviewItems(task: ChapterAnalysisTask): Promise<void> {
    setReviewBusy(true); setFailure(undefined)
    try {
      const result = await mojingClient.chapterAnalyses.reviewItems(project.id, task.id)
      useNovelStore.getState().replaceProject(result.project)
      setReviewNotice({ analysisId: task.id, added: result.added })
    } catch (error) { setFailure(message(error)) } finally { setReviewBusy(false) }
  }

  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? runs[0]
  const currentRuns = runs.filter((run) => runIsCurrent(run.status))
  const historyRuns = runs.filter((run) => !runIsCurrent(run.status))

  // 运行中的任务轮询刷新；草稿与已完成态不需要轮询。
  useEffect(() => {
    if (!selectedRun || !['等待执行', '运行中', '待作者确认'].includes(selectedRun.status)) return
    const timer = window.setInterval(() => {
      void mojingClient.orchestrationRuns.get(selectedRun.id)
        .then((updated) => setRuns((items) => items.map((item) => item.id === updated.id ? updated : item)))
        .catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [selectedRunId, selectedRun?.status])

  async function createRun(): Promise<void> {
    setRunBusy(true)
    try {
      const run = await mojingClient.orchestrationRuns.create(project.id, {
        intent,
        chapterId: intent === '章节创作' ? chapterId || undefined : undefined,
        volumeNumber: intent === '大纲规划' ? volumeNumber : undefined,
        maxParallel: 2
      })
      setRuns((items) => [run, ...items.filter((item) => item.id !== run.id)])
      setSelectedRunId(run.id)
      setRunNotice('任务已创建，尚未开始调用 AI。你可以检查后再开始。')
    } catch (error) { setRunNotice(message(error)) } finally { setRunBusy(false) }
  }

  async function runAction(action: 'start' | 'pause' | 'resume' | 'cancel', run: CreativeOrchestrationRun): Promise<void> {
    setRunBusy(true)
    try {
      const updated = await mojingClient.orchestrationRuns[action](run.id)
      setRuns((items) => items.map((item) => item.id === updated.id ? updated : item))
      setRunNotice(action === 'cancel' ? '任务已取消，原正文未发生变化。' : action === 'start' ? '任务已开始，正在等待执行。' : '任务状态已更新。')
    } catch (error) { setRunNotice(message(error)) } finally { setRunBusy(false) }
  }

  async function stepAction(kind: 'executeStep' | 'retryStep', run: CreativeOrchestrationRun, step: CreativeOrchestrationStep): Promise<void> {
    setRunBusy(true)
    try {
      const updated = await mojingClient.orchestrationRuns[kind](run.id, step.id)
      setRuns((items) => items.map((item) => item.id === updated.id ? updated : item))
      setRunNotice(kind === 'retryStep' ? '失败步骤已经可以重新执行。' : '步骤已提交，结果会以候选或提案形式返回。')
    } catch (error) { setRunNotice(message(error)) } finally { setRunBusy(false) }
  }

  function renderRunCard(run: CreativeOrchestrationRun): React.JSX.Element {
    const active = selectedRun?.id === run.id
    const actions = runStatusActions(run.status)
    // P3 第一阶段：`runProgress` 是「已完成 + 跳过步骤 / 总步骤」的真实计数，
    // 这里只把它暴露到无障碍树，不新增任何补间或伪造百分比。
    const percent = runProgress(run)
    return (
      <article key={run.id} className={`run-card${active ? ' active' : ''}`}>
        <button type="button" className="run-summary" onClick={() => setSelectedRunId(run.id)}>
          {/* P3 第一阶段：属性名统一为 `data-state`（取值仍是真实的 run.status，不改状态来源与文案）。 */}
          <span className="run-status-dot" data-state={run.status} />
          <span className="run-title">
            <strong>{run.request.intent}</strong>
            <small className="mjp-muted">{new Date(run.createdAt).toLocaleString('zh-CN')} · {run.steps.length} 个步骤</small>
          </span>
          <span className="run-status-text" data-testid="run-status">{run.status}</span>
          <ChevronRight size={15} />
        </button>
        {active && (
          <div className="run-details">
            <div className="run-progress-line">
              <span>完成度 {percent}%</span>
              <i
                className="run-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`完成度 ${percent}%`}
              >
                <b style={{ width: `${percent}%` }} />
              </i>
              <div className="run-actions">
                {actions.includes('暂停') && <Btn size="sm" icon={CirclePause} disabled={runBusy} onClick={() => void runAction('pause', run)}>暂停</Btn>}
                {actions.includes('恢复') && <Btn size="sm" icon={CirclePlay} disabled={runBusy} onClick={() => void runAction('resume', run)}>恢复</Btn>}
                {actions.includes('取消') && <Btn size="sm" icon={X} disabled={runBusy} onClick={() => void runAction('cancel', run)}>取消</Btn>}
                {run.status === '草稿' && <Btn size="sm" variant="primary" icon={CirclePlay} disabled={runBusy} onClick={() => void runAction('start', run)}>开始任务</Btn>}
              </div>
            </div>
            <details className="run-execution-details">
              <summary>
                <span className="mjp-row" style={{ gap: 6 }}><strong>执行详情</strong><span className="mjp-muted">查看步骤顺序与预计用量</span></span>
                <ChevronRight size={15} />
              </summary>
              <div className="step-list">
                {run.steps.map((step, index) => (
                  <div className="run-step" key={step.id}>
                    <span className="step-number">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <small className="mjp-muted"> · {stepDependencySummary(step, run.steps)}</small>
                      <p className="mjp-muted">{step.reason}</p>
                      {step.evidence.length > 0 && (
                        <details>
                          <summary>查看资料依据与召回原因</summary>
                          <ul>{step.evidence.map((evidence, evidenceIndex) => <li key={`${step.id}-${evidenceIndex}`}>{evidence}</li>)}</ul>
                        </details>
                      )}
                    </div>
                    <aside>
                      <em>{step.status}</em>
                      <small className="mjp-muted">预计用量约 {step.estimatedTokens.toLocaleString()} Token</small>
                      {step.status === '可执行' && <Btn size="sm" disabled={runBusy} onClick={() => void stepAction('executeStep', run, step)}>执行这一步</Btn>}
                      {step.status === '失败' && <Btn size="sm" disabled={runBusy} onClick={() => void stepAction('retryStep', run, step)}>重试这一步</Btn>}
                    </aside>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </article>
    )
  }

  const running = analyses.filter((item) => item.status === '等待' || item.status === '运行中')
  const metrics = buildTodoMetrics(memoryHealth, project)
  const suggestion = getTaskCenterNextStep(project)
  const issueTotal = metrics.reduce((sum, metric) => sum + metric.count, 0)
  const priorityMetrics = metrics.filter((metric) => metric.count > 0).sort((a, b) => b.count - a.count).slice(0, 3)
  const hiddenMetricCount = metrics.length - priorityMetrics.length
  const pendingSettingProposals = (project.worldExpansionProposals ?? []).filter((item) => item.status === '待确认').length

  const renderMetricRows = (items: readonly TodoMetric[]): React.JSX.Element[] => items.map((metric) => (
    <li key={metric.label}>
      <button
        type="button"
        className={metric.count > 0 ? 'has-issue' : 'is-clear'}
        aria-label={`${metric.label}：${metric.count > 0 ? `${metric.count} 项待处理` : '无需处理'}，前往对应页面`}
        onClick={() => onNavigate(metric.target)}
      >
        <span className="phl-main"><strong>{metric.label}</strong><small className="mjp-muted">{metric.detail}</small></span>
        <em>{metric.count > 0 ? `${metric.count} 项` : '无需处理'}</em>
        <span className="health-open-label">前往处理</span>
        <ChevronRight size={14} />
      </button>
    </li>
  ))

  return (
    <>
      {failure && <div className="mjp-banner warn" role="alert"><div>{failure}</div></div>}

      <section className="mjp-card workbench-todo-overview">
        <header className="mjp-card-hd">
          <div className="ti">
            <Sparkles size={18} strokeWidth={1.7} className="ico" />
            <h2>现在该做什么</h2>
            <div className="desc">先完成一个最重要的动作。AI 只会产生候选或提案，未确认前不会覆盖正式内容。</div>
          </div>
        </header>
        <div className="mjp-card-bd">
          <div className="workbench-next-action">
            <div>
              <small className="mjp-muted">建议下一步</small>
              <strong>{suggestion.label}</strong>
              <p className="mjp-muted">{suggestion.detail}</p>
            </div>
            <Btn size="sm" variant="primary" onClick={() => onNavigate(suggestion.target)}>打开对应页面</Btn>
          </div>
        </div>
      </section>

      <section className="mjp-card task-center-current" aria-labelledby="task-center-current-title">
        <header className="mjp-card-hd">
          <div className="ti">
            <Clock3 size={18} strokeWidth={1.7} className="ico" />
            <h2 id="task-center-current-title">进行中</h2>
            <div className="desc">只显示尚未完成、暂停或等待你确认的任务。</div>
          </div>
          <div className="right"><Status tone={currentRuns.length > 0 ? 'warn' : 'ok'}>{currentRuns.length > 0 ? `${currentRuns.length} 项` : '暂无任务'}</Status></div>
        </header>
        <div className="mjp-card-bd">
          {currentRuns.length === 0 ? <p className="mjp-muted">目前没有进行中的任务。</p> : <div className="run-list">{currentRuns.map(renderRunCard)}</div>}
        </div>
      </section>

      <section className="mjp-card project-health-panel">
        <header className="mjp-card-hd">
          <div className="ti">
            <Gauge size={18} strokeWidth={1.7} className="ico" />
            <h3>需要你处理</h3>
            <div className="desc">按待处理数量显示最优先的问题，其余项目在“更多任务”中查看。</div>
          </div>
          <div className="right"><Status tone={issueTotal > 0 ? 'warn' : 'ok'}>{issueTotal > 0 ? `${issueTotal} 项待处理` : '状态良好'}</Status></div>
        </header>
        <div className="mjp-card-bd">
          {priorityMetrics.length > 0 ? <ul className="project-health-list">{renderMetricRows(priorityMetrics)}</ul> : <p className="mjp-muted">目前没有需要优先处理的问题。</p>}
          {hiddenMetricCount > 0 ? <p className="task-center-more-hint">还有 {hiddenMetricCount} 项状态可在“更多任务”中查看。</p> : null}
        </div>
      </section>

      <details className="task-center-more">
        <summary>
          <span><strong>更多任务</strong><small>自动流程、完整健康清单、章后分析与历史记录</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </summary>
        <div className="task-center-more-body">
          <div className="task-center-more-links" aria-label="相关入口">
            <Btn size="sm" icon={Network} onClick={() => document.getElementById('creative-seats-region')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>自动流程</Btn>
          </div>

          <section className="mjp-card project-health-panel task-center-full-health">
            <header className="mjp-card-hd">
              <div className="ti">
                <Gauge size={18} strokeWidth={1.7} className="ico" />
                <h3>完整健康清单</h3>
                <div className="desc">逐项查看原因并前往对应页面。</div>
              </div>
            </header>
            <div className="mjp-card-bd"><ul className="project-health-list">{renderMetricRows(metrics)}</ul></div>
          </section>

      {/*
        跨栏目提示（只读）：只报告世界观里待确认设定提案的数量并给一个跳转，
        不在任务中心复制「采用 / 忽略」这套编辑，避免出现第二条写入通道。
      */}
      <div className="mjp-banner info" data-testid="setting-proposals-notice" role="status">
        <div>
          {pendingSettingProposals > 0
            ? <>世界观还有 <strong>{pendingSettingProposals}</strong> 条待确认的设定提案；采用或忽略请到「世界观 · 扩展世界观」处理。</>
            : '暂无待确认的设定提案。'}
        </div>
        <div className="right">
          <Btn size="sm" disabled={pendingSettingProposals === 0} onClick={() => onNavigate({ stageId: 'world', subnavId: 'world-expansion' })}>前往世界观</Btn>
        </div>
      </div>

      <div className="mjp-col creative-seats-page" id="creative-seats-region" style={{ gap: 14 }}>
        <header className="creative-seats-head">
          <div>
            <h2>一次安排多个连续步骤</h2>
            <p className="mjp-muted">创作对话适合边聊边解决一个问题；这里适合连续处理需要规划、生成和检查的复杂任务。</p>
          </div>
          <span className="creative-safety-badge"><LockKeyhole size={16} />不会自动覆盖正文</span>
        </header>

        {runNotice && <div className="mjp-banner info" role="status"><div>{runNotice}</div></div>}

        <section className="mjp-card orchestration-launch">
          <header className="mjp-card-hd">
            <div className="ti"><Network size={18} strokeWidth={1.7} className="ico" /><h3>创建任务</h3>
              <div className="desc">先选择任务和处理范围。创建任务不会立即调用 AI。</div>
            </div>
            <div className="right"><Tag tone="outline"><LockKeyhole size={12} /> 结果需确认</Tag></div>
          </header>
          <div className="mjp-card-bd">
            <div className="launch-controls">
              <Field label="任务类型">
                <select className="mjp-select" aria-label="任务类型" value={intent} onChange={(event) => setIntent(event.target.value as NovelOrchestrationIntent)}>
                  {INTENT_OPTIONS.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              {intent === '章节创作' && (
                <Field label="处理范围">
                  <select className="mjp-select" aria-label="处理范围" value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                    {project.chapters.length > 0
                      ? project.chapters.map((chapter) => <option value={chapter.id} key={chapter.id}>第 {chapter.chapterNumber} 章 · {chapter.title}</option>)
                      : <option value="">尚无章节</option>}
                  </select>
                </Field>
              )}
              {intent === '大纲规划' && (
                <Field label="处理范围">
                  <select className="mjp-select" aria-label="处理范围" value={volumeNumber} onChange={(event) => setVolumeNumber(Number(event.target.value))}>
                    {project.outline && project.outline.volumes.length > 0
                      ? project.outline.volumes.map((volume) => <option value={volume.volumeNumber} key={volume.id}>第 {volume.volumeNumber} 卷 · {volume.title}</option>)
                      : <option value={1}>第 1 卷</option>}
                  </select>
                </Field>
              )}
              <Btn variant="primary" icon={Sparkles} disabled={runBusy || (intent === '章节创作' && !chapterId)} onClick={() => void createRun()}>创建任务</Btn>
            </div>
          </div>
        </section>

        <section className="mjp-card run-history">
          <header className="mjp-card-hd">
            <div className="ti"><Clock3 size={18} strokeWidth={1.7} className="ico" /><h3>正在处理</h3>
              <div className="desc">历史记录收在这里，避免和当前任务混在一起。</div>
            </div>
          </header>
          <div className="mjp-card-bd">
            {historyRuns.length === 0 ? <p className="mjp-muted">还没有历史任务。</p> : <div className="run-list">{historyRuns.map(renderRunCard)}</div>}
          </div>
        </section>
      </div>

      <Card
        title="章后分析"
        icon={Activity}
        desc="分析失败不会影响已保存的章节；章节内容修改后，旧分析结果会标为过期。"
        headRight={<Btn size="sm" icon={RefreshCw} disabled={busy} onClick={() => void load().catch((error) => setAnalysesError(message(error)))}>刷新</Btn>}
        tight
      >
        {analysesError ? (
          <Status tone="danger">分析任务读取失败：{analysesError}</Status>
        ) : analyses.length === 0 ? (
          <Status tone="ok">还没有分析任务</Status>
        ) : analyses.map((task) => {
          const chapter = project.chapters.find((item) => item.id === task.chapterId)
          const findings = task.result?.reviewFindings ?? []
          const listed = reviewNotice?.analysisId === task.id ? reviewNotice.added : undefined
          return (
            <div key={task.id} className="analysis-task-block" style={{ marginBottom: 6 }}>
              <div className="mjp-health-row" data-testid="analysis-task">
                <span className="nm">
                  <b>{chapter ? `第${chapter.chapterNumber}章《${chapter.title}》` : task.chapterId}</b>
                  <span className="mjp-muted"> · {task.trigger} · {new Date(task.createdAt).toLocaleString('zh-CN')}</span>
                  {task.error ? <span className="mjp-muted"> · {task.error}</span> : null}
                </span>
                <span className="mjp-row" style={{ gap: 6 }}>
                  <span data-testid="analysis-status"><Tag tone={STATUS_TONE[task.status]} dot>{task.status}</Tag></span>
                  {task.status === '等待' || task.status === '运行中' ? (
                    <Btn size="sm" disabled={busy} onClick={() => void act(() => mojingClient.chapterAnalyses.cancel(project.id, task.id))}>
                      取消
                    </Btn>
                  ) : (
                    <Btn size="sm" disabled={busy} onClick={() => void act(() => mojingClient.chapterAnalyses.retry(project.id, task.id))}>
                      重新分析
                    </Btn>
                  )}
                </span>
              </div>
              {task.status === '完成' && (
                <div className="analysis-result-area" data-testid="analysis-result">
                  {findings.length === 0 ? (
                    <p className="mjp-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>这次分析没有产生质量发现，无需列入待审问题。</p>
                  ) : (
                    <>
                      <details>
                        <summary>质量发现（{findings.length}）</summary>
                        <ul className="mjp-kn">
                          {findings.map((finding, index) => (
                            <li key={`${task.id}-rf-${index}`}>
                              <span className="t">{finding.title}</span>
                              <span className="mjp-muted">{finding.detail}</span>
                              <Tag tone={finding.severity === '高' ? 'danger' : finding.severity === '中' ? 'amber' : 'outline'}>{finding.severity}</Tag>
                            </li>
                          ))}
                        </ul>
                      </details>
                      <div className="mjp-row" style={{ gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Btn size="sm" variant="primary" disabled={reviewBusy} data-testid="analysis-to-review" onClick={() => void listReviewItems(task)}>
                          列入待审问题
                        </Btn>
                        {listed && (
                          <span className="mjp-row" style={{ gap: 8 }}>
                            <span className="mjp-muted" style={{ fontSize: 12 }}>
                              {listed.length > 0 ? `已列入 ${listed.length} 条待审问题。` : '这些质量发现此前已经列入待审问题。'}
                            </span>
                            <Btn size="sm" onClick={() => onNavigate({ stageId: 'delivery', subnavId: 'review-issues' })}>前往审稿问题</Btn>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {running.length > 0 && (
          <p className="mjp-muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            有 {running.length} 个任务正在进行；关闭软件后它们会被标记为已中断，不会假装还在运行。
          </p>
        )}
      </Card>

      <Card title="分析结果归属" icon={Compass} tight>
        {ROUTING.map((item) => (
          <div key={item.label} className="mjp-health-row">
            <span className="nm">{item.label}</span>
            <Btn size="sm" onClick={() => onNavigate(item.target)}>前往处理</Btn>
          </div>
        ))}
      </Card>

      <Card title="自动流程任务" icon={Layers} tight>
        {jobs.length === 0 ? (
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13 }}>还没有 AI 任务记录。</p>
        ) : jobs.slice(0, 20).map((job) => (
          <div key={job.id} className="mjp-health-row">
            <span className="nm">
              <b>{job.kind}</b>
              <span className="mjp-muted"> · {new Date(job.createdAt).toLocaleString('zh-CN')}{job.message ? ` · ${job.message}` : ''}</span>
            </span>
            <Tag tone={job.status === '完成' ? 'ok' : job.status === '失败' ? 'danger' : 'amber'} dot>{job.status}</Tag>
          </div>
        ))}
      </Card>

      <Card title="版本恢复" icon={Layers} tight>
        <div className="mjp-row" style={{ justifyContent: 'flex-end' }}>
          <Btn size="sm" onClick={() => onNavigate({ stageId: 'delivery', subnavId: 'version-history' })}>前往版本历史</Btn>
        </div>
      </Card>
        </div>
      </details>
    </>
  )
}
