import { describe, expect, it } from 'vitest'
import { getWorkspaceAssistantProfile } from './workspaceAssistantProfiles'

describe('一级栏目助手档案', () => {
  it('同一一级栏目切换二级页时保持助手身份', () => {
    const outlineProfiles = ['idea', 'outline'].map((stage) => getWorkspaceAssistantProfile(stage, '星纹古钟'))
    const memoryProfiles = ['memory', 'memory'].map((stage) => getWorkspaceAssistantProfile(stage, '星纹古钟'))

    expect(new Set(outlineProfiles.map((profile) => profile.name)).size).toBe(1)
    expect(new Set(outlineProfiles.map((profile) => profile.welcome)).size).toBe(1)
    expect(new Set(memoryProfiles.map((profile) => profile.name)).size).toBe(1)
    expect(outlineProfiles[0]?.displaySection).toBe('小说大纲')
    expect(memoryProfiles[0]?.displaySection).toBe('记忆 / 伏笔')
  })

  it('项目工具使用稳定的项目级助手档案', () => {
    const profile = getWorkspaceAssistantProfile('world', '星纹古钟', true)

    expect(profile.displaySection).toBe('项目工具')
    expect(profile.name).toBe('项目工具助手')
  })
})
