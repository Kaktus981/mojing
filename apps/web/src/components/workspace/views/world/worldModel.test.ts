import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, emptyWorldDetails, type NovelProject } from '../../../../../../../packages/contracts/src'
import {
  WORLD_ENTRY_TYPES,
  WORLD_PAGE_IDS,
  buildRulesBoundaries,
  buildWorldEntries,
  buildWorldExpansion,
  buildWorldOverview,
  buildWorldTimeline,
  isWorldPageId,
  worldPageKind
} from './worldModel'

const NOW = '2026-09-13T12:00:00.000Z'

function rawWorld() {
  return {
    schemaVersion: 7,
    id: 'novel-world',
    title: '折光之城',
    seed: '',
    status: '创作中',
    revision: 4,
    settings: {
      genreTemplate: '通用', targetWords: 200_000, plannedVolumes: 1, plannedChapters: 20,
      pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '',
      language: '简体中文', rhetoricIntensity: 1
    },
    worldBible: {
      status: '草稿',
      summary: '雾城与归墟。',
      premise: '旧秩序崩塌。',
      themes: ['归乡'],
      rules: ['归墟重启周期为三十年', '灵气枯竭边界逐年回缩'],
      geography: '',
      historySummary: '',
      entries: [
        {
          id: 'e-1', type: '角色', name: '沈砚', aliases: ['小砚'], tags: ['主角'], summary: '归城的年轻人',
          notes: '', locked: true, aiVisibility: '始终可见',
          relations: [
            { id: 'r-1', type: '师徒', targetEntryId: 'e-2', description: '' },
            { id: 'r-2', type: '旧识', targetEntryId: 'e-missing', description: '' }
          ],
          customFields: {}, details: emptyWorldDetails('角色')
        },
        {
          id: 'e-2', type: '地点', name: '回雁城', aliases: [], tags: [], summary: '', notes: '',
          locked: false, aiVisibility: '按需召回', relations: [], customFields: {},
          details: emptyWorldDetails('地点')
        },
        {
          id: 'e-3', type: '修行体系', name: '灯火诀', aliases: [], tags: [], summary: '靠灯火续命的功法',
          notes: '', locked: false, aiVisibility: '仅审校', relations: [], customFields: {},
          details: emptyWorldDetails('修行体系')
        }
      ],
      timeline: [
        { id: 't-1', dateLabel: '雷变元年', order: 1, title: '雷变之夜', description: '归墟第一次松动。', entryIds: ['e-1', 'e-missing'], locked: true },
        { id: 't-2', dateLabel: '雷变元年', order: 2, title: '断简现世', description: '', entryIds: ['e-2'], locked: false }
      ],
      updatedAt: NOW
    },
    chapters: [],
    memories: [],
    plotThreads: [
      {
        id: 'th-1', title: '断简的温度', detail: '', characterIds: [], status: '已埋设',
        setupMethod: '', resolutionMethod: '', progress: [], updatedAt: NOW
      }
    ],
    branches: [],
    reviews: [],
    worldConstraints: [
      {
        id: 'c-1', term: '归墟', definition: '世界重启周期', notDefinition: '不是地名', entityType: '概念',
        allowedUsages: ['归墟重启'], forbiddenUsages: [{ phrase: '归墟之门', reason: '与设定冲突', suggestedReplacement: '归墟裂隙' }],
        unresolvedQuestions: ['重启的确切时长？'],
        facts: [{ subject: '归墟', relation: '周期', object: '三十年', polarity: '允许' }],
        source: { fieldPath: 'worldBible.rules.0', excerpt: '归墟重启周期为三十年' },
        status: '待确认', createdAt: NOW, updatedAt: NOW
      },
      {
        id: 'c-2', term: '灯火诀', definition: '续命功法', notDefinition: '', entityType: '',
        allowedUsages: [], forbiddenUsages: [], unresolvedQuestions: [], facts: [],
        source: { fieldPath: 'worldBible.rules.1', excerpt: '灵气枯竭边界逐年回缩' },
        status: '已锁定', createdAt: NOW, updatedAt: NOW
      }
    ],
    worldQualityFindings: [
      {
        id: 'q-1', type: '术语误用', severity: '中', confidence: 0.7,
        evidence: { fieldPath: 'worldBible.summary', excerpt: '雾城与归墟' },
        constraintIds: ['c-1'], explanation: '摘要把归墟当地名使用。', suggestedReplacement: '雾城与归墟周期',
        baseFieldDigest: 'digest', status: '待处理', source: '本地规则', createdAt: NOW
      }
    ],
    worldExpansionProposals: [
      {
        id: 'x-1', title: '新增海上势力', reason: '第二卷需要对手方', baseRevision: 4, baseWorldDigest: 'digest',
        proposedEntries: [{ name: '沧溟会' }], sourceChapterIds: ['ch-1'], plannedChapterNumbers: [3, 4],
        transitionPlan: [{ chapterNumber: 3, purpose: '引出沧溟会', changes: ['新增势力'], suggestion: '' }],
        affectedChapterIds: ['ch-1'], affectedOutlineChapterIds: [],
        conflicts: [{ kind: '正文尚无铺垫', message: '第 1 章未出现海上势力', severity: '中', relatedChapterIds: [] }],
        causalChain: [{ id: 'cl-1', layer: '底层规则', title: '潮汐周期', description: '', sourceEntryIds: [], status: '待确认' }],
        unresolvedQuestions: ['沧溟会是否与归墟有关？'],
        impactSummary: '新增一个与归墟周期相关的海上势力。',
        status: '待确认', createdAt: NOW, updatedAt: NOW
      }
    ],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function baseProject(): NovelProject {
  return NovelProjectSchema.parse(rawWorld())
}

function emptyProject(): NovelProject {
  return NovelProjectSchema.parse({
    ...rawWorld(),
    worldBible: undefined,
    worldConstraints: [],
    worldQualityFindings: [],
    worldExpansionProposals: undefined
  })
}

describe('世界观二级页面拆分', () => {
  it('五个二级入口页面类型唯一', () => {
    expect(WORLD_PAGE_IDS).toHaveLength(5)
    const kinds = WORLD_PAGE_IDS.map((id) => worldPageKind(id))
    expect(new Set(kinds).size).toBe(5)
    expect(isWorldPageId('world-overview')).toBe(true)
    expect(isWorldPageId('outline-foundation')).toBe(false)
    expect(worldPageKind('nope')).toBe('overview')
  })

  it('同一份项目在五个页面上产出不同内容', () => {
    const project = baseProject()
    const overview = buildWorldOverview(project)
    const rules = buildRulesBoundaries(project)
    const entries = buildWorldEntries(project)
    const timeline = buildWorldTimeline(project)
    const expansion = buildWorldExpansion(project)
    expect([overview.kind, rules.kind, entries.kind, timeline.kind, expansion.kind])
      .toEqual(['overview', 'rules', 'entries', 'timeline', 'expansion'])

    expect(overview.entryCount).toBe(3)
    expect(rules.rules).toHaveLength(2)
    expect(entries.groups.map((group) => group.type)).toEqual(['角色', '修行体系', '地点'])
    expect(timeline.events.map((event) => event.order)).toEqual([1, 2])
    expect(expansion.proposals.map((proposal) => proposal.id)).toEqual(['x-1'])
  })
})

describe('世界总览', () => {
  it('统计全部来自真实数据，含悬空关系与待确认术语', () => {
    const model = buildWorldOverview(baseProject())
    expect(model.hasWorld).toBe(true)
    expect(model.status).toBe('草稿')
    expect(model.entryCount).toBe(3)
    expect(model.lockedEntryCount).toBe(1)
    expect(model.relationCount).toBe(2)
    expect(model.brokenRelationCount).toBe(1)
    expect(model.ruleCount).toBe(2)
    expect(model.timelineCount).toBe(2)
    expect(model.constraints).toEqual({ total: 2, 待确认: 1, 已确认: 0, 已锁定: 1, 已拒绝: 0 })
    expect(model.pendingQualityFindings).toBe(1)
    expect(model.expansionProposalCount).toBe(1)
  })

  it('缺字段如实列出，不用空串冒充已建立', () => {
    const model = buildWorldOverview(baseProject())
    expect(model.missingFields).toEqual(['地理', '历史概览'])
    expect(model.coverage).toHaveLength(WORLD_ENTRY_TYPES.length)
    expect(model.uncoveredTypes).toContain('货币')
    expect(model.coverage.find((item) => item.type === '角色')?.count).toBe(1)
  })
})

describe('规则与边界', () => {
  it('规则与术语边界都来自项目，且状态如实展示', () => {
    const model = buildRulesBoundaries(baseProject())
    expect(model.rules.map((rule) => rule.text)).toEqual(['归墟重启周期为三十年', '灵气枯竭边界逐年回缩'])
    expect(model.constraints.map((item) => item.status)).toEqual(['待确认', '已锁定'])
    expect(model.constraints[0]!.notDefinition).toBe('不是地名')
    expect(model.constraints[0]!.forbiddenUsages[0]!.suggestedReplacement).toBe('归墟裂隙')
    expect(model.constraints[0]!.unresolvedQuestions).toEqual(['重启的确切时长？'])
    expect(model.constraints[0]!.facts[0]!.polarity).toBe('允许')
    expect(model.constraints[0]!.sourceExcerpt).toContain('归墟重启周期')
  })

  it('审校发现按真实状态计数，并明确 AI 修复只进候选层', () => {
    const model = buildRulesBoundaries(baseProject())
    expect(model.findings.map((finding) => finding.id)).toEqual(['q-1'])
    expect(model.pendingFindingCount).toBe(1)
    expect(model.findings[0]!.fieldPath).toBe('worldBible.summary')
    expect(model.notice.id).toBe('world-repair')
    expect(model.notice.detail).toContain('候选')
  })
})

describe('世界词条', () => {
  it('按类型分组，并算出真实的失效引用数', () => {
    const model = buildWorldEntries(baseProject())
    expect(model.entryCount).toBe(3)
    expect(model.unlockedCount).toBe(2)
    const role = model.groups.find((group) => group.type === '角色')!
    expect(role.items[0]!.name).toBe('沈砚')
    expect(role.items[0]!.locked).toBe(true)
    expect(role.items[0]!.aliasCount).toBe(1)
    expect(role.items[0]!.brokenRelationCount).toBe(1)
    expect(role.items[0]!.relationCount).toBe(2)
  })
})

describe('世界时间线', () => {
  it('按 order 排序展示真实事件，并标出失效关联与重复日期标签', () => {
    const model = buildWorldTimeline(baseProject())
    expect(model.events.map((event) => event.id)).toEqual(['t-1', 't-2'])
    expect(model.lockedCount).toBe(1)
    expect(model.events[0]!.brokenEntryIds).toEqual(['e-missing'])
    expect(model.repeatedLabels).toEqual([{ label: '雷变元年', count: 2 }])
  })
})

describe('扩展世界观', () => {
  it('展示真实候选内容，但所有操作禁用并写明接口未接通', () => {
    const model = buildWorldExpansion(baseProject())
    expect(model.proposals).toHaveLength(1)
    const proposal = model.proposals[0]!
    expect(proposal.title).toBe('新增海上势力')
    expect(proposal.proposedEntryCount).toBe(1)
    expect(proposal.plannedChapterNumbers).toEqual([3, 4])
    expect(proposal.transitionCount).toBe(1)
    expect(proposal.conflicts[0]!.category).toBe('正文尚无铺垫')
    expect(proposal.causalChain[0]!.layer).toBe('底层规则')
    expect(model.pendingCount).toBe(1)
    expect(model.actions).toHaveLength(4)
    for (const action of model.actions) {
      expect(action.enabled).toBe(false)
      expect(action.reason).toContain('暂未开放')
    }
    expect(model.notice.title).toBe('扩展世界观目前不能直接写入')
  })
})

describe('没有世界观的项目不出现假数据', () => {
  it('各页面返回空模型并如实说明', () => {
    const project = emptyProject()
    const overview = buildWorldOverview(project)
    expect(overview.hasWorld).toBe(false)
    expect(overview.entryCount).toBe(0)
    expect(overview.ruleCount).toBe(0)
    expect(overview.missingFields).toEqual([])
    expect(overview.uncoveredTypes).toHaveLength(WORLD_ENTRY_TYPES.length)

    const rules = buildRulesBoundaries(project)
    expect(rules.hasWorld).toBe(false)
    expect(rules.rules).toEqual([])
    expect(rules.constraints).toEqual([])
    expect(rules.findings).toEqual([])

    const entries = buildWorldEntries(project)
    expect(entries.hasWorld).toBe(false)
    expect(entries.groups).toEqual([])

    const timeline = buildWorldTimeline(project)
    expect(timeline.hasWorld).toBe(false)
    expect(timeline.events).toEqual([])

    const expansion = buildWorldExpansion(project)
    expect(expansion.proposals).toEqual([])
    expect(expansion.pendingCount).toBe(0)
    expect(expansion.notice.title).toBe('扩展世界观目前不能直接写入')
  })
})
