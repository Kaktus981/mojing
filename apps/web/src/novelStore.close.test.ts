import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NovelProject, NovelVersionSummary } from '../../../packages/contracts/src'

vi.stubGlobal('window', { location: { hash: '' }, confirm: () => true })
const { useNovelStore } = await import('./novelStore')

const project: NovelProject = {
  schemaVersion: 7, id: 'safe-close', title: '保留内存稿', seed: '测试', status: '待规划', revision: 2,
  settings: { genreTemplate: '通用', targetWords: 100000, plannedVolumes: 1, plannedChapters: 10, pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文', rhetoricIntensity: 1 },
  chapters: [], memories: [], plotThreads: [], branches: [], reviews: [], worldConstraints: [], worldQualityFindings: [], createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z'
}
const version: NovelVersionSummary = { id: 'version-a', projectId: project.id, revision: 1, reason: '保留', source: '手动检查点', createdAt: project.createdAt }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useNovelStore.setState({ project: structuredClone(project), versions: [version], saveState: '未保存', saveError: undefined, selectedChapterId: 'chapter-a', error: undefined, activeJobId: undefined })
})
afterEach(() => vi.unstubAllGlobals())

it('M3 failed save aborts close without clearing project or auxiliary state', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: '隔离保存失败' }), { status: 500 }))
  await useNovelStore.getState().closeProject()
  expect(useNovelStore.getState().project).toEqual(project)
  expect(useNovelStore.getState().versions).toEqual([version])
  expect(useNovelStore.getState().selectedChapterId).toBe('chapter-a')
  // 保存失败是独立状态，并把错误留在 saveError 里，供「重试保存」与提示使用。
  expect(useNovelStore.getState().saveState).toBe('保存失败')
  expect(useNovelStore.getState().saveError).toBeTruthy()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('M3 successful save closes and clears project-specific auxiliaries', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(project))).mockResolvedValueOnce(new Response('[]'))
  await useNovelStore.getState().closeProject()
  expect(useNovelStore.getState().project).toBeUndefined()
  expect(useNovelStore.getState().versions).toEqual([])
  expect(useNovelStore.getState().selectedChapterId).toBeUndefined()
  expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['PUT', 'GET'])
})
