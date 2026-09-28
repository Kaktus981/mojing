import { describe, expect, it } from 'vitest'
import { getWorkspaceAssistantModeToggle } from './workspaceAssistantPresentation'

describe('助手标题行模式切换', () => {
  it('自由创作和引导构建都在标题行给出对向入口', () => {
    expect(getWorkspaceAssistantModeToggle('free')).toEqual({ label: '切到引导构建', nextMode: '引导构建' })
    expect(getWorkspaceAssistantModeToggle('guide')).toEqual({ label: '切到自由创作', nextMode: '自由创作' })
    expect(getWorkspaceAssistantModeToggle('guide-no-target')).toEqual({ label: '切到自由创作', nextMode: '自由创作' })
    expect(getWorkspaceAssistantModeToggle('chooser')).toBeUndefined()
  })
})
