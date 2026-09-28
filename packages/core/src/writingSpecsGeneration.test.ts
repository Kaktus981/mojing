import { describe, expect, it, vi } from 'vitest'
import { NovelDatabaseService } from './novelDatabase'
import { NovelGenerationService } from './novelGeneration'
import { makeNovel } from './novelTestFactory'
import type { ProviderService } from './ai/provider'

describe('从故事种子推断创作规格', () => {
  it('只产出待确认候选，并保留作者已有的创作限制', async () => {
    const database = new NovelDatabaseService(':memory:')
    const source = makeNovel(1)
    source.settings.contentLimits = '不要伤害儿童'
    const project = database.createProject(source)
    const proposed = {
      genreTemplate: '悬疑', targetWords: 180_000, plannedVolumes: 3, plannedChapters: 60,
      pointOfView: '第三人称限知', tense: '过去时', audience: '悬疑读者', style: '冷静克制',
      contentLimits: '', rhetoricIntensity: 1
    }
    const generate = vi.fn().mockResolvedValue(proposed)
    const service = new NovelGenerationService(database, { generate } as unknown as ProviderService)
    const result = await service.run(project.id, { kind: 'writing-specs', baseRevision: project.revision, qualityProfile: 'standard', acknowledgedDraftPlanning: false })
    const proposal = database.getRevision(result.proposalId!)
    expect(proposal).toMatchObject({ kind: 'writing-specs', target: 'settings', status: '待处理' })
    expect(proposal.candidate).toMatchObject({ genreTemplate: '悬疑', contentLimits: '不要伤害儿童' })
    expect(database.getProject(project.id).settings).toEqual(project.settings)
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ schemaName: 'mojing_writing_specs' })
    database.close()
  })
})
