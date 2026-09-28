import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { HallPage } from './components/hall/HallPage'
import { useTheme } from './components/shell/useTheme'
import { SettingsPage } from './components/settings/SettingsPage'
import { WorkspacePage } from './components/workspace/WorkspacePage'
import { WorkspaceRail } from './components/workspace/WorkspaceRail'
import { getWorkspaceDisplayDefault, type WorkspaceNavigationTarget, type WorkspaceProjectToolId } from './components/workspace/workspaceNavigation'
import { Btn } from './components/ui/Primitives'
import { useNovelStore } from './novelStore'

export default function App(): React.JSX.Element {
  const initialize = useNovelStore((state) => state.initialize)
  const project = useNovelStore((state) => state.project)
  const openProject = useNovelStore((state) => state.openProject)
  const closeProject = useNovelStore((state) => state.closeProject)
  const saveState = useNovelStore((state) => state.saveState)
  const saveError = useNovelStore((state) => state.saveError)
  const persistNow = useNovelStore((state) => state.persistNow)
  const progress = useNovelStore((state) => state.progress)
  const error = useNovelStore((state) => state.error)
  const notice = useNovelStore((state) => state.notice)
  const hallFeedback = useNovelStore((state) => state.hallFeedback)
  const hallImportError = useNovelStore((state) => state.hallImportError)
  const hallCreateError = useNovelStore((state) => state.hallCreateError)
  const hallDeleteError = useNovelStore((state) => state.hallDeleteError)
  const hallActionError = useNovelStore((state) => state.hallActionError)
  const dismiss = useNovelStore((state) => state.dismiss)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [localSaveFeedback, setLocalSaveFeedback] = useState(false)
  const [projectEntryTransition, setProjectEntryTransition] = useState(false)
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceNavigationTarget>(() => getWorkspaceDisplayDefault('overview'))
  const [workspaceTool, setWorkspaceTool] = useState<WorkspaceProjectToolId>()
  const workspaceRailHandlers = useRef<{ navigate: (target: WorkspaceNavigationTarget) => void; openTool: (toolId: WorkspaceProjectToolId) => void } | undefined>(undefined)
  const { theme, toggleTheme } = useTheme()

  useEffect(() => { void initialize() }, [initialize])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => dismiss('notice'), 4500)
    return () => clearTimeout(timer)
  }, [notice, dismiss])
  useEffect(() => {
    if (!projectEntryTransition || !project) return
    const timer = window.setTimeout(() => setProjectEntryTransition(false), 520)
    return () => window.clearTimeout(timer)
  }, [projectEntryTransition, project])

  async function openProjectFromHall(id: string): Promise<void> {
    setProjectEntryTransition(true)
    try {
      await openProject(id)
      if (!useNovelStore.getState().project) setProjectEntryTransition(false)
    } catch (error) {
      setProjectEntryTransition(false)
      throw error
    }
  }

  function handleOpenSettings(): void { setSettingsOpen(true) }
  function handleReturnToHall(): void {
    setSettingsOpen(false)
    if (project) void closeProject()
  }

  const job = progress ? { label: progress.message, percent: progress.progress } : undefined

  const railVariant = project ? 'project' : 'hall'
  const workspacePage = project ? (
    <div className="mjp-page-layer" hidden={settingsOpen} inert={settingsOpen}>
      <WorkspacePage
        saveState={saveState}
        job={job}
        theme={theme}
        onToggleTheme={toggleTheme}
        embedded
        onNavigationStateChange={(target, activeTool) => { setWorkspaceTarget(target); setWorkspaceTool(activeTool) }}
        onRegisterRailHandlers={(handlers) => { workspaceRailHandlers.current = handlers }}
        onLocalSaveFeedbackChange={setLocalSaveFeedback}
      />
    </div>
  ) : null
  const page = settingsOpen ? (
    <>
    <SettingsPage
      theme={theme}
      onToggleTheme={toggleTheme}
      embedded
    />
      {workspacePage}
    </>
  ) : workspacePage ? (
    workspacePage
  ) : (
    <HallPage
      theme={theme}
      onToggleTheme={toggleTheme}
      onOpenProject={openProjectFromHall}
    />
  )

  const saveFailure = !!project && !!saveError && (saveState === '保存失败' || saveState === '正在保存')
  const errorShown = error && !(saveFailure && error === saveError && localSaveFeedback && !settingsOpen) && !(!project && !settingsOpen && ((hallImportError && error === hallImportError) || (hallCreateError && error === hallCreateError) || (hallDeleteError && error === hallDeleteError) || (hallActionError && error === hallActionError.message)))
  const noticeShown = notice && !(!project && !settingsOpen && hallFeedback)

  return (
    <>
      <div className="mjp-app">
        <WorkspaceRail
          variant={railVariant}
          active={workspaceTarget}
          activeTool={workspaceTool}
          projectTitle={project?.title ?? '项目大厅'}
          theme={theme}
          settingsActive={settingsOpen}
          expandedLocked={railVariant === 'project' && workspaceTarget.stageId === 'overview' && !workspaceTool}
          transitioning={projectEntryTransition}
          onBackToHall={handleReturnToHall}
          onNavigate={(target) => { if (settingsOpen) setSettingsOpen(false); workspaceRailHandlers.current?.navigate(target) }}
          onOpenTool={(toolId) => { if (settingsOpen) setSettingsOpen(false); workspaceRailHandlers.current?.openTool(toolId) }}
          onOpenSettings={handleOpenSettings}
          onToggleTheme={toggleTheme}
        />
        {page}
      </div>
      <div className="mjp-toasts">
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {errorShown && (
            <div className="mjp-toast is-error" data-state="error">
              <AlertCircle size={19} aria-hidden="true" />
              <div className="mjp-toast-content">
                <span>{error}</span>
                {saveFailure && (!localSaveFeedback || settingsOpen) && (
                  <Btn size="sm" loading={saveState === '正在保存'} onClick={() => void persistNow()}>重试保存</Btn>
                )}
              </div>
              <button aria-label="关闭错误" onClick={() => dismiss('error')}><X size={16} /></button>
            </div>
          )}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true">
          {noticeShown && (
            <div className="mjp-toast is-success" data-state="success">
              <CheckCircle2 size={19} aria-hidden="true" />
              <span>{noticeShown}</span>
              <button aria-label="关闭提示" onClick={() => dismiss('notice')}><X size={16} /></button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
