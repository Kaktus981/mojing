import { History, ShieldCheck, Workflow } from 'lucide-react'
import type { NovelProject } from '../../../../../../packages/contracts/src'
import { useNovelStore } from '../../../novelStore'
import { countProjectWords } from '../paragraphModel'
import { StyleWorkshopPage } from './tools/StyleWorkshopPage'
import { AssistantSettingsPage } from './tools/AssistantSettingsPage'
import { TaskCenterPage } from './tools/TaskCenterPage'
import { Btn, Card, Tag } from '../../ui/Primitives'
import type { WorkspaceNavigationTarget, WorkspaceProjectToolId } from '../workspaceNavigation'

/**
 * 项目工具面板（对应左侧导航「项目工具」分组）。
 *
 * 正式入口：任务中心 / 助手与技能 / 文笔工坊。版本历史归审稿与导出栏目。
 * 「自动流程」的按钮已从导航移除（P11 去重），旧的 `creative-seats` 目标仍在这里兼容：
 * 它渲染同一个任务中心页面，作者不会落到空页。
 *
 * 「前往处理」一律走 `onNavigate` 落到**真实二级页面**：
 * 只切一级栏目会停在栏目默认页，作者还要自己再点一次才找得到待办。
 */
export function ToolView({
  toolId,
  project,
  onOpenVersionHistory,
  onNavigate
}: {
  toolId: WorkspaceProjectToolId
  project: NovelProject
  /** 版本管理只保留一条受控入口：跳到「审稿与导出 · 版本历史」。 */
  onOpenVersionHistory: () => void
  /** 待办跳转：更新实际导航目标与当前栏目，并退出工具面板。 */
  onNavigate: (target: WorkspaceNavigationTarget) => void
}): React.JSX.Element {
  // 任务中心：合并 AI 工作台、待办总览与「自动流程」（连续任务启动 + 席位装配），只做状态/取消/重试/结果跳转（D7）。
  if (toolId === 'ai-workbench') return <TaskCenterPage project={project} onNavigate={onNavigate} />
  if (toolId === 'assistant-skills') return <AssistantSettingsPage project={project} />
  // 兼容旧目标 `creative-seats`（自动流程）：正式导航里它已不存在，改派后仍渲染任务中心。
  if (toolId === 'creative-seats') return <TaskCenterPage project={project} onNavigate={onNavigate} />
  if (toolId === 'history') return <HistoryView project={project} onOpenVersionHistory={onOpenVersionHistory} />
  // 文笔工坊：样文 → 选段 → 候选画像/手写画像 → 绑定快照（D4）。
  if (toolId === 'style-library') return <StyleWorkshopPage project={project} />
  // 所有入口都有真实实现；未知 id 回退到任务中心，不留空白页。
  return <TaskCenterPage project={project} onNavigate={onNavigate} />
}

/* ------------------------------ 历史记录 ------------------------------ */
function HistoryView({ project, onOpenVersionHistory }: { project: NovelProject; onOpenVersionHistory: () => void }): React.JSX.Element {
  const versions = useNovelStore((state) => state.versions)
  const jobs = useNovelStore((state) => state.generationJobs)
  const createCheckpoint = useNovelStore((state) => state.createCheckpoint)
  const busy = useNovelStore((state) => state.busy)

  return (
    <>
      <div className="mjp-overview">
        <div className="mjp-ov"><div className="l">当前版本</div><div className="v">v{project.revision}</div><div className="sub">{new Date(project.updatedAt).toLocaleString('zh-CN')}</div></div>
        <div className="mjp-ov"><div className="l">可恢复快照</div><div className="v">{versions.length}</div><div className="sub">应用候选与手动检查点</div></div>
        <div className="mjp-ov"><div className="l">AI 任务记录</div><div className="v">{jobs.length}</div><div className="sub">含成功、失败、取消</div></div>
        <div className="mjp-ov"><div className="l">正文规模</div><div className="v">{project.chapters.length} 章</div><div className="sub">{countProjectWords(project.chapters).toLocaleString()} 字</div></div>
      </div>

      <Card
        title="版本快照"
        icon={History}
        headRight={<Btn size="sm" disabled={busy} onClick={() => void createCheckpoint()}>创建检查点</Btn>}
        tight
      >
        {versions.length === 0 ? (
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13, padding: '4px 0' }}>
            还没有版本快照。创建检查点或应用一次 AI 候选后会出现记录。
          </p>
        ) : (
          versions.map((version) => (
            <div key={version.id} className="mjp-health-row">
              <span className="nm">
                <b>版本 {version.revision}</b>
                <span className="mjp-muted"> · {version.reason || version.source}</span>
              </span>
              <span className="val">{new Date(version.createdAt).toLocaleString('zh-CN')}</span>
              <Tag tone="outline">只读</Tag>
            </div>
          ))
        )}
      </Card>

      <Card
        title="恢复与版本管理"
        icon={ShieldCheck}
        tight
      >
        <div className="mjp-row" style={{ justifyContent: 'flex-end' }}>
          <Btn size="sm" onClick={onOpenVersionHistory}>前往版本历史</Btn>
        </div>
      </Card>

      <Card title="AI 任务历史" icon={Workflow} tight>
        {jobs.length === 0 ? (
          <p className="mjp-muted" style={{ margin: 0, fontSize: 13, padding: '4px 0' }}>还没有 AI 任务记录。</p>
        ) : (
          jobs.slice(0, 40).map((job) => (
            <div key={job.id} className="mjp-health-row">
              <span className="nm">
                <b>{job.kind}</b>
                <span className="mjp-muted"> · {new Date(job.createdAt).toLocaleString('zh-CN')}{job.message ? ` · ${job.message}` : ''}</span>
              </span>
              <span className="val">{(job.estimatedInputTokens + job.estimatedOutputTokens).toLocaleString()} Token</span>
              <Tag tone={job.status === '完成' ? 'ok' : job.status === '失败' ? 'danger' : 'amber'} dot>{job.status}</Tag>
            </div>
          ))
        )}
      </Card>
    </>
  )
}
