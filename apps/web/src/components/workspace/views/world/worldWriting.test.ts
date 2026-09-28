import { describe, expect, it } from 'vitest'

import {
  CONSTRAINT_LIST_FIELDS,
  CONSTRAINT_TEXT_FIELDS,
  MANUAL_SOURCE_EXCERPT,
  applyAddEntryRelation,
  applyAddWorldConstraint,
  applyConstraintFieldEdit,
  applyConstraintListEdit,
  applyRemoveWorldConstraint,
  applyRemoveEntryRelation,
  applyRemoveWorldEntry,
  applyWorldOverviewEdit,
  applyWorldOverviewFinalize,
  applyWorldOverviewThemesEdit,
  constraintReferenceCount,
  entryReferenceReport,
  type WorldOverviewEditTarget,
  type WorldWritingDraft
} from './worldWriting'

/**
 * M5 · 世界观手写：术语与词条的安全边界测试。
 *
 * 覆盖四件事：
 *   1. 人工录入的术语来源如实标注，不冒充 AI 提取；
 *   2. 契约必填字段（term / definition）不能被清空；
 *   3. 锁定项必须先解锁才能删；
 *   4. 被引用时拒绝删除，避免悬空关联。
 */

const NOW = '2026-09-14T21:00:00.000Z'

const draft = (): WorldWritingDraft => ({ worldConstraints: [] })

describe('世界总览：编辑与定稿', () => {
  const world = (): WorldOverviewEditTarget => ({
    status: '创作中',
    worldBible: {
      status: '定稿',
      updatedAt: '2026-09-01T00:00:00.000Z',
      summary: '旧摘要',
      premise: '旧前提',
      themes: ['旧主题'],
      geography: '旧地理',
      historySummary: '旧历史',
      entries: []
    }
  })

  it('applyWorldOverviewEdit 改 summary 后其余字段不变、status 变草稿', () => {
    const target = world()
    const result = applyWorldOverviewEdit(target, 'summary', '新的世界摘要', NOW)
    expect(result.ok).toBe(true)
    expect(target.worldBible!.summary).toBe('新的世界摘要')
    expect(target.worldBible!.premise).toBe('旧前提')
    expect(target.worldBible!.geography).toBe('旧地理')
    expect(target.worldBible!.historySummary).toBe('旧历史')
    expect(target.worldBible!.status).toBe('草稿')
    expect(target.worldBible!.updatedAt).toBe(NOW)
    expect(target.status).toBe('世界观草稿')
  })

  it('必填未补全时 applyWorldOverviewFinalize 返回 ok:false 且 status 仍是草稿', () => {
    const target = world()
    target.worldBible = {
      status: '草稿',
      updatedAt: '2026-09-01T00:00:00.000Z',
      summary: '摘要',
      premise: '前提',
      themes: [],
      geography: '',
      historySummary: '',
      entries: []
    }
    const result = applyWorldOverviewFinalize(target, NOW)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('补全')
    expect(target.worldBible.status).toBe('草稿')
    expect(target.worldBible.updatedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('必填齐全时 status 变定稿', () => {
    const target = world()
    target.worldBible = {
      status: '草稿',
      updatedAt: '2026-09-01T00:00:00.000Z',
      summary: '摘要',
      premise: '前提',
      themes: [],
      geography: '地理',
      historySummary: '历史',
      entries: []
    }
    const result = applyWorldOverviewFinalize(target, NOW)
    expect(result.ok).toBe(true)
    expect(target.worldBible.status).toBe('定稿')
    expect(target.worldBible.updatedAt).toBe(NOW)
  })

  /**
   * 主题：契约里一直有这份数据，界面此前没有出口。补出口后必须遵守与四个正文字段
   * 完全一致的写入规则（无主体拒绝、同值不写、写入即回草稿），并且**不参与定稿门槛**
   * —— 主题不是必填项，不因它缺失而禁止定稿。
   */
  it('主题可整组改写：去重去空、写入即回草稿，且不影响定稿门槛', () => {
    const target = world()
    expect(target.worldBible!.themes).toEqual(['旧主题'])

    const result = applyWorldOverviewThemesEdit(target, [' 复仇 ', '复仇', '', '代价'], NOW)
    expect(result.ok).toBe(true)
    expect(target.worldBible!.themes).toEqual(['复仇', '代价'])
    expect(target.worldBible!.status).toBe('草稿')
    expect(target.worldBible!.updatedAt).toBe(NOW)
    expect(target.status).toBe('世界观草稿')

    // 同值再写一次：不写，也不刷新时间（避免无意义保存）。
    const same = applyWorldOverviewThemesEdit(target, ['复仇', '代价'], '2026-09-15T00:00:00.000Z')
    expect(same.ok).toBe(false)
    expect(same.message).toBe('内容没有变化。')
    expect(target.worldBible!.updatedAt).toBe(NOW)

    // 主题为空也不是定稿障碍：四个必填片段齐全即可定稿。
    const finalTarget: WorldOverviewEditTarget = {
      status: '创作中',
      worldBible: {
        status: '草稿',
        updatedAt: NOW,
        summary: '摘要',
        premise: '前提',
        themes: [],
        geography: '地理',
        historySummary: '历史',
        entries: []
      }
    }
    expect(applyWorldOverviewFinalize(finalTarget, NOW).ok).toBe(true)

    // 没有世界观主体时一律拒绝，不静默创建。
    const empty: WorldOverviewEditTarget = { status: '创作中' }
    const rejected = applyWorldOverviewThemesEdit(empty, ['主题'], NOW)
    expect(rejected.ok).toBe(false)
    expect(rejected.message).toContain('先建立世界观主体')
  })
})

describe('手动术语', () => {
  it('契约完整、来源如实标注为作者手动录入、状态为待确认', () => {
    const target = draft()
    const result = applyAddWorldConstraint(target, { term: '星纹古钟', definition: '旧城地底的计时装置' }, NOW, 'term-1')

    expect(result.ok).toBe(true)
    expect(target.worldConstraints[0]).toMatchObject({
      id: 'term-1',
      term: '星纹古钟',
      definition: '旧城地底的计时装置',
      notDefinition: '',
      entityType: '',
      allowedUsages: [],
      unresolvedQuestions: [],
      // 界面会直接读这两个数组：缺了它们会白屏（历史事故）
      forbiddenUsages: [],
      facts: [],
      status: '待确认',
      createdAt: NOW,
      updatedAt: NOW,
      source: { fieldPath: 'worldConstraints.term-1', excerpt: MANUAL_SOURCE_EXCERPT }
    })
  })

  it('没有名称或定义就不创建（契约必填，不由程序代写）', () => {
    const target = draft()
    expect(applyAddWorldConstraint(target, { term: '  ', definition: '有定义' }, NOW, 'term-1').ok).toBe(false)
    expect(applyAddWorldConstraint(target, { term: '有名称', definition: '   ' }, NOW, 'term-1').ok).toBe(false)
    expect(target.worldConstraints).toHaveLength(0)
  })

  it('四个文本字段可改，但名称与定义不能被清空', () => {
    const target = draft()
    applyAddWorldConstraint(target, { term: '星纹古钟', definition: '旧城地底的计时装置' }, NOW, 'term-1')
    expect([...CONSTRAINT_TEXT_FIELDS]).toEqual(['term', 'definition', 'notDefinition', 'entityType'])

    expect(applyConstraintFieldEdit(target, 'term-1', 'notDefinition', '不是普通报时钟', NOW)).toBe(true)
    expect(applyConstraintFieldEdit(target, 'term-1', 'entityType', '器物', NOW)).toBe(true)
    expect(applyConstraintFieldEdit(target, 'term-1', 'definition', '时钟会改写记忆', NOW)).toBe(true)
    expect(target.worldConstraints[0]!.notDefinition).toBe('不是普通报时钟')
    expect(target.worldConstraints[0]!.definition).toBe('时钟会改写记忆')

    expect(applyConstraintFieldEdit(target, 'term-1', 'definition', '  ', NOW)).toBe(false)
    expect(target.worldConstraints[0]!.definition).toBe('时钟会改写记忆')
  })

  it('允许用法与未决问题按数组整组替换，去重去空', () => {
    const target = draft()
    applyAddWorldConstraint(target, { term: '星纹古钟', definition: '定义' }, NOW, 'term-1')
    expect([...CONSTRAINT_LIST_FIELDS]).toEqual(['allowedUsages', 'unresolvedQuestions'])

    expect(applyConstraintListEdit(target, 'term-1', 'allowedUsages', ['古钟', ' 古钟 ', '', '星纹钟'], NOW)).toBe(true)
    expect(target.worldConstraints[0]!.allowedUsages).toEqual(['古钟', '星纹钟'])
    expect(applyConstraintListEdit(target, 'term-1', 'allowedUsages', ['古钟', '星纹钟'], NOW), '内容没变不写').toBe(false)
  })
})

describe('术语删除边界', () => {
  it('已锁定的术语必须先解锁', () => {
    const target = draft()
    applyAddWorldConstraint(target, { term: '星纹古钟', definition: '定义' }, NOW, 'term-1')
    target.worldConstraints[0]!.status = '已锁定'

    const result = applyRemoveWorldConstraint(target, 'term-1')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/先把它改成其他状态/)
    expect(target.worldConstraints).toHaveLength(1)

    target.worldConstraints[0]!.status = '已确认'
    expect(applyRemoveWorldConstraint(target, 'term-1').ok).toBe(true)
    expect(target.worldConstraints).toHaveLength(0)
  })

  it('仍被未处理审校问题引用时拒绝删除，已忽略的问题不再阻塞', () => {
    const target = draft()
    applyAddWorldConstraint(target, { term: '星纹古钟', definition: '定义' }, NOW, 'term-1')
    target.worldQualityFindings = [{ id: 'f-1', constraintIds: ['term-1'], status: '待处理' }]

    expect(constraintReferenceCount(target, 'term-1')).toBe(1)
    const blocked = applyRemoveWorldConstraint(target, 'term-1')
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toMatch(/1 条未处理的审校问题/)
    expect(target.worldConstraints).toHaveLength(1)

    target.worldQualityFindings[0]!.status = '已忽略'
    expect(constraintReferenceCount(target, 'term-1')).toBe(0)
    expect(applyRemoveWorldConstraint(target, 'term-1').ok).toBe(true)
  })
})

describe('词条删除边界', () => {
  const withEntries = (): WorldWritingDraft => ({
    worldConstraints: [],
    worldBible: {
      status: '草稿',
      updatedAt: '2026-09-01T00:00:00.000Z',
      summary: '摘要',
      premise: '前提',
      themes: [],
      geography: '地理',
      historySummary: '历史',
      entries: [
        { id: 'char-1', name: '林砚', locked: true, relations: [] },
        { id: 'char-2', name: '巡夜人', locked: false, relations: [{ id: 'rel-1', targetEntryId: 'char-1', type: '师徒', description: '师徒' }] },
        { id: 'char-3', name: '路人', locked: false, relations: [] }
      ]
    },
    storylines: [{ id: 'line-1', title: '潮汐调查线', entryIds: ['char-3'] }]
  })

  it('引用报告如实列出关系持有者与事件线', () => {
    const target = withEntries()
    const report = entryReferenceReport(target, 'char-1')
    expect(report.locked).toBe(true)
    expect(report.relationOwners).toEqual(['巡夜人'])
    expect(entryReferenceReport(target, 'char-3').storylineTitles).toEqual(['潮汐调查线'])
    expect(entryReferenceReport(target, 'char-2')).toEqual({ locked: false, relationOwners: [], storylineTitles: [] })
  })

  it('锁定词条必须先解锁', () => {
    const target = withEntries()
    const result = applyRemoveWorldEntry(target, 'char-1')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/先解锁/)
    expect(target.worldBible!.entries).toHaveLength(3)
  })

  it('被别的词条关系引用时拒绝删除', () => {
    const target = withEntries()
    target.worldBible!.entries[0]!.locked = false
    const result = applyRemoveWorldEntry(target, 'char-1')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/解除这些关系/)
    expect(target.worldBible!.entries).toHaveLength(3)
  })

  it('被事件线引用时拒绝删除；解绑后可以删除', () => {
    const target = withEntries()
    const blocked = applyRemoveWorldEntry(target, 'char-3')
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toMatch(/先在事件线里解绑/)

    target.storylines![0]!.entryIds = []
    expect(applyRemoveWorldEntry(target, 'char-3').ok).toBe(true)
    expect(target.worldBible!.entries.map((entry) => entry.id)).toEqual(['char-1', 'char-2'])
  })

  it('没有依赖的词条可以直接删除', () => {
    const target = withEntries()
    expect(applyRemoveWorldEntry(target, 'char-2').ok).toBe(true)
    expect(target.worldBible!.entries.map((entry) => entry.id)).toEqual(['char-1', 'char-3'])
  })
})

describe('词条关系：手动建立与解除', () => {
  const host = () => ({
    entries: [
      { id: 'char-1', name: '林砚', locked: false, relations: [] as Array<{ id: string; targetEntryId: string; type: string; description: string }> },
      { id: 'char-2', name: '巡夜人', locked: false, relations: [] as Array<{ id: string; targetEntryId: string; type: string; description: string }> },
      { id: 'char-3', name: '旧钟', locked: true, relations: [] as Array<{ id: string; targetEntryId: string; type: string; description: string }> }
    ]
  })

  it('建立关系只长在起点词条上，不改目标词条', () => {
    const draft = host()
    const result = applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-2', type: '师徒', description: '互相掩护', id: 'rel-1' })

    expect(result.ok).toBe(true)
    expect(draft.entries[0]!.relations).toEqual([{ id: 'rel-1', targetEntryId: 'char-2', type: '师徒', description: '互相掩护' }])
    expect(draft.entries[1]!.relations, '不得反向自动建立一条').toEqual([])
  })

  it('拒绝自关联、重复关联、锁定起点与不存在的目标', () => {
    const draft = host()
    expect(applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-1', id: 'rel-x' }).message).toContain('它自己')
    expect(applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'missing', id: 'rel-x' }).message).toContain('目标词条')
    expect(applyAddEntryRelation(draft, { fromEntryId: 'char-3', toEntryId: 'char-1', id: 'rel-x' }).message).toContain('锁定')

    expect(applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-2', id: 'rel-1' }).ok).toBe(true)
    const duplicate = applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-2', id: 'rel-2' })
    expect(duplicate.ok).toBe(false)
    expect(duplicate.message).toContain('已经关联')
    expect(draft.entries[0]!.relations, '重复关联不得写入').toHaveLength(1)
  })

  it('解除关系只删这一条，其余关系与词条本身都不动', () => {
    const draft = host()
    applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-2', id: 'rel-1' })
    applyAddEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-3', id: 'rel-2' })

    expect(applyRemoveEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-2' }).ok).toBe(true)
    expect(draft.entries[0]!.relations).toEqual([{ id: 'rel-2', targetEntryId: 'char-3', type: '关联', description: '' }])
    expect(applyRemoveEntryRelation(draft, { fromEntryId: 'char-1', toEntryId: 'char-2' }).ok, '重复解除应当失败').toBe(false)
  })

  it('关系存在时删除被指向的词条会被拒绝，解除后即可删除', () => {
    const draft = { worldConstraints: [], worldBible: host() } as unknown as WorldWritingDraft
    applyAddEntryRelation(draft.worldBible!, { fromEntryId: 'char-1', toEntryId: 'char-2', id: 'rel-1' })

    expect(applyRemoveWorldEntry(draft, 'char-2').ok).toBe(false)
    expect(applyRemoveWorldEntry(draft, 'char-2').message).toContain('林砚')

    applyRemoveEntryRelation(draft.worldBible!, { fromEntryId: 'char-1', toEntryId: 'char-2' })
    expect(applyRemoveWorldEntry(draft, 'char-2').ok, '解除引用后可安全删除').toBe(true)
  })
})
