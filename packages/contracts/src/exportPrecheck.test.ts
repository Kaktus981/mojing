import { describe, expect, it } from 'vitest'
import { ExportPrecheckSchema, exportPrecheckAllowsExport, exportPrecheckState } from './novelApi'

const checkedAt = '2026-09-13T10:00:00.000Z'

function precheck(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'novel', projectRevision: 12, format: 'docx' as const, checkedAt,
    source: '本地预检' as const, blockers: [], warnings: [], ...overrides
  }
}

describe('阶段 1.4 导出预检契约', () => {
  it('预检结果必须绑定项目版本、格式与检查时间，且来源只能是本地确定性检查', () => {
    const parsed = ExportPrecheckSchema.safeParse(precheck())
    expect(parsed.success).toBe(true)
    expect(ExportPrecheckSchema.safeParse({ projectId: 'novel', format: 'docx', blockers: [], warnings: [] }).success).toBe(false)
    expect(ExportPrecheckSchema.safeParse(precheck({ source: 'AI 判断' })).success).toBe(false)
  })

  it('从未检查时状态为未检查，且不允许导出', () => {
    const state = exportPrecheckState(undefined, { projectRevision: 12, format: 'docx' })
    expect(state).toBe('未检查')
    expect(exportPrecheckAllowsExport(state)).toBe(false)
  })

  it('项目版本或目标格式变化后预检立即过期', () => {
    const stale = exportPrecheckState(precheck(), { projectRevision: 13, format: 'docx' })
    expect(stale).toBe('已过期')
    expect(exportPrecheckAllowsExport(stale)).toBe(false)
    const reformatted = exportPrecheckState(precheck(), { projectRevision: 12, format: 'md' })
    expect(reformatted).toBe('已过期')
  })

  it('阻断项存在时不得导出；警告项存在时需作者确认后才能导出', () => {
    const blocked = exportPrecheckState(precheck({ blockers: [{ code: '保存失败', message: '项目尚未保存成功。' }] }), { projectRevision: 12, format: 'docx' })
    expect(blocked).toBe('阻断')
    expect(exportPrecheckAllowsExport(blocked)).toBe(false)

    const warned = exportPrecheckState(precheck({ warnings: [{ code: '草稿章节', message: '第 4 章仍为草稿。' }] }), { projectRevision: 12, format: 'docx' })
    expect(warned).toBe('可导出含警告')
    expect(exportPrecheckAllowsExport(warned)).toBe(true)

    const clean = exportPrecheckState(precheck(), { projectRevision: 12, format: 'docx' })
    expect(clean).toBe('可导出')
  })

  it('完整 JSON 备份不被内容质量警告阻断，但仍受阻断项约束', () => {
    const jsonWithWarnings = exportPrecheckState(
      precheck({ format: 'json', warnings: [{ code: '未应用候选', message: '存在待确认候选。' }] }),
      { projectRevision: 12, format: 'json' }
    )
    expect(jsonWithWarnings).toBe('可导出')
    const jsonBlocked = exportPrecheckState(
      precheck({ format: 'json', blockers: [{ code: '项目结构损坏', message: '项目无法安全序列化。' }] }),
      { projectRevision: 12, format: 'json' }
    )
    expect(jsonBlocked).toBe('阻断')
  })

  it('阻断项与警告项使用固定枚举，未知原因会被拒绝', () => {
    expect(ExportPrecheckSchema.safeParse(precheck({ blockers: [{ code: '随意原因', message: 'x' }] })).success).toBe(false)
    expect(ExportPrecheckSchema.safeParse(precheck({ warnings: [{ code: '随意警告', message: 'x' }] })).success).toBe(false)
    const all = ExportPrecheckSchema.safeParse(precheck({
      blockers: ['保存失败', '并发冲突', '项目结构损坏', '无可导出正文', '导出器失败'].map((code) => ({ code, message: code })),
      warnings: ['高风险审稿问题', '草稿章节', '过期记忆', '逾期伏笔', '未应用候选'].map((code) => ({ code, message: code }))
    }))
    expect(all.success).toBe(true)
  })
})
