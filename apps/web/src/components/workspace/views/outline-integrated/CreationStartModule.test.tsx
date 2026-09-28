import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NovelProject } from '../../../../../../../packages/contracts/src'

const holder = globalThis as unknown as { window?: { location: { hash: string } } }
holder.window = holder.window ?? { location: { hash: '' } }

const { CreationStartModule } = await import('./CreationStartModule')

function makeProject(): NovelProject {
  return {
    id: 'project-a', title: '测试项目', seed: '少年发现一座古钟', status: '待规划', updatedAt: '2026-09-26T00:00:00.000Z',
    outline: { volumes: [] }, directionCards: [], settings: {
      genreTemplate: '玄幻修仙', pointOfView: '第三人称限知', plannedChapters: 120,
      targetWords: 300_000, plannedVolumes: 3, tense: '过去时', language: '简体中文',
      audience: '', style: '', contentLimits: '', rhetoricIntensity: 1
    }
  } as unknown as NovelProject
}

function renderStart(focusId: 'seed' | 'directions' | 'specs' = 'seed'): string {
  return renderToStaticMarkup(<CreationStartModule project={makeProject()} focusId={focusId} onNavigate={() => undefined} />)
}

describe('创作起点首屏', () => {
  it('突出故事种子和进入大纲，方向与规格只保留可展开的单行状态', () => {
    const html = renderStart()

    expect(html).toContain('故事种子')
    expect(html).toContain('进入总纲与卷纲')
    const directionRow = html.match(/<button[^>]*aria-controls="mjp-oi-fold-directions"[^>]*>[\s\S]*?<\/button>/)?.[0]
    const specsRow = html.match(/<button[^>]*aria-controls="mjp-oi-fold-specs"[^>]*>[\s\S]*?<\/button>/)?.[0]
    expect(directionRow).toContain('aria-expanded="false"')
    expect(directionRow).toContain('当前方向')
    expect(specsRow).toContain('aria-expanded="false"')
    expect(specsRow).toContain('创作规格')
    expect(html).not.toContain('必要的三条规格')
    expect(html).not.toContain('种子字数')
    expect(html).not.toContain('摘要只读')
    expect(html).not.toContain('900ms')
    expect(html).not.toContain('从故事种子生成方向卡')
  })

  it('展开方向或规格后仍保留原有编辑与生成入口', () => {
    const directions = renderStart('directions')
    const specs = renderStart('specs')

    expect(directions).toContain('AI 生成方向卡候选')
    expect(directions).toContain('手动添加')
    expect(specs).toContain('从故事种子推断规格')
    expect(specs).toContain('题材模板')
    expect(specs).toContain('目标字数')
    expect(specs).not.toContain('这一页会改到哪些内容')
  })

  it('空种子时直接说明创建大纲的前提', () => {
    const project = makeProject()
    project.seed = ''
    project.outline = undefined
    const html = renderToStaticMarkup(<CreationStartModule project={project} focusId="seed" onNavigate={() => undefined} />)

    expect(html).toContain('创建空白大纲')
    expect(html).toContain('先写下故事种子')
    expect(html).not.toContain('空字符串进入生成上下文')
  })
})
