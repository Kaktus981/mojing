import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantModeChooser } from './AssistantModeChooser'

/** SSR 会在相邻文本节点间插入注释分隔符；比较文案前先去掉它们。 */
function plain(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

describe('首次使用的模式选择器', () => {
  const html = renderToStaticMarkup(<AssistantModeChooser onSelect={() => undefined} />)
  const text = plain(html)

  it('只有引导构建与自由创作两项，且引导在上', () => {
    expect(html).toContain('data-testid="assistant-mode-guide"')
    expect(html).toContain('data-testid="assistant-mode-free"')
    expect(html).toContain('class="mjp-mode-choice-card"')
    expect(text.indexOf('引导构建')).toBeGreaterThan(-1)
    expect(text.indexOf('引导构建')).toBeLessThan(text.indexOf('自由对话'))
    expect((html.match(/mjp-mode-choice-item/g) ?? []).length).toBe(2)
  })

  it('每项最多一句短说明，不做大卡片与流程目录', () => {
    expect((html.match(/<span class="d">/g) ?? []).length).toBe(2)
    expect(text).toContain('适合从零推进一个目标')
    expect(text).toContain('适合边写边想')
    expect(text).toContain('自由对话')
  })

  it('入口选择页不混入范围、配置、准备度或自由创作控件', () => {
    for (const forbidden of ['本次使用', '创作准备', '历史候选', 'mojing-dock-input', '<select']) {
      expect(html).not.toContain(forbidden)
    }
  })

  it('选项是语义按钮并带可见文案', () => {
    expect((html.match(/<button type="button"/g) ?? []).length).toBe(2)
    expect(text).toContain('先选一种方式开始')
  })
})
