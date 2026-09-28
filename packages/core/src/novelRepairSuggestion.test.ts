import { describe, expect, it, vi } from 'vitest'
import type { ProviderService } from './ai/provider'
import { NovelDatabaseService } from './novelDatabase'
import { NovelGenerationService } from './novelGeneration'
import { makeNovel } from './novelTestFactory'
import { worldFieldDigest } from './worldQuality'

describe('世界观 AI 修改建议', () => {
  it('针对单个问题生成最小替换建议，但不直接修改候选', async () => {
    const database = new NovelDatabaseService(':memory:'), project = makeNovel(1)
    const candidate = structuredClone(project.worldBible)!
    candidate.historySummary = '近二十年来，异骨出生率下降。'
    database.createProject(project)
    database.saveRevision({
      id: 'proposal', projectId: project.id, kind: 'world-foundation', target: 'worldBible', baseRevision: 0,
      summary: '世界观候选', candidate, status: '待处理', createdAt: project.createdAt,
      qualityFindings: [{
        id: 'finding', type: '主语指代', severity: '高', confidence: 1, evidence: { fieldPath: '/historySummary', excerpt: '异骨出生率' },
        constraintIds: [], explanation: '异骨不会自行出生。', baseFieldDigest: worldFieldDigest(candidate.historySummary), status: '待处理', source: '本地规则', createdAt: project.createdAt,
        alternativeSuggestions: []
      }]
    })
    const provider = { generate: vi.fn().mockResolvedValue({ replacement: '具异骨的新生灵比例', reason: '补全真正承担出生比例的主体。', alternatives: ['天生异骨者的出生比例'], requiresAuthorDecision: false }) } as unknown as ProviderService
    const service = new NovelGenerationService(database, provider)

    await service.run(project.id, { kind: 'world-repair-suggestion', proposalId: 'proposal', findingId: 'finding', baseRevision: 0, qualityProfile: 'standard', acknowledgedDraftPlanning: false })

    const saved = database.getRevision('proposal')
    expect(saved.qualityFindings?.[0]).toMatchObject({ suggestedReplacement: '具异骨的新生灵比例', suggestionType: '可直接应用', aiSuggestionReason: '补全真正承担出生比例的主体。' })
    expect((saved.candidate as typeof candidate).historySummary).toBe('近二十年来，异骨出生率下降。')
    database.close()
  })
})
