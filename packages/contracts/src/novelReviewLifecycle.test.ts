import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, ReviewItemSchema, ReviewResolutionSchema, reviewResolutionState, type ReviewItem } from './novel'
import { NovelRevisionProposalSchema } from './novelApi'

const now = '2026-09-13T00:00:00.000Z'

function reviewItem(overrides: Partial<ReviewItem> = {}): Record<string, unknown> {
  return {
    id: 'review-1', chapterId: 'chapter-1', category: '连续性', severity: '高',
    title: '第 3 章时间线冲突', description: '主角同一天出现在两地。',
    evidence: [{ chapterId: 'chapter-1', excerpt: '他清晨抵达北境。' }],
    recommendation: '统一交通时长。', status: '待处理', createdAt: now,
    ...overrides
  }
}

describe('阶段 1.1 审稿问题生命周期契约', () => {
  it('审稿问题可以记录处理方式、处理理由、处理时间与关联候选', () => {
    const parsed = ReviewItemSchema.parse(reviewItem({
      status: '已完成',
      resolution: {
        method: '候选已应用并复核', reason: '已按候选统一交通时长，并核对第 4 章。',
        resolvedAt: now, proposalIds: ['proposal-9'], evidence: [{ chapterId: 'chapter-1', excerpt: '他在第三日清晨抵达北境。' }]
      },
      linkedProposalIds: ['proposal-9']
    }))
    expect(parsed.resolution).toMatchObject({ method: '候选已应用并复核', proposalIds: ['proposal-9'] })
    expect(parsed.linkedProposalIds).toEqual(['proposal-9'])
    expect(reviewResolutionState(parsed)).toBe('已记录')
  })

  it('忽略必须填写处理理由，缺少理由时契约拒绝', () => {
    const missingReason = ReviewResolutionSchema.safeParse({ method: '风险已知仍忽略', resolvedAt: now })
    expect(missingReason.success).toBe(false)
    const withReason = ReviewResolutionSchema.safeParse({ method: '风险已知仍忽略', reason: '该冲突是刻意伏笔。', resolvedAt: now })
    expect(withReason.success).toBe(true)
  })

  it('声明“正文已手动修复”时必须关联新的正文证据', () => {
    expect(ReviewResolutionSchema.safeParse({ method: '正文已手动修复', reason: '已改。', resolvedAt: now }).success).toBe(false)
    expect(ReviewResolutionSchema.safeParse({
      method: '正文已手动修复', reason: '已改。', resolvedAt: now,
      evidence: [{ chapterId: 'chapter-1', excerpt: '他在第三日清晨抵达北境。' }]
    }).success).toBe(true)
  })

  it('旧问题缺少处理记录时标记为缺少记录，不伪造已完成', () => {
    const legacy = ReviewItemSchema.parse(reviewItem({ status: '已完成' }))
    expect(legacy.resolution).toBeUndefined()
    expect(legacy.linkedProposalIds).toBeUndefined()
    expect(reviewResolutionState(legacy)).toBe('缺少处理记录')
    expect(reviewResolutionState(ReviewItemSchema.parse(reviewItem()))).toBe('待处理')
  })

  it('旧项目整体读取时不因缺少处理记录而失败', () => {
    const project = NovelProjectSchema.safeParse({
      schemaVersion: 2, id: 'novel', title: '原创小说', seed: '一个原创故事',
      settings: { genreTemplate: '通用', targetWords: 300000, plannedVolumes: 3, plannedChapters: 120, pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文' },
      status: '待规划', revision: 0, chapters: [], memories: [], plotThreads: [], branches: [],
      reviews: [reviewItem({ status: '已忽略' })], createdAt: now, updatedAt: now
    })
    expect(project.success).toBe(true)
    expect(project.success && project.data.reviews[0]?.resolution).toBeUndefined()
  })

  it('修改候选携带稳定 reviewId，应用候选不等于问题完成', () => {
    const proposal = NovelRevisionProposalSchema.parse({
      id: 'proposal-9', projectId: 'novel', kind: 'chapter-revision', target: 'chapter', targetId: 'chapter-1',
      baseRevision: 4, summary: '统一交通时长', candidate: { blocks: [] }, status: '待处理', createdAt: now, reviewId: 'review-1'
    })
    expect(proposal.reviewId).toBe('review-1')
    const notLinked = NovelRevisionProposalSchema.parse({
      id: 'proposal-10', projectId: 'novel', kind: 'chapter', target: 'chapter', targetId: 'chapter-2',
      baseRevision: 4, summary: '普通续写', candidate: {}, status: '待处理', createdAt: now
    })
    expect(notLinked.reviewId).toBeUndefined()
    // 候选已应用后，问题仍保持待处理：状态只能由作者的操作改变。
    const applied = ReviewItemSchema.parse(reviewItem({ status: '待处理', linkedProposalIds: ['proposal-9'] }))
    expect(applied.status).toBe('待处理')
    expect(reviewResolutionState(applied)).toBe('待处理')
  })
})
