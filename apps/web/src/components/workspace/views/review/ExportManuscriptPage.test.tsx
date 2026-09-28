import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { buildExportManifest } from './reviewModel'

const store = vi.hoisted(() => ({
  state: {
    persistNow: async () => undefined as NovelProject | undefined,
    saveState: '已保存',
    revisions: [] as Array<{ status: string }>
  }
}))

vi.mock('../../../../novelStore', () => ({
  useNovelStore: Object.assign(
    (selector: (state: typeof store.state) => unknown) => selector(store.state),
    { getState: () => store.state }
  )
}))

const { ExportManuscriptPage, attemptExport } = await import('./ExportManuscriptPage')

function project(): NovelProject {
  return {
    id: 'novel-a', revision: 3, title: '潮汐钟',
    chapters: [{ id: 'chapter-a', chapterNumber: 1, volumeNumber: 1, title: '潮声', status: '草稿', blocks: [{ id: 'block-a', text: '钟声响起。' }] }],
    memories: [], plotThreads: [], reviews: []
  } as unknown as NovelProject
}

describe('成稿导出入口', () => {
  it('有正文时可直接点导出，不要求先手动运行检查', () => {
    const current = project()
    const html = renderToStaticMarkup(
      <ExportManuscriptPage
        model={buildExportManifest(current, [])}
        project={current}
        busy={false}
        onExport={async () => undefined}
        onGoTo={() => undefined}
      />
    )

    const submit = html.match(/<button[^>]*data-testid="export-submit"[^>]*>/)?.[0]
    expect(submit).toBeDefined()
    expect(submit).not.toContain('disabled')
    expect(html).not.toContain('请先运行本地预检')
    expect(html).toContain('备份整个项目')
    expect(html).not.toContain('完整 JSON 备份')
  })

  it('保存成功且无阻断时才执行成稿导出', async () => {
    const current = project()
    const events: string[] = []
    const result = await attemptExport({
      format: 'docx',
      persistNow: async () => { events.push('save'); return current },
      getSaveState: () => '已保存',
      pendingProposalCount: 0,
      onExport: async () => { events.push('export') }
    })

    expect(events).toEqual(['save', 'export'])
    expect(result.precheck?.blockers).toHaveLength(0)
    expect(result.precheck?.warnings.map((item) => item.code)).toContain('草稿章节')
  })

  it('保存失败时说明原因且不调用导出', async () => {
    let exported = false
    const result = await attemptExport({
      format: 'docx',
      persistNow: async () => undefined,
      getSaveState: () => '保存失败',
      pendingProposalCount: 0,
      onExport: async () => { exported = true }
    })

    expect(exported).toBe(false)
    expect(result.message).toContain('保存')
  })

  it('没有正文时点击导出会说明阻断原因，而不会生成空成稿', async () => {
    const current = project()
    current.chapters[0]!.blocks = []
    let exported = false
    const result = await attemptExport({
      format: 'docx',
      persistNow: async () => current,
      getSaveState: () => '已保存',
      pendingProposalCount: 0,
      onExport: async () => { exported = true }
    })

    expect(exported).toBe(false)
    expect(result.precheck?.blockers.map((item) => item.code)).toContain('无可导出正文')
  })

  it('发现阻断项时不导出，仍返回具体问题供页面显示', async () => {
    const current = project()
    current.chapters.push({ ...current.chapters[0]!, id: 'chapter-b' })
    let exported = false
    const result = await attemptExport({
      format: 'docx',
      persistNow: async () => current,
      getSaveState: () => '已保存',
      pendingProposalCount: 0,
      onExport: async () => { exported = true }
    })

    expect(exported).toBe(false)
    expect(result.precheck?.blockers.map((item) => item.code)).toContain('项目结构损坏')
  })

  it('项目备份无需正文，但仍先保存', async () => {
    const current = project()
    current.chapters = []
    const events: string[] = []
    await attemptExport({
      format: 'json',
      persistNow: async () => { events.push('save'); return current },
      getSaveState: () => '已保存',
      pendingProposalCount: 0,
      onExport: async () => { events.push('export') }
    })

    expect(events).toEqual(['save', 'export'])
  })
})
