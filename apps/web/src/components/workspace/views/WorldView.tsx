import { useMemo } from 'react'
import { Waypoints } from 'lucide-react'
import type { NovelProject } from '../../../../../../packages/contracts/src'
import { EmptyState } from '../../ui/Primitives'
import { RulesBoundariesPage } from './world/RulesBoundariesPage'
import { WorldEntriesPage } from './world/WorldEntriesPage'
import { SettingProposalsPage } from './world/SettingProposalsPage'
import { WorldOverviewPage } from './world/WorldOverviewPage'
import { WorldTimelinePage } from './world/WorldTimelinePage'
import {
  buildRulesBoundaries,
  buildWorldEntries,
  buildWorldExpansion,
  buildWorldOverview,
  buildWorldTimeline,
  worldPageKind
} from './world/worldModel'

/**
 * 世界观栏目（含 5 个二级页面）。
 *
 * 旧实现把 5 个二级入口都指向同一份「词条卡 + 词条编辑器」。现在按 `subnavId`
 * 分成真正不同的页面：
 *   世界总览 / 规则与边界 / 世界词条 / 世界时间线 / 扩展世界观
 * 数据全部来自传入的真实 `NovelProject`；缺能力的动作（世界扩展的四步操作）
 * 明确标注「尚未接通」并禁用，不出现假成功。
 */
export function WorldView({
  project,
  subnavId,
  onNavigate
}: {
  project: NovelProject
  /** 当前二级页面 id（WorkspaceNavigationTarget.subnavId）。 */
  subnavId: string
  onNavigate: (target: { stageId: 'world'; subnavId: string }) => void
}): React.JSX.Element {
  const kind = worldPageKind(subnavId)

  const model = useMemo(() => {
    switch (kind) {
      case 'rules': return buildRulesBoundaries(project)
      case 'entries': return buildWorldEntries(project)
      case 'timeline': return buildWorldTimeline(project)
      case 'expansion': return buildWorldExpansion(project)
      default: return buildWorldOverview(project)
    }
  }, [kind, project])

  if (kind !== 'overview' && !project.worldBible) {
    return (
      <EmptyState
        icon={Waypoints}
        title="世界观尚未建立"
        description="这个项目还没有世界观内容。请先在「世界总览」建立空白世界，或让世界观构建助手推演候选。"
      />
    )
  }

  switch (model.kind) {
    case 'overview':
      return <WorldOverviewPage model={model} onGoTo={(next) => onNavigate({ stageId: 'world', subnavId: next })} />
    case 'rules':
      return <RulesBoundariesPage model={model} project={project} />
    case 'entries':
      return <WorldEntriesPage model={model} project={project} />
    case 'timeline':
      return <WorldTimelinePage model={model} />
    default:
      // 「扩展世界观」现在是「设定提案」：统一收纳手动暂存 / AI 建议 / 正文发现（D6）。
      return <SettingProposalsPage project={project} />
  }
}
