import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NovelProject, NovelVersionSummary } from '../../../packages/contracts/src'

const confirm = vi.fn<(message?: string) => boolean>()
vi.stubGlobal('window', { location: { hash: '' }, confirm })
const { useNovelStore } = await import('./novelStore')

describe('小说版本历史删除', () => {
  const first: NovelVersionSummary = { id: 'version-1', projectId: 'novel-test', revision: 1, reason: '准备删除', source: '手动检查点', createdAt: '2026-08-25T00:00:00.000Z' }
  const second: NovelVersionSummary = { id: 'version-2', projectId: 'novel-test', revision: 2, reason: '保留版本', source: '手动检查点', createdAt: '2026-08-25T00:01:00.000Z' }

  beforeEach(() => {
    confirm.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { hash: '' }, confirm })
    vi.stubGlobal('fetch', vi.fn())
    const project = makeProject()
    useNovelStore.setState({ project, versions: [first, second], notice: undefined, error: undefined })
  })

  it('用户取消时不发出删除请求，也不移除本地版本', async () => {
    confirm.mockReturnValue(false)

    await useNovelStore.getState().removeVersion(first.id)

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('当前小说内容不会受到影响'))
    expect(fetch).not.toHaveBeenCalled()
    expect(useNovelStore.getState().versions).toEqual([first, second])
  })

  it('确认后删除指定快照，保留其他快照与当前小说内容', async () => {
    confirm.mockReturnValue(true)
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const projectBeforeDelete = structuredClone(useNovelStore.getState().project)

    await useNovelStore.getState().removeVersion(first.id)

    expect(fetch).toHaveBeenCalledWith('http://localhost:8787/api/novels/novel-test/versions/version-1', expect.objectContaining({ method: 'DELETE' }))
    expect(useNovelStore.getState().versions).toEqual([second])
    expect(useNovelStore.getState().project).toEqual(projectBeforeDelete)
    expect(useNovelStore.getState().notice).toBe('版本快照已删除；当前小说内容未受影响。')
  })
})

describe('受控恢复（M8）：必须先预览、摘要绑定、未保存先处理', () => {
  const target: NovelVersionSummary = { id: 'version-9', projectId: 'novel-test', revision: 1, reason: '恢复目标', source: '手动检查点', createdAt: '2026-08-25T00:02:00.000Z' }
  const preview = {
    projectId: 'novel-test', versionId: 'version-9', targetRevision: 1, currentRevision: 4,
    previewDigest: 'digest-abc', createdAt: '2026-09-14T10:00:00.000Z', diffs: []
  }

  beforeEach(() => {
    confirm.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { hash: '' }, confirm })
    vi.stubGlobal('fetch', vi.fn())
    useNovelStore.setState({
      project: { ...makeProject(), revision: 4 }, versions: [target], saveState: '已保存',
      restorePreview: undefined, notice: undefined, error: undefined
    })
  })

  it('未保存的修改先自动保存；保存失败就不恢复，并说明原因', async () => {
    useNovelStore.setState({ saveState: '未保存', restorePreview: preview })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: 'X', message: '写盘失败' } }), {
      status: 500, headers: { 'content-type': 'application/json' }
    }))

    await useNovelStore.getState().restoreVersion(target.id)

    const calls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(calls.some((url) => url.includes('/restore')), '保存失败时不得发出恢复请求').toBe(false)
    expect(useNovelStore.getState().error).toContain('取消恢复')
  })

  it('没有差异预览时不发恢复请求，要求先预览', async () => {
    await useNovelStore.getState().restoreVersion(target.id)

    expect(fetch, '没有预览就不该发请求').not.toHaveBeenCalled()
    expect(useNovelStore.getState().error).toContain('差异预览')
  })

  it('预览绑定的是别的版本时拒绝恢复', async () => {
    useNovelStore.setState({ restorePreview: { ...preview, versionId: 'version-other' } })

    await useNovelStore.getState().restoreVersion(target.id)

    expect(fetch).not.toHaveBeenCalled()
    expect(useNovelStore.getState().error).toContain('差异预览')
  })

  it('当前稿在预览之后变化过时拒绝恢复，要求重新预览', async () => {
    useNovelStore.setState({ restorePreview: { ...preview, currentRevision: 2 } })

    await useNovelStore.getState().restoreVersion(target.id)

    expect(fetch).not.toHaveBeenCalled()
    expect(useNovelStore.getState().error).toContain('重新预览')
  })

  it('预览有效时提交 currentRevision 与 previewDigest，并在成功后清掉预览', async () => {
    useNovelStore.setState({ restorePreview: preview })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(makeProject()), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))

    await useNovelStore.getState().restoreVersion(target.id)

    const call = vi.mocked(fetch).mock.calls.map((item) => ({ url: String(item[0]), init: item[1] as RequestInit }))
      .find((item) => item.url.includes('/restore'))!
    expect(call.url).toBe('http://localhost:8787/api/novels/novel-test/versions/version-9/restore')
    expect(JSON.parse(String(call.init.body))).toEqual({ currentRevision: 4, previewDigest: 'digest-abc' })
    expect(useNovelStore.getState().restorePreview, '恢复成功后预览作废').toBeUndefined()
  })

  it('预览本身只调用只读的 restore-preview 端点', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(preview), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))

    const result = await useNovelStore.getState().previewVersionRestore(target.id)

    expect(result).toEqual(preview)
    const url = String(vi.mocked(fetch).mock.calls[0]![0])
    expect(url).toContain('/versions/version-9/restore-preview')
    expect(useNovelStore.getState().restorePreview).toEqual(preview)
  })
})

function makeProject(): NovelProject {
  const now = '2026-08-25T00:00:00.000Z'
  return {
    schemaVersion: 7, id: 'novel-test', title: '版本删除测试', seed: '测试故事', status: '待规划', revision: 2,
    settings: { genreTemplate: '通用', targetWords: 100_000, plannedVolumes: 1, plannedChapters: 10, pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '', language: '简体中文', rhetoricIntensity: 1 },
    chapters: [], memories: [], plotThreads: [], branches: [], reviews: [], worldConstraints: [], worldQualityFindings: [], createdAt: now, updatedAt: now
  }
}

type TestChapter = NovelProject['chapters'][number]

function makeChapter(id: string, chapterNumber: number): TestChapter {
  return { id, volumeNumber: 1, chapterNumber, title: `第${chapterNumber}章`, blocks: [{ id: `${id}-b1`, text: '' }], status: '草稿', sourceDigest: '', updatedAt: '2026-08-25T00:00:00.000Z' }
}

/**
 * 打开项目时会打一批只读接口（项目本体 + 辅助数据）。这里按 URL 返回宽松但形状正确的响应：
 * 列表接口一律空数组、memory-health 空对象，只有项目本体返回真实数据。
 */
function mockMojingFetch(project: NovelProject): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input)
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('/revision-proposals') || url.includes('/memory-proposals') || url.includes('/versions') || url.includes('/generation-jobs') || url.includes('/mentions')) return json([])
    if (url.includes('/memory-health')) return json({})
    if (/\/api\/novels\/[^/]+$/.test(url)) return json(project)
    return json([])
  })
}

describe('返回保持项目/章节选择（M9）', () => {
  const first = makeChapter('m9-ch-1', 1)
  const second = makeChapter('m9-ch-2', 2)
  const project: NovelProject = { ...makeProject(), id: 'novel-m9', title: '返回保持测试', chapters: [first, second] }

  beforeEach(() => {
    confirm.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { hash: '' }, confirm })
    vi.stubGlobal('fetch', vi.fn())
    // saveState 已保存 → closeProject 里的 persistNow 不会真的写盘而提前 return。
    useNovelStore.setState({ project, saveState: '已保存', selectedChapterId: undefined, stage: 'idea', restoredTarget: undefined, notice: undefined, error: undefined })
  })

  it('返回同一项目时回到上次选中的章、栏目与二级页', async () => {
    useNovelStore.getState().selectChapter(second.id)
    useNovelStore.getState().rememberWorkspaceTarget({ stage: 'memory', subnavId: 'memory-proposals' })
    mockMojingFetch(project)

    await useNovelStore.getState().closeProject()
    await useNovelStore.getState().openProject(project.id)

    expect(useNovelStore.getState().selectedChapterId).toBe(second.id)
    expect(useNovelStore.getState().stage).toBe('memory')
    expect(useNovelStore.getState().restoredTarget).toEqual({ stage: 'memory', subnavId: 'memory-proposals' })
  })

  it('记住的章节已被删除时回落到第一章，并保留记住的栏目', async () => {
    const changed: NovelProject = { ...project, id: 'novel-m9-gone' }
    useNovelStore.setState({ project: changed, saveState: '已保存' })
    useNovelStore.getState().selectChapter('m9-ch-deleted')
    useNovelStore.getState().rememberWorkspaceTarget({ stage: 'memory', subnavId: 'memory-proposals' })
    mockMojingFetch(changed)

    await useNovelStore.getState().closeProject()
    await useNovelStore.getState().openProject(changed.id)

    expect(useNovelStore.getState().selectedChapterId).toBe(first.id)
    expect(useNovelStore.getState().stage).toBe('memory')
    expect(useNovelStore.getState().restoredTarget).toEqual({ stage: 'memory', subnavId: 'memory-proposals' })
  })

  it('记住的栏目是 writing 但对应章已不存在时，不硬套正文栏目，退回按数据推算的结果', async () => {
    // 这个项目没有任何正文：按数据推算应落到 idea，而不是记住的 writing。
    const empty: NovelProject = { ...makeProject(), id: 'novel-m9-empty', chapters: [] }
    useNovelStore.setState({ project: empty, saveState: '已保存' })
    useNovelStore.getState().selectChapter('m9-ch-deleted')
    useNovelStore.getState().rememberWorkspaceTarget({ stage: 'writing', subnavId: 'prose-editor' })
    mockMojingFetch(empty)

    await useNovelStore.getState().closeProject()
    await useNovelStore.getState().openProject(empty.id)

    const state = useNovelStore.getState()
    expect(state.selectedChapterId).toBeUndefined()
    expect(state.selectedChapterId).toBe(empty.chapters[0]?.id)
    expect(state.stage, '记住的 writing 依赖已删除的章，必须退回按数据推算的栏目').not.toBe('writing')
    expect(state.stage).toBe('idea')
    expect(state.restoredTarget).toBeUndefined()
  })
})

describe('保存失败独立态（P3 第二阶段）', () => {
  /** 造一个「作者已经输入过内容」的项目，失败后必须原样保留。 */
  function makeDirtyProject(): NovelProject {
    const chapter = makeChapter('ch-p3-1', 1)
    return { ...makeProject(), chapters: [{ ...chapter, blocks: [{ id: 'blk-p3-1', text: '作者尚未保存的输入' }] }] }
  }

  beforeEach(() => {
    confirm.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { hash: '' }, confirm })
    vi.stubGlobal('fetch', vi.fn())
    useNovelStore.setState({
      project: makeDirtyProject(),
      saveState: '未保存',
      saveError: undefined,
      error: undefined,
      notice: undefined
    })
  })

  it('保存失败落到独立的「保存失败」状态并写入 saveError，且保留作者已输入的内容', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('无法连接保存服务'))

    const saved = await useNovelStore.getState().persistNow()

    const state = useNovelStore.getState()
    expect(saved).toBeUndefined()
    expect(state.saveState).toBe('保存失败')
    expect(state.saveError).toContain('无法连接保存服务')
    expect(state.project?.chapters[0]?.blocks[0]?.text, '保存失败不得清空作者的输入').toBe('作者尚未保存的输入')
  })

  it('重试成功后回到已保存并清空 saveError', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('第一次保存失败'))
    expect(await useNovelStore.getState().persistNow()).toBeUndefined()
    expect(useNovelStore.getState().saveState).toBe('保存失败')

    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(makeProject()), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))
    const saved = await useNovelStore.getState().persistNow()

    const state = useNovelStore.getState()
    expect(saved).toBeDefined()
    expect(state.saveState).toBe('已保存')
    expect(state.saveError, '重试成功后必须清空 saveError').toBeUndefined()
    expect(state.error, '恢复后不应继续显示同一次保存失败').toBeUndefined()
  })

  it('独立关闭错误不清空提示、保存错误或草稿；提示关闭也不清空错误', () => {
    const project = useNovelStore.getState().project
    useNovelStore.setState({ error: '保存断网', notice: '导入成功', saveError: '保存断网', saveState: '保存失败' })
    useNovelStore.getState().dismiss('error')
    expect(useNovelStore.getState()).toMatchObject({ error: undefined, notice: '导入成功', saveError: '保存断网', saveState: '保存失败', project })
    useNovelStore.setState({ error: '其他错误' })
    useNovelStore.getState().dismiss('notice')
    expect(useNovelStore.getState()).toMatchObject({ error: '其他错误', notice: undefined, saveError: '保存断网', saveState: '保存失败', project })
  })

  it('保存重试成功保留同时发生的其他全局错误', async () => {
    useNovelStore.setState({ saveState: '保存失败', saveError: '保存断网', error: '其他操作失败' })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(makeProject()), { status: 200 }))
    await useNovelStore.getState().persistNow()
    expect(useNovelStore.getState()).toMatchObject({ saveState: '已保存', saveError: undefined, error: '其他操作失败' })
  })

  it('与保存无关的全局 error 不会污染 saveError，也不会把保存态改成失败', async () => {
    useNovelStore.setState({ saveState: '已保存', saveError: undefined, error: undefined })
    vi.mocked(fetch).mockRejectedValue(new Error('项目列表读取失败'))

    await useNovelStore.getState().initialize()

    const state = useNovelStore.getState()
    expect(state.summariesError).toContain('项目列表读取失败')
    expect(state.saveError, '全局 error 不得被当成保存错误').toBeUndefined()
    expect(state.saveState).toBe('已保存')
  })
})

describe('大厅列表读取状态', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  it('读取期间重复重试不发出第二个请求', async () => {
    useNovelStore.setState({ summariesState: 'idle' })
    let resolve!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    const first = useNovelStore.getState().initialize()
    await useNovelStore.getState().initialize()
    expect(fetch).toHaveBeenCalledTimes(1)
    resolve(new Response('[]', { status: 200 }))
    await first
    expect(useNovelStore.getState().summariesState).toBe('ready')
  })
  it('刷新失败保留已有列表，重试成功清除局部错误且不影响保存错误', async () => {
    const summaries = [{ id: 'existing', title: '已有小说' }] as import('../../../packages/contracts/src').NovelProjectSummary[]
    useNovelStore.setState({ summaries, summariesState: 'ready', saveError: '保存错误', error: '其他错误' })
    vi.mocked(fetch).mockRejectedValueOnce(new Error('读取失败'))
    const pending = useNovelStore.getState().initialize()
    expect(useNovelStore.getState().summariesState).toBe('loading')
    await pending
    expect(useNovelStore.getState()).toMatchObject({ summaries, summariesState: 'error', summariesError: '读取失败', saveError: '保存错误', error: '其他错误' })
    vi.mocked(fetch).mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await useNovelStore.getState().initialize()
    expect(useNovelStore.getState()).toMatchObject({ summaries: [], summariesState: 'ready', summariesError: undefined, saveError: '保存错误' })
  })
})

describe('大厅变更后的列表刷新一致性', () => {
  const created = { ...makeProject(), id: 'created-after-refresh-failure', title: '刷新失败后仍保留', seed: '城门每天少一块砖。' }

  beforeEach(() => {
    confirm.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal('window', { location: { hash: '' }, confirm })
    vi.stubGlobal('fetch', vi.fn())
    useNovelStore.setState({
      project: undefined, summaries: [], summariesState: 'ready', summariesError: undefined,
      hallCreateError: undefined, hallDeleteError: undefined, hallActionError: undefined,
      hallFeedback: undefined, notice: undefined, error: undefined
    })
  })

  it('创建成功但列表刷新失败时保留项目并标记局部刷新错误', async () => {
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(created), { status: 201, headers: { 'content-type': 'application/json' } })
      throw new Error('列表刷新失败')
    })

    await useNovelStore.getState().createProject({ title: created.title, seed: created.seed, settings: created.settings })

    expect(useNovelStore.getState()).toMatchObject({ project: created, summariesState: 'error', summariesError: '列表刷新失败', summariesErrorKind: 'refresh', hallFeedback: '小说项目已创建。', notice: expect.stringContaining('已创建') })
    expect(useNovelStore.getState().summaries.some((item) => item.id === created.id)).toBe(true)
  })

  it('创建服务端失败时保留弹窗内联错误，网络错误使用可执行文案', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await useNovelStore.getState().createProject({ title: created.title, seed: created.seed, settings: created.settings })

    expect(useNovelStore.getState()).toMatchObject({
      hallCreateError: '无法连接本机服务，请检查服务状态后重试创建。',
      error: '无法连接本机服务，请检查服务状态后重试创建。'
    })
  })

  it('创建失败后重试成功会清除同一次失败的局部与全局错误', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }))

    const input = { title: created.title, seed: created.seed, settings: created.settings }
    await useNovelStore.getState().createProject(input)
    await useNovelStore.getState().createProject(input)

    expect(useNovelStore.getState()).toMatchObject({ hallCreateError: undefined, error: undefined })
  })

  it('导入成功但列表刷新失败时保留项目并标记局部刷新错误', async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/novels/import') && init?.method === 'POST') return new Response(JSON.stringify(created), { status: 201, headers: { 'content-type': 'application/json' } })
      throw new Error('导入后的列表刷新失败')
    })

    await useNovelStore.getState().importProject(new File(['正文'], 'refresh-failure.txt', { type: 'text/plain' }))

    expect(useNovelStore.getState()).toMatchObject({ project: created, summariesState: 'error', summariesError: '导入后的列表刷新失败', summariesErrorKind: 'refresh', hallFeedback: expect.stringContaining('已导入'), notice: expect.stringContaining('已导入') })
    expect(useNovelStore.getState().summaries.some((item) => item.id === created.id)).toBe(true)
  })

  it('导入服务端失败时保留大厅内联错误，网络错误使用可执行文案', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await useNovelStore.getState().importProject(new File(['正文'], 'network.txt', { type: 'text/plain' }))

    expect(useNovelStore.getState()).toMatchObject({
      hallImportError: '无法连接本机服务，请检查服务状态后重新导入。',
      error: '无法连接本机服务，请检查服务状态后重新导入。'
    })
    useNovelStore.getState().dismiss('hallImportError')
    expect(useNovelStore.getState()).toMatchObject({ hallImportError: undefined, error: undefined })
  })

  it('删除确认显示项目名，取消时不发出删除请求', async () => {
    confirm.mockReturnValue(false)
    useNovelStore.setState({ summaries: [{ id: created.id, title: created.title } as import('../../../packages/contracts/src').NovelProjectSummary] })

    await useNovelStore.getState().removeProject(created.id)

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(created.title))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('删除请求失败时保留项目并提供可关闭的大厅删除错误', async () => {
    useNovelStore.setState({ summaries: [{ id: created.id, title: created.title } as import('../../../packages/contracts/src').NovelProjectSummary] })
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const succeeded = await useNovelStore.getState().removeProject(created.id, created.title, true)

    expect(succeeded).toBe(false)
    expect(useNovelStore.getState()).toMatchObject({
      hallDeleteError: '无法连接本机服务，请检查服务状态后重试删除。',
      error: '无法连接本机服务，请检查服务状态后重试删除。'
    })
    expect(useNovelStore.getState().summaries.some((item) => item.id === created.id)).toBe(true)
    useNovelStore.getState().dismiss('hallDeleteError')
    expect(useNovelStore.getState()).toMatchObject({ hallDeleteError: undefined, error: undefined })
  })

  it('归档成功但列表刷新失败时保留本地归档结果并允许重试同步', async () => {
    const archived = { ...created, archived: true, archivedAt: '2026-09-22T00:00:00.000Z' }
    useNovelStore.setState({ summaries: [{ id: created.id, title: created.title, archived: false } as import('../../../packages/contracts/src').NovelProjectSummary] })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith(`/api/novels/${created.id}/archive`) && init?.method === 'PUT') return new Response(JSON.stringify(archived), { status: 200, headers: { 'content-type': 'application/json' } })
      throw new Error('归档后的列表刷新失败')
    })

    const succeeded = await useNovelStore.getState().archiveProject(created.id, true)

    expect(succeeded).toBe(true)
    expect(useNovelStore.getState()).toMatchObject({ summariesState: 'error', summariesErrorKind: 'refresh', hallFeedback: '小说项目已归档，可在「已归档」中恢复。' })
    expect(useNovelStore.getState().summaries.find((item) => item.id === created.id)?.archived).toBe(true)
  })

  it('关闭大厅成功结果时一并清除同一条全局提示', () => {
    useNovelStore.setState({ hallFeedback: '小说项目已创建。', notice: '小说项目已创建。' })

    useNovelStore.getState().dismiss('hallFeedback')

    expect(useNovelStore.getState()).toMatchObject({ hallFeedback: undefined, notice: undefined })
  })

  it('归档请求失败时保留项目并提供大厅内联错误', async () => {
    useNovelStore.setState({ summaries: [{ id: created.id, title: created.title, archived: false } as import('../../../packages/contracts/src').NovelProjectSummary] })
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const succeeded = await useNovelStore.getState().archiveProject(created.id, true)

    expect(succeeded).toBe(false)
    expect(useNovelStore.getState()).toMatchObject({ hallActionError: { action: 'archive', message: '无法连接本机服务，请检查服务状态后重试归档。' } })
    expect(useNovelStore.getState().summaries[0]?.archived).toBe(false)
  })

  it('归档失败后重试成功会清除同一次失败的局部与全局错误', async () => {
    const archived = { ...created, archived: true, archivedAt: '2026-09-22T00:00:00.000Z' }
    useNovelStore.setState({ summaries: [{ id: created.id, title: created.title, archived: false } as import('../../../packages/contracts/src').NovelProjectSummary] })
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify(archived), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }))

    await useNovelStore.getState().archiveProject(created.id, true)
    await useNovelStore.getState().archiveProject(created.id, true)

    expect(useNovelStore.getState()).toMatchObject({ hallActionError: undefined, error: undefined })
  })
})
