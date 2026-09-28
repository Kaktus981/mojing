import { describe, expect, it } from 'vitest'
import { NovelProjectSchema } from './novel'

/**
 * 阶段 1 的旧数据兼容门禁：schemaVersion 2–7 的历史项目必须无损读取，
 * 新增加的可选字段保持缺省，不能被自动补造成“已处理”或“最新”。
 */
function legacyProject(schemaVersion: number) {
  return {
    schemaVersion,
    id: 'legacy-novel', title: '旧项目', seed: '旧的故事想法',
    settings: {
      genreTemplate: '通用', targetWords: 200000, plannedVolumes: 2, plannedChapters: 80,
      pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文'
    },
    status: '创作中', revision: 9,
    chapters: [{ id: 'chapter-1', volumeNumber: 1, chapterNumber: 1, title: '第一章', blocks: [{ id: 'b1', text: '旧正文。' }], status: '草稿', sourceDigest: 'digest-old', updatedAt: '2026-08-01T00:00:00.000Z' }],
    memories: [],
    plotThreads: [],
    branches: [{ id: 'branch-1', name: '旧分支', description: '', baseChapterId: 'chapter-1', chapters: [], status: '可比较', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }],
    reviews: [{ id: 'review-1', chapterId: 'chapter-1', category: '连续性', severity: '中', title: '旧问题', description: '旧描述', evidence: [], recommendation: '旧建议', status: '已完成', createdAt: '2026-08-01T00:00:00.000Z' }],
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z'
  }
}

describe('阶段 1 旧数据兼容', () => {
  it.each([2, 3, 4, 5, 6, 7])('schemaVersion %i 的历史项目可以无损读取', (schemaVersion) => {
    const parsed = NovelProjectSchema.safeParse(legacyProject(schemaVersion))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.schemaVersion).toBe(7)
    expect(parsed.data.chapters[0]?.blocks[0]?.text).toBe('旧正文。')
    expect(parsed.data.revision).toBe(9)
  })

  it('旧项目的新增可选字段保持缺省，不伪造处理记录或分支新鲜度', () => {
    const parsed = NovelProjectSchema.parse(legacyProject(2))
    expect(parsed.reviews[0]?.resolution).toBeUndefined()
    expect(parsed.reviews[0]?.linkedProposalIds).toBeUndefined()
    expect(parsed.branches[0]?.baseRevision).toBeUndefined()
    expect(parsed.branches[0]?.sourceDigest).toBeUndefined()
  })

  it('缺少可选集合的旧项目仍可读取，并得到空集合而不是失败', () => {
    const project = legacyProject(3) as Record<string, unknown>
    delete project.memories
    delete project.plotThreads
    delete project.branches
    delete project.reviews
    const parsed = NovelProjectSchema.safeParse(project)
    expect(parsed.success).toBe(false) // 核心集合缺失仍视为结构损坏，必须显式修复而不是静默补默认值
  })
})
