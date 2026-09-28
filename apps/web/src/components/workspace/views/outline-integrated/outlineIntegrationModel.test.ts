import { describe, expect, it } from 'vitest'

import type { NovelProject } from '../../../../../../../packages/contracts/src'
import * as integratedOutlineModel from './outlineIntegrationModel'
import {
  CREATION_START_EDIT_TARGETS,
  INTEGRATED_OUTLINE_CANONICAL_TARGETS,
  INTEGRATED_OUTLINE_MODULE_IDS,
  LEGACY_SECTION_REDIRECTS,
  applyActiveDirectionCardEdit,
  applySeedEdit,
  applySettingEdit,
  canEnterOutline,
  resolveIntegratedOutlineTarget,
  resolveLegacySectionRedirect
} from './outlineIntegrationModel'
import type {
  IntegratedOutlineFocusId,
  IntegratedOutlineModuleId,
  IntegratedOutlineTarget
} from './outlineIntegrationModel'

type LegacyEntryCase = {
  /** 旧入口描述，仅用于测试可读性 */
  name: string
  stageId: string
  subnavId?: string
  moduleId: IntegratedOutlineModuleId
  focusId: IntegratedOutlineFocusId
  canonicalTarget: IntegratedOutlineTarget['canonicalTarget']
}

/**
 * 旧导航中仍映射到小说大纲的九个入口。
 * 第十个 `idea / terms-boundaries` 已随去重调整改派到世界观，见 LEGACY_REDIRECT_CASES。
 */
const LEGACY_ENTRY_CASES: readonly LegacyEntryCase[] = [
  {
    name: 'idea / story-seed',
    stageId: 'idea',
    subnavId: 'story-seed',
    moduleId: 'creation-start',
    focusId: 'seed',
    canonicalTarget: { stageId: 'idea', subnavId: 'story-seed' }
  },
  {
    name: 'idea / direction-cards',
    stageId: 'idea',
    subnavId: 'direction-cards',
    moduleId: 'creation-start',
    focusId: 'directions',
    canonicalTarget: { stageId: 'idea', subnavId: 'story-seed' }
  },
  {
    name: 'idea / writing-specs',
    stageId: 'idea',
    subnavId: 'writing-specs',
    moduleId: 'creation-start',
    focusId: 'specs',
    canonicalTarget: { stageId: 'idea', subnavId: 'story-seed' }
  },
  {
    name: 'outline / outline-foundation',
    stageId: 'outline',
    subnavId: 'outline-foundation',
    moduleId: 'outline-volumes',
    focusId: 'overview',
    canonicalTarget: { stageId: 'outline', subnavId: 'outline-foundation' }
  },
  {
    name: 'outline / outline-structure',
    stageId: 'outline',
    subnavId: 'outline-structure',
    moduleId: 'outline-volumes',
    focusId: 'structure',
    canonicalTarget: { stageId: 'outline', subnavId: 'outline-foundation' }
  },
  {
    name: 'outline / chapter-directory',
    stageId: 'outline',
    subnavId: 'chapter-directory',
    moduleId: 'chapter-planning',
    focusId: 'all-chapters',
    canonicalTarget: { stageId: 'outline', subnavId: 'chapter-directory' }
  },
  {
    name: 'outline / rolling-outline',
    stageId: 'outline',
    subnavId: 'rolling-outline',
    moduleId: 'chapter-planning',
    focusId: 'nearby-chapters',
    canonicalTarget: { stageId: 'outline', subnavId: 'chapter-directory' }
  },
  {
    name: 'outline / chapter-beats',
    stageId: 'outline',
    subnavId: 'chapter-beats',
    moduleId: 'chapter-planning',
    focusId: 'chapter-detail',
    canonicalTarget: { stageId: 'outline', subnavId: 'chapter-directory' }
  },
  {
    name: 'outline / storylines',
    stageId: 'outline',
    subnavId: 'storylines',
    moduleId: 'storylines',
    focusId: 'storyline-list',
    canonicalTarget: { stageId: 'outline', subnavId: 'storylines' }
  }
]

/** 因去重调整改派到其他栏目的旧入口（数据不迁移、不删除）。 */
const LEGACY_REDIRECT_CASES = [
  { name: 'idea / terms-boundaries -> world / rules-boundaries', stageId: 'idea', subnavId: 'terms-boundaries', redirect: { stageId: 'world', subnavId: 'rules-boundaries' } }
] as const

describe('resolveLegacySectionRedirect - 栏目改派', () => {
  for (const testCase of LEGACY_REDIRECT_CASES) {
    it(`${testCase.name}`, () => {
      expect(resolveLegacySectionRedirect(testCase.stageId, testCase.subnavId)).toEqual(testCase.redirect)
    })
  }

  it('改派表只登记一个入口，且落点就是要保留的那一处', () => {
    expect(Object.keys(LEGACY_SECTION_REDIRECTS)).toEqual(['idea/terms-boundaries'])
    expect(LEGACY_SECTION_REDIRECTS['idea/terms-boundaries']).toEqual({ stageId: 'world', subnavId: 'rules-boundaries' })
  })

  it('未改派的入口返回 undefined，不会误伤其他页', () => {
    for (const entry of LEGACY_ENTRY_CASES) {
      expect(resolveLegacySectionRedirect(entry.stageId, entry.subnavId)).toBeUndefined()
    }
    expect(resolveLegacySectionRedirect('world', 'rules-boundaries')).toBeUndefined()
    expect(resolveLegacySectionRedirect('idea')).toBeUndefined()
  })

  it('改派结果每次都是新对象，调用方改不动常量本身', () => {
    const first = resolveLegacySectionRedirect('idea', 'terms-boundaries')!
    first.subnavId = 'story-seed'
    expect(LEGACY_SECTION_REDIRECTS['idea/terms-boundaries']!.subnavId).toBe('rules-boundaries')
  })

  it('改派优先于大纲映射：该入口不再落回创作起点', () => {
    expect(resolveLegacySectionRedirect('idea', 'terms-boundaries'))
      .not.toEqual(resolveIntegratedOutlineTarget('idea', 'terms-boundaries').canonicalTarget)
  })
})

describe('resolveIntegratedOutlineTarget - 旧入口兼容映射', () => {
  it('九入口映射表 + 一个栏目改派表，合起来仍覆盖十个旧入口', () => {
    expect(LEGACY_ENTRY_CASES).toHaveLength(9)
    expect(LEGACY_REDIRECT_CASES).toHaveLength(1)
    expect(LEGACY_ENTRY_CASES.length + LEGACY_REDIRECT_CASES.length).toBe(10)
  })

  for (const testCase of LEGACY_ENTRY_CASES) {
    it(`${testCase.name} -> ${testCase.moduleId} / ${testCase.focusId}`, () => {
      const target = resolveIntegratedOutlineTarget(testCase.stageId, testCase.subnavId)

      expect(target.moduleId).toBe(testCase.moduleId)
      expect(target.focusId).toBe(testCase.focusId)
      expect(target.canonicalTarget).toEqual(testCase.canonicalTarget)
    })
  }

  it('创作起点三个旧入口共享同一 canonicalTarget，只改变页内定位', () => {
    const seed = resolveIntegratedOutlineTarget('idea', 'story-seed')
    const directions = resolveIntegratedOutlineTarget('idea', 'direction-cards')
    const specs = resolveIntegratedOutlineTarget('idea', 'writing-specs')

    expect(directions.canonicalTarget).toEqual(seed.canonicalTarget)
    expect(specs.canonicalTarget).toEqual(seed.canonicalTarget)

    expect(new Set([seed.focusId, directions.focusId, specs.focusId]).size).toBe(3)
  })

  it('章节规划三个旧入口共享 canonicalTarget，但 focusId 互不相同', () => {
    const all = resolveIntegratedOutlineTarget('outline', 'chapter-directory')
    const nearby = resolveIntegratedOutlineTarget('outline', 'rolling-outline')
    const detail = resolveIntegratedOutlineTarget('outline', 'chapter-beats')

    expect(nearby.canonicalTarget).toEqual(all.canonicalTarget)
    expect(detail.canonicalTarget).toEqual(all.canonicalTarget)
    expect(new Set([all.focusId, nearby.focusId, detail.focusId]).size).toBe(3)
  })

  it('四个正式模块的 canonicalTarget 严格等于第 6 节定义', () => {
    expect(resolveIntegratedOutlineTarget('idea', 'story-seed').canonicalTarget)
      .toEqual({ stageId: 'idea', subnavId: 'story-seed' })
    expect(resolveIntegratedOutlineTarget('outline', 'outline-foundation').canonicalTarget)
      .toEqual({ stageId: 'outline', subnavId: 'outline-foundation' })
    expect(resolveIntegratedOutlineTarget('outline', 'chapter-directory').canonicalTarget)
      .toEqual({ stageId: 'outline', subnavId: 'chapter-directory' })
    expect(resolveIntegratedOutlineTarget('outline', 'storylines').canonicalTarget)
      .toEqual({ stageId: 'outline', subnavId: 'storylines' })
  })

  it('九个映射入口只产生四种模块', () => {
    const moduleIds = LEGACY_ENTRY_CASES.map((entry) =>
      resolveIntegratedOutlineTarget(entry.stageId, entry.subnavId).moduleId
    )

    expect([...new Set(moduleIds)].sort()).toEqual([
      'chapter-planning',
      'creation-start',
      'outline-volumes',
      'storylines'
    ])
  })
})

describe('resolveIntegratedOutlineTarget - 安全回落', () => {
  const FALLBACK_CANONICAL_TARGET: IntegratedOutlineTarget['canonicalTarget'] = {
    stageId: 'idea',
    subnavId: 'story-seed'
  }

  it('未知 idea 入口回落 creation-start / seed', () => {
    const target = resolveIntegratedOutlineTarget('idea', 'not-a-real-subnav')

    expect(target.moduleId).toBe('creation-start')
    expect(target.focusId).toBe('seed')
    expect(target.canonicalTarget).toEqual(FALLBACK_CANONICAL_TARGET)
  })

  it('idea 未提供 subnavId 时回落 creation-start / seed', () => {
    const target = resolveIntegratedOutlineTarget('idea')

    expect(target.moduleId).toBe('creation-start')
    expect(target.focusId).toBe('seed')
    expect(target.canonicalTarget).toEqual(FALLBACK_CANONICAL_TARGET)
  })

  it('未知 outline 入口回落 outline-volumes / overview', () => {
    const target = resolveIntegratedOutlineTarget('outline', 'not-a-real-subnav')

    expect(target.moduleId).toBe('outline-volumes')
    expect(target.focusId).toBe('overview')
    expect(target.canonicalTarget).toEqual({ stageId: 'outline', subnavId: 'outline-foundation' })
  })

  it('outline 未提供 subnavId 时回落 outline-volumes / overview', () => {
    const target = resolveIntegratedOutlineTarget('outline')

    expect(target.moduleId).toBe('outline-volumes')
    expect(target.focusId).toBe('overview')
    expect(target.canonicalTarget).toEqual({ stageId: 'outline', subnavId: 'outline-foundation' })
  })

  for (const stageId of ['world', 'writing', 'memory', 'delivery', 'unknown-stage']) {
    it(`非大纲 stage "${stageId}" 安全回落创作起点且不抛异常`, () => {
      expect(() => resolveIntegratedOutlineTarget(stageId, 'any-subnav')).not.toThrow()

      const target = resolveIntegratedOutlineTarget(stageId, 'any-subnav')

      expect(target.moduleId).toBe('creation-start')
      expect(target.focusId).toBe('seed')
      expect(target.canonicalTarget).toEqual(FALLBACK_CANONICAL_TARGET)
    })
  }

  it('回落结果总是返回三个字段的完整对象', () => {
    const target = resolveIntegratedOutlineTarget('world', 'world-entries')

    expect(Object.keys(target).sort()).toEqual(['canonicalTarget', 'focusId', 'moduleId'])
  })
})

describe('组合模型 - canonicalTarget 与四个模块一一对应', () => {
  it('四个 canonicalTarget 各自落到四个不同模块', () => {
    const moduleIds = Object.values(INTEGRATED_OUTLINE_CANONICAL_TARGETS).map((target) =>
      resolveIntegratedOutlineTarget(target.stageId, target.subnavId).moduleId
    )

    expect(new Set(moduleIds).size).toBe(4)
    expect([...moduleIds].sort()).toEqual([...INTEGRATED_OUTLINE_MODULE_IDS].sort())
  })

  it('每个模块的 canonicalTarget 解析回它自己的模块', () => {
    for (const moduleId of INTEGRATED_OUTLINE_MODULE_IDS) {
      const canonicalTarget = INTEGRATED_OUTLINE_CANONICAL_TARGETS[moduleId]
      const resolved = resolveIntegratedOutlineTarget(canonicalTarget.stageId, canonicalTarget.subnavId)

      expect(resolved.moduleId).toBe(moduleId)
      expect(resolved.canonicalTarget).toEqual(canonicalTarget)
    }
  })
})

describe('canEnterOutline - 只有故事种子是硬条件', () => {
  /** 故意带上大纲 / 方向卡 / 规格字段，用来证明它们都不是进入条件。 */
  const projectLike = (seed: string) => ({ seed, outline: {}, directionCards: [], settings: {} })

  it('故事种子非空即可进入', () => {
    expect(canEnterOutline({ seed: '一个关于复仇与救赎的故事' })).toBe(true)
  })

  it('种子为空串或纯空白时不可进入', () => {
    expect(canEnterOutline({ seed: '' })).toBe(false)
    expect(canEnterOutline({ seed: '   \n\t ' })).toBe(false)
  })

  it('即使项目已有大纲、方向卡与规格，种子为空仍然不可进入', () => {
    expect(canEnterOutline(projectLike(''))).toBe(false)
    expect(canEnterOutline(projectLike('只有种子非空'))).toBe(true)
  })
})

describe('创作起点 · 四类已启用编辑只改授权字段', () => {
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  /**
   * 一个形状够用的草稿：只覆盖四个授权字段所在的区域。
   * 这里不追求通过 NovelProject 的完整校验，mutator 的断言只关心「改了哪些字段」。
   */
  const baseline = () => ({
    seed: '原始种子',
    activeDirectionCardId: 'card-1' as string | undefined,
    worldConstraints: [
      { id: 'c1', status: '待确认', updatedAt: '2026-01-01T00:00:00.000Z', definition: '定义文本一' },
      { id: 'c2', status: '已确认', updatedAt: '2026-01-02T00:00:00.000Z', definition: '定义文本二' }
    ],
    settings: {
      genreTemplate: '都市',
      pointOfView: '第一人称',
      tense: '过去时',
      language: '简体中文',
      targetWords: 120000,
      plannedVolumes: 3,
      plannedChapters: 40,
      audience: '目标读者',
      style: '语言与文风',
      contentLimits: '内容边界',
      rhetoricIntensity: 2
    }
  })

  const asProject = (draft: ReturnType<typeof baseline>): NovelProject => draft as unknown as NovelProject

  it('授权写目标恰好是三项（术语状态已随去重移出本模块）', () => {
    expect([...CREATION_START_EDIT_TARGETS]).toEqual([
      'seed',
      'activeDirectionCardId',
      'settings'
    ])
  })

  it('组合模型导出的写函数与授权清单完全一致（新增写通道必须先在此登记）', () => {
    const writers = Object.keys(integratedOutlineModel)
      .filter((name) => name.startsWith('apply'))
      .sort()

    // 创作起点：方向卡当前采用 / 种子 / 创作规格
    // M3 总纲与卷纲：空白大纲 / 新增卷 / 总纲字段 / 卷字段 / 方向卡 / 方向问答
    // M4 章纲到正文：新建章纲 / 章纲字段 / 章纲引用 / 步骤增改排序删确认 / 开始写作 / 正文补建章纲
    expect(writers).toEqual([
      'applyActiveDirectionCardEdit',
      'applyAddBeat',
      'applyAddChapterOutline',
      'applyAddDirectionCard',
      'applyAddOutlineVolume',
      'applyBeatFieldEdit',
      'applyChapterOutlineFieldEdit',
      'applyChapterReferenceEdit',
      'applyConfirmBeats',
      'applyCreateBlankOutline',
      'applyCreateBodyForOutline',
      'applyCreateOutlineForBody',
      'applyDirectionAnswerEdit',
      'applyDirectionCardFieldEdit',
      'applyMoveBeat',
      'applyOutlineFieldEdit',
      'applyRemoveBeat',
      'applySeedEdit',
      'applySettingEdit',
      'applyVolumeFieldEdit'
    ])
  })

  it('组合模型不导出任何直接写库 / 保存 / 提交的入口', () => {
    const names = Object.keys(integratedOutlineModel)
    expect(names.filter((name) => /updateProject|persist|save|commit/i.test(name))).toEqual([])
  })

  it('故事种子编辑只改 seed', () => {
    const draft = baseline()
    const before = clone(draft)

    applySeedEdit(draft, '新的种子')

    expect(draft.seed).toBe('新的种子')
    expect({ ...draft, seed: before.seed }).toEqual(before)
  })

  it('方向卡「当前采用」只改 activeDirectionCardId，并可取消采用', () => {
    const draft = baseline()
    const before = clone(draft)

    applyActiveDirectionCardEdit(draft, 'card-9')

    expect(draft.activeDirectionCardId).toBe('card-9')
    expect({ ...draft, activeDirectionCardId: before.activeDirectionCardId }).toEqual(before)

    const cleared = baseline()
    applyActiveDirectionCardEdit(cleared, undefined)
    expect(cleared.activeDirectionCardId).toBeUndefined()
    expect(cleared.seed).toBe('原始种子')
  })

  it('创作规格的数值字段只改自身', () => {
    const draft = asProject(baseline())
    const before = clone(draft.settings)

    applySettingEdit(draft, 'plannedChapters', 55)

    expect(draft.settings.plannedChapters).toBe(55)
    expect({ ...draft.settings, plannedChapters: before.plannedChapters }).toEqual(before)
  })

  it('创作规格的文本与枚举字段同样只改自身', () => {
    const draft = asProject(baseline())
    const before = clone(draft.settings)

    applySettingEdit(draft, 'contentLimits', '新的内容边界')
    applySettingEdit(draft, 'tense', '现在时' as NovelProject['settings']['tense'])

    expect(draft.settings.contentLimits).toBe('新的内容边界')
    expect(draft.settings.tense).toBe('现在时')
    expect({ ...draft.settings, contentLimits: before.contentLimits, tense: before.tense }).toEqual(before)
  })
})
