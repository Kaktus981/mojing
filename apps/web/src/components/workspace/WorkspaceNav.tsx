import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  getWorkspaceDisplaySubnav,
  type WorkspaceNavigationTarget,
  type WorkspaceProjectToolId
} from '../workspace/workspaceNavigation'
import { resolveWorkspaceSecondaryNav } from './workspaceSecondaryNav'

type WorkspaceNavProps = {
  /** 正在浏览栏目时为当前目标；停在项目工具上时为 undefined。 */
  active?: WorkspaceNavigationTarget
  activeTool?: WorkspaceProjectToolId
  /** 正文目录在写作二级导航下方常驻，收起状态只影响这棵树。 */
  chapterTree?: React.ReactNode
  directoryOpen?: boolean
  onToggleDirectory?: () => void
  onNavigate: (target: WorkspaceNavigationTarget) => void
  onOpenTool: (toolId: WorkspaceProjectToolId) => void
}

const WRITING_DIRECTORY_PREFERENCE = 'mojing:writing-directory-open'

export function readWritingDirectoryOpen(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(WRITING_DIRECTORY_PREFERENCE) !== 'false'
  } catch {
    return true
  }
}

export function rememberWritingDirectoryOpen(open: boolean): void {
  try {
    window.localStorage.setItem(WRITING_DIRECTORY_PREFERENCE, String(open))
  } catch {
    // 存储不可用时仍允许当前会话手动展开或收起。
  }
}

/**
 * 232px 功能导航（对应参考样例 .fnav）。
 * 分组、标签、id 全部复用 workspaceNavigation.ts 的既有定义，
 * 这样保存过的导航偏好与后续页面接入都能对上。
 */
export function WorkspaceNav({
  active,
  activeTool,
  chapterTree,
  directoryOpen = true,
  onToggleDirectory,
  onNavigate,
  onOpenTool
}: WorkspaceNavProps): React.JSX.Element {
  const secondary = resolveWorkspaceSecondaryNav(active, activeTool)
  if (secondary.kind === 'none') return <></>
  const displayActive = active ? getWorkspaceDisplaySubnav(active.stageId, active.subnavId) : undefined

  return (
    <aside className={`mjp-snav is-secondary-only${chapterTree ? ' has-writing-directory' : ''}`} aria-label={`${secondary.label}二级导航`}>
      <div className="mjp-snav-scroll mjp-scroll">
        {secondary.kind === 'section' ? (
          <div data-nav-section={secondary.id}>
            <div className="mjp-snav-sublist">
              {secondary.items.map((item) => {
                const itemActive = item.stageId === displayActive?.stageId && item.id === displayActive.id
                return (
                  <button
                    key={`${item.stageId}-${item.id}`}
                    type="button"
                    className={`mjp-snav-item${itemActive ? ' is-active' : ''}`}
                    title={item.description}
                    onClick={() => onNavigate(item.stageId === 'overview' ? { stageId: 'overview', subnavId: 'project-overview' } : { stageId: item.stageId, subnavId: item.id })}
                  >
                    <i className="bullet" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            {secondary.items.map((tool) => (
              <button key={tool.id} type="button" className={`mjp-snav-section${activeTool === tool.id ? ' is-active' : ''}`} title={tool.description} onClick={() => onOpenTool(tool.id)}>
                <tool.icon size={18} strokeWidth={1.7} />
                {tool.label}
              </button>
            ))}
          </>
        )}
      </div>
      {chapterTree && (
        <div className={`mjp-snav-directory${directoryOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="mjp-snav-directory-toggle"
            aria-expanded={directoryOpen}
            aria-controls="mjp-writing-chapters"
            aria-label={directoryOpen ? '收起正文目录' : '展开正文目录'}
            onClick={onToggleDirectory}
          >
            {directoryOpen ? <ChevronDown size={16} strokeWidth={1.8} /> : <ChevronRight size={16} strokeWidth={1.8} />}
            <span>正文目录</span>
            <span className="mjp-snav-directory-action">{directoryOpen ? '收起' : '展开'}</span>
          </button>
          {directoryOpen && (
            <div id="mjp-writing-chapters" className="mjp-snav-directory-scroll mjp-scroll">
              {chapterTree}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
