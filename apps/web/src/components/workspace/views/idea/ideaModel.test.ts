import { describe, expect, it } from 'vitest'
import { NovelProjectSchema, RHETORIC_GUIDANCE, type NovelProject } from '../../../../../../../packages/contracts/src'
import {
  GENRE_TEMPLATE_OPTIONS,
  IDEA_PAGE_IDS,
  RHETORIC_LEVEL_OPTIONS,
  buildDirectionCards,
  buildStorySeed,
  buildTermsBoundaries,
  buildWritingSpecs,
  ideaPageKind,
  isIdeaPageId
} from './ideaModel'

const NOW = '2026-09-13T12:00:00.000Z'

/**
 * 一份「什么都有」的项目：种子里有内容，两张方向卡（一张完整、一张只有精简字段），
 * 两条术语约束（一条待确认带完整边界、一条已锁定），settings 11 个字段全填。
 */
function rawIdeaProject() {
  return {
    schemaVersion: 7,
    id: 'novel-idea',
    title: '折光之城',
    seed: '雾城每三十年重启一次，只有记得旧世界的人能留下。',
    status: '待规划',
    revision: 3,
    settings: {
      genreTemplate: '玄幻修仙',
      targetWords: 300_000,
      plannedVolumes: 3,
      plannedChapters: 60,
      pointOfView: '第三人称限知',
      tense: '过去时',
      audience: '喜欢慢热群像的读者',
      style: '冷静克制，长句为主',
      contentLimits: '不写血腥细节',
      language: '简体中文',
      rhetoricIntensity: 2
    },
    chapters: [],
    directionCards: [
      {
        id: 'd-1', version: 2, title: '归墟守灯人',
        premise: '守灯人靠记忆续命。', protagonistHook: '他知道自己终将遗忘一切。',
        coreConflict: '留下记忆还是保住城市。', emotionalPromise: '在遗忘中坚持被记住。',
        openingSituation: '雷变之夜，他第一次忘记妻子。',
        genreDirection: '玄幻悬疑', logline: '一个守灯人用记忆交换整城人的明天。',
        protagonistIdentity: '最后的守灯人', protagonistSituation: '记忆每日递减',
        protagonistGoal: '在记忆耗尽前找到归墟重启的真相', mainObstacle: '旧秩序的既得利益者',
        specialPremise: '灯火可以存储记忆', cost: '每点亮一次灯就忘掉一个人',
        failureConsequence: '全城被重置', centralMystery: '归墟为什么会重启',
        readingExperience: '压抑中带暖意的坚持',
        fieldStatuses: { logline: '作者已确定', protagonistGoal: '暂时采用' },
        unresolvedQuestions: ['妻子是否也被重置过？'],
        status: '已采用', createdAt: NOW, updatedAt: NOW
      },
      {
        id: 'd-2', version: 1, title: '空白方向卡',
        premise: '', protagonistHook: '', coreConflict: '', emotionalPromise: '', openingSituation: '',
        unresolvedQuestions: [], status: '候选', createdAt: NOW, updatedAt: NOW
      }
    ],
    activeDirectionCardId: 'd-1',
    directionQuestions: ['主角最怕失去什么？', '结局是开放式的吗？'],
    directionQuestionAnswers: ['忘记妻子', ''],
    memories: [],
    plotThreads: [],
    branches: [],
    reviews: [],
    worldConstraints: [
      {
        id: 'c-1', term: '归墟', definition: '世界重启周期', notDefinition: '不是地名', entityType: '概念',
        allowedUsages: ['归墟重启'],
        forbiddenUsages: [{ phrase: '归墟之门', reason: '与设定冲突', suggestedReplacement: '归墟裂隙' }],
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
    createdAt: NOW,
    updatedAt: NOW
  }
}

function baseProject(): NovelProject {
  return NovelProjectSchema.parse(rawIdeaProject())
}

/** 旧项目：没有方向卡与方向问答，没有术语约束，settings 里三个自由文本字段是空的。 */
function bareProject(): NovelProject {
  const raw = rawIdeaProject()
  return NovelProjectSchema.parse({
    ...raw,
    seed: '',
    directionCards: undefined,
    activeDirectionCardId: undefined,
    directionQuestions: undefined,
    directionQuestionAnswers: undefined,
    worldConstraints: [],
    settings: { ...raw.settings, audience: '', style: '', contentLimits: '' }
  })
}

describe('小说大纲 · 故事起点四个二级页面的模型拆分', () => {
  it('四个二级入口各自唯一，未知 id 回落到故事种子', () => {
    expect(IDEA_PAGE_IDS).toHaveLength(4)
    const kinds = IDEA_PAGE_IDS.map((id) => ideaPageKind(id))
    expect(new Set(kinds).size).toBe(4)
    expect(kinds).toEqual(['seed', 'directions', 'terms', 'specs'])
    expect(isIdeaPageId('story-seed')).toBe(true)
    expect(isIdeaPageId('world-overview')).toBe(false)
    expect(ideaPageKind('nope')).toBe('seed')
  })

  it('同一份项目在四个页面上产出结构不同的内容', () => {
    const project = baseProject()
    const seed = buildStorySeed(project)
    const directions = buildDirectionCards(project)
    const terms = buildTermsBoundaries(project)
    const specs = buildWritingSpecs(project)

    expect([seed.kind, directions.kind, terms.kind, specs.kind]).toEqual(['seed', 'directions', 'terms', 'specs'])
    expect([seed.weAreHere, directions.weAreHere, terms.weAreHere, specs.weAreHere]).toEqual(['seed', 'directions', 'terms', 'specs'])

    // 四个模型的字段集合互不相同 —— 页面拿到的数据形状本身就不一样。
    const shapes = [seed, directions, terms, specs].map((model) => Object.keys(model).sort().join('|'))
    expect(new Set(shapes).size).toBe(4)

    // 每页核心内容各自来自不同数据源。
    expect(seed.charCount).toBe(project.seed.trim().length)
    expect(directions.cards).toHaveLength(2)
    expect(terms.constraints).toHaveLength(2)
    expect(specs.targetWords).toBe(300_000)
  })

  it('故事种子页只带种子字段，不夹带方向卡 / 术语 / 规格数据', () => {
    const seed = buildStorySeed(baseProject()) as Record<string, unknown>
    expect(Object.keys(seed)).not.toContain('cards')
    expect(Object.keys(seed)).not.toContain('constraints')
    expect(Object.keys(seed)).not.toContain('targetWords')
    expect(seed.seed).toBe('雾城每三十年重启一次，只有记得旧世界的人能留下。')
  })
})

describe('故事种子', () => {
  it('全部取值来自 project.seed 与项目自身，无占位内容', () => {
    const project = baseProject()
    const model = buildStorySeed(project)
    expect(model.hasSeed).toBe(true)
    expect(model.seed).toBe(project.seed)
    expect(model.charCount).toBe(project.seed.trim().length)
    expect(model.projectTitle).toBe('折光之城')
    expect(model.projectStatus).toBe('待规划')
    expect(model.updatedAt).toBe(NOW)
    expect(model.notice.id).toBe('idea-seed')
  })

  it('空种子如实标空，并说明「AI 从种子推演方向卡」当前不可用', () => {
    const model = buildStorySeed(bareProject())
    expect(model.hasSeed).toBe(false)
    expect(model.charCount).toBe(0)
    expect(model.actions).toHaveLength(1)
    expect(model.actions[0]!.label).toContain('方向卡')
    expect(model.actions[0]!.enabled).toBe(false)
    expect(model.actions[0]!.reason).toContain('当前不可用')
  })
})

describe('故事方向卡', () => {
  it('卡片、当前采用标记与方向问答都来自项目真实数据', () => {
    const model = buildDirectionCards(baseProject())
    expect(model.hasCards).toBe(true)
    expect(model.cards.map((card) => card.id)).toEqual(['d-1', 'd-2'])
    expect(model.activeCardId).toBe('d-1')
    expect(model.activeCardTitle).toBe('归墟守灯人')
    expect(model.cards[0]!.isActive).toBe(true)
    expect(model.cards[1]!.isActive).toBe(false)
    expect(model.statusCounts).toEqual({ total: 2, 候选: 1, 已采用: 1, 已归档: 0 })
    expect(model.questions).toEqual(['主角最怕失去什么？', '结局是开放式的吗？'])
    expect(model.answers).toEqual(['忘记妻子', ''])
    expect(model.answeredCount).toBe(1)
    expect(model.notice.id).toBe('idea-direction-cards')
  })

  it('完整的卡展示全部方向字段，旧卡缺字段如实标空而不是补占位', () => {
    const model = buildDirectionCards(baseProject())
    const full = model.cards[0]!
    expect(full.coreFields.map((field) => field.label)).toEqual(['故事前提', '核心冲突', '主角钩子', '情感承诺', '开场情境'])
    expect(full.fullFields).toHaveLength(11)
    expect(full.fullFields.every((field) => field.value.trim().length > 0)).toBe(true)
    expect(full.missingFields).toEqual([])
    expect(full.fieldStatuses).toEqual([
      { label: '一句话梗概', status: '作者已确定' },
      { label: '主角目标', status: '暂时采用' }
    ])
    expect(full.unresolvedQuestions).toEqual(['妻子是否也被重置过？'])

    const blank = model.cards[1]!
    expect(blank.fullFields.every((field) => field.value === '')).toBe(true)
    expect(blank.fieldStatuses).toEqual([])
    // 5 个精简字段 + 11 个完整方向字段全部缺失，逐条列出真实空白。
    expect(blank.missingFields).toHaveLength(16)
    expect(blank.missingFields).toContain('故事前提')
    expect(blank.missingFields).toContain('一句话梗概')
  })

  it('生成 / 采用候选 / 批量三条操作全部禁用，并写明各自真实原因', () => {
    const model = buildDirectionCards(baseProject())
    expect(model.actions).toHaveLength(3)
    for (const action of model.actions) {
      expect(action.enabled).toBe(false)
      expect(action.reason).toContain('当前不可用')
    }
    const apply = model.actions.find((action) => action.id === 'apply-direction-card-candidate')!
    expect(apply.reason).toContain('采用方向卡候选')
    expect(apply.reason).toContain('当前不可用')
  })
})

describe('术语与边界', () => {
  it('术语与状态都来自 worldConstraints，创作内容限制只读展示 settings.contentLimits', () => {
    const model = buildTermsBoundaries(baseProject())
    expect(model.constraints.map((item) => item.term)).toEqual(['归墟', '灯火诀'])
    expect(model.constraints.map((item) => item.status)).toEqual(['待确认', '已锁定'])
    expect(model.constraintStats).toEqual({ total: 2, 待确认: 1, 已确认: 0, 已锁定: 1, 已拒绝: 0 })
    expect(model.contentLimits).toBe('不写血腥细节')
    expect(model.unresolvedTermCount).toBe(1)
    expect(model.notice.id).toBe('idea-terms')

    const first = model.constraints[0]!
    expect(first.notDefinition).toBe('不是地名')
    expect(first.allowedUsages).toEqual(['归墟重启'])
    expect(first.forbiddenUsages[0]).toEqual({ phrase: '归墟之门', reason: '与设定冲突' })
    expect(first.factCount).toBe(1)
    expect(first.sourceExcerpt).toContain('归墟重启周期')
  })

  it('提取与批量确认两条操作全部禁用，避免替作者确认候选', () => {
    const model = buildTermsBoundaries(baseProject())
    expect(model.actions).toHaveLength(2)
    for (const action of model.actions) {
      expect(action.enabled).toBe(false)
      expect(action.reason).toContain('当前不可用')
    }
    expect(model.actions.map((action) => action.id)).toEqual(['extract-terms', 'batch-confirm-terms'])
  })
})

describe('创作规格', () => {
  it('11 个字段与文风档位全部来自 project.settings', () => {
    const model = buildWritingSpecs(baseProject())
    expect(model.genreTemplate).toBe('玄幻修仙')
    expect(model.targetWords).toBe(300_000)
    expect(model.plannedVolumes).toBe(3)
    expect(model.plannedChapters).toBe(60)
    expect(model.pointOfView).toBe('第三人称限知')
    expect(model.tense).toBe('过去时')
    expect(model.audience).toBe('喜欢慢热群像的读者')
    expect(model.style).toBe('冷静克制，长句为主')
    expect(model.contentLimits).toBe('不写血腥细节')
    expect(model.language).toBe('简体中文')
    expect(model.rhetoricIntensity).toBe(2)
    expect(model.rhetoricLabel).toBe(RHETORIC_GUIDANCE[2]!.label)
    expect(model.rhetoricInstruction).toBe(RHETORIC_GUIDANCE[2]!.instruction)
    expect(model.averageChapterWords).toBe(5_000)
    expect(model.missingFields).toEqual([])
    expect(model.notice.id).toBe('idea-specs')
  })

  it('空字段如实例出，不自动填默认值', () => {
    const model = buildWritingSpecs(bareProject())
    expect(model.missingFields).toEqual(['目标读者', '语言与文风', '创作内容限制'])
    expect(model.audience).toBe('')
    expect(model.style).toBe('')
    expect(model.contentLimits).toBe('')
  })

  it('题材模板直接取自契约枚举，文风档位覆盖 0–4', () => {
    expect(GENRE_TEMPLATE_OPTIONS.length).toBeGreaterThan(0)
    expect(RHETORIC_LEVEL_OPTIONS.map((item) => item.level)).toEqual([0, 1, 2, 3, 4])
    expect(RHETORIC_LEVEL_OPTIONS.map((item) => item.label)).toEqual(RHETORIC_GUIDANCE.map((item) => item.label))
  })

  it('推断规格操作禁用并写明没有对应生成类型', () => {
    const model = buildWritingSpecs(baseProject())
    expect(model.actions).toHaveLength(1)
    expect(model.actions[0]!.enabled).toBe(false)
    expect(model.actions[0]!.reason).toContain('当前不可用')
  })
})

describe('四页的未接通能力都如实建模，不出现假成功', () => {
  it('所有页面的所有操作 enabled 恒为 false，且原因具体可核对', () => {
    const project = baseProject()
    const models = [buildStorySeed(project), buildDirectionCards(project), buildTermsBoundaries(project), buildWritingSpecs(project)]
    for (const model of models) {
      expect(model.actions.length).toBeGreaterThan(0)
      for (const action of model.actions) {
        expect(action.enabled).toBe(false)
        expect(action.label.trim().length).toBeGreaterThan(0)
        expect(action.reason.length).toBeGreaterThan(20)
        expect(action.reason).toContain('当前不可用')
      }
      expect(model.notice.detail.length).toBeGreaterThan(0)
    }
  })

  it('四个页面的说明互不相同，各自只讲本页的数据边界', () => {
    const project = baseProject()
    const ids = [
      buildStorySeed(project).notice.id,
      buildDirectionCards(project).notice.id,
      buildTermsBoundaries(project).notice.id,
      buildWritingSpecs(project).notice.id
    ]
    expect(new Set(ids).size).toBe(4)
  })
})

describe('没有方向卡 / 术语的旧项目不出现假数据', () => {
  it('方向卡页给出空态而不是假卡片', () => {
    const model = buildDirectionCards(bareProject())
    expect(model.hasCards).toBe(false)
    expect(model.cards).toEqual([])
    expect(model.activeCardTitle).toBe('')
    expect(model.questions).toEqual([])
    expect(model.answeredCount).toBe(0)
    expect(model.statusCounts).toEqual({ total: 0, 候选: 0, 已采用: 0, 已归档: 0 })
  })

  it('术语页返回空清单与空边界，统计全为 0', () => {
    const model = buildTermsBoundaries(bareProject())
    expect(model.constraints).toEqual([])
    expect(model.constraintStats).toEqual({ total: 0, 待确认: 0, 已确认: 0, 已锁定: 0, 已拒绝: 0 })
    expect(model.contentLimits).toBe('')
    expect(model.unresolvedTermCount).toBe(0)
  })
})
