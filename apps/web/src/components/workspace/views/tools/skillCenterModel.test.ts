import { describe, expect, it } from 'vitest'
import {
  describeSkillSource,
  describeSkillStatus,
  normalizeRemoteSkillUrl,
  nextSkillCenterStep,
  previousSkillCenterStep,
  skillCenterSteps,
  summarizeVersionAction,
  type SkillCenterCapability
} from './skillCenterModel'

const capability = (overrides: Partial<SkillCenterCapability> = {}): SkillCenterCapability => ({
  id: 'skill-1',
  name: '叙事节奏',
  description: '检查段落节奏。',
  taskScopes: ['正文创作'],
  contextScopes: [],
  permission: '只读分析',
  enabled: false,
  source: '用户配置',
  constraints: [],
  taskPreferences: [],
  ...overrides
})

describe('skill center model', () => {
  it('keeps the settings flow in a keyboard-friendly, reversible step order', () => {
    expect(skillCenterSteps.map((step) => step.id)).toEqual(['directory', 'connect', 'permissions', 'versions'])
    expect(nextSkillCenterStep('directory')).toBe('connect')
    expect(nextSkillCenterStep('versions')).toBeNull()
    expect(previousSkillCenterStep('versions')).toBe('permissions')
    expect(previousSkillCenterStep('directory')).toBeNull()
  })

  it('describes update and rollback previews without claiming that anything changed', () => {
    expect(summarizeVersionAction({ kind: 'update', capabilityName: '古风对白校审', fromVersion: '1.3', toVersion: '1.4' })).toEqual({
      title: '检查到「古风对白校审」的新版本',
      detail: '当前 v1.3，预览 v1.4；确认后才会替换当前来源。',
      confirmLabel: '确认应用更新'
    })
    expect(summarizeVersionAction({ kind: 'rollback', capabilityName: '古风对白校审', fromVersion: '1.3', toVersion: '1.2' })).toEqual({
      title: '预览回滚「古风对白校审」',
      detail: '当前 v1.3，确认后会恢复到 v1.2；历史版本仍会保留。',
      confirmLabel: '确认回滚'
    })
  })

  it('accepts and canonicalizes HTTPS SKILL.md sources only', () => {
    expect(normalizeRemoteSkillUrl('  https://github.com/owner/repo/blob/main/SKILL.md  ')).toBe('https://github.com/owner/repo/blob/main/SKILL.md')
    expect(normalizeRemoteSkillUrl('https://raw.githubusercontent.com/owner/repo/main/SKILL.md')).toBe('https://raw.githubusercontent.com/owner/repo/main/SKILL.md')
    expect(normalizeRemoteSkillUrl('https://example.com/skills/SKILL.md')).toBeUndefined()
    expect(normalizeRemoteSkillUrl('http://example.com/skills/SKILL.md')).toBeUndefined()
    expect(normalizeRemoteSkillUrl('https://example.com/skills/readme.txt')).toBeUndefined()
  })

  it('describes a pinned remote source without exposing executable semantics', () => {
    expect(describeSkillSource(capability({ sourceKind: '远程', sourceUrl: 'https://github.com/owner/repo/blob/main/SKILL.md', sourceDigest: 'a'.repeat(64) }))).toEqual({
      label: '远程 SKILL.md',
      detail: '来源已固定 · github.com'
    })
    expect(describeSkillSource(capability({ sourceKind: 'remote', sourceUrl: 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md' }))).toEqual({
      label: '远程 SKILL.md',
      detail: '来源已固定 · raw.githubusercontent.com'
    })
  })

  it('separates enabled state from the runtime loaded state', () => {
    expect(describeSkillStatus(capability({ enabled: false, loaded: false }))).toEqual({ label: '已停用', tone: 'default' })
    expect(describeSkillStatus(capability({ enabled: true, loaded: false }))).toEqual({ label: '已启用，待加载', tone: 'amber' })
    expect(describeSkillStatus(capability({ enabled: true, loaded: true, activeVersion: '1.2' }))).toEqual({ label: '已加载 · v1.2', tone: 'ok' })
    expect(describeSkillStatus(capability({ enabled: true, loadedStages: ['writing'], loadedVersion: '2.0' }))).toEqual({ label: '已加载 · v2.0', tone: 'ok' })
  })
})
