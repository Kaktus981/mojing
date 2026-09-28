import { useEffect, useMemo, useRef, useState } from 'react'
import { Focus, Save } from 'lucide-react'
import type { AssistantTarget, AssistantTaskType } from '../../../../../packages/contracts/src'
import { mojingClient } from '../../api/mojingClient'
import { useNovelStore } from '../../novelStore'
import { AppShell } from '../shell/AppShell'
import {
  getWorkspaceDisplayDefault,
  PROJECT_TOOL_ENTRY_REGION_IDS,
  resolveProjectToolId,
  type WorkspaceNavigationTarget,
  type WorkspaceProjectToolId,
  type WorkspaceSubnavId
} from './workspaceNavigation'
import { buildWorkspaceHeader, saveStateTone } from './workspaceHeader'
import { ChapterTreePanel } from './ChapterTreePanel'
import { hasUsableModel, WorkspaceDock } from './WorkspaceDock'
import { readWritingDirectoryOpen, rememberWritingDirectoryOpen, WorkspaceNav } from './WorkspaceNav'
import { resolveWorkspaceSecondaryNav } from './workspaceSecondaryNav'
import { resolveWorkspaceInkBackground } from './workspaceInkBackground'
import { getWorkspaceAssistantProfile } from './workspaceAssistantProfiles'
import { searchProject, type ProjectSearchHit } from './projectSearch'
import { MemoryView } from './views/MemoryView'
import { OutlineIntegratedView } from './views/outline-integrated/OutlineIntegratedView'
import type { OutlineRefineScope } from './views/outline-integrated/OutlineVolumesModule'
import { resolveIntegratedOutlineTarget } from './views/outline-integrated/outlineIntegrationModel'
import {
  applyCreateBodyForOutline,
  nextChapterNumber,
  resolveLegacySectionRedirect
} from './views/outline-integrated/outlineIntegrationModel'
import { ReviewView } from './views/ReviewView'
import { ToolView } from './views/ToolView'
import { WorldView } from './views/WorldView'
import { WritingView } from './views/WritingView'
import { ProjectWorkbenchPage } from './views/project-workbench/ProjectWorkbenchPage'
import { MojingMark } from '../shell/MojingMark'
import type { MojingTheme } from '../shell/useTheme'

type WorkspacePageProps = {
  /** 真实保存状态（来自 novelStore 的 saveState），在中央工作区状态位如实展示。 */
  saveState?: string
  /** 正在运行的 AI 任务进度；没有任务时不渲染胶囊。 */
  job?: { label: string; percent: number }
  theme: MojingTheme
  onToggleTheme: () => void
  embedded?: boolean
  onNavigationStateChange?: (target: WorkspaceNavigationTarget, activeTool?: WorkspaceProjectToolId) => void
  onRegisterRailHandlers?: (handlers?: { navigate: (target: WorkspaceNavigationTarget) => void; openTool: (toolId: WorkspaceProjectToolId) => void }) => void
  onLocalSaveFeedbackChange?: (visible: boolean) => void
}

/** 项目工具里哪些在 store 里有真实 stage，可以驱动导航选中态。 */
const TOOL_STAGES: readonly WorkspaceProjectToolId[] = ['ai-workbench', 'creative-seats', 'history']

/**
 * 去重改派的旧入口一律先归一到它真正的栏目。
 *
 * 例如 `idea/terms-boundaries` 现在属于世界观「规则与边界」：必须在**进入渲染之前**
 * 归一，导航高亮、面包屑、标题、右侧助手与中央视图才会同时落到世界观，
 * 而不是各走各的。
 */
function normalizeWorkspaceTarget(target: WorkspaceNavigationTarget): WorkspaceNavigationTarget {
  return resolveLegacySectionRedirect(target.stageId, target.subnavId) ?? target
}

/**
 * 正式工作区固定三段栅格：
 *   68px 项目一级图标栏（WorkspaceRail）
 *   + 自适应中央工作区（52px 上下文标题栏 + 视图）
 *   + 360px 不可折叠 AI 助手（WorkspaceDock，常驻，无开合按钮）
 *
 * 视图按「一级栏目」分派，每个栏目渲染各不相同的真实内容：
 *   小说大纲 → 灵感与规格（idea）/ 卷章结构（outline）
 *   世界观 / 正文创作 / 记忆与伏笔 / 审稿与导出 → 各自的数据面板
 * 项目工具里有后端的走真实面板，没有后端的如实说明未实现。
 */
export function WorkspacePage({ saveState, job, theme, onToggleTheme, embedded = false, onNavigationStateChange, onRegisterRailHandlers, onLocalSaveFeedbackChange }: WorkspacePageProps): React.JSX.Element {
  const project = useNovelStore((state) => state.project)
  /** 助手作用域要用项目 id，但 useMemo 必须在提前 return 之前声明，这里先取出来。 */
  const activeProjectId = project?.id ?? ''
  const selectedChapterId = useNovelStore((state) => state.selectedChapterId)
  const persistNow = useNovelStore((state) => state.persistNow)
  const selectChapter = useNovelStore((state) => state.selectChapter)
  const setStage = useNovelStore((state) => state.setStage)
  const rememberWorkspaceTarget = useNovelStore((state) => state.rememberWorkspaceTarget)
  const updateProject = useNovelStore((state) => state.updateProject)
  const [activeTool, setActiveTool] = useState<WorkspaceProjectToolId>()
  /** 项目打开时始终进入正式的项目概览导航目标。 */
  const [target, setTarget] = useState<WorkspaceNavigationTarget>(() => getWorkspaceDisplayDefault('overview'))
  const projectOverview = target.stageId === 'overview' && !activeTool
  const assistantStage = projectOverview || activeTool || target.stageId === 'overview' ? 'outline' : target.stageId
  /**
   * 专注模式（P2-C 后的语义：连 232px 目录列一起收起，只剩 68px 窄栏 + 稿纸 + 360px 助手）。
   * 状态放在这里而不是 WritingView 内部，是因为收起的对象已经跨出画布边界。
   */
  const [writingFocus, setWritingFocus] = useState(false)
  const [writingDirectoryOpen, setWritingDirectoryOpen] = useState(readWritingDirectoryOpen)
  const [assistantExpanded, setAssistantExpanded] = useState(false)
  const assistantToggled = useRef(false)
  useEffect(() => {
    if (!activeProjectId) return
    let current = true
    assistantToggled.current = false
    setAssistantExpanded(false)
    void mojingClient.providers.list().then(
      (providers) => { if (current && !assistantToggled.current) setAssistantExpanded(hasUsableModel(providers)) },
      () => { if (current && !assistantToggled.current) setAssistantExpanded(true) }
    )
    return () => { current = false }
  }, [activeProjectId])
  /** 大纲内显式选中的章纲：点章节目录后进入「剧情步骤」编辑，而不是跳正文。 */
  const [outlineChapterId, setOutlineChapterId] = useState<string>()
  /**
   * 「总纲与卷纲」里作者圈定的**分批细化范围**（整卷 / 卷内某章）。
   *
   * 这一项只决定「助手这次改哪儿」，本身不写任何项目字段；圈定后助手的目标从整本总纲
   * 收窄到这一卷或这一章，生成仍只落候选草稿、采用前仍必须查看差异。
   */
  const [refineScope, setRefineScope] = useState<OutlineRefineScope>()
  useEffect(() => {
    onNavigationStateChange?.(target, activeTool)
  }, [activeTool, onNavigationStateChange, target])
  /**
   * 归一后的细化范围：卷或章已经不在了（结构调整删掉/合并）就当作没选，
   * 助手退回整本总纲，不会停在一个已不存在的目标上。
   */
  const activeRefineScope = useMemo<OutlineRefineScope | undefined>(() => {
    if (!refineScope || !project) return undefined
    const volume = project.outline?.volumes.find((item) => item.id === refineScope.volumeId)
    if (!volume) return undefined
    if (!refineScope.chapterId) return refineScope
    return volume.chapters.some((card) => card.id === refineScope.chapterId) ? refineScope : { volumeId: volume.id }
  }, [refineScope, project])
  /** 项目内全局搜索（限定当前项目，纯客户端）。 */
  const [searchQuery, setSearchQuery] = useState('')
  const hits = useMemo<ProjectSearchHit[]>(() => {
    if (!project || !searchQuery.trim()) return []
    return searchProject(project, searchQuery)
  }, [project, searchQuery])

  /** 助手身份只按一级栏目选择，二级页和对象通过当前页面与精确作用域表达。 */
  const assistantProfile = useMemo(() => {
    if (!project) return undefined
    return getWorkspaceAssistantProfile(assistantStage, project.title, Boolean(activeTool))
  }, [project, activeTool, assistantStage])

  /**
   * 助手的精确作用域：由当前栏目、二级页和作者选中的对象决定。
   * 这只是「作者正在看什么」的报告——真正读取/写入范围由服务端按任务白名单重算，
   * 而且换页面、换选中对象本身不会触发任何模型请求。
   */
  const assistantTarget = useMemo<{ target: AssistantTarget; taskType: AssistantTaskType } | undefined>(() => {
    if (activeTool) return undefined
    const projectId = activeProjectId
    if (!projectId) return undefined
    const chapterOf = (id: string): AssistantTarget => ({ kind: 'chapter', projectId, objectId: id })
    switch (target.stageId) {
      case 'idea':
      case 'outline':
        if (['story-seed', 'direction-cards', 'writing-specs'].includes(target.subnavId)) {
          return { target: { kind: 'story-core', projectId }, taskType: '引导构建' }
        }
        if (['chapter-directory', 'chapter-beats'].includes(target.subnavId) && outlineChapterId) {
          return { target: chapterOf(outlineChapterId), taskType: '局部修改' }
        }
        /**
         * 分批细化（P05）：只有在「总纲与卷纲」模块里圈定的范围才生效 ——
         * 卷级 → `volume`，章级 → `chapter`；范围之外一律不写（服务端会再校验一次）。
         */
        if (activeRefineScope && resolveIntegratedOutlineTarget(target.stageId, target.subnavId).moduleId === 'outline-volumes') {
          return activeRefineScope.chapterId
            ? { target: chapterOf(activeRefineScope.chapterId), taskType: '局部修改' }
            : { target: { kind: 'volume', projectId, objectId: activeRefineScope.volumeId }, taskType: '局部修改' }
        }
        return { target: { kind: 'outline', projectId }, taskType: '局部修改' }
      case 'world':
        return { target: { kind: 'world', projectId }, taskType: target.subnavId === 'world-expansion' ? '世界观提案' : '自由讨论' }
      case 'writing':
        return selectedChapterId ? { target: chapterOf(selectedChapterId), taskType: '自由讨论' } : undefined
      case 'memory':
        return selectedChapterId ? { target: chapterOf(selectedChapterId), taskType: '章节分析' } : undefined
      case 'delivery':
        return { target: { kind: 'outline', projectId }, taskType: '连续性检查' }
      default:
        return undefined
    }
  }, [activeTool, activeProjectId, outlineChapterId, selectedChapterId, target.stageId, target.subnavId, activeRefineScope])

  const localSaveFeedback = !!project?.chapters.length && !projectOverview && !activeTool && target.stageId === 'writing' && target.subnavId === 'prose-editor'
  useEffect(() => {
    onLocalSaveFeedbackChange?.(localSaveFeedback)
    return () => onLocalSaveFeedbackChange?.(false)
  }, [localSaveFeedback, onLocalSaveFeedbackChange])

  useEffect(() => {
    if (!project) return undefined
    onRegisterRailHandlers?.({ navigate, openTool })
    return () => onRegisterRailHandlers?.()
  }, [onRegisterRailHandlers, project, target, activeTool, activeRefineScope, outlineChapterId, selectedChapterId])

  if (!project) return <></>

  const activeProject = project
  const header = projectOverview
    ? { crumb: [activeProject.title], title: '项目概览', description: '查看项目状态，选择下一步创作入口' }
    : buildWorkspaceHeader({ projectTitle: activeProject.title, target, activeTool })
  const writeView = !projectOverview && target.stageId === 'writing' && !activeTool
  /** 正文目录与二级导航同列，正文编辑仍只占用中央画布。 */
  const proseEditor = writeView && target.subnavId === 'prose-editor'
  /** 专注模式只在正文编辑页生效：整列 232px 一起收起，助手与保存链路不受影响。 */
  const writingFocusOn = proseEditor && writingFocus
  /** 右侧项目导航只承载当前一级栏目的二级入口；概览也保持同名入口常驻。 */
  const secondaryNav = resolveWorkspaceSecondaryNav(!activeTool ? target : undefined, activeTool)
  /** 导航目录与编辑器共用同一份「当前章节」（store 没选中时回落到第一章）。 */
  const activeChapterId = activeProject.chapters.find((chapter) => chapter.id === selectedChapterId)?.id
    ?? activeProject.chapters[0]?.id
  function navigate(next: WorkspaceNavigationTarget): void {
    // 先归一：改派到其他栏目的旧入口（如 idea/terms-boundaries）在这里就换成目标栏目
    const resolved = normalizeWorkspaceTarget(next)
    setActiveTool(undefined)
    setTarget(resolved)
    if (resolved.stageId !== 'overview') {
      setStage(resolved.stageId)
      // 概览是工作区路由，不冒充 novelStore 的创作阶段保存。
      rememberWorkspaceTarget({ stage: resolved.stageId, subnavId: resolved.subnavId })
    }
    setWritingFocus(false)
    // 正文域的精确落点：直接选中目标章节（store 的 selectChapter 会切到 writing）。
    if (resolved.stageId === 'writing' && resolved.focusId) selectChapter(resolved.focusId)
  }

  /**
   * 打开项目工具。
   *
   * 已收口的旧目标（`creative-seats` / 自动流程）在这里就换成正式入口：界面只渲染一个
   * 任务中心，并且滚到它自己的连续任务启动区（`#creative-seats-region`），
   * 而不是停在页首，也不是落到空页。
   */
  function openTool(toolId: WorkspaceProjectToolId): void {
    const resolved = resolveProjectToolId(toolId)
    if (!resolved) return
    setActiveTool(resolved)
    if (TOOL_STAGES.includes(resolved)) setStage(resolved as Parameters<typeof setStage>[0])
    const regionId = PROJECT_TOOL_ENTRY_REGION_IDS[toolId]
    if (regionId) {
      window.setTimeout(() => {
        document.getElementById(regionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)
    }
  }

  /**
   * 正文创作里新建章节：同时考虑现有章纲与正文的最大章号，避免刚建好的章纲被撞号。
   * 这是「正文侧」的建章；「章节规划」侧只建章纲，见 startWriting 与模块内的「新建章节规划」。
   */
  function createChapter(): void {
    const id = `ch-${Date.now().toString(36)}`
    updateProject((draft) => {
      const nextNumber = nextChapterNumber(draft)
      draft.chapters.push({
        id,
        volumeNumber: draft.chapters.at(-1)?.volumeNumber ?? 1,
        chapterNumber: nextNumber,
        title: `第${nextNumber}章`,
        blocks: [{ id: `${id}-b1`, text: '' }],
        status: '草稿',
        sourceDigest: '',
        updatedAt: new Date().toISOString()
      })
    })
    selectChapter(id)
    navigate({ stageId: 'writing', subnavId: 'prose-editor' })
  }

  /**
   * 「开始写作」：为选中的章纲建立**唯一**正文并进入正文。
   * 已有同章号正文时只做导航（模块已经把它显示为「继续写作」），不会建立第二份正文；
   * 建章经纯 mutator `applyCreateBodyForOutline` 走同一个保存通道，不另开写路径。
   */
  function startWriting(cardId: string): void {
    const card = (activeProject.outline?.volumes ?? [])
      .flatMap((volume) => volume.chapters)
      .find((chapter) => chapter.id === cardId)
    if (!card) return

    const existing = activeProject.chapters.find((chapter) => chapter.id === card.id)
      ?? activeProject.chapters.find((chapter) => chapter.chapterNumber === card.chapterNumber)
    if (existing) {
      openChapterBody(existing.id)
      return
    }

    // 正文沿用章纲的稳定身份；这样以后调整结构重排章号时，正文不会串到别的章。
    let bodyId: string | undefined
    updateProject((draft) => {
      bodyId = applyCreateBodyForOutline(draft, cardId, new Date().toISOString())
    })
    openChapterBody(bodyId ?? cardId)
  }

  /**
   * 大纲里单击章节：只切到「剧情步骤」模块（chapter-beats 经兼容映射落到章节规划 / 章纲详情）
   * 并记住目标章纲，**不跳正文、不改正文状态**。
   * 这里刻意不调用 store.selectChapter —— 它会把 stage 切到 writing。
   */
  function openChapterOutline(cardId: string): void {
    setOutlineChapterId(cardId)
    navigate({ stageId: 'outline', subnavId: 'chapter-beats' })
  }

  /**
   * 「进入正文」是章节规划模块里唯一的正文入口：只有它使用既有正文导航
   * （selectChapter 会切到 writing），选中章纲本身不会自动跳转。
   */
  function openChapterBody(chapterId: string): void {
    selectChapter(chapterId)
    navigate({ stageId: 'writing', subnavId: 'prose-editor' })
  }

  function toggleWritingDirectory(): void {
    const next = !writingDirectoryOpen
    setWritingDirectoryOpen(next)
    rememberWritingDirectoryOpen(next)
  }

  function renderView(): React.JSX.Element {
    if (projectOverview) {
      return (
        <ProjectWorkbenchPage
          project={activeProject}
          selectedChapterId={selectedChapterId}
          onNavigate={navigate}
          onOpenChapter={openChapterBody}
        />
      )
    }
    if (activeTool) {
      return (
        <ToolView
          toolId={activeTool}
          project={activeProject}
          onOpenVersionHistory={() => navigate({ stageId: 'delivery', subnavId: 'version-history' })}
          onNavigate={navigate}
        />
      )
    }

    if (target.stageId === 'idea' || target.stageId === 'outline') {
      return (
        <OutlineIntegratedView
          project={activeProject}
          stageId={target.stageId}
          subnavId={target.subnavId}
          focusId={target.focusId}
          selectedChapterId={selectedChapterId}
          outlineChapterId={outlineChapterId}
          refineScope={activeRefineScope}
          onSelectRefineScope={setRefineScope}
          onNavigate={navigate}
          onOpenChapterOutline={openChapterOutline}
          onOpenChapter={openChapterBody}
          onStartWriting={startWriting}
        />
      )
    }

    switch (target.stageId) {
      case 'world': return (
        <WorldView
          project={activeProject}
          subnavId={target.subnavId}
          onNavigate={(next) => navigate({ stageId: next.stageId, subnavId: next.subnavId as WorkspaceSubnavId })}
        />
      )
      case 'writing': return (
        <WritingView
          project={activeProject}
          chapterId={selectedChapterId}
          subnavId={target.subnavId}
          onCreateChapter={createChapter}
          focus={writingFocusOn}
          onToggleFocus={() => setWritingFocus((value) => !value)}
        />
      )
      case 'memory': return (
        <MemoryView
          project={activeProject}
          subnavId={target.subnavId}
          selectedChapterId={selectedChapterId}
          onNavigate={(page) => navigate({ stageId: 'memory', subnavId: page })}
          onOpenSettingProposals={() => navigate({ stageId: 'world', subnavId: 'world-expansion' })}
        />
      )
      case 'delivery': return (
        <ReviewView
          project={activeProject}
          subnavId={target.subnavId}
          onNavigate={(page) => navigate({ stageId: 'delivery', subnavId: page })}
          onOpenSettingProposals={() => navigate({ stageId: 'world', subnavId: 'world-expansion' })}
        />
      )
      default: return <></>
    }
  }

  return (
    <AppShell
      railItems={[]}
      activeRailId=""
      onSelectRail={() => {}}
      brand={<MojingMark />}
      theme={theme}
      onToggleTheme={onToggleTheme}
      showTopBar={false}
      bareBody
      embedded={embedded}
    >
    <div
      className={`mjp-body is-docked${writingFocusOn ? ' is-writing-focus' : ''}${activeTool ? ' is-tool' : ''}${secondaryNav.kind === 'none' || projectOverview ? ' is-no-snav' : ''}${projectOverview ? ' is-no-dock' : ''}${!activeTool && !projectOverview && !assistantExpanded ? ' is-dock-collapsed' : ''}`}
      data-ink-background={resolveWorkspaceInkBackground(target.stageId, Boolean(activeTool))}
    >

      {secondaryNav.kind !== 'none' && !projectOverview && !writingFocusOn && (
        <WorkspaceNav
          active={!activeTool ? target : undefined}
          activeTool={activeTool}
          chapterTree={writeView ? <ChapterTreePanel project={activeProject} currentId={activeChapterId} onCreateChapter={createChapter} createAriaLabel="新建一章（正文目录）" /> : undefined}
          directoryOpen={writingDirectoryOpen}
          onToggleDirectory={toggleWritingDirectory}
          onNavigate={navigate}
          onOpenTool={openTool}
        />
      )}

      <div className="mjp-canvas">
        <div className={`mjp-view-head${proseEditor ? ' is-prose-editor' : ''}`}>
          <nav className="mjp-crumb" aria-label="面包屑">
            {header.crumb.map((part, index) => (
              <span key={`${part}-${index}`} className="mjp-row">
                {index > 0 && <span className="sep">/</span>}
                <span className={index === header.crumb.length - 1 ? 'cur' : undefined}>{part}</span>
              </span>
            ))}
          </nav>
          {/* 当前视图标题：语义上就是本页的一级标题，因此用 h1（class 与 title 属性不变，视觉零变化） */}
          <h1 className="title" title={header.description}>{header.title}</h1>
          <span className="desc" title={header.description}>{header.description}</span>

          <div className="tools">
            {!writeView && (
              <span
                className={`mjp-save-state is-${saveStateTone(saveState)}`}
                data-testid="workspace-save-state"
                data-save-state={saveState ?? '已保存'}
                title={`保存状态：${saveState ?? '已保存'}`}
                aria-live={saveState === '正在保存' ? 'polite' : 'off'}
              >
                <i className="dot" />
                {saveState ?? '已保存'}
              </span>
            )}
            <div className="mjp-search" style={{ position: 'relative' }}>
              <input
                type="search"
                className="mjp-input"
                style={{ minWidth: proseEditor ? 120 : 220 }}
                placeholder="在当前项目内搜索…"
                aria-label="项目内搜索"
                data-testid="project-search-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery.trim() && (
                <div className="mjp-search-result" data-testid="project-search-result" role="listbox">
                  {hits.length === 0 ? (
                    <div className="mjp-search-empty">没有找到</div>
                  ) : (
                    hits.map((hit, index) => (
                      <button
                        key={`${hit.kind}-${hit.title}-${index}`}
                        type="button"
                        className="mjp-search-hit"
                        role="option"
                        onClick={() => {
                          navigate(hit.target)
                          setSearchQuery('')
                        }}
                      >
                        <span className={`mjp-search-kind kind-${hit.kind}`}>{hit.kind}</span>
                        <span className="mjp-search-title">{hit.title}</span>
                        <span className="mjp-search-snippet">{hit.snippet}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {job && (() => {
              // P3 第一阶段只补语义：进度条在无障碍树里可读，且值就是服务端回传的真实百分比。
              // 计算方式、显示数值、布局与文案一律不动。
              const clamped = Math.max(0, Math.min(100, job.percent))
              return (
                <span className="mjp-status-pill is-ai" title={job.label}>
                  {job.label}
                  <span
                    className="bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={clamped}
                    aria-valuetext={`${job.label} ${clamped}%`}
                  >
                    <i style={{ width: `${clamped}%` }} />
                  </span>
                </span>
              )
            })()}
            {proseEditor && (
              <>
                <button
                  type="button"
                  className="mjp-btn ghost sm mjp-editor-header-action"
                  aria-label="保存正文"
                  title="保存正文"
                  disabled={saveState === '正在保存'}
                  onClick={() => void persistNow()}
                >
                  <Save size={15} strokeWidth={1.8} />
                  <span>保存</span>
                </button>
                <button
                  type="button"
                  className="mjp-btn ghost sm mjp-editor-header-action"
                  aria-label={writingFocusOn ? '退出专注模式' : '进入专注模式'}
                  aria-pressed={writingFocusOn}
                  title={`${writingFocusOn ? '退出' : '进入'}专注模式（Ctrl+Shift+F）`}
                  onClick={() => setWritingFocus((value) => !value)}
                >
                  <Focus size={15} strokeWidth={1.8} />
                  <span>{writingFocusOn ? '退出专注' : '专注模式'}</span>
                </button>
              </>
            )}
            {/*
              正文创作侧只保留「新建章节」（建立正文）。
              「章节规划」侧的建章入口在模块内部（「新建章节规划」只建立章纲），
              这样同一个动作不会有两个含义相反的按钮。
            */}
            {!projectOverview && target.stageId === 'writing' && !activeTool && (
              <button type="button" className="mjp-btn primary sm" onClick={createChapter}>新建章节</button>
            )}
          </div>
        </div>

        <div className={`mjp-canvas-scroll${writeView ? ' is-flush' : ''}${projectOverview ? ' is-workbench' : ''}`}>
          {renderView()}
        </div>
      </div>

      {!activeTool && !projectOverview && (
        <WorkspaceDock
          stage={assistantStage}
          projectId={activeProject.id}
          projectTitle={activeProject.title}
          assistantProfile={assistantProfile}
          target={assistantTarget?.target}
          taskType={assistantTarget?.taskType}
          onNavigate={navigate}
          expanded={assistantExpanded}
          onToggle={() => { assistantToggled.current = true; setAssistantExpanded((value) => !value) }}
        />
      )}
    </div>
    </AppShell>
  )
}
