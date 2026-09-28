import { describe, expect, it } from 'vitest'
import { resolveWorkspaceInkBackground } from './workspaceInkBackground'

describe('工作区共享水墨背景', () => {
  it('按一级栏目保持稳定构图', () => {
    expect(resolveWorkspaceInkBackground('overview')).toBe('landscape')
    expect(resolveWorkspaceInkBackground('idea')).toBe('landscape')
    expect(resolveWorkspaceInkBackground('outline')).toBe('landscape')
    expect(resolveWorkspaceInkBackground('writing')).toBe('city')
    expect(resolveWorkspaceInkBackground('memory')).toBe('harbor')
    expect(resolveWorkspaceInkBackground('world')).toBe('landscape')
  })

  it('正文使用可辨认的城景构图', () => {
    expect(resolveWorkspaceInkBackground('writing')).toBe('city')
  })

  it('项目工具页没有助手时仍有稳定底图', () => {
    expect(resolveWorkspaceInkBackground('overview', true)).toBe('mountain')
  })
})
