import type { NovelProject } from '../../../../../../../packages/contracts/src'
import type { WorkspaceStageNavigationTarget as WorkspaceNavigationTarget } from '../../workspaceNavigation'

/**
 * 小说大纲 · 十入口 → 四模块兼容映射（纯函数，无副作用）。
 *
 * 背景：`WorkspaceSubnavId` 里的十个「小说大纲」旧入口必须全部保留（保存过的
 * 布局偏好、深层链接都还在用它们），但正式界面只显示四个模块。本文件是两套
 * 结构之间唯一的翻译层：
 *
 *   1. 只做纯映射：不读取 store、不访问 DOM、不产生任何写入；
 *   2. 四个模块各自有稳定的 `canonicalTarget`，同一模块的旧入口只改变页内定位
 *      （`focusId`），不改变落点；
 *   3. 未知输入必须安全回落而不是抛异常，避免旧深层入口把整页打崩。
 */

/** 正式显示的小说大纲四模块。 */
export type IntegratedOutlineModuleId =
  | 'creation-start'
  | 'outline-volumes'
  | 'chapter-planning'
  | 'storylines'

/** 模块内的初始定位；用于初始化折叠区展开状态。 */
export type IntegratedOutlineFocusId =
  | 'seed'
  | 'directions'
  | 'specs'
  | 'overview'
  | 'structure'
  | 'all-chapters'
  | 'nearby-chapters'
  | 'chapter-detail'
  | 'storyline-list'

export type IntegratedOutlineTarget = {
  moduleId: IntegratedOutlineModuleId
  focusId: IntegratedOutlineFocusId
  canonicalTarget: WorkspaceNavigationTarget
}

/** 四个正式模块的落点。 */
export const INTEGRATED_OUTLINE_CANONICAL_TARGETS: Record<
  IntegratedOutlineModuleId,
  WorkspaceNavigationTarget
> = {
  'creation-start': { stageId: 'idea', subnavId: 'story-seed' },
  'outline-volumes': { stageId: 'outline', subnavId: 'outline-foundation' },
  'chapter-planning': { stageId: 'outline', subnavId: 'chapter-directory' },
  storylines: { stageId: 'outline', subnavId: 'storylines' }
}

/** 正式展示顺序，与「创作起点 → 总纲与卷纲 → 章节规划 → 故事线」一致。 */
export const INTEGRATED_OUTLINE_MODULE_IDS: readonly IntegratedOutlineModuleId[] = [
  'creation-start',
  'outline-volumes',
  'chapter-planning',
  'storylines'
]

/**
 * 四个模块的显示名与一句话说明。
 *
 * 232px 导航项、52px 标题栏与助手档案都必须取自这里：十入口归一之后，
 * 任何一处自己拼文案都会立刻和另外两处对不上。
 */
export const INTEGRATED_OUTLINE_MODULES: Record<
  IntegratedOutlineModuleId,
  { label: string; description: string }
> = {
  'creation-start': {
    label: '创作起点',
    description: '故事种子、当前方向与必要的创作规格'
  },
  'outline-volumes': {
    label: '总纲与卷纲',
    description: '总纲、主冲突、结局方向与分卷结构'
  },
  'chapter-planning': {
    label: '章节规划',
    description: '按卷查看章节，并逐章检查目标、冲突与剧情步骤'
  },
  storylines: {
    label: '故事线',
    description: '跨章事件线的推进、暂停与待收束节点'
  }
}

/**
 * 是否允许从「创作起点」进入后续三个模块。
 *
 * 唯一硬条件是故事种子非空：大纲对象、方向卡、创作规格都不是前置条件，
 * 因此缺大纲的项目仍然可以进入「总纲与卷纲」并看到诚实空态，而不是被拦在门外。
 */
export function canEnterOutline(project: Pick<NovelProject, 'seed'>): boolean {
  return Boolean(project.seed?.trim())
}

type LegacyEntryMapping = {
  moduleId: IntegratedOutlineModuleId
  focusId: IntegratedOutlineFocusId
}

/** 键为 `${stageId}/${subnavId}`，覆盖十个旧入口。 */
const LEGACY_ENTRY_MAPPINGS: Readonly<Record<string, LegacyEntryMapping>> = Object.freeze({
  'idea/story-seed': { moduleId: 'creation-start', focusId: 'seed' },
  'idea/direction-cards': { moduleId: 'creation-start', focusId: 'directions' },
  'idea/writing-specs': { moduleId: 'creation-start', focusId: 'specs' },
  'outline/outline-foundation': { moduleId: 'outline-volumes', focusId: 'overview' },
  'outline/outline-structure': { moduleId: 'outline-volumes', focusId: 'structure' },
  'outline/chapter-directory': { moduleId: 'chapter-planning', focusId: 'all-chapters' },
  'outline/rolling-outline': { moduleId: 'chapter-planning', focusId: 'nearby-chapters' },
  'outline/chapter-beats': { moduleId: 'chapter-planning', focusId: 'chapter-detail' },
  'outline/storylines': { moduleId: 'storylines', focusId: 'storyline-list' }
})

/**
 * 因去重调整而**改派到其他栏目**的旧入口。
 *
 * 「术语与边界」在创作起点里与世界观「规则与边界」完全重复：同一批 `worldConstraints`、
 * 同一套状态切换、同一份只读内容限制。去重后只保留世界观那一处，
 * 旧入口改派到 `world/rules-boundaries` —— **数据不迁移、不删除**，
 * 导航高亮、标题与右侧助手都跟着改派后的栏目走。
 */
export const LEGACY_SECTION_REDIRECTS: Readonly<Record<string, WorkspaceNavigationTarget>> = Object.freeze({
  'idea/terms-boundaries': { stageId: 'world', subnavId: 'rules-boundaries' }
})

/**
 * 解析「改派到其他栏目」的旧入口；不是改派入口时返回 `undefined`。
 *
 * 调用方（导航高亮、标题栏、右侧助手、工作区渲染）必须在做任何其他判断之前先问这一处，
 * 否则旧深层链接会错落到创作起点。
 */
export function resolveLegacySectionRedirect(
  stageId: string,
  subnavId?: string
): WorkspaceNavigationTarget | undefined {
  const target = LEGACY_SECTION_REDIRECTS[`${stageId}/${subnavId ?? ''}`]
  return target ? { ...target } : undefined
}

/** 未知 idea 入口与非大纲 stage 都回落到创作起点首屏。 */
const CREATION_START_FALLBACK: LegacyEntryMapping = {
  moduleId: 'creation-start',
  focusId: 'seed'
}

/** 未知 outline 入口回落到总纲与卷纲概览。 */
const OUTLINE_VOLUMES_FALLBACK: LegacyEntryMapping = {
  moduleId: 'outline-volumes',
  focusId: 'overview'
}

const buildTarget = (mapping: LegacyEntryMapping): IntegratedOutlineTarget => ({
  moduleId: mapping.moduleId,
  focusId: mapping.focusId,
  canonicalTarget: { ...INTEGRATED_OUTLINE_CANONICAL_TARGETS[mapping.moduleId] }
})

/**
 * 把旧的 stage / subnav 入口翻译成四模块定位。
 *
 * - 命中十个已登记入口 → 对应模块与页内定位；
 * - 未知 `idea` 入口 → `creation-start / seed`；
 * - 未知 `outline` 入口 → `outline-volumes / overview`；
 * - 非大纲 stage → 安全回落创作起点，不抛异常。
 */
export function resolveIntegratedOutlineTarget(
  stageId: string,
  subnavId?: string
): IntegratedOutlineTarget {
  const mapping = LEGACY_ENTRY_MAPPINGS[`${stageId}/${subnavId ?? ''}`]
  if (mapping) return buildTarget(mapping)

  if (stageId === 'outline') return buildTarget(OUTLINE_VOLUMES_FALLBACK)
  return buildTarget(CREATION_START_FALLBACK)
}

/* ------------------------------------------------------------------ *
 * 已启用的真实编辑：唯一写入口的纯 mutator
 * ------------------------------------------------------------------ *
 * 创作起点只保留三类已接通写入（术语状态切换已随「术语与边界」折叠区一起去重，
 * 改由世界观「规则与边界」页面自己管理）：
 *   seed / activeDirectionCardId / settings
 * 大纲、卷纲、章纲、剧情步骤、结构调整与故事线都没有可用端点，继续禁用。
 *
 * 页面侧仍然是 `updateProject((draft) => applyXxx(draft, …))`，
 * 900ms 防抖与 revision 流程完全不变；把「改哪个字段」抽成纯函数，
 * 是为了让测试能直接证明「只改授权字段」，而不是靠肉眼审代码。
 */

/** 创作起点里被授权写入的字段。新增写通道必须先出现在这里，否则测试会失败。 */
export const CREATION_START_EDIT_TARGETS = [
  'seed',
  'activeDirectionCardId',
  'settings'
] as const

export type CreationStartEditTarget = (typeof CREATION_START_EDIT_TARGETS)[number]

/** 故事种子：只改 `project.seed`。 */
export function applySeedEdit(draft: { seed: string }, seed: string): void {
  draft.seed = seed
}

/** 方向卡「当前采用」：只改 `project.activeDirectionCardId`（传 undefined 即取消采用）。 */
export function applyActiveDirectionCardEdit(
  draft: { activeDirectionCardId?: string },
  cardId?: string
): void {
  draft.activeDirectionCardId = cardId
}

/** 创作规格：只改 `project.settings` 上的一个字段。 */
export function applySettingEdit<K extends keyof NovelProject['settings']>(
  draft: Pick<NovelProject, 'settings'>,
  key: K,
  value: NovelProject['settings'][K]
): void {
  draft.settings[key] = value
}

/* ------------------------------------------------------------------ *
 * M3：空项目 → 总纲与卷纲（手写内容）
 * ------------------------------------------------------------------ *
 * 这一组是「总纲 / 卷 / 方向卡」的唯一写入口，页面只把它们包进 `updateProject`：
 *   - 空白大纲契约完整但**不造示例内容**，只有还没有大纲时才创建，绝不覆盖已有大纲；
 *   - 手写改动定稿规划时退回「草稿」并刷新大纲时间，不自动改正文；
 *   - 重复点击、越界索引、找不到目标都返回 false 且无副作用。
 */

/** 章纲里的一个剧情步骤；只声明会读写的字段。 */
export type BeatDraft = {
  id: string
  order: number
  title: string
  purpose: string
  conflict: string
  outcome: string
  location: string
  timeframe: string
  reveal: string
  characterIds: string[]
  threadActions: string[]
}

/** 一张章纲卡；只声明会读写或用于判定的字段。 */
export type ChapterOutlineDraft = {
  id: string
  volumeNumber: number
  chapterNumber: number
  title: string
  storyTime?: string
  narrativeMode?: string
  pov: string
  objective: string
  conflict: string
  turningPoint: string
  reveal: string
  endingHook: string
  characterIds: string[]
  setupThreadIds: string[]
  payoffThreadIds: string[]
  beats: BeatDraft[]
  /** 契约里 `beatFindings` 有默认值，但前端不经过 schema 解析，缺它会打崩章节目录。 */
  beatFindings: unknown[]
  status: string
  beatStatus?: string
  downstreamReviewStatus?: string
  downstreamReviewReason?: string
  beatSourceOutlineDigest?: string
}

export type OutlineVolumeDraft = {
  id: string
  volumeNumber: number
  title: string
  goal: string
  climax: string
  resolution: string
  chapters: ChapterOutlineDraft[]
}

export type OutlineDraftShape = {
  status: string
  synopsis: string
  themes: string[]
  mainConflict: string
  endingDirection: string
  volumes: OutlineVolumeDraft[]
  updatedAt: string
}

export type DirectionCardDraft = {
  id: string
  version: number
  title: string
  premise: string
  coreConflict: string
  protagonistHook: string
  emotionalPromise: string
  openingSituation: string
  status: string
  unresolvedQuestions: string[]
  createdAt: string
  updatedAt: string
}

/** 大纲手写编辑所需的草稿形状；只声明真正会读写的字段。 */
export type OutlineWritingDraft = {
  outline?: OutlineDraftShape
  directionCards?: DirectionCardDraft[]
  directionQuestions?: string[]
  directionQuestionAnswers?: string[]
}

/** 可手写编辑的总纲字段。 */
export type OutlineEditableField = 'synopsis' | 'mainConflict' | 'endingDirection'

/** 可手写编辑的卷字段。 */
export type OutlineVolumeEditableField = 'title' | 'goal' | 'climax' | 'resolution'

/** 可手动编辑的方向卡字段。 */
export type DirectionCardEditableField =
  | 'title'
  | 'premise'
  | 'coreConflict'
  | 'protagonistHook'
  | 'emotionalPromise'
  | 'openingSituation'

function draftId(prefix: string, now: string, index: number): string {
  const stamp = Number.isFinite(Date.parse(now)) ? Date.parse(now).toString(36) : 'x'
  return `${prefix}-${stamp}-${index}`
}

/** 触碰大纲：刷新大纲时间；若原状态是「定稿」，按既有规则退回「草稿」。 */
function touchOutline(outline: OutlineDraftShape, now: string): void {
  if (outline.status === '定稿') outline.status = '草稿'
  outline.updatedAt = now
}

/** 契约完整但内容全空的初始大纲；不写入任何示例文本。 */
export function createBlankOutline(now: string): OutlineDraftShape {
  return {
    status: '草稿',
    synopsis: '',
    themes: [],
    mainConflict: '',
    endingDirection: '',
    volumes: [],
    updatedAt: now
  }
}

/** 只有在项目还没有大纲时才建立空白大纲；已有大纲一律不动。 */
export function applyCreateBlankOutline(draft: OutlineWritingDraft, now: string): boolean {
  if (draft.outline) return false
  draft.outline = createBlankOutline(now)
  return true
}

/** 写总纲字段。 */
export function applyOutlineFieldEdit(
  draft: OutlineWritingDraft,
  field: OutlineEditableField,
  value: string,
  now: string
): boolean {
  const outline = draft.outline
  if (!outline) return false
  if (outline[field] === value) return false
  outline[field] = value
  touchOutline(outline, now)
  return true
}

/** 新增一卷（含首卷）：卷号取现有最大值 +1，章纲为空数组。 */
export function applyAddOutlineVolume(
  draft: OutlineWritingDraft,
  volumeId: string,
  now: string
): boolean {
  const outline = draft.outline
  if (!outline) return false
  if (outline.volumes.some((volume) => volume.id === volumeId)) return false

  const nextNumber = outline.volumes.reduce((max, volume) => Math.max(max, volume.volumeNumber), 0) + 1
  outline.volumes.push({
    id: volumeId,
    volumeNumber: nextNumber,
    title: `第${nextNumber}卷`,
    goal: '',
    climax: '',
    resolution: '',
    chapters: []
  })
  touchOutline(outline, now)
  return true
}

/** 写卷字段。 */
export function applyVolumeFieldEdit(
  draft: OutlineWritingDraft,
  volumeId: string,
  field: OutlineVolumeEditableField,
  value: string,
  now: string
): boolean {
  const outline = draft.outline
  if (!outline) return false
  const volume = outline.volumes.find((item) => item.id === volumeId)
  if (!volume) return false
  if (volume[field] === value) return false
  volume[field] = value
  touchOutline(outline, now)
  return true
}

/** 手动建立一张方向卡：合法空候选，来源是作者本人（不是 AI 候选）。 */
export function applyAddDirectionCard(draft: OutlineWritingDraft, now: string): string | undefined {
  if (!Array.isArray(draft.directionCards)) draft.directionCards = []
  const id = draftId('card', now, draft.directionCards.length + 1)
  draft.directionCards.push({
    id,
    version: 1,
    title: '',
    premise: '',
    coreConflict: '',
    protagonistHook: '',
    emotionalPromise: '',
    openingSituation: '',
    status: '候选',
    unresolvedQuestions: [],
    createdAt: now,
    updatedAt: now
  })
  return id
}

/** 写方向卡字段。 */
export function applyDirectionCardFieldEdit(
  draft: OutlineWritingDraft,
  cardId: string,
  field: DirectionCardEditableField,
  value: string,
  now: string
): boolean {
  const card = draft.directionCards?.find((item) => item.id === cardId)
  if (!card) return false
  if (card[field] === value) return false
  card[field] = value
  card.updatedAt = now
  return true
}

/** 写作者对某个方向问题的回答；位置越界不写。 */
export function applyDirectionAnswerEdit(
  draft: OutlineWritingDraft,
  index: number,
  answer: string
): boolean {
  const questions = draft.directionQuestions ?? []
  if (!Number.isInteger(index) || index < 0 || index >= questions.length) return false

  const answers = [...(draft.directionQuestionAnswers ?? [])]
  while (answers.length < questions.length) answers.push('')
  if (answers[index] === answer) return false
  answers[index] = answer
  draft.directionQuestionAnswers = answers
  return true
}

/* ------------------------------------------------------------------ *
 * M4：章纲 → 正文与结构一致性
 * ------------------------------------------------------------------ *
 * 这一组是「章纲 / 剧情步骤 / 正文关联」的唯一写入口，页面只把它们包进
 * `updateProject`，900ms 防抖与 revision 流程不变：
 *   - 新章编号同时看现有章纲与正文，避免只看正文时与章纲撞号；
 *   - 章纲七字段与剧情步骤七字段可手写；改动已确认的步骤必须退回并标记复核；
 *   - 「开始写作」为章纲建立唯一正文，重复点击不会产生第二份；
 *   - 正文没有章纲时只补建作者确认的空规划，不猜正文摘要、不改写正文。
 * 结构操作（调序 / 跨卷移动 / 删章 / 拆分 / 合并）不在这里实现：
 * 它们必须走 core 的结构候选与影响摘要，不能由前端直接改写大纲。
 */

/** 可手写编辑的章纲字段（不新增与现有字段重复的“结果”类数据）。 */
export const CHAPTER_OUTLINE_EDITABLE_FIELDS = [
  'title',
  'pov',
  'objective',
  'conflict',
  'turningPoint',
  'reveal',
  'endingHook'
] as const

export type ChapterOutlineEditableField = (typeof CHAPTER_OUTLINE_EDITABLE_FIELDS)[number]

/** 可手写编辑的剧情步骤字段。 */
export const BEAT_EDITABLE_FIELDS = [
  'title',
  'purpose',
  'conflict',
  'outcome',
  'location',
  'timeframe',
  'reveal'
] as const

export type BeatEditableField = (typeof BEAT_EDITABLE_FIELDS)[number]

/**
 * 因改动已确认的剧情步骤而写入的复核原因。
 * 只有这一条原因会在重新确认步骤时被清掉，卷级变更造成的复核标记不会被顺手抹掉。
 */
export const BEAT_REVIEW_REASON = '已确认的剧情步骤被修改，需要重新确认'

export type BodyChapterDraft = {
  id: string
  volumeNumber: number
  chapterNumber: number
  title: string
  blocks: Array<{ id: string; text: string }>
  status: string
  sourceDigest: string
  updatedAt: string
}

/** 章纲编辑所需的草稿形状：在大纲草稿之上补正文数组。 */
export type ChapterWritingDraft = OutlineWritingDraft & { chapters: BodyChapterDraft[] }

/**
 * 下一个可用章号：同时考虑所有现有章纲与正文。
 * 旧实现只看正文最大值，项目刚建好章纲还没写正文时，新章会和现有章纲撞号。
 */
export function nextChapterNumber(source: {
  outline?: OutlineDraftShape
  chapters: BodyChapterDraft[]
}): number {
  const numbers = [
    ...(source.outline?.volumes ?? []).flatMap((volume) => volume.chapters.map((chapter) => chapter.chapterNumber)),
    ...source.chapters.map((chapter) => chapter.chapterNumber)
  ]
  return numbers.reduce((max, current) => Math.max(max, current), 0) + 1
}

function findOutlineChapter(draft: ChapterWritingDraft, chapterId: string): ChapterOutlineDraft | undefined {
  for (const volume of draft.outline?.volumes ?? []) {
    const chapter = volume.chapters.find((item) => item.id === chapterId)
    if (chapter) return chapter
  }
  return undefined
}

function renumberBeats(chapter: ChapterOutlineDraft): void {
  chapter.beats.forEach((beat, index) => {
    beat.order = index + 1
  })
}

/** 已确认的步骤被改动：退回「待确认」，并写明可回收的复核原因。 */
function markBeatsNeedReview(chapter: ChapterOutlineDraft): void {
  chapter.beatStatus = '待确认'
  chapter.downstreamReviewStatus = '待复核'
  chapter.downstreamReviewReason = BEAT_REVIEW_REASON
}

/** 新建一张章纲：追加到目标卷末尾，内容全空且状态为「未规划」。 */
export function applyAddChapterOutline(
  draft: ChapterWritingDraft,
  input: { volumeNumber?: number },
  now: string,
  chapterId: string
): string | undefined {
  const outline = draft.outline
  if (!outline || outline.volumes.length === 0) return undefined
  const volume = input.volumeNumber === undefined
    ? outline.volumes[outline.volumes.length - 1]
    : outline.volumes.find((item) => item.volumeNumber === input.volumeNumber)
  if (!volume) return undefined
  if (outline.volumes.some((item) => item.chapters.some((chapter) => chapter.id === chapterId))) return undefined

  volume.chapters.push({
    id: chapterId,
    volumeNumber: volume.volumeNumber,
    chapterNumber: nextChapterNumber(draft),
    title: '',
    pov: '',
    objective: '',
    conflict: '',
    turningPoint: '',
    reveal: '',
    endingHook: '',
    characterIds: [],
    setupThreadIds: [],
    payoffThreadIds: [],
    beats: [],
    beatFindings: [],
    status: '未规划',
    beatStatus: '未生成'
  })
  touchOutline(outline, now)
  return chapterId
}

/** 写章纲字段；已有剧情步骤时标记下游待复核。 */
export function applyChapterOutlineFieldEdit(
  draft: ChapterWritingDraft,
  chapterId: string,
  field: ChapterOutlineEditableField,
  value: string,
  now: string
): boolean {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  if (!outline || !chapter) return false
  if (chapter[field] === value) return false

  chapter[field] = value
  if (chapter.status === '已定稿' || chapter.status === '已写作') chapter.status = '已规划'
  if (chapter.status === '未规划' && value.trim()) chapter.status = '已规划'
  if (chapter.beats.length > 0) {
    chapter.downstreamReviewStatus = '待复核'
    chapter.downstreamReviewReason = BEAT_REVIEW_REASON
  }
  touchOutline(outline, now)
  return true
}

/**
 * 章纲「本章引用」的三类关联目标。它们各自对应章纲上一个稳定 id 数组，
 * 全部只描述**章纲计划**：写了计划埋设 / 计划回收，不等于伏笔已经埋设或已经回收。
 */
export const CHAPTER_REFERENCE_KINDS = ['character', 'setupThread', 'payoffThread'] as const

export type ChapterReferenceKind = (typeof CHAPTER_REFERENCE_KINDS)[number]

const CHAPTER_REFERENCE_FIELDS: Record<ChapterReferenceKind, 'characterIds' | 'setupThreadIds' | 'payoffThreadIds'> = {
  character: 'characterIds',
  setupThread: 'setupThreadIds',
  payoffThread: 'payoffThreadIds'
}

/**
 * 选择 / 移除一条章纲引用关联。
 *
 * 三条硬规则：
 *   1. 只写章纲上那一个 id 数组，**不动**正文、记忆与伏笔的实际状态与证据；
 *   2. 按稳定 id 关联，已在数组里就不再追加（禁止重复引用）；
 *   3. 目标已处于期望状态时返回 false 且不触碰任何字段 —— 界面据此避免无意义写请求。
 *
 * 越界或 id 为空一律返回 false。引用与章纲字段同属「章纲计划」，会进入章纲摘要
 * （`novelPlanning.chapterOutlineDigest`），因此沿用 `applyChapterOutlineFieldEdit` 的口径：
 * 状态从「已定稿 / 已写作」退回「已规划」，已有剧情步骤时标记下游待复核。
 */
export function applyChapterReferenceEdit(
  draft: ChapterWritingDraft,
  chapterId: string,
  kind: ChapterReferenceKind,
  referenceId: string,
  selected: boolean,
  now: string
): boolean {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  if (!outline || !chapter || !referenceId) return false

  const field = CHAPTER_REFERENCE_FIELDS[kind]
  const current = chapter[field] ?? []
  if (current.includes(referenceId) === selected) return false

  chapter[field] = selected ? [...current, referenceId] : current.filter((id) => id !== referenceId)
  if (chapter.status === '已定稿' || chapter.status === '已写作') chapter.status = '已规划'
  if (chapter.beats.length > 0) {
    chapter.downstreamReviewStatus = '待复核'
    chapter.downstreamReviewReason = BEAT_REVIEW_REASON
  }
  touchOutline(outline, now)
  return true
}

/** 新增一个剧情步骤；位置排在末位，内容全空。 */
export function applyAddBeat(
  draft: ChapterWritingDraft,
  chapterId: string,
  now: string,
  beatId: string
): string | undefined {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  if (!outline || !chapter) return undefined
  if (chapter.beats.some((beat) => beat.id === beatId)) return undefined

  const wasConfirmed = chapter.beatStatus === '已确认'
  chapter.beats.push({
    id: beatId,
    order: chapter.beats.length + 1,
    title: '',
    purpose: '',
    conflict: '',
    outcome: '',
    location: '',
    timeframe: '',
    reveal: '',
    characterIds: [],
    threadActions: []
  })
  chapter.beatStatus = '待确认'
  if (wasConfirmed) markBeatsNeedReview(chapter)
  if (chapter.status === '未规划') chapter.status = '已规划'
  touchOutline(outline, now)
  return beatId
}

/** 写剧情步骤字段；改动已确认的步骤会退回「待确认」并标记复核。 */
export function applyBeatFieldEdit(
  draft: ChapterWritingDraft,
  chapterId: string,
  beatId: string,
  field: BeatEditableField,
  value: string,
  now?: string
): boolean {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  const beat = chapter?.beats.find((item) => item.id === beatId)
  if (!outline || !chapter || !beat) return false
  if (beat[field] === value) return false

  beat[field] = value
  if (chapter.beatStatus === '已确认') markBeatsNeedReview(chapter)
  if (now) touchOutline(outline, now)
  return true
}

/** 步骤上移 / 下移；顺序号始终从 1 连续。 */
export function applyMoveBeat(
  draft: ChapterWritingDraft,
  chapterId: string,
  beatId: string,
  direction: 'up' | 'down',
  now?: string
): boolean {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  if (!outline || !chapter) return false

  const index = chapter.beats.findIndex((item) => item.id === beatId)
  if (index < 0) return false
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= chapter.beats.length) return false

  const [moved] = chapter.beats.splice(index, 1)
  chapter.beats.splice(target, 0, moved!)
  renumberBeats(chapter)
  if (chapter.beatStatus === '已确认') markBeatsNeedReview(chapter)
  if (now) touchOutline(outline, now)
  return true
}

/** 删除一个剧情步骤；剩余步骤按顺序重编号。 */
export function applyRemoveBeat(
  draft: ChapterWritingDraft,
  chapterId: string,
  beatId: string,
  now?: string
): boolean {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  if (!outline || !chapter) return false

  const index = chapter.beats.findIndex((item) => item.id === beatId)
  if (index < 0) return false

  const wasConfirmed = chapter.beatStatus === '已确认'
  chapter.beats.splice(index, 1)
  renumberBeats(chapter)
  if (chapter.beats.length === 0) chapter.beatStatus = '未生成'
  else if (wasConfirmed) markBeatsNeedReview(chapter)
  if (now) touchOutline(outline, now)
  return true
}

/** 确认剧情步骤：没有步骤不能确认；只清掉因步骤改动产生的复核标记。 */
export function applyConfirmBeats(
  draft: ChapterWritingDraft,
  chapterId: string,
  now?: string
): boolean {
  const outline = draft.outline
  const chapter = findOutlineChapter(draft, chapterId)
  if (!outline || !chapter || chapter.beats.length === 0) return false
  if (chapter.beatStatus === '已确认' && chapter.downstreamReviewReason !== BEAT_REVIEW_REASON) return false

  chapter.beatStatus = '已确认'
  if (chapter.downstreamReviewReason === BEAT_REVIEW_REASON) {
    chapter.downstreamReviewStatus = '正常'
    chapter.downstreamReviewReason = undefined
  }
  if (now) touchOutline(outline, now)
  return true
}

/**
 * 开始写作：为选中的章纲建立唯一正文；已存在同章号正文时不重复建立。
 *
 * **正文沿用章纲的稳定身份**（id）：章号只是阅读顺序，结构调整会重排它，
 * 只有身份一致才能保证变更后正文仍跟着自己那一张章纲。返回新正文的 id（等于章纲 id）。
 */
export function applyCreateBodyForOutline(
  draft: ChapterWritingDraft,
  chapterId: string,
  now: string
): string | undefined {
  const chapter = findOutlineChapter(draft, chapterId)
  if (!chapter) return undefined
  if (draft.chapters.some((item) => item.chapterNumber === chapter.chapterNumber)) return undefined
  if (draft.chapters.some((item) => item.id === chapterId)) return undefined

  draft.chapters.push({
    id: chapterId,
    volumeNumber: chapter.volumeNumber,
    chapterNumber: chapter.chapterNumber,
    title: chapter.title || `第${chapter.chapterNumber}章`,
    blocks: [{ id: `${chapterId}-b1`, text: '' }],
    status: '草稿',
    sourceDigest: '',
    updatedAt: now
  })
  return chapterId
}

/**
 * 正文没有章纲时补建：只建立作者确认的空规划。
 * 标题取自正文自身，其余规划字段留空；不读取正文内容猜摘要，也不改写正文。
 *
 * 补建的章纲沿用该正文的稳定身份（id）：补完之后两者按身份关联，以后再调整结构也不会串章。
 * 返回新章纲的 id（等于正文 id）。
 */
export function applyCreateOutlineForBody(
  draft: ChapterWritingDraft,
  bodyChapterId: string,
  now: string
): string | undefined {
  const outline = draft.outline
  const body = draft.chapters.find((item) => item.id === bodyChapterId)
  if (!outline || !body) return undefined
  if (outline.volumes.some((volume) => volume.chapters.some((chapter) => chapter.id === bodyChapterId))) return undefined
  if (outline.volumes.some((volume) => volume.chapters.some((chapter) => chapter.chapterNumber === body.chapterNumber))) {
    return undefined
  }

  let volume = outline.volumes.find((item) => item.volumeNumber === body.volumeNumber)
  if (!volume) {
    volume = {
      id: `${bodyChapterId}-vol`,
      volumeNumber: body.volumeNumber,
      title: `第${body.volumeNumber}卷`,
      goal: '',
      climax: '',
      resolution: '',
      chapters: []
    }
    outline.volumes.push(volume)
    outline.volumes.sort((left, right) => left.volumeNumber - right.volumeNumber)
  }

  volume.chapters.push({
    id: bodyChapterId,
    volumeNumber: volume.volumeNumber,
    chapterNumber: body.chapterNumber,
    title: body.title,
    pov: '',
    objective: '',
    conflict: '',
    turningPoint: '',
    reveal: '',
    endingHook: '',
    characterIds: [],
    setupThreadIds: [],
    payoffThreadIds: [],
    beats: [],
    beatFindings: [],
    status: '未规划',
    beatStatus: '未生成'
  })
  volume.chapters.sort((left, right) => left.chapterNumber - right.chapterNumber)
  touchOutline(outline, now)
  return bodyChapterId
}
