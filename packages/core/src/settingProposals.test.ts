import { describe, expect, it } from 'vitest'
import type { CreateWorldExpansion, NovelProject } from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import {
  adoptSettingProposal, createSettingProposal, findSimilarEntries,
  hasIgnoredSameEvidence, rejectSettingProposal, updateSettingProposal
} from './settingProposals'

function entry(name: string, id = `entry-${name}`) {
  return {
    id, type: '地点' as const, name, aliases: [], tags: [], summary: `${name}的说明`, notes: '',
    locked: false, aiVisibility: '按需召回' as const, relations: [], customFields: {},
    details: { fields: {}, lists: {} }
  }
}

function setup() {
  const database = new NovelDatabaseService(':memory:')
  const project = structuredClone(makeNovel(1)) as NovelProject
  database.createProject(project)
  return { database, project }
}

const raw = (name: string, overrides: Partial<CreateWorldExpansion> = {}): CreateWorldExpansion => ({
  title: `新增设定：${name}`, reason: '正文里出现了新地点',
  proposedEntries: [entry(name)],
  sourceChapterIds: [], plannedChapterNumbers: [], transitionPlan: [],
  evidence: { chapterId: 'chapter-1', chapterNumber: 1, excerpt: '林砚走进潮汐港', inferred: false },
  ...overrides
})

describe('设定提案（D6）', () => {
  it('建提案只落候选，正式世界观一个字都不变', () => {
    const { database, project } = setup()
    const before = JSON.stringify(project.worldBible?.entries.map((item) => item.name))
    const { proposal } = createSettingProposal({ database, project, raw: raw('潮汐港') })
    expect(proposal.status).toBe('待确认')
    const after = database.getProject(project.id)
    expect(JSON.stringify(after.worldBible?.entries.map((item) => item.name))).toBe(before)
    expect(after.worldExpansionProposals?.length).toBe(1)
    database.close()
  })

  it('来源与证据被如实记录，没有原文依据时必须标为推测', () => {
    const { database, project } = setup()
    const ai = createSettingProposal({ database, project, raw: raw('潮汐港', { source: 'AI 建议' }) }).proposal
    expect(ai.source).toBe('AI 建议')
    expect(ai.evidence?.excerpt).toBe('林砚走进潮汐港')
    expect(ai.evidence?.inferred).toBe(false)

    const inferred = createSettingProposal({
      database, project: database.getProject(project.id),
      raw: raw('雾巷', { source: '手动暂存', evidence: { excerpt: '作者猜测这里有雾巷', inferred: true } })
    }).proposal
    expect(inferred.source).toBe('手动暂存')
    expect(inferred.evidence?.inferred, '没有原文依据必须标为推测').toBe(true)
    database.close()
  })

  it('同名与别名相同只提示，不自动合并', () => {
    const { database, project } = setup()
    const withAlias = structuredClone(database.getProject(project.id))
    withAlias.worldBible!.entries.push({ ...entry('旧港'), aliases: ['潮汐港'] })
    database.saveProject(withAlias, withAlias.revision, '手动编辑', '用户编辑')

    const similar = findSimilarEntries(database.getProject(project.id), raw('潮汐港'))
    expect(similar.some((item) => item.reason === '别名相同' && item.name === '旧港')).toBe(true)
    // 提示归提示，正式条目没有被改。
    expect(database.getProject(project.id).worldBible!.entries.find((item) => item.name === '旧港')?.summary).toBe('旧港的说明')
    database.close()
  })

  it('锁定条目不能被提案覆盖，必须先显式解锁', () => {
    const { database, project } = setup()
    const locked = structuredClone(database.getProject(project.id))
    locked.worldBible!.entries.push({ ...entry('古钟'), locked: true })
    database.saveProject(locked, locked.revision, '手动编辑', '用户编辑')

    const created = createSettingProposal({
      database, project: database.getProject(project.id),
      raw: raw('古钟', { source: 'AI 建议' })
    })
    const similar = findSimilarEntries(database.getProject(project.id), raw('古钟'))
    expect(similar.some((item) => item.locked)).toBe(true)
    expect(() => adoptSettingProposal({ database, project: database.getProject(project.id), proposalId: created.proposal.id }))
      .toThrowError(/已经锁定/)
    expect(database.getProject(project.id).worldBible!.entries.find((item) => item.name === '古钟')?.summary).toBe('古钟的说明')
    database.close()
  })

  it('采用后写入世界观并留版本；忽略后提案关闭且世界观不变', () => {
    const { database, project } = setup()
    const created = createSettingProposal({ database, project, raw: raw('潮汐港') })
    const versionsBefore = database.listVersions(project.id).length

    const adopted = adoptSettingProposal({ database, project: database.getProject(project.id), proposalId: created.proposal.id })
    expect(adopted.worldBible!.entries.some((item) => item.name === '潮汐港')).toBe(true)
    expect(database.listVersions(project.id).length).toBeGreaterThan(versionsBefore)

    const second = createSettingProposal({ database, project: database.getProject(project.id), raw: raw('雾巷') })
    const beforeNames = database.getProject(project.id).worldBible!.entries.map((item) => item.name)
    rejectSettingProposal({ database, project: database.getProject(project.id), proposalId: second.proposal.id })
    expect(database.getProject(project.id).worldBible!.entries.map((item) => item.name)).toEqual(beforeNames)
    expect(hasIgnoredSameEvidence(database.getProject(project.id), raw('雾巷'))).toBe(true)
    database.close()
  })

  it('旧来源的提案在项目变化后不能采用', () => {
    const { database, project } = setup()
    const created = createSettingProposal({ database, project, raw: raw('潮汐港') })
    const current = database.getProject(project.id)
    database.saveProject({ ...current, seed: `${current.seed} 又改了` }, current.revision, '手动编辑', '用户编辑')
    expect(() => adoptSettingProposal({ database, project: database.getProject(project.id), proposalId: created.proposal.id }))
      .toThrowError(/已经变化|已失效/)
    database.close()
  })

  it('提案可以改，改完仍只是候选', () => {
    const { database, project } = setup()
    const created = createSettingProposal({ database, project, raw: raw('潮汐港') })
    const updated = updateSettingProposal({
      database, project: database.getProject(project.id), proposalId: created.proposal.id,
      patch: { title: '改成另一个标题', proposedEntries: [entry('潮汐港', 'entry-潮汐港')] }
    })
    expect(updated.title).toBe('改成另一个标题')
    expect(database.getProject(project.id).worldBible!.entries.some((item) => item.name === '潮汐港')).toBe(false)
    database.close()
  })
})
