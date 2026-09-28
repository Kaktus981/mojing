import {
  GenreTemplateSchema,
  RHETORIC_GUIDANCE,
  rhetoricGuidance,
  type NovelProject
} from '../../../../../../../packages/contracts/src'

/**
 * 小说大纲 ·「故事起点」四个二级页面的纯数据模型。
 *
 * 背景：`idea` 阶段的四个入口（故事种子 / 故事方向卡 / 术语与边界 / 创作规格）
 * 原先四个入口的中央内容完全相同。本文件按三条原则把它们拆开：
 *   1. 四个入口必须呈现**不同**内容，可被测试直接证明；
 *   2. 展示值只能来自传入的真实 `NovelProject`（seed / directionCards /
 *      worldConstraints / settings）—— 不补占位、不造假统计、不造假成功；
 *   3. 未接通的能力显式建模为 `notice` + `actions[].enabled=false` 并写明真实原因，
 *      页面只负责如实说明并保持禁用。
 */

export type IdeaPageId = 'story-seed' | 'direction-cards' | 'terms-boundaries' | 'writing-specs'

export const IDEA_PAGE_IDS: readonly IdeaPageId[] = [
  'story-seed',
  'direction-cards',
  'terms-boundaries',
  'writing-specs'
]

export type IdeaPageKind = 'seed' | 'directions' | 'terms' | 'specs'

const PAGE_KIND: Record<IdeaPageId, IdeaPageKind> = {
  'story-seed': 'seed',
  'direction-cards': 'directions',
  'terms-boundaries': 'terms',
  'writing-specs': 'specs'
}

export function isIdeaPageId(value: string): value is IdeaPageId {
  return (IDEA_PAGE_IDS as readonly string[]).includes(value)
}

/** 未知 / 失效 id 回落到本组默认页（故事种子），与导航的 defaultSubnavId 一致。 */
export function ideaPageKind(subnavId: string): IdeaPageKind {
  return isIdeaPageId(subnavId) ? PAGE_KIND[subnavId] : 'seed'
}

/** 未接通能力的真实原因。放在模型里，页面只负责如实展示。 */
export type IdeaNotice = { id: string; title: string; detail: string }

/** 未接通的操作。`enabled` 恒为 false —— 结构上就不允许页面渲染成可点。 */
export type IdeaAction = { id: string; label: string; enabled: false; reason: string }

type Settings = NovelProject['settings']
type DirectionCard = NonNullable<NovelProject['directionCards']>[number]
type WorldConstraint = NovelProject['worldConstraints'][number]

/** 题材模板直接取自契约枚举，避免界面维护第二份清单后与契约漂移。 */
export const GENRE_TEMPLATE_OPTIONS: readonly Settings['genreTemplate'][] = GenreTemplateSchema.options

export const POINT_OF_VIEW_OPTIONS: readonly Settings['pointOfView'][] = [
  '第一人称',
  '第三人称限知',
  '第三人称全知',
  '多视角'
]

export const TENSE_OPTIONS: readonly Settings['tense'][] = ['过去时', '现在时', '混合']

export const RHETORIC_LEVEL_OPTIONS = RHETORIC_GUIDANCE.map((item, level) => ({
  level,
  label: item.label,
  description: item.description
}))

export const CONSTRAINT_STATUSES = ['待确认', '已确认', '已锁定', '已拒绝'] as const

/* ------------------------------------------------------------------ *
 * 未接通说明（四个页面各一条，原因与现状一一对应）
 * ------------------------------------------------------------------ */

export const IDEA_NOTICE_SEED: IdeaNotice = {
  id: 'idea-seed',
  title: '故事种子只保存你亲手写的内容',
  detail:
    '本页只保存你亲手写下的故事种子，不会自动补全或改写。从种子推演故事方向的能力目前还没有开放 —— 与其放一个点了没反应的按钮，不如如实说明。故事方向可以先在右侧助手里讨论，结论只进候选层。'
}

export const SEED_ACTIONS: readonly IdeaAction[] = [
  {
    id: 'infer-directions-from-seed',
    label: 'AI 从故事种子推演方向卡',
    enabled: false,
    reason: '推演出的结果只会作为方向卡候选供你确认，不会直接改动任何内容；当前不可用。'
  }
]

export const IDEA_NOTICE_DIRECTION_CARDS: IdeaNotice = {
  id: 'idea-direction-cards',
  title: '方向卡暂不支持 AI 生成、采用候选与批量操作',
  detail:
    '（1）生成：AI 生成的方向卡只会作为候选供你确认，该入口目前尚未开放；（2）采用候选：「采用方向卡候选」这一操作目前也尚未开放，无法把候选取用为正式方向卡；（3）批量：批量操作同样尚未开放。本页因此只允许你在已有方向卡之间切换「当前采用」标记，并如实展示每张卡的关键内容与未决问题。'
}

export const IDEA_NOTICE_TERMS: IdeaNotice = {
  id: 'idea-terms',
  title: '术语提取只产出待确认候选，确认与否由你决定',
  detail:
    'AI 提取出的术语默认只是「待确认」的候选，不会直接变成正式设定。本页如实展示已提取的术语，并允许你按作者意愿切换状态 —— 只改状态本身，不改写 AI 给出的定义文本，也不会替你「采用」任何候选。'
}

export const IDEA_NOTICE_SPECS: IdeaNotice = {
  id: 'idea-specs',
  title: '创作规格是生成时的软约束',
  detail:
    '这里填写的创作规格会在正文 / 大纲生成时作为软约束带入，但不会回头改写已经写好的正文；所有改动都会自动保存。'
}

/* ------------------------------------------------------------------ *
 * 页面 1/4 · 故事种子
 * ------------------------------------------------------------------ */

export type StorySeedModel = {
  kind: 'seed'
  weAreHere: 'seed'
  seed: string
  hasSeed: boolean
  charCount: number
  projectTitle: string
  projectStatus: string
  updatedAt: string
  notice: IdeaNotice
  actions: readonly IdeaAction[]
}

export function buildStorySeed(project: NovelProject): StorySeedModel {
  const seed = project.seed
  return {
    kind: 'seed',
    weAreHere: 'seed',
    seed,
    hasSeed: Boolean(seed.trim()),
    charCount: seed.trim().length,
    projectTitle: project.title,
    projectStatus: project.status,
    updatedAt: project.updatedAt,
    notice: IDEA_NOTICE_SEED,
    actions: SEED_ACTIONS
  }
}

/* ------------------------------------------------------------------ *
 * 页面 2/4 · 故事方向卡
 * ------------------------------------------------------------------ */

/** 方向卡的精简字段：旧卡片也有，契约里必填但可能是空串。 */
const DIRECTION_CARD_CORE_FIELDS = [
  ['premise', '故事前提'],
  ['coreConflict', '核心冲突'],
  ['protagonistHook', '主角钩子'],
  ['emotionalPromise', '情感承诺'],
  ['openingSituation', '开场情境']
] as const satisfies readonly (readonly [keyof DirectionCard, string])[]

/** 完整故事方向字段：旧卡片可能整段缺失，读取时如实标空而不是补占位。 */
const DIRECTION_CARD_FULL_FIELDS = [
  ['logline', '一句话梗概'],
  ['genreDirection', '类型方向'],
  ['protagonistIdentity', '主角身份'],
  ['protagonistSituation', '主角处境'],
  ['protagonistGoal', '主角目标'],
  ['mainObstacle', '主要阻碍'],
  ['specialPremise', '特殊设定'],
  ['cost', '代价'],
  ['failureConsequence', '失败后果'],
  ['centralMystery', '核心悬念'],
  ['readingExperience', '阅读体验']
] as const satisfies readonly (readonly [keyof DirectionCard, string])[]

/** 一张方向卡里真正的关键字段；缺失即如实标出，不用占位文本填满。 */
const DIRECTION_CARD_FIELDS: readonly (readonly [keyof DirectionCard, string])[] = [
  ...DIRECTION_CARD_CORE_FIELDS,
  ...DIRECTION_CARD_FULL_FIELDS
]

/** `fieldStatuses` 的字段名 → 中文标签；只用于展示，不改动任何状态。 */
const FIELD_STATUS_LABELS: Record<string, string> = {
  genreDirection: '类型方向',
  logline: '一句话梗概',
  protagonistIdentity: '主角身份',
  protagonistSituation: '主角处境',
  protagonistGoal: '主角目标',
  mainObstacle: '主要阻碍',
  specialPremise: '特殊设定',
  cost: '代价',
  failureConsequence: '失败后果',
  centralMystery: '核心悬念',
  readingExperience: '阅读体验',
  openingSituation: '开场情境'
}

/** 作者对单个方向的判定（作者已确定 / 暂时采用 / 尚未确定），只在卡上如实展示。 */
export type DirectionFieldStatusView = { label: string; status: string }

export type DirectionFieldView = { key: string; label: string; value: string }

export type DirectionCardViewModel = {
  id: string
  title: string
  status: string
  version: number
  isActive: boolean
  premise: string
  coreConflict: string
  protagonistHook: string
  emotionalPromise: string
  openingSituation: string
  /** 精简字段的展示行，供页面直接渲染。 */
  coreFields: DirectionFieldView[]
  /** 完整故事方向字段的展示行；旧卡片这些字段可能是空的。 */
  fullFields: DirectionFieldView[]
  /** 作者逐字段的判定；一张都没填时为空数组。 */
  fieldStatuses: DirectionFieldStatusView[]
  unresolvedQuestions: string[]
  /** 真实为空的字段标签，界面据此显示空态而不是占位。 */
  missingFields: string[]
  updatedAt: string
}

export type DirectionCardsModel = {
  kind: 'directions'
  weAreHere: 'directions'
  cards: DirectionCardViewModel[]
  activeCardId: string
  activeCardTitle: string
  questions: string[]
  answers: string[]
  answeredCount: number
  statusCounts: { total: number; 候选: number; 已采用: number; 已归档: number }
  /** 真实存在的方向卡数量，用来区分「还没生成」与「已生成但未采用」。 */
  hasCards: boolean
  notice: IdeaNotice
  actions: readonly IdeaAction[]
}

export const DIRECTION_CARD_ACTIONS: readonly IdeaAction[] = [
  {
    id: 'generate-direction-cards',
    label: 'AI 生成方向卡',
    enabled: false,
    reason: 'AI 生成的方向卡只会作为候选供你确认，不会直接改动任何内容；该入口尚未开放，当前不可用。'
  },
  {
    id: 'apply-direction-card-candidate',
    label: '采用方向卡候选',
    enabled: false,
    reason: '「采用方向卡候选」当前没有可用的处理流程，无法把候选取用为正式方向卡；当前不可用。'
  },
  {
    id: 'batch-direction-cards',
    label: '批量归档 / 批量采用',
    enabled: false,
    reason: '方向卡的批量归档与批量采用功能尚未开放；当前不可用。'
  }
]

function toDirectionFieldRows(
  card: DirectionCard,
  fields: readonly (readonly [keyof DirectionCard, string])[]
): DirectionFieldView[] {
  return fields.map(([key, label]) => {
    const value = card[key]
    return { key, label, value: typeof value === 'string' ? value : '' }
  })
}

function toDirectionCardView(card: DirectionCard, activeCardId: string): DirectionCardViewModel {
  const missingFields: string[] = []
  if (!card.title.trim()) missingFields.push('标题')
  for (const [key, label] of DIRECTION_CARD_FIELDS) {
    const value = card[key]
    // 旧卡片的完整方向字段可能是 undefined（字段本身没写过），与新卡的 '' 一样都属于真实空白。
    if (typeof value !== 'string' || !value.trim()) missingFields.push(label)
  }
  const rawStatuses: Record<string, string | undefined> =
    (card.fieldStatuses as Record<string, string | undefined> | undefined) ?? {}
  const fieldStatuses: DirectionFieldStatusView[] = Object.keys(FIELD_STATUS_LABELS)
    .filter((key) => Boolean(rawStatuses[key]))
    .map((key) => ({ label: FIELD_STATUS_LABELS[key] as string, status: rawStatuses[key] as string }))
  return {
    id: card.id,
    title: card.title.trim(),
    status: card.status,
    version: card.version,
    isActive: card.id === activeCardId,
    premise: card.premise,
    coreConflict: card.coreConflict,
    protagonistHook: card.protagonistHook,
    emotionalPromise: card.emotionalPromise,
    openingSituation: card.openingSituation,
    coreFields: toDirectionFieldRows(card, DIRECTION_CARD_CORE_FIELDS),
    fullFields: toDirectionFieldRows(card, DIRECTION_CARD_FULL_FIELDS),
    fieldStatuses,
    unresolvedQuestions: card.unresolvedQuestions,
    missingFields,
    updatedAt: card.updatedAt
  }
}

export function buildDirectionCards(project: NovelProject): DirectionCardsModel {
  const rawCards = project.directionCards ?? []
  const activeCardId = project.activeDirectionCardId ?? ''
  const cards = rawCards.map((card) => toDirectionCardView(card, activeCardId))
  const active = cards.find((card) => card.isActive)
  const answers = project.directionQuestionAnswers ?? []
  return {
    kind: 'directions',
    weAreHere: 'directions',
    cards,
    activeCardId,
    activeCardTitle: active?.title ?? '',
    questions: project.directionQuestions ?? [],
    answers,
    answeredCount: answers.filter((answer) => answer.trim()).length,
    statusCounts: {
      total: cards.length,
      候选: cards.filter((card) => card.status === '候选').length,
      已采用: cards.filter((card) => card.status === '已采用').length,
      已归档: cards.filter((card) => card.status === '已归档').length
    },
    hasCards: cards.length > 0,
    notice: IDEA_NOTICE_DIRECTION_CARDS,
    actions: DIRECTION_CARD_ACTIONS
  }
}

/* ------------------------------------------------------------------ *
 * 页面 3/4 · 术语与边界
 * ------------------------------------------------------------------ */

export type TermConstraintViewModel = {
  id: string
  term: string
  definition: string
  notDefinition: string
  entityType: string
  status: string
  allowedUsages: string[]
  forbiddenUsages: Array<{ phrase: string; reason: string }>
  unresolvedQuestions: string[]
  factCount: number
  sourceExcerpt: string
  updatedAt: string
}

export type TermsBoundariesModel = {
  kind: 'terms'
  weAreHere: 'terms'
  constraints: TermConstraintViewModel[]
  constraintStats: { total: number; 待确认: number; 已确认: number; 已锁定: number; 已拒绝: number }
  /** 创作内容限制来自 settings.contentLimits；这里只读展示，编辑在「创作规格」页。 */
  contentLimits: string
  unresolvedTermCount: number
  notice: IdeaNotice
  actions: readonly IdeaAction[]
}

export const TERMS_BOUNDARIES_ACTIONS: readonly IdeaAction[] = [
  {
    id: 'extract-terms',
    label: 'AI 从故事种子提取术语',
    enabled: false,
    reason: '提取出的术语只会作为「待确认」候选供你判断，不会直接变成正式设定；该入口尚未开放，当前不可用。'
  },
  {
    id: 'batch-confirm-terms',
    label: '批量确认全部术语',
    enabled: false,
    reason: '批量确认会绕过你逐条判断，因此暂不提供；当前不可用。'
  }
]

function toTermView(constraint: WorldConstraint): TermConstraintViewModel {
  return {
    id: constraint.id,
    term: constraint.term,
    definition: constraint.definition,
    notDefinition: constraint.notDefinition,
    entityType: constraint.entityType,
    status: constraint.status,
    allowedUsages: constraint.allowedUsages,
    forbiddenUsages: constraint.forbiddenUsages.map((usage) => ({ phrase: usage.phrase, reason: usage.reason })),
    unresolvedQuestions: constraint.unresolvedQuestions,
    factCount: constraint.facts.length,
    sourceExcerpt: constraint.source.excerpt,
    updatedAt: constraint.updatedAt
  }
}

export function buildTermsBoundaries(project: NovelProject): TermsBoundariesModel {
  const constraints = project.worldConstraints ?? []
  const constraints_view = constraints.map(toTermView)
  return {
    kind: 'terms',
    weAreHere: 'terms',
    constraints: constraints_view,
    constraintStats: {
      total: constraints_view.length,
      待确认: constraints_view.filter((item) => item.status === '待确认').length,
      已确认: constraints_view.filter((item) => item.status === '已确认').length,
      已锁定: constraints_view.filter((item) => item.status === '已锁定').length,
      已拒绝: constraints_view.filter((item) => item.status === '已拒绝').length
    },
    contentLimits: project.settings.contentLimits,
    unresolvedTermCount: constraints_view.filter((item) => item.unresolvedQuestions.length > 0).length,
    notice: IDEA_NOTICE_TERMS,
    actions: TERMS_BOUNDARIES_ACTIONS
  }
}

/* ------------------------------------------------------------------ *
 * 页面 4/4 · 创作规格
 * ------------------------------------------------------------------ */

export type WritingSpecsModel = {
  kind: 'specs'
  weAreHere: 'specs'
  genreTemplate: Settings['genreTemplate']
  targetWords: number
  plannedVolumes: number
  plannedChapters: number
  pointOfView: Settings['pointOfView']
  tense: Settings['tense']
  audience: string
  style: string
  contentLimits: string
  language: string
  rhetoricIntensity: number
  rhetoricLabel: string
  rhetoricDescription: string
  rhetoricInstruction: string
  /** 真实推导值：目标字数 / 预计章节；两者都是有效正整数时才有意义。 */
  averageChapterWords?: number
  /** 真正为空的字段标签，界面据此提示，不自动填默认值。 */
  missingFields: string[]
  notice: IdeaNotice
  actions: readonly IdeaAction[]
}

export const WRITING_SPECS_ACTIONS: readonly IdeaAction[] = [
  {
    id: 'infer-specs',
    label: 'AI 从故事种子推断规格',
    enabled: false,
    reason: '「从故事种子推断创作规格」这一能力尚未开放；当前不可用。'
  }
]

export function buildWritingSpecs(project: NovelProject): WritingSpecsModel {
  const settings = project.settings
  const guidance = rhetoricGuidance(settings.rhetoricIntensity)
  const missingFields: string[] = []
  if (!settings.audience.trim()) missingFields.push('目标读者')
  if (!settings.style.trim()) missingFields.push('语言与文风')
  if (!settings.contentLimits.trim()) missingFields.push('创作内容限制')
  const averageChapterWords =
    settings.plannedChapters > 0 && settings.targetWords > 0
      ? Math.round(settings.targetWords / settings.plannedChapters)
      : undefined
  return {
    kind: 'specs',
    weAreHere: 'specs',
    genreTemplate: settings.genreTemplate,
    targetWords: settings.targetWords,
    plannedVolumes: settings.plannedVolumes,
    plannedChapters: settings.plannedChapters,
    pointOfView: settings.pointOfView,
    tense: settings.tense,
    audience: settings.audience,
    style: settings.style,
    contentLimits: settings.contentLimits,
    language: settings.language,
    rhetoricIntensity: guidance.level,
    rhetoricLabel: guidance.label,
    rhetoricDescription: guidance.description,
    rhetoricInstruction: guidance.instruction,
    averageChapterWords,
    missingFields,
    notice: IDEA_NOTICE_SPECS,
    actions: WRITING_SPECS_ACTIONS
  }
}
