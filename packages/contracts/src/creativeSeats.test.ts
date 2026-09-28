import { describe, expect, it } from 'vitest'
import { CreateCreativeCapabilityInputSchema, CreativeOrchestrationRunSchema, CreativeSkillRemoteImportInputSchema, CreativeSkillVersionSchema } from './creativeSeats'

describe('创作席位与能力契约', () => {
  it('用户能力只接受说明性约束，拒绝执行声明', () => {
    const valid = CreateCreativeCapabilityInputSchema.safeParse({ name: '对白检查', description: '检查对白是否符合人物底线。', taskScopes: ['中文审校'], constraints: ['只输出建议'], taskPreferences: ['保持语气克制'] })
    expect(valid.success).toBe(true)
    const invalid = CreateCreativeCapabilityInputSchema.safeParse({ name: '危险能力', description: '不应执行。', taskScopes: ['记忆'], command: 'powershell', script: 'Remove-Item *' })
    expect(invalid.success).toBe(false)
  })

  it('远程技能来源与版本快照契约固定为可审计字段', () => {
    expect(CreativeSkillRemoteImportInputSchema.parse({ url: 'https://github.com/acme/story-skills/blob/abc123/SKILL.md', expectedRef: 'abc123' })).toEqual({
      url: 'https://github.com/acme/story-skills/blob/abc123/SKILL.md', expectedRef: 'abc123'
    })
    expect(CreativeSkillVersionSchema.safeParse({
      id: 'skill-version-1', projectId: 'novel-1', capabilityId: 'custom-skill-1', revision: 1,
      skillVersion: '1.0', sourceDigest: 'a'.repeat(64), sourceKind: 'remote',
      sourceUrl: 'https://raw.githubusercontent.com/acme/story-skills/abc123/SKILL.md', sourceRef: 'abc123',
      capability: { id: 'custom-skill-1', name: '边界检查', description: '检查边界。', taskScopes: ['正文创作'], contextScopes: [], permission: '只读分析', constraints: [], taskPreferences: [], skillText: '只提出建议。', skillVersion: '1.0', enabled: false, source: '用户配置' },
      createdAt: new Date().toISOString()
    }).success).toBe(true)
    expect(CreativeSkillRemoteImportInputSchema.safeParse({ url: 'http://example.com/SKILL.md' }).success).toBe(false)
  })

  it('编排运行强制人工门禁且禁止自动应用', () => {
    const now = new Date().toISOString()
    const parsed = CreativeOrchestrationRunSchema.safeParse({ id: 'run-1', projectId: 'novel-1', request: { intent: '长篇复核', maxParallel: 2 }, baseRevision: 1, status: '等待执行', policy: { maxParallel: 2, requireHumanGate: true, autoApply: false }, warnings: [], steps: [{ id: 'step-1', runId: 'run-1', order: 0, seatId: 'seat-memory-curator', title: '重建记忆', kind: 'memory-rebuild', dependsOn: [], status: '可执行', reason: '检查', evidence: [], estimatedTokens: 100, memoryProposalIds: [], attempt: 0, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now })
    expect(parsed.success).toBe(true)
    const unsafe = CreativeOrchestrationRunSchema.safeParse({ id: 'run-1', projectId: 'novel-1', request: { intent: '长篇复核', maxParallel: 2 }, baseRevision: 1, status: '等待执行', policy: { maxParallel: 2, requireHumanGate: false, autoApply: true }, warnings: [], steps: [], createdAt: now, updatedAt: now })
    expect(unsafe.success).toBe(false)
  })
})
