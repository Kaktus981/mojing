import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NovelProject } from '../../../../../../../packages/contracts/src'

const holder = globalThis as unknown as { window?: { location: { hash: string } } }
holder.window = holder.window ?? { location: { hash: '' } }

const { StyleWorkshopPage } = await import('./StyleWorkshopPage')

describe('文笔工坊文本框样式', () => {
  it('默认展示画像库和学习新文入口，不把导入表单堆在主页面', () => {
    const html = renderToStaticMarkup(
      <StyleWorkshopPage
        project={{ id: 'project-a', settings: {}, chapters: [] } as unknown as NovelProject}
      />
    )

    expect(html).toContain('文风库')
    expect(html).toContain('学习新文')
    expect(html).toContain('style-profile-library')
    expect(html).toContain('文风库')
    expect(html).toContain('已导入样文')
    expect(html).toContain('使用记录')
    expect(html).not.toContain('style-file-input')
  })

  it('保留样文与使用记录页签的真实入口', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/web/src/components/workspace/views/tools/StyleWorkshopPage.tsx'), 'utf8')

    expect(source).toContain("type LibraryTab = 'profiles' | 'samples' | 'usage'")
    expect(source).toContain('data-testid="style-workshop-tabs"')
    expect(source).toContain('data-testid="style-imported-samples-tab"')
    expect(source).toContain('data-testid="style-usage-history-tab"')
    expect(source).toContain('当前项目还没有绑定文风画像')
  })

  it('学习入口、画像行和关闭按钮都接入同一个右侧抽屉', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/web/src/components/workspace/views/tools/StyleWorkshopPage.tsx'), 'utf8')

    expect(source).toContain("setDrawer({ kind: 'learn', step: 'add' })")
    expect(source).toContain("setDrawer({ kind: 'profile', profileId: profile.id })")
    expect(source).toContain('data-testid="style-workshop-drawer"')
    expect(source).toContain('关闭文风工坊抽屉')
    expect(source).toContain('data-testid="style-file-input"')
    expect(source).toContain('onClick={closeDrawer}')
  })

  it('默认页不渲染抽屉文本框，抽屉源码仍使用墨境纸面样式钩子', () => {
    const html = renderToStaticMarkup(
      <StyleWorkshopPage
        project={{ id: 'project-a', settings: {}, chapters: [] } as unknown as NovelProject}
      />
    )
    const source = readFileSync(resolve(process.cwd(), 'apps/web/src/components/workspace/views/tools/StyleWorkshopPage.tsx'), 'utf8')

    expect(html).not.toContain('skill-center-textarea')
    expect(html).not.toContain('<textarea')
    expect(source).toContain('className="skill-center-textarea"')
  })

  it('首屏不堆叠导入分析表单，但保留学习入口', () => {
    const html = renderToStaticMarkup(
      <StyleWorkshopPage
        project={{ id: 'project-a', settings: {}, chapters: [] } as unknown as NovelProject}
      />
    )

    expect(html).not.toContain('使用本项目正文')
    expect(html).not.toContain('手写画像（不需要模型）')
    expect(html).toContain('学习新文')
    expect(html).not.toContain('分析所选片段')
    expect(html).not.toContain('绑定到本项目')
  })
})
