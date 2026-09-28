import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StageChatAssistantProfile } from '../../stageChatGuidance'

/**
 * 自由创作面板在测试环境里需要浏览器全局：`mojingClient` 在模块装载时会读
 * `window.location.hash` 解析运行时配置。这里只补上最小的 `window` 外壳，
 * 不改任何产品代码，也不发起任何请求。
 */
const holder = globalThis as unknown as { window?: { location: { hash: string } } }
holder.window = holder.window ?? { location: { hash: '' } }

const { FreeCreationPanel } = await import('./FreeCreationPanel')

const profile: StageChatAssistantProfile = {
  displaySection: '小说大纲',
  name: '大纲架构师',
  welcome: '我们一起来搭故事骨架。',
  contextSources: ['故事种子', '总纲'],
  quickActions: [
    { label: '梳理故事核心', prompt: '梳理主角欲望与核心冲突。' },
    { label: '检查大纲缺口', prompt: '看看大纲还缺什么。' }
  ],
  resultPresentation: '结果只作为候选。',
  proposalTypes: ['初纲候选']
}

function panel(patch: Partial<Parameters<typeof FreeCreationPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <FreeCreationPanel
      active
      stage="outline"
      projectId="project-a"
      profile={profile}
      target={{ kind: 'story-core', projectId: 'project-a' }}
      taskType="引导构建"
      input=""
      onInputChange={() => undefined}
      {...patch}
    />
  )
}

describe('自由创作面板的模式隔离与输入保留', () => {
  it('引导态下自由创作内容完全不渲染', () => {
    expect(panel({ active: false })).toBe('')
  })

  it('自由态渲染原来的聊天外壳：快捷提示与作者输入框', () => {
    const html = panel({ input: '作者还没发送的半句话' })
    expect(html).toContain('id="mojing-dock-input"')
    expect(html).toContain('mjp-dock-quick')
    expect(html).toContain('梳理故事核心')
  })

  it('未发送的输入由外部状态持有：切回自由态仍然原样显示，不会被清空', () => {
    // 模型切换时面板会卸载；输入值来自上层状态，重新挂载后必须原样出现。
    const before = panel({ input: '作者还没发送的半句话' })
    const away = panel({ active: false })
    const after = panel({ input: '作者还没发送的半句话' })
    expect(before).toContain('作者还没发送的半句话')
    expect(away).toBe('')
    expect(after).toContain('作者还没发送的半句话')
  })

  it('自由创作态不在内容区重复放置模式切换', () => {
    const html = panel()
    expect(html).not.toContain('data-testid="free-switch-guide"')
  })

  it('不在聊天区展示历史候选记录或结果说明小注释', () => {
    const html = panel()
    expect(html).not.toContain('dock-history-candidates')
    expect(html).not.toContain('结果只作为候选。')
  })

  it('输入区保持单行紧凑，并移除重复的候选与产出注释', () => {
    const html = panel()
    expect(html).toContain('rows="1"')
    expect(html).toContain('⏎')
    expect(html).toContain('⇧⏎')
    expect(html).not.toContain('结果仅作为候选')
    expect(html).not.toContain('产出：')
  })

  it('所有创作助手输入框都不显示引导占位提示', () => {
    expect(panel()).not.toContain('placeholder=')
    const reviseSource = readFileSync(resolve(process.cwd(), 'apps/web/src/components/workspace/assistant/ReviseScopePanel.tsx'), 'utf8')
    expect(reviseSource).not.toContain('placeholder=')
  })

  it('不在聊天区展示项目准备度区块', () => {
    expect(panel()).not.toContain('data-testid="dock-preparation"')
  })

  it('模型不可用时保留作者输入，但发送动作进入明确禁用态', () => {
    const html = panel({ input: '准备发送的一段话', blockedReason: '模型服务尚未配置。' })
    expect(html).toContain('title="模型服务尚未配置。"')
    expect(html).toContain('class="mjp-dock-send"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('准备发送的一段话')
  })
})
