import { describe, expect, it } from 'vitest'
import type { WorldBible, WorldConstraint } from '../../contracts/src'
import { applyWorldQualityRecommendation, auditWorldLocally, isWorldQualityFindingStale } from './worldQuality'

const now = '2026-08-25T00:00:00.000Z'
const constraint: WorldConstraint = {
  id: 'constraint-yigu', term: '异骨', definition: '生灵可能生来自带的异常骨质结构', notDefinition: '自然资源、矿产或可开采材料', entityType: '先天身体结构',
  allowedUsages: ['生灵具有异骨'],
  forbiddenUsages: [{ phrase: '旧骨资源枯竭', reason: '异骨不是自然资源，且“旧骨”尚未定义。', suggestedReplacement: '可合法流通的遗骨来源日益稀缺' }],
  unresolvedQuestions: ['死后能否取用或交易'],
  facts: [{ subject: '生灵', relation: '可能先天具有', object: '异骨', polarity: '允许' }],
  source: { fieldPath: '/seed', excerpt: '世间生灵，体生异骨。' }, status: '已锁定', createdAt: now, updatedAt: now
}

function world(historySummary: string): WorldBible {
  return { status: '草稿', summary: '生灵体内可能生有异骨。', premise: '力量必须承担代价。', themes: [], rules: [], geography: '', historySummary, entries: [], timeline: [], updatedAt: now }
}

describe('世界观本地语义质量检查', () => {
  it('识别异骨主体错位和资源化误写，并提供局部修复', () => {
    const candidate = world('近二十年来，异骨出生率下降、旧骨资源枯竭。')
    const findings = auditWorldLocally(candidate, [constraint], '本地规则', now)
    expect(findings.some((item) => item.type === '主语指代' && item.evidence.excerpt === '异骨出生率')).toBe(true)
    const resource = findings.find((item) => item.evidence.excerpt === '旧骨资源枯竭')!
    expect(resource).toMatchObject({ type: '术语误用', severity: '高' })
    const repaired = applyWorldQualityRecommendation(candidate, resource)
    expect(repaired.historySummary).toContain('可合法流通的遗骨来源日益稀缺')
    expect(candidate.historySummary).toContain('旧骨资源枯竭')
  })

  it('候选被作者修改后旧修复失效', () => {
    const finding = auditWorldLocally(world('旧骨资源枯竭。'), [constraint], '本地规则', now)[0]!
    expect(isWorldQualityFindingStale(finding, world('据传旧骨资源枯竭。'))).toBe(true)
    expect(() => applyWorldQualityRecommendation(world('据传旧骨资源枯竭。'), finding)).toThrow('已失效')
  })

  it('把死后取用和交易保留为作者决定，而不是自动判定允许', () => {
    const findings = auditWorldLocally(world('黑市开始大量回收死者异骨。'), [constraint], '本地规则', now)
    expect(findings).toContainEqual(expect.objectContaining({ type: '无依据事实', severity: '中' }))
    expect(findings[0]?.explanation).toContain('尚未确定')
  })

  it('不把合法中文共享主语误判为问题', () => {
    const findings = auditWorldLocally(world('他推门而入，抬眼看见灯火。'), [], '本地规则', now)
    expect(findings.some((item) => item.type === '主语指代')).toBe(false)
  })

  it('未经确认的 AI 术语提议不会成为强约束', () => {
    expect(auditWorldLocally(world('异骨出生率下降。'), [{ ...constraint, status: '待确认' }], '本地规则', now)).toEqual([])
  })
})
