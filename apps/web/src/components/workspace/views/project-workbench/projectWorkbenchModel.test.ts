import { describe, expect, it } from 'vitest'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { buildProjectWorkbenchModel, workbenchCoverKind } from './projectWorkbenchModel'

const baseProject = (overrides: Partial<NovelProject> = {}): NovelProject => ({
  schemaVersion: 7,
  id: 'project-1',
  title: '雾中来客',
  seed: '一名巡夜人沿着没有尽头的山路寻找失踪的门。',
  status: '创作中',
  revision: 2,
  outline: { status: '草稿', synopsis: '一名巡夜人沿着没有尽头的山路寻找失踪的门。', themes: [], mainConflict: '', endingDirection: '', volumes: [], updatedAt: '2026-09-22T00:00:00.000Z' },
  settings: {
    genreTemplate: '通用', targetWords: 1000, plannedVolumes: 1, plannedChapters: 4,
    pointOfView: '第三人称限知', tense: '过去时', audience: '成年读者', style: '', contentLimits: '', language: '简体中文', rhetoricIntensity: 1
  },
  chapters: [{ id: 'ch-1', volumeNumber: 1, chapterNumber: 1, title: '第一章 山路', blocks: [{ id: 'b-1', text: '山路在雾里收拢。' }], status: '草稿', sourceDigest: '', updatedAt: '2026-09-22T00:00:00.000Z' }],
  memories: [], plotThreads: [], branches: [], reviews: [], worldConstraints: [], worldQualityFindings: [],
  createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
  ...overrides
})

describe('project workbench model', () => {
  it('uses the selected chapter and counts words with the shared prose rule', () => {
    const project = baseProject({ chapters: [
      { id: 'ch-1', volumeNumber: 1, chapterNumber: 1, title: '第一章', blocks: [{ id: 'b-1', text: '一 二' }], status: '草稿', sourceDigest: '', updatedAt: '2026-09-22T00:00:00.000Z' },
      { id: 'ch-2', volumeNumber: 1, chapterNumber: 2, title: '第二章', blocks: [{ id: 'b-2', text: '潮声继续。' }], status: '待审校', sourceDigest: '', updatedAt: '2026-09-22T00:00:00.000Z' }
    ] })
    const model = buildProjectWorkbenchModel(project, 'ch-1')
    expect(model.wordCount).toBe(7)
    expect(model.currentChapter?.id).toBe('ch-1')
    expect(model.currentChapterSource).toBe('已选章节')
    expect(model.primaryAction).toMatchObject({
      id: 'continue-writing',
      target: { stageId: 'writing', subnavId: 'prose-editor', focusId: 'ch-1' }
    })
    expect(model.indexActions.map((action) => action.id)).toEqual(['outline', 'world', 'planning'])
  })

  it('reports honest gaps and routes to real setup pages when the project is empty', () => {
    const project = baseProject({ seed: '', chapters: [], outline: undefined, worldBible: undefined })
    const model = buildProjectWorkbenchModel(project)
    expect(model.description).toBeUndefined()
    expect(model.missing).toEqual({ description: true, outline: true, world: true, currentChapter: true })
    expect(model.currentChapterSource).toBe('尚无章节')
    expect(model.primaryAction).toMatchObject({ id: 'outline', target: { stageId: 'idea', subnavId: 'story-seed' } })
    expect(model.indexActions.map((action) => action.id)).toEqual(['world'])
  })

  it('keeps cover direction aligned with the existing hall palette', () => {
    expect(workbenchCoverKind('悬疑')).toBe('harbor')
    expect(workbenchCoverKind('都市')).toBe('city')
    expect(workbenchCoverKind('通用')).toBe('mountain')
  })
})
