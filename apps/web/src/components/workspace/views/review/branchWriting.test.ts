import { describe, expect, it } from 'vitest'
import { NovelProjectSchema } from '../../../../../../../packages/contracts/src'
import { applyArchiveStoryBranch, applyCreateStoryBranch } from './branchWriting'

describe('剧情分支的作者操作', () => {
  it('只能从真实章节创建，空分支不能直接采用，归档保留正文与来源', () => {
    const now = new Date().toISOString()
    const project = NovelProjectSchema.parse({
      schemaVersion: 7, id: 'project', title: '古钟', seed: '古钟改变旧城', status: '创作中', revision: 0,
      settings: { genreTemplate: '悬疑', targetWords: 100_000, plannedVolumes: 1, plannedChapters: 30, pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', rhetoricIntensity: 1 },
      chapters: [{ id: 'chapter-1', volumeNumber: 1, chapterNumber: 1, title: '第一章', blocks: [{ id: 'block-1', text: '古钟响了。' }], status: '草稿', sourceDigest: 'digest-1', updatedAt: now }],
      memories: [], plotThreads: [], branches: [], reviews: [], createdAt: now, updatedAt: now
    })
    const original = structuredClone(project)
    expect(applyCreateStoryBranch(project, { id: 'bad', name: '无来源', baseChapterId: 'missing', now }).ok).toBe(false)
    expect(project).toEqual(original)
    expect(applyCreateStoryBranch(project, { id: 'alternate', name: '钟声另一种走向', baseChapterId: project.chapters[0]!.id, now }).ok).toBe(true)
    expect(NovelProjectSchema.safeParse(project).success).toBe(true)
    expect(project.branches[0]).toMatchObject({ id: 'alternate', sourceDigest: project.chapters[0]!.sourceDigest, chapters: [], status: '构思中' })
    project.branches[0]!.chapters.push(structuredClone(project.chapters[0]!))
    expect(applyArchiveStoryBranch(project, 'alternate', now).ok).toBe(true)
    expect(project.branches[0]).toMatchObject({ status: '已归档', sourceDigest: project.chapters[0]!.sourceDigest })
    expect(project.branches[0]!.chapters).toHaveLength(1)
  })
})
