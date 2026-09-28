import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, type MemoryProposal, type NovelProject } from '../../contracts/src/novel'
import { applyMemoryProposalBatch, chapterDigest } from './novelMemory'

function project(): NovelProject {
  return NovelProjectSchema.parse({
    schemaVersion: 2, id: 'novel-1', title: '测试项目', seed: '一个原创故事',
    settings: { genreTemplate: '通用', targetWords: 200000, plannedVolumes: 2, plannedChapters: 80, pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文' },
    status: '创作中', revision: 12,
    chapters: [{ id: 'chapter-1', volumeNumber: 1, chapterNumber: 1, title: '第一章', blocks: [{ id: 'b1', text: '他在清晨抵达北境。' }], status: '草稿', sourceDigest: '', updatedAt: '2026-09-01T00:00:00.000Z' }],
    memories: [], plotThreads: [], branches: [], reviews: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
  })
}

function withFreshDigest(base: NovelProject): NovelProject {
  const next = structuredClone(base)
  next.chapters[0]!.sourceDigest = chapterDigest(next.chapters[0]!)
  return next
}

function proposal(base: NovelProject, overrides: Partial<MemoryProposal> = {}): MemoryProposal {
  return {
    id: 'proposal-1', projectId: base.id, chapterId: 'chapter-1', sourceDigest: base.chapters[0]!.sourceDigest,
    category: '章节摘要', targetId: undefined, candidate: '他在清晨抵达北境，并发现哨塔空无一人。',
    source: { chapterId: 'chapter-1', blockId: 'b1', excerpt: '他在清晨抵达北境。' },
    confidence: 0.8, risk: '低', status: '待确认', createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

describe('阶段 2.1 记忆批量接受的全成或全不成语义', () => {
  it('全部提案有效时一次性应用，并返回新的项目副本', () => {
    const base = withFreshDigest(project())
    const summary = proposal(base)
    const item = proposal(base, { id: 'proposal-2', category: '道具状态', candidate: '青铜罗盘' })
    const result = applyMemoryProposalBatch(base, [summary, item], [
      { proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-2', status: '已接受' }
    ], 12)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.appliedProposalIds).toEqual(['proposal-1', 'proposal-2'])
    expect(result.project.memories[0]?.summary).toContain('哨塔空无一人')
    expect(result.project.memories[0]?.objectStates).toEqual(['青铜罗盘'])
    // 不可变语义：原项目完全不变。
    expect(base.memories).toEqual([])
    expect(result.project.revision).toBe(12)
  })

  it('任一提案来源正文变化时整批回滚，正式记忆零写入', () => {
    const base = withFreshDigest(project())
    const stale = proposal(base, { id: 'proposal-2', sourceDigest: 'digest-from-another-edition' })
    const result = applyMemoryProposalBatch(base, [proposal(base), stale], [
      { proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-2', status: '已接受' }
    ], 12)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]?.code).toBe('来源正文变化')
    expect(result.blockers[0]?.proposalId).toBe('proposal-2')
    expect(base.memories).toEqual([])
  })

  it('项目版本不匹配时整批拒绝', () => {
    const base = withFreshDigest(project())
    const result = applyMemoryProposalBatch(base, [proposal(base)], [{ proposalId: 'proposal-1', status: '已接受' }], 13)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]?.code).toBe('项目版本变化')
    expect(base.memories).toEqual([])
  })

  it('提案不存在、状态冲突与缺少原文证据都会阻止整批写入', () => {
    const base = withFreshDigest(project())
    const missing = applyMemoryProposalBatch(base, [proposal(base)], [{ proposalId: 'proposal-9', status: '已接受' }], 12)
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.blockers[0]?.code).toBe('提案不存在')

    const resolved = applyMemoryProposalBatch(base, [proposal(base, { status: '已接受' })], [{ proposalId: 'proposal-1', status: '已接受' }], 12)
    expect(!resolved.ok && resolved.blockers[0]?.code).toBe('提案状态冲突')

    const noEvidence = applyMemoryProposalBatch(base, [proposal(base, { source: { chapterId: 'chapter-1', excerpt: '   ' } })], [{ proposalId: 'proposal-1', status: '已接受' }], 12)
    expect(!noEvidence.ok && noEvidence.blockers[0]?.code).toBe('缺少原文证据')

    const invalidated = applyMemoryProposalBatch(base, [proposal(base, { status: '已失效' })], [{ proposalId: 'proposal-1', status: '已接受' }], 12)
    expect(!invalidated.ok && invalidated.blockers[0]?.code).toBe('提案已失效')
  })

  it('只拒绝不接受的批次不会写入任何正式记忆', () => {
    const base = withFreshDigest(project())
    const result = applyMemoryProposalBatch(base, [proposal(base), proposal(base, { id: 'proposal-2' })], [
      { proposalId: 'proposal-1', status: '已拒绝' }, { proposalId: 'proposal-2', status: '已拒绝' }
    ], 12)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.appliedProposalIds).toEqual([])
    expect(result.project.memories).toEqual([])
  })

  it('同一提案被重复决定时整批回滚，不产生半成品记忆', () => {
    const base = withFreshDigest(project())
    const result = applyMemoryProposalBatch(base, [proposal(base)], [
      { proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-1', status: '已接受' }
    ], 12)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.blockers[0]?.code).toBe('重复提案')
    expect(base.memories).toEqual([])
  })
})
