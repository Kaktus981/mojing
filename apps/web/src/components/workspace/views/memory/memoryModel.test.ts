import { describe, expect, it } from 'vitest'
import {
  MemoryProposalSchema,
  NovelMemoryHealthSchema,
  NovelProjectSchema,
  emptyWorldDetails,
  type MemoryProposal,
  type NovelProject
} from '../../../../../../../packages/contracts/src'
import {
  MEMORY_NOTICE_BATCH,
  MEMORY_NOTICE_MANUAL,
  MEMORY_PAGE_IDS,
  buildForeshadowing,
  buildMemoryLedger,
  buildMemoryProposals,
  buildMemoryRecall,
  buildMemoryWorkbench,
  chapterLabel,
  isApplicableAt,
  isFutureFor,
  isMemoryPageId,
  memoryPageKind,
  resolveTargetChapter,
  resolveTargetCharacterIds,
  threadHasHistory
} from './memoryModel'

const NOW = '2026-09-13T12:00:00.000Z'

function settings() {
  return {
    genreTemplate: '通用', targetWords: 200_000, plannedVolumes: 1, plannedChapters: 20,
    pointOfView: '第三人称限知', tense: '过去时', audience: '', style: '', contentLimits: '',
    language: '简体中文', rhetoricIntensity: 1
  }
}

/**
 * 夹具刻意做成「一份有真实缺口的项目」：
 *   - 第 3 章是未来章（相对第 2 章），并且它的 sourceDigest 为空；
 *   - 第 1 章记忆的摘要与正文摘要已经不一致（需更新）；
 *   - 有一条记忆的生效起点在第 3 章，用来验证「未来信息不进入更早章节」。
 * 只有这样才能同时证明「真实数据照着显示」与「不给假数据」。
 */
function rawProject() {
  return {
    schemaVersion: 7,
    id: 'novel-memory',
    title: '折光之城',
    seed: '',
    status: '创作中',
    revision: 9,
    settings: settings(),
    worldBible: {
      status: '草稿',
      summary: '雾城与归墟。',
      premise: '',
      themes: [],
      rules: [],
      geography: '',
      historySummary: '',
      entries: [
        {
          id: 'e-1', type: '角色', name: '沈砚', aliases: [], tags: [], summary: '', notes: '',
          locked: false, aiVisibility: '始终可见', relations: [], customFields: {}, details: emptyWorldDetails('角色')
        },
        {
          id: 'e-2', type: '角色', name: '柳明', aliases: [], tags: [], summary: '', notes: '',
          locked: false, aiVisibility: '按需召回', relations: [], customFields: {}, details: emptyWorldDetails('角色')
        }
      ],
      timeline: [],
      updatedAt: NOW
    },
    outline: {
      status: '草稿',
      synopsis: '',
      themes: [],
      mainConflict: '',
      endingDirection: '',
      updatedAt: NOW,
      volumes: [
        {
          id: 'v-1', volumeNumber: 1, title: '第一卷', goal: '', climax: '', resolution: '',
          chapters: [
            {
              id: 'oc-1', volumeNumber: 1, chapterNumber: 1, title: '第一章 雾中来客',
              pov: '沈砚', objective: '', conflict: '', turningPoint: '', reveal: '', endingHook: '',
              characterIds: ['e-1', 'e-2'], setupThreadIds: ['th-1'], payoffThreadIds: [], beats: []
            }
          ]
        }
      ]
    },
    chapters: [
      { id: 'ch-1', volumeNumber: 1, chapterNumber: 1, title: '第一章 雾中来客', blocks: [{ id: 'b-1', text: '沈砚抵达回雁城。' }], status: '定稿', sourceDigest: 'digest-ch1-v2', updatedAt: NOW },
      { id: 'ch-2', volumeNumber: 1, chapterNumber: 2, title: '第二章 断简', blocks: [{ id: 'b-2', text: '柳明说断简认主。' }], status: '定稿', sourceDigest: 'digest-ch2', updatedAt: NOW },
      { id: 'ch-3', volumeNumber: 1, chapterNumber: 3, title: '第三章 归墟', blocks: [], status: '草稿', sourceDigest: '', updatedAt: NOW }
    ],
    memories: [
      {
        id: 'm-1', chapterId: 'ch-1', chapterNumber: 1, status: '需更新',
        sourceDigest: 'digest-ch1-v1', summary: '沈砚入城。', keyEvents: ['入城'],
        facts: [
          {
            id: 'f-1', category: '事件', content: '沈砚抵达回雁城', certainty: '正式', locked: false,
            source: { chapterId: 'ch-1', blockId: 'b-1', excerpt: '沈砚抵达回雁城。' }
          }
        ],
        characterStates: [
          {
            id: 's-1', characterId: 'e-1', characterName: '沈砚', location: '回雁城', ability: '', physicalState: '',
            emotion: '戒备', goal: '', knowledge: [], relationships: [],
            source: { chapterId: 'ch-1', blockId: 'b-1', excerpt: '沈砚抵达回雁城。' }
          }
        ],
        objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: NOW
      },
      {
        id: 'm-2', chapterId: 'ch-2', chapterNumber: 2, status: '正式',
        sourceDigest: 'digest-ch2', summary: '断简认主。', keyEvents: ['断简认主'],
        facts: [
          {
            id: 'f-2', category: '关系', content: '沈砚与柳明是同门', certainty: '正式', locked: false,
            source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }
          },
          {
            id: 'f-3', category: '秘密', content: '柳明身怀断简', certainty: '推测', locked: false,
            perspective: '角色认知', knownToCharacterIds: ['e-1'],
            knowledgeEvidence: [{ chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }],
            source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }
          },
          {
            id: 'f-5', category: '事件', content: '断简被夺', certainty: '未决', locked: false,
            appliesFromChapter: 3,
            source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }
          },
          {
            id: 'f-7', category: '事件', content: '断简重新回到沈砚手中', certainty: '正式', locked: false,
            replacesId: 'f-1',
            source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }
          }
        ],
        characterStates: [
          {
            id: 's-2', characterId: 'e-2', characterName: '柳明', location: '断简洞', ability: '', physicalState: '重伤',
            emotion: '', goal: '', knowledge: [], relationships: [],
            perspective: '角色认知', knownToCharacterIds: ['e-2'],
            source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' }
          }
        ],
        objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: NOW
      },
      {
        id: 'm-3', chapterId: 'ch-3', chapterNumber: 3, status: '需更新',
        sourceDigest: '', summary: '归墟开启。', keyEvents: [],
        facts: [
          {
            id: 'f-4', category: '事件', content: '归墟开启', certainty: '正式', locked: true,
            source: { chapterId: 'ch-3', excerpt: '归墟开启。' }
          }
        ],
        characterStates: [], objectStates: [], timelineEvents: [], styleSignals: [], updatedAt: NOW
      }
    ],
    plotThreads: [
      {
        id: 'th-1', title: '断简的温度', detail: '断简与归墟的联系', characterIds: ['e-1', 'e-2'], status: '推进中',
        setupChapterId: 'ch-1', setupMethod: '第一章点出断简',
        targetPayoffChapter: 6, resolutionMethod: '',
        setupEvidence: { chapterId: 'ch-1', blockId: 'b-1', excerpt: '断简在掌心发烫。' },
        evidencePool: [
          { id: 'ev-1', phase: '埋设', chapterId: 'ch-1', excerpt: '断简在掌心发烫。', note: '首次出现', source: '正文', confidence: 1, status: '有效' },
          { id: 'ev-2', phase: '推进', chapterId: 'ch-2', excerpt: '柳明说断简认主。', note: '补足因果', source: '作者记录', confidence: 0.9, status: '待核实' }
        ],
        progress: [
          { id: 'pg-1', chapterId: 'ch-2', description: '断简认主', source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' } }
        ],
        cognition: {
          reader: '读者知道断简认主', protagonist: '沈砚只知道断简发烫',
          otherCharacters: [{ characterId: 'e-2', characterName: '柳明', knowledge: '柳明知道断简认主', evidenceIds: ['ev-2'] }],
          gapSummary: '主角认知落后', updatedAt: NOW
        },
        readiness: {
          score: 0.6, level: '接近回收', fulfilled: ['埋设完成'], gaps: ['缺少回收证据'],
          basis: ['证据池 2 项'], recommendation: '补一条回收证据', assessedAt: NOW
        },
        revealReadiness: 0.4,
        cognitiveGap: '旧版认知差描述',
        revisionHistory: [
          { id: 'rv-1', changedAt: '2026-09-10T10:00:00.000Z', fromStatus: '已埋设', toStatus: '推进中', chapterId: 'ch-2', reason: '第二章推进' }
        ],
        updatedAt: NOW
      },
      { id: 'th-2', title: '海上势力', detail: '第二卷对手', characterIds: [], status: '计划', setupMethod: '', resolutionMethod: '', progress: [], updatedAt: NOW },
      { id: 'th-3', title: '断简的归宿', detail: '', characterIds: [], status: '逾期', setupMethod: '', resolutionMethod: '', progress: [], updatedAt: NOW }
    ],
    branches: [],
    reviews: [],
    worldConstraints: [],
    worldQualityFindings: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function baseProject(): NovelProject {
  return NovelProjectSchema.parse(rawProject())
}

/** 一份「什么都还没发生」的真实空项目：不补任何占位。 */
function emptyProject(): NovelProject {
  return NovelProjectSchema.parse({
    ...rawProject(),
    worldBible: undefined,
    outline: undefined,
    chapters: [],
    memories: [],
    plotThreads: []
  })
}

/**
 * 提案夹具在第 2 条上刻意使用「解析后的真实角色状态」当 before 快照，
 * 这样 JSON 比对必然相等 —— 用来证明 changedSinceGeneration 真的是比对出来的，
 * 而不是恒定返回 true。第 1 条则给了与正式值不同的旧快照。
 */
function proposals(project: NovelProject): MemoryProposal[] {
  const stateSnapshot = project.memories[1]!.characterStates[0]!
  return [
    MemoryProposalSchema.parse({
      id: 'p-1', projectId: 'novel-memory', chapterId: 'ch-1', sourceDigest: 'digest-ch1-v1',
      category: '剧情事实', targetId: 'f-1',
      before: { id: 'f-1', content: '旧内容' }, candidate: { id: 'f-1', content: '新内容' },
      source: { chapterId: 'ch-1', blockId: 'b-1', excerpt: '沈砚抵达回雁城。' },
      confidence: 0.82, risk: '中', status: '待确认', createdAt: NOW
    }),
    MemoryProposalSchema.parse({
      id: 'p-2', projectId: 'novel-memory', chapterId: 'ch-2', sourceDigest: 'digest-ch2',
      category: '角色状态', targetId: 's-2', before: stateSnapshot, candidate: { characterId: 'e-2', location: '断简洞深处' },
      source: { chapterId: 'ch-2', blockId: 'b-2', excerpt: '柳明说断简认主。' },
      confidence: 0.6, risk: '低', status: '已接受', createdAt: NOW
    }),
    MemoryProposalSchema.parse({
      id: 'p-3', projectId: 'novel-memory', chapterId: 'ch-3', sourceDigest: 'digest-ch3',
      category: '章节摘要', candidate: { summary: '归墟开启。' },
      source: { chapterId: 'ch-3', excerpt: '归墟开启。' },
      confidence: 0.5, risk: '低', status: '已失效', createdAt: NOW
    }),
    MemoryProposalSchema.parse({
      id: 'p-4', projectId: 'novel-memory', chapterId: 'ch-404', sourceDigest: 'digest-x',
      category: '伏笔', candidate: { title: '断简的温度' },
      source: { chapterId: 'ch-404', excerpt: '未知' },
      confidence: 0.4, risk: '高', status: '已拒绝', createdAt: NOW
    })
  ]
}

describe('记忆与伏笔二级页面拆分', () => {
  it('五个二级入口页面类型唯一', () => {
    expect(MEMORY_PAGE_IDS).toHaveLength(5)
    const kinds = MEMORY_PAGE_IDS.map((id) => memoryPageKind(id))
    expect(new Set(kinds).size).toBe(5)
    expect(isMemoryPageId('foreshadowing')).toBe(true)
    expect(isMemoryPageId('memory-ledger')).toBe(true)
    expect(isMemoryPageId('prose-editor')).toBe(false)
    expect(memoryPageKind('nope')).toBe('workbench')
  })

  it('同一份项目在五个页面上产出不同内容', () => {
    const project = baseProject()
    const rows = proposals(project)
    const workbench = buildMemoryWorkbench({ project, proposals: rows })
    const recall = buildMemoryRecall(project, 2, '已选章节')
    const proposalModel = buildMemoryProposals({ project, proposals: rows })
    const foreshadowing = buildForeshadowing(project)
    const ledger = buildMemoryLedger(project)

    expect([workbench.kind, recall.kind, proposalModel.kind, foreshadowing.kind, ledger.kind])
      .toEqual(['workbench', 'recall', 'proposals', 'foreshadowing', 'ledger'])

    // 五页各自看到的是不同的真实切片，不是同一个数字换标题。
    expect(workbench.memories.total).toBe(3)
    expect(recall.objective.map((item) => item.id)).toEqual(['f-1', 's-1', 'f-2', 'f-7'])
    expect(proposalModel.counts).toEqual({ pending: 1, resolved: 2, expired: 1 })
    expect(foreshadowing.counts.total).toBe(3)
    expect(ledger.rows.map((row) => row.id)).toEqual(['m-1', 'm-2', 'm-3'])
  })
})

describe('目标章节解析', () => {
  it('优先已选章节，否则退回最新章节并如实标注来源', () => {
    const project = baseProject()
    expect(resolveTargetChapter(project, 'ch-2')).toMatchObject({ source: '已选章节', chapter: { chapterNumber: 2 } })
    expect(resolveTargetChapter(project)).toMatchObject({ source: '最新章节', chapter: { chapterNumber: 3 } })
    // 选中 id 已失效时不假装选中，退回最新章节。
    expect(resolveTargetChapter(project, 'ch-404')).toMatchObject({ source: '最新章节', chapter: { chapterNumber: 3 } })
  })

  it('没有章节时明确返回「尚无章节」，不编一个目标章', () => {
    expect(resolveTargetChapter(emptyProject())).toEqual({ source: '尚无章节' })
    expect(chapterLabel(undefined)).toBe('未标注章号')
    expect(chapterLabel(3)).toBe('第 3 章')
  })

  it('目标章角色来自同名章纲卡的真实 characterIds', () => {
    const project = baseProject()
    expect(resolveTargetCharacterIds(project, 1)).toEqual(['e-1', 'e-2'])
    expect(resolveTargetCharacterIds(project, 99)).toEqual([])
    expect(resolveTargetCharacterIds(project, undefined)).toEqual([])
  })
})

describe('页面 2 · 长篇记忆召回', () => {
  it('客观事实与角色认知分轨，且严格按有效章节范围过滤', () => {
    const model = buildMemoryRecall(baseProject(), 2, '已选章节')

    expect(model.targetSource).toBe('已选章节')
    expect(model.chapterNumber).toBe(2)
    expect(model.objective.map((item) => item.id)).toEqual(['f-1', 's-1', 'f-2', 'f-7'])
    expect(model.cognition.map((item) => item.id)).toEqual(['f-3', 's-2'])
    expect(model.objective.every((item) => item.perspective === '客观事实')).toBe(true)
    expect(model.cognition.every((item) => item.perspective === '角色认知')).toBe(true)
  })

  it('晚于目标章的记忆整章不参与，未来生效的信息被排除并计数', () => {
    const model = buildMemoryRecall(baseProject(), 2)

    // 第 3 章整章不进召回。
    expect(model.futureChapterMemories).toEqual({ count: 1, chapterNumbers: [3] })
    // f-5 的生效起点在第 3 章，在第 2 章只能被排除。
    expect(model.futureExcluded.count).toBe(1)
    expect(model.futureExcluded.items[0]).toMatchObject({ id: 'f-5', appliesFromChapter: 3 })
    // 结构性保证：任何被召回的条目都不来自晚于目标章的章节。
    expect([...model.objective, ...model.cognition].every((item) => item.sourceChapterNumber <= 2)).toBe(true)
    expect(model.notice.id).toBe('memory-recall-scope')
  })

  it('召回条目只带真实字段：知情角色按世界观词条解析名字，证据原文照抄', () => {
    const model = buildMemoryRecall(baseProject(), 2)
    const cognitionFact = model.cognition.find((item) => item.id === 'f-3')!
    expect(cognitionFact.knownTo).toEqual(['沈砚'])
    expect(cognitionFact.evidenceExcerpts).toEqual(['柳明说断简认主。'])
    expect(cognitionFact.excerpt).toBe('柳明说断简认主。')
    expect(cognitionFact.reason).toContain('第 2 章正式记忆')
    expect(cognitionFact.locked).toBe(false)

    const state = model.objective.find((item) => item.id === 's-1')!
    expect(state.kind).toBe('角色状态')
    expect(state.detail).toContain('位置：回雁城')
    expect(state.layer).toBe('动态状态')
  })

  it('动态状态层与剧情证据层的计数都来自真实条目', () => {
    const model = buildMemoryRecall(baseProject(), 2)
    expect(model.layers.find((layer) => layer.layer === '剧情证据')?.count).toBe(4)
    expect(model.layers.find((layer) => layer.layer === '动态状态')?.count).toBe(2)
  })

  it('没有目标章时返回空召回，而不是默认第一章', () => {
    const model = buildMemoryRecall(emptyProject())
    expect(model.targetSource).toBe('尚无章节')
    expect(model.chapterNumber).toBeUndefined()
    expect(model.objective).toEqual([])
    expect(model.cognition).toEqual([])
    expect(model.layers).toEqual([])
    expect(model.futureExcluded.count).toBe(0)
    expect(model.futureChapterMemories.count).toBe(0)
  })

  it('生效范围判定是纯函数，边界值确定', () => {
    expect(isApplicableAt({}, 5)).toBe(true)
    expect(isApplicableAt({ appliesFromChapter: 3 }, 2)).toBe(false)
    expect(isApplicableAt({ appliesFromChapter: 3 }, 3)).toBe(true)
    expect(isApplicableAt({ appliesThroughChapter: 2 }, 3)).toBe(false)
    expect(isApplicableAt({ appliesFromChapter: 2, appliesThroughChapter: 4 }, 3)).toBe(true)
    expect(isFutureFor({ appliesFromChapter: 4 }, 3)).toBe(true)
    expect(isFutureFor({ appliesFromChapter: 3 }, 3)).toBe(false)
    expect(isFutureFor({}, 1)).toBe(false)
  })
})

describe('页面 1 · 记忆工作台', () => {
  it('汇总全部来自真实数据，并列出真实待办来源', () => {
    const project = baseProject()
    const model = buildMemoryWorkbench({ project, proposals: proposals(project) })

    expect(model.target).toMatchObject({ chapterNumber: 3, status: '草稿', source: '最新章节' })
    expect(model.memories).toEqual({ total: 3, formal: 1, needsUpdate: 2, pendingReview: 0 })
    expect(model.proposals).toEqual({ total: 4, pending: 1, accepted: 1, rejected: 1, expired: 1 })
    expect(model.threads).toEqual({ total: 3, open: 3, overdue: 1, protectedFromDelete: 1 })
    expect(model.recall).toMatchObject({ objective: 6, cognition: 2, futureExcluded: 0 })
    expect(model.todos.map((todo) => todo.id)).toEqual(['pending-proposals', 'stale-memories', 'overdue-threads'])
    expect(model.todos.find((todo) => todo.id === 'stale-memories')?.label).toBe('2 章正式记忆需更新')
    expect(model.todos.map((todo) => todo.page)).toEqual(['memory-proposals', 'memory-ledger', 'foreshadowing'])
  })

  it('没有健康检查快照时如实显示「未评估」，不生成百分比', () => {
    const project = baseProject()
    const model = buildMemoryWorkbench({ project, proposals: [] })
    expect(model.health.assessed).toBe(false)
    expect(model.health.entries).toEqual([])
    expect(model.health.lastSuccessAt).toBeUndefined()
  })

  it('有快照时逐项照抄真实字段值', () => {
    const health = NovelMemoryHealthSchema.parse({
      pendingProposals: 1, staleMemories: 2, missingSummaries: 0,
      unresolvedThreads: 1, overdueThreads: 1, unindexedChapters: 0, indexedMentions: 12
    })
    const model = buildMemoryWorkbench({ project: baseProject(), proposals: [], health })
    expect(model.health.assessed).toBe(true)
    expect(model.health.entries).toHaveLength(15)
    expect(model.health.entries.find((entry) => entry.key === 'staleMemories')?.value).toBe(2)
    expect(model.health.entries.find((entry) => entry.key === 'indexedMentions')?.value).toBe(12)
    expect(model.health.entries.find((entry) => entry.key === 'missingSummaries')?.value).toBe(0)
  })
})

describe('页面 3 · 记忆变更提案', () => {
  it('三方对照只读真实值，并标出「生成后正式值已变」与「提案基于旧正文」', () => {
    const project = baseProject()
    const model = buildMemoryProposals({ project, proposals: proposals(project) })
    const p1 = model.pending[0]!

    expect(p1.current.present).toBe(true)
    expect(p1.current.text).toBe('事件：沈砚抵达回雁城')
    expect(p1.current.detail).toBe('第 1 章 · 正式')
    expect(p1.generated.text).toBe('旧内容')
    expect(p1.changedSinceGeneration).toBe(true)
    expect(p1.basedOnStaleText).toBe(true)
    expect(p1.candidateJson).toContain('新内容')
    expect(p1.appliesRange).toBe('未限定（按第一章起、长期有效）')
  })

  it('候选与正式值一致时不谎报变化', () => {
    const project = baseProject()
    const model = buildMemoryProposals({ project, proposals: proposals(project) })
    const p2 = model.resolved.find((row) => row.id === 'p-2')!
    expect(p2.changedSinceGeneration).toBe(false)
    expect(p2.basedOnStaleText).toBe(false)
    expect(p2.current.text).toBe('柳明：断简洞')
    expect(p2.current.detail).toBe('第 2 章 · 重伤')
  })

  it('目标记录不存在或类别无正式记录时如实说明，不编一个现值', () => {
    const project = baseProject()
    const model = buildMemoryProposals({ project, proposals: proposals(project) })
    const expired = model.expired.find((row) => row.id === 'p-3')!
    expect(expired.current.present).toBe(true)
    expect(expired.current.text).toBe('归墟开启。')

    const rejected = model.resolved.find((row) => row.id === 'p-4')!
    expect(rejected.chapterTitle).toBe('未知章节')
    expect(rejected.current.present).toBe(false)
    expect(rejected.current.text).toBe('未记载（该类别还没有正式记录）')
  })

  it('逐条和批量处理可用；人工摘要修订进入提案', () => {
    const model = buildMemoryProposals({ project: baseProject(), proposals: [] })
    expect(model.singleResolveAvailable).toBe(true)
    expect(model.batch.enabled).toBe(true)
    expect(model.manual.enabled).toBe(true)
    expect(model.batch.notice).toEqual(MEMORY_NOTICE_BATCH)
    expect(model.manual.notice).toEqual(MEMORY_NOTICE_MANUAL)
    expect(model.batch.notice.detail).toContain('整批都不会写入')
    expect(model.manual.notice.detail).toContain('待确认提案')
  })
})

describe('页面 4 · 伏笔中心', () => {
  it('有证据或状态历史的伏笔不允许硬删除，并逐条给出保护原因', () => {
    const model = buildForeshadowing(baseProject())
    const protectedThread = model.threads.find((thread) => thread.id === 'th-1')!
    expect(protectedThread.protectedFromDelete).toBe(true)
    expect(protectedThread.protectionReasons).toEqual([
      '2 项证据池记录', '1 条推进记录', '1 条状态历史', '埋设原文证据'
    ])

    const bare = model.threads.find((thread) => thread.id === 'th-2')!
    expect(bare.protectedFromDelete).toBe(false)
    expect(bare.protectionReasons).toEqual([])

    expect(model.counts).toEqual({ total: 3, open: 3, overdue: 1, protectedFromDelete: 1, unassessedReadiness: 2 })
    expect(model.notice.id).toBe('memory-thread-delete')
    expect(model.notice.detail).toContain('证据和历史会保留')
  })

  it('threadHasHistory 只看真实的证据 / 推进 / 历史字段', () => {
    const project = baseProject()
    expect(threadHasHistory(project.plotThreads[0]!)).toBe(true)
    expect(threadHasHistory(project.plotThreads[1]!)).toBe(false)
    expect(threadHasHistory(project.plotThreads[2]!)).toBe(false)
  })

  it('证据池与旧字段归一化成同一种证据行，并按阶段真实计数', () => {
    const model = buildForeshadowing(baseProject())
    const thread = model.threads.find((row) => row.id === 'th-1')!
    // 证据池 2 条 + 旧 setupEvidence 1 条 + progress 1 条
    expect(thread.evidence).toHaveLength(4)
    expect(thread.evidence.filter((item) => item.legacy)).toHaveLength(2)
    expect(thread.byPhase).toEqual([
      { phase: '埋设', count: 2 }, { phase: '推进', count: 2 },
      { phase: '回收', count: 0 }, { phase: '旁证', count: 0 }, { phase: '冲突', count: 0 }
    ])
    expect(model.phases.find((item) => item.phase === '埋设')?.count).toBe(2)
    expect(model.phases.find((item) => item.phase === '推进')?.count).toBe(2)
    expect(thread.setup.chapterNumber).toBe(1)
    expect(thread.payoff.targetChapter).toBe(6)
  })

  it('没有准备度快照就写「未评估」，有快照才显示分数与依据', () => {
    const model = buildForeshadowing(baseProject())
    const assessed = model.threads.find((row) => row.id === 'th-1')!
    expect(assessed.readiness.assessed).toBe(true)
    expect(assessed.readiness.score).toBe(0.6)
    expect(assessed.readiness.level).toBe('接近回收')
    expect(assessed.readiness.legacyRevealReadiness).toBe(0.4)

    const unassessed = model.threads.find((row) => row.id === 'th-2')!
    expect(unassessed.readiness.assessed).toBe(false)
    expect(unassessed.readiness.score).toBeUndefined()
    expect(unassessed.readiness.recommendation).toBe('')
    expect(model.counts.unassessedReadiness).toBe(2)
  })

  it('认知差与状态历史照实录出，旧字段单独标记', () => {
    const model = buildForeshadowing(baseProject())
    const thread = model.threads.find((row) => row.id === 'th-1')!
    expect(thread.cognition?.others).toEqual([{ name: '柳明', knowledge: '柳明知道断简认主', evidenceCount: 1 }])
    expect(thread.legacyCognitiveGap).toBe('旧版认知差描述')
    expect(thread.history).toEqual([
      { id: 'rv-1', changedAt: '2026-09-10T10:00:00.000Z', fromStatus: '已埋设', toStatus: '推进中', reason: '第二章推进', chapterNumber: 2 }
    ])
  })
})

describe('页面 5 · 正式章节记忆（只读台账）', () => {
  it('台账只读，人工修订未接通并注明只能形成候选', () => {
    const model = buildMemoryLedger(baseProject())
    expect(model.readOnly).toBe(true)
    expect(model.manual.enabled).toBe(true)
    expect(model.manual.notice).toEqual(MEMORY_NOTICE_MANUAL)
    expect(model.manual.notice.detail).toContain('接受前不会改变正式记忆')
  })

  it('按章号排序，摘要比对只给真实结论', () => {
    const model = buildMemoryLedger(baseProject())
    expect(model.rows.map((row) => row.chapterNumber)).toEqual([1, 2, 3])
    expect(model.counts).toEqual({ total: 3, formal: 1, needsUpdate: 2, pendingReview: 0, withReplacementChain: 2 })

    const first = model.rows[0]!
    expect(first.digestMatches).toBe(false)
    expect(first.digestNote).toContain('已变化')

    const second = model.rows[1]!
    expect(second.digestMatches).toBe(true)

    // 摘要缺失时不给结论。
    const third = model.rows[2]!
    expect(third.digestMatches).toBeUndefined()
    expect(third.digestNote).toContain('缺少摘要比对依据')
  })

  it('替换链只读真实的条目级 replacesId，正反双向都不猜', () => {
    const model = buildMemoryLedger(baseProject())

    // 第 1 章：f-1 自己没有 replacesId，但被第 2 章的 f-7 声明取代（反向收集）。
    const first = model.rows[0]!
    expect(first.replaces).toEqual([])
    expect(first.replacedBy).toEqual([{ itemId: 'f-1', otherItemId: 'f-7', otherChapterNumber: 2 }])

    // 第 2 章：f-7 声明取代 f-1（正向读自己的 replacesId），它本身没被谁取代。
    const second = model.rows[1]!
    expect(second.replaces).toEqual([{ itemId: 'f-7', otherItemId: 'f-1', otherChapterNumber: 1 }])
    expect(second.replacedBy).toEqual([])

    // 第 3 章不牵涉任何替换关系，不留假链。
    const third = model.rows[2]!
    expect(third.replaces).toEqual([])
    expect(third.replacedBy).toEqual([])
  })

  it('事实与角色状态的维度统计来自真实条目', () => {
    const model = buildMemoryLedger(baseProject())
    const second = model.rows[1]!
    expect(second.facts.total).toBe(4)
    expect(second.facts.locked).toBe(0)
    // byCertainty 统计的是 certainty（正式 / 未决 / 推测），不是 category。
    expect(second.facts.byCertainty).toEqual([
      { certainty: '推测', count: 1 },
      { certainty: '未决', count: 1 },
      { certainty: '正式', count: 2 }
    ])
    expect(second.characterStates).toEqual({
      total: 1,
      perspectives: [{ perspective: '角色认知', count: 1 }]
    })
    expect(model.rows[0]!.excerpts).toEqual(['沈砚抵达回雁城。', '沈砚抵达回雁城。'])
    expect(model.rows[2]!.facts.locked).toBe(1)
  })
})

describe('没有记忆的项目不出现假数据', () => {
  it('五页全部返回空模型并如实说明', () => {
    const project = emptyProject()

    const workbench = buildMemoryWorkbench({ project, proposals: [] })
    // hasProject 表示「有项目上下文」（本栏目只在真实项目下挂载），不代表「有内容」。
    expect(workbench.hasProject).toBe(true)
    expect(workbench.target).toBeUndefined()
    expect(workbench.memories).toEqual({ total: 0, formal: 0, needsUpdate: 0, pendingReview: 0 })
    expect(workbench.proposals).toEqual({ total: 0, pending: 0, accepted: 0, rejected: 0, expired: 0 })
    expect(workbench.threads).toEqual({ total: 0, open: 0, overdue: 0, protectedFromDelete: 0 })
    expect(workbench.recall).toEqual({ objective: 0, cognition: 0, futureExcluded: 0, layers: [] })
    expect(workbench.todos).toEqual([])
    expect(workbench.health.assessed).toBe(false)

    const proposalsModel = buildMemoryProposals({ project, proposals: [] })
    expect(proposalsModel.pending).toEqual([])
    expect(proposalsModel.resolved).toEqual([])
    expect(proposalsModel.expired).toEqual([])
    expect(proposalsModel.counts).toEqual({ pending: 0, resolved: 0, expired: 0 })

    const foreshadowing = buildForeshadowing(project)
    expect(foreshadowing.threads).toEqual([])
    expect(foreshadowing.counts).toEqual({ total: 0, open: 0, overdue: 0, protectedFromDelete: 0, unassessedReadiness: 0 })
    // 阶段分布表仍然给全，但计数都是 0，不拿它冒充有内容。
    expect(foreshadowing.phases).toHaveLength(5)
    expect(foreshadowing.phases.every((phase) => phase.count === 0)).toBe(true)

    const ledger = buildMemoryLedger(project)
    expect(ledger.rows).toEqual([])
    expect(ledger.counts).toEqual({ total: 0, formal: 0, needsUpdate: 0, pendingReview: 0, withReplacementChain: 0 })
    expect(ledger.readOnly).toBe(true)
  })
})
