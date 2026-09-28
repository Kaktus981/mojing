import {
  WorldEntrySchema, type CreateWorldExpansion, type NovelProject, type WorldExpansionProposal,
  type WorldSettingSimilarity
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'
import { applyWorldExpansion, previewWorldExpansion, worldBibleDigest } from './worldExpansion'

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }

const normalize = (value: string): string => value.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase()

/**
 * 设定提案（D6）。
 *
 * 分类唯一：永久设定 / 术语 / 规则只进世界观；章节摘要与人物状态归记忆；
 * 伏笔归记忆与伏笔；矛盾与质量问题归审稿。无法判断归属的保持待确认，
 * 不把临时状态提升为永久规则。
 */

/** 同名或相近的已有条目：**只提示**，不因同名自动合并。 */
export function findSimilarEntries(project: NovelProject, raw: CreateWorldExpansion): WorldSettingSimilarity[] {
  const entries = project.worldBible?.entries ?? []
  const names = new Set<string>()
  const aliases = new Set<string>()
  for (const value of raw.proposedEntries) {
    const parsed = WorldEntrySchema.safeParse(value)
    if (!parsed.success) continue
    names.add(normalize(parsed.data.name))
    for (const alias of parsed.data.aliases) aliases.add(normalize(alias))
  }
  const result: WorldSettingSimilarity[] = []
  const proposedNames = [...names]
  for (const entry of entries) {
    if (names.has(normalize(entry.name))) result.push({ entryId: entry.id, name: entry.name, type: entry.type, locked: entry.locked, reason: '同名' })
    else if (
      entry.aliases.some((alias) => aliases.has(normalize(alias)))
      || entry.aliases.some((alias) => proposedNames.includes(normalize(alias)))
    ) {
      result.push({ entryId: entry.id, name: entry.name, type: entry.type, locked: entry.locked, reason: '别名相同' })
    }
  }
  return result
}

/**
 * 锁定条目必须先显式解锁，AI 或提案都不能自动覆盖它。
 * 这是 D6 的硬规则：正式世界事实的改动只能来自作者。
 */
export function assertNotOverwritingLocked(project: NovelProject, proposal: WorldExpansionProposal): void {
  const lockedNames = new Set((project.worldBible?.entries ?? []).filter((entry) => entry.locked).map((entry) => normalize(entry.name)))
  if (lockedNames.size === 0) return
  for (const value of proposal.proposedEntries) {
    const parsed = WorldEntrySchema.safeParse(value)
    if (!parsed.success) continue
    if (lockedNames.has(normalize(parsed.data.name))) {
      throw fail('WORLD_ENTRY_LOCKED', `「${parsed.data.name}」已经锁定，AI 不能自动覆盖；请先在词条里解锁，或改为新增另一个条目。`)
    }
  }
}

/** 建提案：走既有 `previewWorldExpansion`，只落候选，不动正式世界观。 */
export function createSettingProposal(input: {
  database: NovelDatabaseService
  project: NovelProject
  raw: CreateWorldExpansion
}): { proposal: WorldExpansionProposal; similar: WorldSettingSimilarity[] } {
  const preview = previewWorldExpansion(input.project, input.raw)
  const similar = findSimilarEntries(input.project, input.raw)
  // 保存会把 revision +1，提案基线必须指向**保存后的版本**，否则刚建好就被判为过期。
  const proposal: WorldExpansionProposal = {
    ...preview.proposal,
    id: preview.proposal.id,
    baseRevision: input.project.revision + 1,
    source: input.raw.source ?? '手动暂存',
    evidence: input.raw.evidence ?? null
  }
  const next = structuredClone(input.project)
  next.worldExpansionProposals = [...(input.project.worldExpansionProposals ?? []), proposal]
  const saved = input.database.saveProject(next, input.project.revision, '新增设定提案', '设定提案')
  return { proposal: saved.worldExpansionProposals?.find((item) => item.id === proposal.id) ?? proposal, similar }
}

export function listSettingProposals(project: NovelProject): WorldExpansionProposal[] {
  return (project.worldExpansionProposals ?? []).filter((item) => item.status === '待确认')
}

export function updateSettingProposal(input: {
  database: NovelDatabaseService
  project: NovelProject
  proposalId: string
  patch: Partial<Pick<WorldExpansionProposal, 'title' | 'reason' | 'proposedEntries' | 'source' | 'evidence'>>
}): WorldExpansionProposal {
  const current = (input.project.worldExpansionProposals ?? []).find((item) => item.id === input.proposalId)
  if (!current) throw fail('SETTING_PROPOSAL_NOT_FOUND', '找不到这份设定提案。')
  if (current.status !== '待确认') throw fail('SETTING_PROPOSAL_CLOSED', `这份提案当前为“${current.status}”，不能再修改。`)
  // 改动后世界观可能已经变了：重新按当前资料算摘要，避免用旧基线去写。
  const merged = { ...current, ...input.patch }
  // 改动后按当前资料重新预览，并把基线指向保存后的版本。
  const repreviewed = previewWorldExpansion(input.project, {
    title: merged.title, reason: merged.reason, proposedEntries: merged.proposedEntries,
    sourceChapterIds: current.sourceChapterIds, plannedChapterNumbers: current.plannedChapterNumbers,
    transitionPlan: current.transitionPlan, causalChain: current.causalChain,
    unresolvedQuestions: current.unresolvedQuestions, source: merged.source, evidence: merged.evidence
  })
  const next = structuredClone(input.project)
  next.worldExpansionProposals = (next.worldExpansionProposals ?? []).map((item) =>
    item.id === input.proposalId
      ? {
        ...repreviewed.proposal, id: current.id, baseRevision: input.project.revision + 1,
        source: merged.source, evidence: merged.evidence, createdAt: current.createdAt
      }
      : item)
  const saved = input.database.saveProject(next, input.project.revision, '修改设定提案', '设定提案')
  return saved.worldExpansionProposals?.find((item) => item.id === input.proposalId)!
}

/**
 * 采用提案：先确认没有覆盖锁定条目，再走既有 `applyWorldExpansion`，
 * 最后经统一保存通道落库（会留可恢复版本）。
 */
export function adoptSettingProposal(input: {
  database: NovelDatabaseService
  project: NovelProject
  proposalId: string
  allowRisk?: boolean
}): NovelProject {
  const proposal = (input.project.worldExpansionProposals ?? []).find((item) => item.id === input.proposalId)
  if (!proposal) throw fail('SETTING_PROPOSAL_NOT_FOUND', '找不到这份设定提案。')
  assertNotOverwritingLocked(input.project, proposal)
  const next = applyWorldExpansion(input.project, proposal, { allowRisk: input.allowRisk, reason: '采用设定提案' })
  return input.database.saveProject(next, input.project.revision, `采用设定提案：${proposal.title}`, '设定提案')
}

export function rejectSettingProposal(input: {
  database: NovelDatabaseService
  project: NovelProject
  proposalId: string
}): NovelProject {
  const proposal = (input.project.worldExpansionProposals ?? []).find((item) => item.id === input.proposalId)
  if (!proposal) throw fail('SETTING_PROPOSAL_NOT_FOUND', '找不到这份设定提案。')
  if (proposal.status !== '待确认') throw fail('SETTING_PROPOSAL_CLOSED', `这份提案当前为“${proposal.status}”。`)
  const next = structuredClone(input.project)
  next.worldExpansionProposals = (next.worldExpansionProposals ?? []).map((item) =>
    item.id === input.proposalId ? { ...item, status: '已拒绝' as const, updatedAt: new Date().toISOString() } : item)
  return input.database.saveProject(next, input.project.revision, `忽略设定提案：${proposal.title}`, '设定提案')
}

/**
 * 来源实质变化才允许产生新结果：同一来源证据被忽略过就不再反复提醒。
 * 返回 true 表示「已有被忽略的同证据提案，不要再生成」。
 */
export function hasIgnoredSameEvidence(project: NovelProject, raw: CreateWorldExpansion): boolean {
  const evidence = raw.evidence
  if (!evidence || evidence.inferred || !evidence.excerpt.trim()) return false
  const pendingNormalized = raw.proposedEntries
    .map((value) => WorldEntrySchema.safeParse(value))
    .filter((item): item is { success: true; data: ReturnType<typeof WorldEntrySchema.parse> } => item.success)
    .map((item) => normalize(item.data.name))
  return (project.worldExpansionProposals ?? []).some((item) => {
    if (item.status !== '已拒绝') return false
    if (item.evidence?.excerpt.trim() !== evidence.excerpt.trim()) return false
    const names = item.proposedEntries
      .map((value) => WorldEntrySchema.safeParse(value))
      .filter((parsed): parsed is { success: true; data: ReturnType<typeof WorldEntrySchema.parse> } => parsed.success)
      .map((parsed) => normalize(parsed.data.name))
    return names.some((name) => pendingNormalized.includes(name))
  })
}

export { worldBibleDigest }
