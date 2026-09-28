import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { collectWorldMissingFields } from './worldCanonRules'

/**
 * 世界观 · 五个二级页面的纯数据模型。
 *
 * 与大纲模块同样的三条原则：
 *   1. 五个入口必须呈现**不同**内容，可被测试直接证明；
 *   2. 展示值只能来自传入的 `NovelProject`（worldBible / worldConstraints /
 *      worldQualityFindings / worldExpansionProposals），不补占位、不造假统计；
 *   3. 缺能力的地方显式建模为 `notice`（尚未接通），页面只负责如实说明。
 */

export type WorldPageId = 'world-overview' | 'rules-boundaries' | 'world-entries' | 'world-timeline' | 'world-expansion'

export const WORLD_PAGE_IDS: readonly WorldPageId[] = [
  'world-overview',
  'rules-boundaries',
  'world-entries',
  'world-timeline',
  'world-expansion'
]

export type WorldPageKind = 'overview' | 'rules' | 'entries' | 'timeline' | 'expansion'

const PAGE_KIND: Record<WorldPageId, WorldPageKind> = {
  'world-overview': 'overview',
  'rules-boundaries': 'rules',
  'world-entries': 'entries',
  'world-timeline': 'timeline',
  'world-expansion': 'expansion'
}

export function isWorldPageId(value: string): value is WorldPageId {
  return (WORLD_PAGE_IDS as readonly string[]).includes(value)
}

export function worldPageKind(subnavId: string): WorldPageKind {
  return isWorldPageId(subnavId) ? PAGE_KIND[subnavId] : 'overview'
}

export type WorldNotice = { id: string; title: string; detail: string }

/** 契约里定义的全部词条类型，用来计算「覆盖度」；顺序与契约 discriminatedUnion 一致。 */
export const WORLD_ENTRY_TYPES = [
  '角色', '修行体系', '国家', '货币', '势力', '地点', '种族', '宗教', '文化', '历史', '历法', '科技魔法', '物品', '自定义'
] as const

type WorldBible = NonNullable<NovelProject['worldBible']>
type TimelineEvent = WorldBible['timeline'][number]
type WorldConstraint = NovelProject['worldConstraints'][number]

export type WorldOverviewModel = {
  kind: 'overview'
  hasWorld: boolean
  status: string
  updatedAt: string
  summary: string
  premise: string
  themes: string[]
  geography: string
  historySummary: string
  missingFields: string[]
  entryCount: number
  lockedEntryCount: number
  relationCount: number
  /** 指向不存在词条的关系数（真实悬空引用）。 */
  brokenRelationCount: number
  coverage: Array<{ type: string; count: number }>
  uncoveredTypes: string[]
  ruleCount: number
  timelineCount: number
  constraints: { total: number; 待确认: number; 已确认: number; 已锁定: number; 已拒绝: number }
  pendingQualityFindings: number
  expansionProposalCount: number
}

function countByStatus(constraints: WorldConstraint[]) {
  return {
    total: constraints.length,
    待确认: constraints.filter((item) => item.status === '待确认').length,
    已确认: constraints.filter((item) => item.status === '已确认').length,
    已锁定: constraints.filter((item) => item.status === '已锁定').length,
    已拒绝: constraints.filter((item) => item.status === '已拒绝').length
  }
}

export function buildWorldOverview(project: NovelProject): WorldOverviewModel {
  const world = project.worldBible
  const entries = world?.entries ?? []
  const entryIds = new Set(entries.map((entry) => entry.id))
  const constraints = project.worldConstraints ?? []
  const coverage = WORLD_ENTRY_TYPES.map((type) => ({
    type,
    count: entries.filter((entry) => entry.type === type).length
  }))
  const missingFields = collectWorldMissingFields(world)

  return {
    kind: 'overview',
    hasWorld: Boolean(world),
    status: world?.status ?? '',
    updatedAt: world?.updatedAt ?? '',
    summary: world?.summary ?? '',
    premise: world?.premise ?? '',
    themes: world?.themes ?? [],
    geography: world?.geography ?? '',
    historySummary: world?.historySummary ?? '',
    missingFields,
    entryCount: entries.length,
    lockedEntryCount: entries.filter((entry) => entry.locked).length,
    relationCount: entries.reduce((sum, entry) => sum + entry.relations.length, 0),
    brokenRelationCount: entries.reduce(
      (sum, entry) => sum + entry.relations.filter((relation) => !entryIds.has(relation.targetEntryId)).length,
      0
    ),
    coverage,
    uncoveredTypes: coverage.filter((item) => item.count === 0).map((item) => item.type),
    ruleCount: world?.rules.length ?? 0,
    timelineCount: world?.timeline.length ?? 0,
    constraints: countByStatus(constraints),
    pendingQualityFindings: (project.worldQualityFindings ?? []).filter((finding) => finding.status === '待处理').length,
    expansionProposalCount: (project.worldExpansionProposals ?? []).length
  }
}

export type WorldRuleModel = { index: number; text: string }

export type WorldConstraintModel = {
  id: string
  term: string
  definition: string
  notDefinition: string
  entityType: string
  status: string
  allowedUsages: string[]
  forbiddenUsages: Array<{ phrase: string; reason: string; suggestedReplacement: string }>
  unresolvedQuestions: string[]
  facts: Array<{ subject: string; relation: string; object: string; polarity: string }>
  sourceExcerpt: string
}

export type WorldQualityFindingModel = {
  id: string
  type: string
  severity: '高' | '中' | '低'
  excerpt: string
  fieldPath: string
  explanation: string
  suggestedReplacement?: string
  source: string
  status: string
}

export type RulesBoundariesModel = {
  kind: 'rules'
  hasWorld: boolean
  rules: WorldRuleModel[]
  constraints: WorldConstraintModel[]
  constraintStats: { total: number; 待确认: number; 已确认: number; 已锁定: number; 已拒绝: number }
  findings: WorldQualityFindingModel[]
  pendingFindingCount: number
  /** AI 修复只进入候选层，本页不直接改写正式设定。 */
  notice: WorldNotice
}

const REPAIR_NOTICE: WorldNotice = {
  id: 'world-repair',
  title: 'AI 修复只进入候选层',
  detail: '本页展示审校发现与证据，但不在这里改写正式规则或词条：AI 的修复建议必须先成为待确认候选，由你在候选面板决定是否采用。'
}

export function buildRulesBoundaries(project: NovelProject): RulesBoundariesModel {
  const world = project.worldBible
  const constraints = project.worldConstraints ?? []
  return {
    kind: 'rules',
    hasWorld: Boolean(world),
    rules: (world?.rules ?? []).map((text, index) => ({ index: index + 1, text })),
    constraints: constraints.map((item) => ({
      id: item.id,
      term: item.term,
      definition: item.definition,
      notDefinition: item.notDefinition,
      entityType: item.entityType,
      status: item.status,
      allowedUsages: item.allowedUsages,
      forbiddenUsages: item.forbiddenUsages.map((usage) => ({
        phrase: usage.phrase,
        reason: usage.reason,
        suggestedReplacement: usage.suggestedReplacement
      })),
      unresolvedQuestions: item.unresolvedQuestions,
      facts: item.facts.map((fact) => ({
        subject: fact.subject,
        relation: fact.relation,
        object: fact.object,
        polarity: fact.polarity
      })),
      sourceExcerpt: item.source.excerpt
    })),
    constraintStats: countByStatus(constraints),
    findings: (project.worldQualityFindings ?? []).map((finding) => ({
      id: finding.id,
      type: finding.type,
      severity: finding.severity,
      excerpt: finding.evidence.excerpt,
      fieldPath: finding.evidence.fieldPath,
      explanation: finding.explanation,
      suggestedReplacement: finding.suggestedReplacement,
      source: finding.source,
      status: finding.status
    })),
    pendingFindingCount: (project.worldQualityFindings ?? []).filter((finding) => finding.status === '待处理').length,
    notice: REPAIR_NOTICE
  }
}

export type WorldEntryGroupModel = {
  type: string
  items: Array<{
    id: string
    name: string
    type: string
    summary: string
    locked: boolean
    aiVisibility: string
    aliasCount: number
    tagCount: number
    relationCount: number
    brokenRelationCount: number
  }>
}

export type WorldEntriesModel = {
  kind: 'entries'
  hasWorld: boolean
  groups: WorldEntryGroupModel[]
  entryCount: number
  unlockedCount: number
  types: readonly string[]
  coverage: Array<{ type: string; count: number }>
}

export function buildWorldEntries(project: NovelProject): WorldEntriesModel {
  const entries = project.worldBible?.entries ?? []
  const entryIds = new Set(entries.map((entry) => entry.id))
  const types: readonly string[] = WORLD_ENTRY_TYPES
  return {
    kind: 'entries',
    hasWorld: Boolean(project.worldBible),
    groups: types
      .map((type) => ({
        type,
        items: entries
          .filter((entry) => entry.type === type)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            summary: entry.summary,
            locked: entry.locked,
            aiVisibility: entry.aiVisibility,
            aliasCount: entry.aliases.length,
            tagCount: entry.tags.length,
            relationCount: entry.relations.length,
            brokenRelationCount: entry.relations.filter((relation) => !entryIds.has(relation.targetEntryId)).length
          }))
      }))
      .filter((group) => group.items.length > 0),
    entryCount: entries.length,
    unlockedCount: entries.filter((entry) => !entry.locked).length,
    types,
    coverage: types.map((type) => ({ type, count: entries.filter((entry) => entry.type === type).length }))
  }
}

export type WorldTimelineEventModel = {
  id: string
  dateLabel: string
  order: number
  title: string
  description: string
  entryIds: string[]
  /** 关联词条里已失效的引用数（真实悬空引用）。 */
  brokenEntryIds: string[]
  locked: boolean
}

export type WorldTimelineModel = {
  kind: 'timeline'
  hasWorld: boolean
  events: WorldTimelineEventModel[]
  lockedCount: number
  /** 同一 dateLabel 下出现多个事件（真实重复，仅提示，不自动改写）。 */
  repeatedLabels: Array<{ label: string; count: number }>
}

export function buildWorldTimeline(project: NovelProject): WorldTimelineModel {
  const world = project.worldBible
  const entryIds = new Set((world?.entries ?? []).map((entry) => entry.id))
  const events = [...(world?.timeline ?? [])]
    .sort((left, right) => left.order - right.order)
    .map((event: TimelineEvent) => ({
      id: event.id,
      dateLabel: event.dateLabel,
      order: event.order,
      title: event.title,
      description: event.description,
      entryIds: event.entryIds,
      brokenEntryIds: event.entryIds.filter((id) => !entryIds.has(id)),
      locked: event.locked
    }))
  const labelCounts = new Map<string, number>()
  for (const event of events) {
    if (!event.dateLabel.trim()) continue
    labelCounts.set(event.dateLabel, (labelCounts.get(event.dateLabel) ?? 0) + 1)
  }
  return {
    kind: 'timeline',
    hasWorld: Boolean(world),
    events,
    lockedCount: events.filter((event) => event.locked).length,
    repeatedLabels: [...labelCounts.entries()].filter(([, count]) => count > 1).map(([label, count]) => ({ label, count }))
  }
}

export type WorldExpansionProposalModel = {
  id: string
  title: string
  reason: string
  status: string
  impactSummary: string
  proposedEntryCount: number
  plannedChapterNumbers: number[]
  sourceChapterCount: number
  affectedChapterCount: number
  conflicts: Array<{ id: string; category: string; detail: string; severity?: string }>
  causalChain: Array<{ id: string; layer: string; title: string; description: string; status: string }>
  transitionCount: number
  unresolvedQuestions: string[]
  updatedAt: string
}

export type WorldExpansionModel = {
  kind: 'expansion'
  proposals: WorldExpansionProposalModel[]
  pendingCount: number
  /** 生成 / 修改 / 应用扩展候选需要服务端端点，当前服务端与客户端都没有。 */
  actions: Array<{ id: string; label: string; enabled: false; reason: string }>
  notice: WorldNotice
}

const EXPANSION_NOT_CONNECTED: WorldNotice = {
  id: 'world-expansion-api',
  title: '扩展世界观目前不能直接写入',
  detail: '生成、修改、应用或拒绝世界扩展候选目前都还没有实现。因此扩展操作全部禁用：AI 只能产出候选，不能直接写入正式世界观。'
}

const EXPANSION_ACTIONS = ['生成扩展候选', '修改候选内容', '应用候选到世界观', '拒绝候选'] as const

export function buildWorldExpansion(project: NovelProject): WorldExpansionModel {
  const proposals = project.worldExpansionProposals ?? []
  return {
    kind: 'expansion',
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      reason: proposal.reason,
      status: proposal.status,
      impactSummary: proposal.impactSummary,
      proposedEntryCount: proposal.proposedEntries.length,
      plannedChapterNumbers: proposal.plannedChapterNumbers,
      sourceChapterCount: proposal.sourceChapterIds.length,
      affectedChapterCount: proposal.affectedChapterIds.length,
      conflicts: proposal.conflicts.map((conflict, index) => ({
        id: `${proposal.id}-conflict-${index}`,
        category: conflict.kind,
        detail: conflict.message,
        severity: conflict.severity
      })),
      causalChain: (proposal.causalChain ?? []).map((link) => ({
        id: link.id,
        layer: link.layer,
        title: link.title,
        description: link.description,
        status: link.status
      })),
      transitionCount: proposal.transitionPlan.length,
      unresolvedQuestions: proposal.unresolvedQuestions ?? [],
      updatedAt: proposal.updatedAt
    })),
    pendingCount: proposals.filter((proposal) => proposal.status === '待确认').length,
    actions: EXPANSION_ACTIONS.map((label) => ({
      id: label,
      label,
      enabled: false,
      reason: '这一版暂未开放该能力；当前不可用。'
    })),
    notice: EXPANSION_NOT_CONNECTED
  }
}
