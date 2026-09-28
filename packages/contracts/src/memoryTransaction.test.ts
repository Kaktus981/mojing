import { describe, expect, it } from 'vitest'
import { MemoryProposalBatchResolveResultSchema, planMemoryProposalBatch, type MemoryProposalFact } from './novel'
import { ManualMemoryRevisionRequestSchema, ManualMemoryRevisionResultSchema, MemoryProposalBatchResolveRequestSchema } from './novelApi'

function fact(overrides: Partial<MemoryProposalFact> = {}): MemoryProposalFact {
  return { id: 'proposal-1', status: '待确认', baseRevision: 7, sourceDigest: 'digest-a', ...overrides }
}

describe('阶段 1.3 记忆批量事务与人工修订提案契约', () => {
  it('批量请求必须携带项目版本，且不允许重复提案', () => {
    const ok = MemoryProposalBatchResolveRequestSchema.safeParse({
      currentRevision: 7, decisions: [{ proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-2', status: '已拒绝' }]
    })
    expect(ok.success).toBe(true)
    const duplicated = MemoryProposalBatchResolveRequestSchema.safeParse({
      currentRevision: 7, decisions: [{ proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-1', status: '已拒绝' }]
    })
    expect(duplicated.success).toBe(false)
    expect(MemoryProposalBatchResolveRequestSchema.safeParse({ decisions: [{ proposalId: 'p', status: '已接受' }] }).success).toBe(false)
  })

  it('全部提案有效时批量结果为全部成功', () => {
    const plan = planMemoryProposalBatch(
      [{ proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-2', status: '已接受' }],
      [fact(), fact({ id: 'proposal-2' })], 7
    )
    expect(plan.status).toBe('全部成功')
    expect(plan.appliedProposalIds).toEqual(['proposal-1', 'proposal-2'])
    expect(plan.blockers).toEqual([])
    expect(plan.committedRevision).toBe(7)
  })

  it('任一提案失效时零写入：全部回滚且不返回任何已应用提案', () => {
    const plan = planMemoryProposalBatch(
      [{ proposalId: 'proposal-1', status: '已接受' }, { proposalId: 'proposal-2', status: '已接受' }],
      [fact(), fact({ id: 'proposal-2', status: '已失效' })], 7
    )
    expect(plan.status).toBe('全部回滚')
    expect(plan.appliedProposalIds).toEqual([])
    expect(plan.committedRevision).toBeUndefined()
    expect(plan.blockers.map((blocker) => blocker.code)).toContain('提案已失效')
    expect(plan.blockers[0]?.proposalId).toBe('proposal-2')
  })

  it('项目版本变化、来源正文变化与提案不存在都会阻止整批写入', () => {
    const staleRevision = planMemoryProposalBatch([{ proposalId: 'proposal-1', status: '已接受' }], [{ ...fact(), baseRevision: 6 }], 7)
    expect(staleRevision.status).toBe('全部回滚')
    expect(staleRevision.blockers[0]?.code).toBe('项目版本变化')

    const staleSource = planMemoryProposalBatch([{ proposalId: 'proposal-1', status: '已接受' }], [{ ...fact(), currentSourceDigest: 'digest-b' }], 7)
    expect(staleSource.blockers[0]?.code).toBe('来源正文变化')

    const missing = planMemoryProposalBatch([{ proposalId: 'proposal-9', status: '已接受' }], [fact()], 7)
    expect(missing.blockers[0]?.code).toBe('提案不存在')

    const resolved = planMemoryProposalBatch([{ proposalId: 'proposal-1', status: '已接受' }], [{ ...fact(), status: '已接受' }], 7)
    expect(resolved.blockers[0]?.code).toBe('提案状态冲突')
  })

  it('拒绝待确认提案不依赖旧正文证据，允许清理失去采用价值的候选', () => {
    const plan = planMemoryProposalBatch(
      [{ proposalId: 'proposal-1', status: '已拒绝' }],
      [fact({ currentSourceDigest: 'new-digest', hasSourceEvidence: false })], 7
    )
    expect(plan.status).toBe('全部成功')
    expect(plan.appliedProposalIds).toEqual(['proposal-1'])
  })

  it('结果契约强制全成或全不成，不能出现部分成功', () => {
    const partial = MemoryProposalBatchResolveResultSchema.safeParse({
      status: '全部成功', appliedProposalIds: ['proposal-1'], blockers: [{ proposalId: 'proposal-2', code: '提案已失效', message: 'x' }], committedRevision: 7
    })
    expect(partial.success).toBe(false)
    expect(MemoryProposalBatchResolveResultSchema.safeParse({ status: '全部回滚', appliedProposalIds: [], blockers: [{ proposalId: 'p', code: '提案已失效', message: 'x' }] }).success).toBe(true)
  })

  it('人工修订只创建待确认提案，不写入正式记忆', () => {
    const request = ManualMemoryRevisionRequestSchema.safeParse({
      currentRevision: 7, chapterId: 'chapter-1', category: '剧情事实', targetId: 'fact-3',
      baseTargetDigest: 'target-digest', sourceDigest: 'digest-a', candidate: { content: '修订后的正式值' }, reason: '作者手写修订'
    })
    expect(request.success).toBe(true)
    // 非章节摘要必须指明目标正式值，避免无依据新增。
    expect(ManualMemoryRevisionRequestSchema.safeParse({
      currentRevision: 7, chapterId: 'chapter-1', category: '剧情事实',
      baseTargetDigest: 'target-digest', sourceDigest: 'digest-a', candidate: {}, reason: 'x'
    }).success).toBe(false)
    // 理由为空不允许提交修订。
    expect(ManualMemoryRevisionRequestSchema.safeParse({
      currentRevision: 7, chapterId: 'chapter-1', category: '剧情事实', targetId: 'fact-3',
      baseTargetDigest: 'd', sourceDigest: 's', candidate: {}, reason: ''
    }).success).toBe(false)

    const result = ManualMemoryRevisionResultSchema.safeParse({ proposalId: 'proposal-9', status: '待确认', appliedToCanonical: false })
    expect(result.success).toBe(true)
    // 人工修订永远不可能直接写正式记忆。
    expect(ManualMemoryRevisionResultSchema.safeParse({ proposalId: 'proposal-9', status: '待确认', appliedToCanonical: true }).success).toBe(false)
  })
})
