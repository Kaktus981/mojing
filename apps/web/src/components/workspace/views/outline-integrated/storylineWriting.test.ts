import { describe, expect, it } from 'vitest'

import {
  PAUSE_SCOPE_OPTIONS,
  STORYLINE_NODE_STATUS_OPTIONS,
  STORYLINE_RETURN_POSITION_OPTIONS,
  STORYLINE_STATUS_OPTIONS,
  applyAddStoryline,
  applyAddStorylineChapterPlan,
  applyAddStorylineNode,
  applyRemoveStoryline,
  applyRemoveStorylineChapterPlan,
  applyRemoveStorylineNode,
  applyStorylineChapterPlanFieldEdit,
  applyStorylineChapterRangeEdit,
  applyStorylineFieldEdit,
  applyStorylineNodeFieldEdit,
  applyStorylineNodeStatusEdit,
  applyStorylinePauseEdit,
  applyStorylineEntryLinkEdit,
  applyStorylineStatusEdit,
  storylinePauseReady,
  storylineReferenceReport,
  type StorylineWritingDraft
} from './storylineWriting'
import {
  StorylinePauseScopeSchema,
  StorylineReturnPositionSchema,
  StorylineStatusSchema
} from '../../../../../../../packages/contracts/src'

/**
 * M5 · 事件线手写：纯 mutator 测试。
 *
 * 除了行为，这里还对照契约枚举断言界面选项，避免两边各自漂移：
 * 界面给出的状态 / 暂停范围 / 返回位置必须与契约逐字一致。
 */

const NOW = '2026-09-14T20:00:00.000Z'
const emptyDraft = (): StorylineWritingDraft => ({ storylines: [] })

describe('事件线选项与契约一致', () => {
  it('状态、暂停范围、返回位置、节点状态都与契约枚举逐字一致', () => {
    expect([...STORYLINE_STATUS_OPTIONS]).toEqual([...StorylineStatusSchema.options])
    expect([...PAUSE_SCOPE_OPTIONS]).toEqual([...StorylinePauseScopeSchema.options])
    expect([...STORYLINE_RETURN_POSITION_OPTIONS]).toEqual([...StorylineReturnPositionSchema.options])
    expect([...STORYLINE_NODE_STATUS_OPTIONS]).toEqual(['未开始', '进行中', '已完成', '已取消'])
  })
})

describe('新建事件线', () => {
  it('契约完整、文本全空、状态为未开始', () => {
    const draft = emptyDraft()
    const result = applyAddStoryline(draft, '潮汐调查线', NOW, 'line-1')

    expect(result.ok).toBe(true)
    expect(draft.storylines![0]).toMatchObject({
      id: 'line-1',
      title: '潮汐调查线',
      type: '',
      whyNecessary: '',
      openingState: '',
      finalGoal: '',
      endCondition: '',
      keyNodes: [],
      chapterPlans: [],
      currentProgress: 0,
      costPaid: '',
      unresolvedQuestions: [],
      nextAction: '',
      status: '未开始',
      evidenceChain: [],
      updatedAt: NOW
    })
    expect(draft.storylines![0]!.startChapterNumber).toBeUndefined()
    expect(draft.storylines![0]!.pause).toBeUndefined()
  })

  it('没有名称就不创建（不为通过校验编造占位名字）', () => {
    const draft = emptyDraft()
    expect(applyAddStoryline(draft, '   ', NOW, 'line-1').ok).toBe(false)
    expect(draft.storylines).toHaveLength(0)
  })

  it('重复 id 不会追加两条', () => {
    const draft = emptyDraft()
    applyAddStoryline(draft, '第一条', NOW, 'line-1')
    expect(applyAddStoryline(draft, '第二条', NOW, 'line-1').ok).toBe(false)
    expect(draft.storylines).toHaveLength(1)
  })
})

describe('事件线字段与章节起止', () => {
  const withLine = () => {
    const draft = emptyDraft()
    applyAddStoryline(draft, '潮汐调查线', NOW, 'line-1')
    return draft
  }

  it('八个文本字段都能手写，但名称不能被清空', () => {
    const draft = withLine()
    for (const [field, value] of [
      ['title', '潮汐调查线（改）'], ['type', '悬疑'], ['whyNecessary', '撑起主线悬念'],
      ['openingState', '林砚刚发现钟声'], ['finalGoal', '查清记忆被改写的原因'],
      ['endCondition', '公开真相'], ['nextAction', '去找巡夜人'], ['costPaid', '失去一段记忆']
    ] as const) {
      expect(applyStorylineFieldEdit(draft, 'line-1', field, value, NOW)).toBe(true)
    }
    expect(draft.storylines![0]!.nextAction).toBe('去找巡夜人')

    expect(applyStorylineFieldEdit(draft, 'line-1', 'title', '   ', NOW), '名称是契约必填').toBe(false)
    expect(draft.storylines![0]!.title).toBe('潮汐调查线（改）')
  })

  it('起止章号可以手写，但结束章不能早于开始章', () => {
    const draft = withLine()
    expect(applyStorylineChapterRangeEdit(draft, 'line-1', { startChapterNumber: 2, expectedEndChapterNumber: 8 }, NOW).ok).toBe(true)
    expect(draft.storylines![0]!.startChapterNumber).toBe(2)
    expect(draft.storylines![0]!.expectedEndChapterNumber).toBe(8)

    const refused = applyStorylineChapterRangeEdit(draft, 'line-1', { expectedEndChapterNumber: 1 }, NOW)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/不能早于/)
    expect(draft.storylines![0]!.expectedEndChapterNumber, '被拒绝时不得改动').toBe(8)
  })
})

describe('状态与暂停', () => {
  const withLine = () => {
    const draft = emptyDraft()
    applyAddStoryline(draft, '潮汐调查线', NOW, 'line-1')
    return draft
  }

  it('没有暂停原因与返回条件时不能改成「计划暂停」', () => {
    const draft = withLine()
    const refused = applyStorylineStatusEdit(draft, 'line-1', '计划暂停', NOW)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/暂停原因与返回条件/)
    expect(draft.storylines![0]!.status).toBe('未开始')

    applyStorylinePauseEdit(draft, 'line-1', { reason: '与主线冲突，先搁置' }, NOW)
    expect(applyStorylineStatusEdit(draft, 'line-1', '计划暂停', NOW).ok, '只有原因还不够').toBe(false)

    applyStorylinePauseEdit(draft, 'line-1', { returnCondition: '主线进入第三卷后恢复' }, NOW)
    expect(storylinePauseReady(draft.storylines![0]!)).toBe(true)
    expect(applyStorylineStatusEdit(draft, 'line-1', '计划暂停', NOW).ok).toBe(true)
    expect(draft.storylines![0]!.status).toBe('计划暂停')
  })

  it('暂停对象按契约补全缺失字段，原因与返回条件保留原值', () => {
    const draft = withLine()
    expect(applyStorylinePauseEdit(draft, 'line-1', { reason: '等条件满足', returnCondition: '第五卷前' }, NOW)).toBe(true)

    const pause = draft.storylines![0]!.pause!
    expect(pause).toMatchObject({
      reason: '等条件满足',
      returnCondition: '第五卷前',
      scope: '下一章',
      expectedReturnPosition: '下一章开头',
      currentState: '',
      behindTheScenesChange: '',
      unresolvedQuestions: []
    })
    expect(applyStorylinePauseEdit(draft, 'line-1', { scope: '指定后续卷', expectedReturnChapterNumber: 30 }, NOW)).toBe(true)
    expect(draft.storylines![0]!.pause!.scope).toBe('指定后续卷')
    expect(draft.storylines![0]!.pause!.expectedReturnChapterNumber).toBe(30)
  })

  it('不认识的状态与找不到的事件线都不写', () => {
    const draft = withLine()
    expect(applyStorylineStatusEdit(draft, 'line-1', '随便一个状态', NOW).ok).toBe(false)
    expect(applyStorylineStatusEdit(draft, 'missing', '推进中', NOW).ok).toBe(false)
    expect(draft.storylines![0]!.status).toBe('未开始')
  })
})

describe('关键节点', () => {
  const withLine = () => {
    const draft = emptyDraft()
    applyAddStoryline(draft, '潮汐调查线', NOW, 'line-1')
    return draft
  }

  it('节点名称必填；可改描述与状态；可删除', () => {
    const draft = withLine()
    expect(applyAddStorylineNode(draft, 'line-1', '  ', NOW, 'node-1').ok).toBe(false)

    expect(applyAddStorylineNode(draft, 'line-1', '发现钟声规律', NOW, 'node-1').ok).toBe(true)
    expect(draft.storylines![0]!.keyNodes[0]).toMatchObject({ id: 'node-1', title: '发现钟声规律', description: '', status: '未开始', evidence: [] })

    expect(applyStorylineNodeFieldEdit(draft, 'line-1', 'node-1', 'description', '每月初一钟声改变', NOW)).toBe(true)
    expect(applyStorylineNodeFieldEdit(draft, 'line-1', 'node-1', 'title', '', NOW)).toBe(false)
    expect(applyStorylineNodeStatusEdit(draft, 'line-1', 'node-1', '进行中', NOW)).toBe(true)
    expect(applyStorylineNodeStatusEdit(draft, 'line-1', 'node-1', '不存在', NOW)).toBe(false)

    expect(applyRemoveStorylineNode(draft, 'line-1', 'node-1', NOW)).toBe(true)
    expect(draft.storylines![0]!.keyNodes).toHaveLength(0)
    expect(applyRemoveStorylineNode(draft, 'line-1', 'node-1', NOW)).toBe(false)
  })
})

describe('章节关联', () => {
  const withLine = () => {
    const draft = emptyDraft()
    applyAddStoryline(draft, '潮汐调查线', NOW, 'line-1')
    return draft
  }

  it('绑定真实章节，按章号排序，重复绑定不会产生两条', () => {
    const draft = withLine()
    expect(applyAddStorylineChapterPlan(draft, 'line-1', { id: 'oc-3', chapterNumber: 3 }, NOW).ok).toBe(true)
    expect(applyAddStorylineChapterPlan(draft, 'line-1', { id: 'oc-1', chapterNumber: 1 }, NOW).ok).toBe(true)
    expect(draft.storylines![0]!.chapterPlans.map((plan) => plan.chapterNumber)).toEqual([1, 3])

    expect(applyAddStorylineChapterPlan(draft, 'line-1', { id: 'oc-3', chapterNumber: 3 }, NOW).ok).toBe(false)
    expect(draft.storylines![0]!.chapterPlans).toHaveLength(2)
  })

  it('关联字段可手写，可解绑', () => {
    const draft = withLine()
    applyAddStorylineChapterPlan(draft, 'line-1', { id: 'oc-1', chapterNumber: 1 }, NOW)
    expect(applyStorylineChapterPlanFieldEdit(draft, 'line-1', 'oc-1', 'subGoal', '确认钟声规则', NOW)).toBe(true)
    expect(applyStorylineChapterPlanFieldEdit(draft, 'line-1', 'oc-1', 'nextTrigger', '发现第二口钟', NOW)).toBe(true)
    expect(draft.storylines![0]!.chapterPlans[0]).toMatchObject({ subGoal: '确认钟声规则', nextTrigger: '发现第二口钟', status: '计划' })

    expect(applyRemoveStorylineChapterPlan(draft, 'line-1', 'oc-1', NOW)).toBe(true)
    expect(draft.storylines![0]!.chapterPlans).toHaveLength(0)
  })
})

describe('事件线关联世界词条', () => {
  const draft = () => ({
    outline: undefined,
    worldBible: { entries: [{ id: 'char-1', name: '林砚' }, { id: 'place-1', name: '旧城' }] },
    storylines: [{
      id: 'line-1', title: '潮汐调查线', type: '', whyNecessary: '', openingState: '', finalGoal: '', endCondition: '',
      characterIds: [], entryIds: [] as string[], relatedPlotThreadIds: [], keyNodes: [], chapterPlans: [],
      currentProgress: 0, costPaid: '', unresolvedQuestions: [], nextAction: '', status: '未开始',
      evidenceChain: [], updatedAt: '2026-09-14T00:00:00.000Z'
    }]
  })

  it('关联只写 entryIds，不动词条资料', () => {
    const target = draft()
    const result = applyStorylineEntryLinkEdit(target, 'line-1', 'place-1', true, '2026-09-14T10:00:00.000Z')

    expect(result.ok).toBe(true)
    expect(target.storylines[0]!.entryIds).toEqual(['place-1'])
    expect(target.storylines[0]!.updatedAt).toBe('2026-09-14T10:00:00.000Z')
    expect(target.worldBible.entries[1], '词条本身不得被改写').toEqual({ id: 'place-1', name: '旧城' })
  })

  it('重复关联与解除未关联都失败，且不改动数据', () => {
    const target = draft()
    applyStorylineEntryLinkEdit(target, 'line-1', 'place-1', true, '2026-09-14T10:00:00.000Z')
    expect(applyStorylineEntryLinkEdit(target, 'line-1', 'place-1', true, '2026-09-14T11:00:00.000Z').message).toContain('已经关联')
    expect(applyStorylineEntryLinkEdit(target, 'line-1', 'char-1', false, '2026-09-14T11:00:00.000Z').message).toContain('没有关联')
    expect(target.storylines[0]!.entryIds).toEqual(['place-1'])
  })

  it('关联不存在的词条被拒绝；解绑后即可删除该词条', () => {
    const target = draft()
    expect(applyStorylineEntryLinkEdit(target, 'line-1', 'missing', true, '2026-09-14T10:00:00.000Z').ok).toBe(false)

    applyStorylineEntryLinkEdit(target, 'line-1', 'place-1', true, '2026-09-14T10:00:00.000Z')
    expect(target.storylines[0]!.entryIds).toEqual(['place-1'])

    applyStorylineEntryLinkEdit(target, 'line-1', 'place-1', false, '2026-09-14T12:00:00.000Z')
    expect(target.storylines[0]!.entryIds).toEqual([])
  })
})

describe('事件线编辑不得丢失界面未编辑的字段', () => {
  it('改单个文本字段时对象被就地修改，其他字段（含界面未暴露的）原样保留', () => {
    const raw: Record<string, unknown> = {
      outline: undefined,
      storylines: [{
        id: 'line-1', title: '潮汐调查线', type: '', whyNecessary: '', openingState: '', finalGoal: '旧目标', endCondition: '',
        characterIds: [], entryIds: ['char-1'], relatedPlotThreadIds: ['thread-1'], keyNodes: [], chapterPlans: [],
        currentProgress: 0.4, costPaid: '', unresolvedQuestions: [], nextAction: '', status: '推进中',
        evidenceChain: [], updatedAt: '2026-09-14T00:00:00.000Z',
        // 契约里存在但简化界面没有编辑入口的字段
        revealReadiness: 0.4, cognitiveGap: '读者已知，主角未知',
        cognition: { readerKnows: '钟声会改写记忆' }, readiness: { ready: false }
      }]
    }
    const target = raw as unknown as Parameters<typeof applyStorylineFieldEdit>[0]
    const line = (raw.storylines as Array<Record<string, unknown>>)[0]!

    expect(applyStorylineFieldEdit(target, 'line-1', 'finalGoal', '查清记忆被改写的原因', '2026-09-14T10:00:00.000Z'), '就地修改返回 true').toBe(true)
    expect(line.finalGoal).toBe('查清记忆被改写的原因')
    expect(line.title, '未被编辑的字段不得被重建覆盖').toBe('潮汐调查线')
    expect(line.revealReadiness).toBe(0.4)
    expect(line.cognitiveGap).toBe('读者已知，主角未知')
    expect(line.cognition).toEqual({ readerKnows: '钟声会改写记忆' })
    expect(line.readiness).toEqual({ ready: false })
    expect(line.relatedPlotThreadIds).toEqual(['thread-1'])
    expect(line.entryIds).toEqual(['char-1'])
  })
})

describe('删除整条事件线', () => {
  const base = (): StorylineWritingDraft => ({
    outline: undefined,
    worldBible: { entries: [{ id: 'char-1', name: '林砚' }, { id: 'place-1', name: '旧城' }] },
    plotThreads: [{ id: 'thread-1', title: '断简的温度' }],
    storylines: [
      {
        id: 'line-1', title: '潮汐调查线', type: '', whyNecessary: '', openingState: '', finalGoal: '', endCondition: '',
        startChapterId: 'oc-1', characterIds: ['c-1'], entryIds: ['char-1'], relatedPlotThreadIds: ['thread-1'],
        keyNodes: [], chapterPlans: [], currentProgress: 0, costPaid: '', unresolvedQuestions: [], nextAction: '',
        status: '推进中', evidenceChain: [], updatedAt: '2026-09-14T00:00:00.000Z'
      },
      {
        id: 'line-2', title: '第二条线', type: '', whyNecessary: '', openingState: '', finalGoal: '', endCondition: '',
        characterIds: [], entryIds: [], relatedPlotThreadIds: [], keyNodes: [], chapterPlans: [],
        currentProgress: 0, costPaid: '', unresolvedQuestions: [], nextAction: '', status: '未开始',
        evidenceChain: [], updatedAt: '2026-09-14T00:00:00.000Z'
      }
    ]
  })

  it('删除指定线后该线消失、其余线不受影响', () => {
    const target = base()
    const result = applyRemoveStoryline(target, 'line-1')
    expect(result.ok).toBe(true)
    expect(result.id).toBe('line-1')
    expect(target.storylines!.map((line) => line.id)).toEqual(['line-2'])
  })

  it('lineId 不存在返回 ok:false', () => {
    const target = base()
    const result = applyRemoveStoryline(target, 'missing')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('事件线不存在')
    expect(target.storylines).toHaveLength(2)
  })

  it('externalRefs 非空时拒绝且不执行删除', () => {
    const target = base()
    const result = applyRemoveStoryline(target, 'line-1', ['另一条线的引用'])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('仍有外部引用')
    expect(target.storylines).toHaveLength(2)
  })

  it('storylineReferenceReport 汇总关联章节、节点、章节计划、伏笔、词条与角色', () => {
    const target: StorylineWritingDraft = {
      outline: undefined,
      worldBible: { entries: [{ id: 'char-1', name: '林砚' }] },
      plotThreads: [{ id: 'thread-1', title: '断简的温度' }],
      storylines: [{
        id: 'line-1', title: '潮汐调查线', type: '', whyNecessary: '', openingState: '', finalGoal: '', endCondition: '',
        startChapterId: 'oc-1', characterIds: ['c-1'], entryIds: ['char-1'], relatedPlotThreadIds: ['thread-1'],
        keyNodes: [
          { id: 'node-1', title: '发现钟声', description: '', status: '未开始', evidence: [{ chapterId: 'oc-1', excerpt: 'x' }, { chapterId: 'oc-2', excerpt: 'y' }] },
          { id: 'node-2', title: '查清真相', description: '', status: '未开始', evidence: [] }
        ],
        chapterPlans: [{ chapterId: 'oc-3', chapterNumber: 3, subGoal: '', method: '', obstacle: '', outcome: '', nextTrigger: '', changes: [], status: '计划', evidence: [] }],
        currentProgress: 0, costPaid: '', unresolvedQuestions: [], nextAction: '', status: '推进中', evidenceChain: [], updatedAt: '2026-09-14T00:00:00.000Z'
      }]
    }
    const report = storylineReferenceReport(target, 'line-1')
    expect(report.nodeCount).toBe(2)
    expect(report.chapterPlanCount).toBe(1)
    expect(report.entryNames).toEqual(['林砚'])
    expect(report.plotThreadTitles).toEqual(['断简的温度'])
    expect(report.characterIds).toEqual(['c-1'])
    // 去重后的关联章节：startChapterId(oc-1) + 两个节点证据(oc-1, oc-2) + 章节计划(oc-3)
    expect(report.chapterCount).toBe(3)
  })
})
