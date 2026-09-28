import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CreateWorldExpansionSchema,
  CharacterDetailsSchema,
  CultivationDetailsSchema,
  CurrencyDetailsSchema,
  GenericDetailsSchema,
  InitialOutlineCandidateSchema,
  LocalRevisionCandidateSchema,
  NationDetailsSchema,
  NovelExportFormatSchema,
  WorldEntrySchema,
  type AssistantGuideDomain,
  type AssistantGuideResultKind,
  type AssistantGuideResultRef,
  type AssistantTarget,
  type Chapter,
  type ChapterOutline,
  type CreateWorldExpansion,
  type LocalRevisionScope,
  type NovelPlotThread,
  type NovelProject,
  type WorldEntry
} from '../../contracts/src'
import type { AssistantGuideAdapter, AssistantGuideAdapterContext, AssistantGuideAdapterRegistry } from './assistantGuideService'
import { assistantGuideContextDigest } from './assistantGuide'
import { enqueueChapterAnalysis } from './chapterAnalysis'
import { localRevisionChangesFromCandidate, saveScopedRevisionDraft } from './localRevision'
import { chapterDigest, chapterText, normalizeProse } from './novelMemory'
import type { NovelDatabaseService } from './novelDatabase'
import { calculatePlotThreadReadiness, explainPlotThreadCognition, normalizePlotThreadEvidence } from './novelStoryline'
import { saveInitialOutlineDraft } from './outlineGuide'
import { createSettingProposal } from './settingProposals'

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const OutlinePayloadSchema = z.union([
  z.object({ initialOutline: InitialOutlineCandidateSchema }).strict(),
  z.object({ localRevision: LocalRevisionCandidateSchema, batchChapterIds: z.array(z.string().min(1)).max(50).optional() }).strict()
])

const GuideWorldEntryBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  summary: z.string().default(''),
  notes: z.string().default(''),
  relations: z.array(z.object({
    targetId: z.string(),
    relation: z.string(),
    note: z.string().default('')
  }).strict()).default([]),
  customFields: z.record(z.string()).default({})
}).strict()

const GuideWorldEntrySchema = z.discriminatedUnion('type', [
  GuideWorldEntryBaseSchema.extend({ type: z.literal('角色'), details: CharacterDetailsSchema }),
  GuideWorldEntryBaseSchema.extend({ type: z.literal('修行体系'), details: CultivationDetailsSchema }),
  GuideWorldEntryBaseSchema.extend({ type: z.literal('国家'), details: NationDetailsSchema }),
  GuideWorldEntryBaseSchema.extend({ type: z.literal('货币'), details: CurrencyDetailsSchema }),
  ...(['势力', '地点', '种族', '宗教', '文化', '历史', '历法', '科技魔法', '物品', '自定义'] as const)
    .map((type) => GuideWorldEntryBaseSchema.extend({ type: z.literal(type), details: GenericDetailsSchema }))
])

const GuideWorldPayloadSchema = CreateWorldExpansionSchema
  .omit({ source: true, proposedEntries: true })
  .extend({ proposedEntries: z.array(GuideWorldEntrySchema).min(1).max(100) })
  .strict()

const WritingPayloadSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  paragraphs: z.array(z.string().trim().min(1).max(8_000)).min(1).max(300),
  summary: z.string().trim().min(1).max(500).optional()
}).strict()

const MemoryPayloadSchema = z.object({}).strict()

const DeliveryReviewPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  finding: z.object({
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().min(1).max(2_000),
    severity: z.enum(['高', '中', '低']),
    category: z.enum(['逻辑', '节奏', '角色', '文风', '连续性', '伏笔', '世界规则']).default('连续性'),
    recommendation: z.string().trim().max(1_000).default(''),
    evidence: z.object({
      blockId: z.string().min(1).optional(),
      excerpt: z.string().trim().min(1).max(1_000)
    }).strict().optional()
  }).strict()
}).strict()

const DeliveryExportPayloadSchema = z.object({
  format: NovelExportFormatSchema
}).strict()

/**
 * 交付审稿实际取用的**有界证据**上限。
 *
 * 审稿要能引用正文原句、核对世界规则与已确认记忆，光有章节 ID 与计数是不够的
 * （模型看不到正文，只能凭标题猜）。这里按「有上限、可复现」给足：
 *   · 正文摘录：最多 12 章，每章最多 1200 字；
 *   · 已确认记忆：最近 40 条；
 *   · 总纲与世界事实：沿用已有的有界投影（`worldContext`）。
 * 超出上限的部分如实标注（`manuscriptTruncated` / `evidenceBounds`），
 * 不假装「已经读过全书」。
 */
const DELIVERY_EVIDENCE_CHAPTER_LIMIT = 12
const DELIVERY_EVIDENCE_CHARS_PER_CHAPTER = 1_200
const DELIVERY_EVIDENCE_MEMORY_LIMIT = 40

/**
 * 交付审稿的**有界伏笔台账**上限。
 *
 * 交付审稿的主线之一就是「伏笔闭环」，但引导上下文此前一个字都没带 —— 装配了伏笔审稿能力，
 * 模型手里却只有正文、总纲、世界事实和记忆，**看不到任何伏笔**（自由创作路径早已投影
 * 「伏笔准备度与认知差」，两条路径在这里并不对齐）。这里补一份**有界、可复现**的投影：
 *   · 最多 10 条伏笔；每条最多 2 条有效证据，摘录最多 200 字；
 *   · 每条的准备度缺口最多 2 条、认知差最多 200 字；
 *   · 每条的自由文本（标题、角色名）同样**逐字段截断**、角色名最多 12 个 —— 否则单条
 *     凭一个超长标题就能独自越过整份上限，把整份投影清空（`threads: []`），静默丢掉范围里的全部伏笔；
 *   · 整份投影另有 6000 字符硬上限，超出即停止并如实标注 `truncated`。
 * 超出上限的部分不假装「已经看过全部伏笔」，与 `boundedManuscript` 同一口径。
 */
const DELIVERY_THREAD_LIMIT = 10
const DELIVERY_THREAD_EVIDENCE_LIMIT = 2
const DELIVERY_THREAD_EXCERPT_CHARS = 200
const DELIVERY_THREAD_TEXT_CHARS = 200
const DELIVERY_THREAD_GAP_LIMIT = 2
const DELIVERY_THREAD_CHARACTER_LIMIT = 12
const DELIVERY_THREAD_TOTAL_CHARS = 6_000

/**
 * 伏笔投影的排序权重：**未闭环的排在前面**。
 *
 * 审稿要看的是「哪些伏笔还没收干净」，所以有界截断必须先落在逾期 / 推进中 / 已埋设 / 计划上，
 * 已回收与已放弃排最后。这张表是投影顺序的**唯一来源**，顺序变了就要同步这里的权重。
 * 交付审稿与记忆引导两个投影**共用**这份顺序（`comparePlotThreadOrder`），
 * 以免两条路径对「截断掉哪几条」给出不同答案。
 */
const THREAD_STATUS_ORDER: Record<NovelPlotThread['status'], number> = {
  逾期: 0, 推进中: 1, 已埋设: 2, 计划: 3, 已回收: 4, 已放弃: 5
}

/** 逐字段截断：文本类字段必须各自有上限，否则单条凭一个超长字段就能独自顶破整份预算。 */
function clip(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value
}

/** 章节 ID → 章号。锚点解析不出来（不存在该章节）时返回 `undefined`，**绝不猜测**。 */
function chapterNumberOf(project: NovelProject, chapterId?: string): number | undefined {
  return chapterId ? project.chapters.find((chapter) => chapter.id === chapterId)?.chapterNumber : undefined
}

/** 可发送词条 id → 名称。只投影 `canSendEntry` 通过的名字，「永不发送」「仅审校」一个字都不出现。 */
function sendableEntryNames(project: NovelProject): Map<string, string> {
  return new Map((project.worldBible?.entries ?? []).filter(canSendEntry).map((entry) => [entry.id, entry.name] as const))
}

/**
 * 章节范围的伏笔筛选（**范围即权限**）：只纳入埋设或推进到该章、或计划在该章回收的伏笔。
 * 章节锚点缺失、或指向不存在章节的伏笔**不参与猜测**，直接不进投影 —— 宁可给出明确的空投影。
 * 交付审稿的章节目标与记忆引导共用这一份判定。
 */
function chapterScopedPlotThreads(project: NovelProject, chapterNumber: number): NovelPlotThread[] {
  return project.plotThreads.filter((thread) => {
    const anchors = [thread.setupChapterId, ...thread.progress.map((item) => item.chapterId)]
      .map((chapterId) => chapterNumberOf(project, chapterId))
      .filter((value): value is number => value !== undefined)
    return anchors.some((value) => value <= chapterNumber) || thread.targetPayoffChapter === chapterNumber
  })
}

/**
 * 伏笔投影的**真全序**比较器：状态权重 → 计划回收章（无值排最后）→ 标题（UTF-16 码点）→ 身份兜底。
 *
 * 排序必须是确定的，否则「截断掉哪几条」会随环境变化。两条兜底都不可省：
 * 计划回收章相同时必须继续比标题，标题也相同时必须再用身份，才是一个全序。
 */
function comparePlotThreadOrder(left: NovelPlotThread, right: NovelPlotThread): number {
  const byStatus = THREAD_STATUS_ORDER[left.status] - THREAD_STATUS_ORDER[right.status]
  if (byStatus !== 0) return byStatus
  // 计划回收章：无值排最后。**绝不能写成 `a - b`** —— 两条都无值时是
  // `Infinity - Infinity = NaN`，而 `NaN !== 0` 为真，会把 NaN 当比较结果返回，
  // 使下面两级兜底（标题、身份）永不生效，并列组退化成「保留 plotThreads 原始数组序」。
  // V8 的稳定排序恰好让错误不可见，但这是寄生在实现细节上的巧合，不是全序。
  const leftPayoff = left.targetPayoffChapter ?? Number.POSITIVE_INFINITY
  const rightPayoff = right.targetPayoffChapter ?? Number.POSITIVE_INFINITY
  if (leftPayoff !== rightPayoff) return leftPayoff < rightPayoff ? -1 : 1
  if (left.title !== right.title) return left.title < right.title ? -1 : 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/**
 * 有界正文摘录。
 *
 * ⚠️ 摘录必须是**稳定字符串**：这段上下文会参与会话摘要（`assistantGuideContextDigest`），
 * 只要同一次会话里两次读取得到的串不同，作者每答一题都会被判成「引用的内容变了」，
 * 被迫重新分析一遍 —— 段落对象（`normalizeProse`）会为每一段生成新的 `id`，
 * 因此这里只能用 `chapterText` 拼出真实正文，再按字符上限截断。
 */
function boundedManuscript(chapters: readonly Chapter[]) {
  return chapters.slice(0, DELIVERY_EVIDENCE_CHAPTER_LIMIT).map((chapter) => {
    const text = chapterText(chapter)
    return {
      id: chapter.id,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      status: chapter.status,
      excerpt: text.slice(0, DELIVERY_EVIDENCE_CHARS_PER_CHAPTER),
      excerptTruncated: text.length > DELIVERY_EVIDENCE_CHARS_PER_CHAPTER
    }
  })
}

function boundedMemory(project: NovelProject) {
  return project.memories.slice(-DELIVERY_EVIDENCE_MEMORY_LIMIT).map((memory) => ({
    chapterNumber: memory.chapterNumber,
    summary: memory.summary,
    keyEvents: memory.keyEvents,
    facts: memory.facts.map((fact) => ({ category: fact.category, content: fact.content, certainty: fact.certainty }))
  }))
}

/**
 * 有界伏笔台账投影（交付引导专用，见文件顶部的上限说明）。
 *
 * **稳定性**：投影里只能出现稳定值。`calculatePlotThreadReadiness` 会带上 `assessedAt`
 * （每次调用都是新的时间戳），整条展开会让同一份台账两次读取得到的上下文摘要不同 ⇒
 * 作者每答一题都被判成「引用的内容变了」。所以这里只取它的稳定子集（`level` / `score` / `gaps`）。
 *
 * **范围即权限**：章节目标只投影与本审稿章相关的伏笔（埋设或推进到该章、或计划在该章回收）。
 * 章节锚点缺失、或指向不存在章节的伏笔**不参与猜测**，直接不进投影 —— 宁可给出明确的空投影。
 *
 * **可见性**：伏笔关联的角色只投影**可发送**条目的名称（复用 `canSendEntry`），
 * 「永不发送」「仅审校」的词条名一个字都不出现。
 *
 * **不发送整份台账**：绝不把 `project.plotThreads` 整条转发出去，只走下面这份字段白名单。
 */
function boundedForeshadowLedger(
  project: NovelProject,
  scope: { kind: 'chapter'; chapterNumber: number } | { kind: 'whole-project' }
) {
  const sendableNames = sendableEntryNames(project)
  const related = scope.kind === 'whole-project'
    ? project.plotThreads.slice()
    : chapterScopedPlotThreads(project, scope.chapterNumber)

  // 全序比较器：状态权重 → 计划回收章（无值排最后）→ 标题 → 身份兜底（见 `comparePlotThreadOrder`）。
  const ordered = [...related].sort(comparePlotThreadOrder)

  const threads: Array<Record<string, unknown>> = []
  let used = 0
  let truncated = false
  for (const thread of ordered) {
    if (threads.length >= DELIVERY_THREAD_LIMIT) { truncated = true; break }
    const readiness = calculatePlotThreadReadiness(thread)
    const entry = {
      // 自由文本必须逐字段截断：`NovelPlotThreadSchema.title` 是无限长的 `z.string()`，
      // 一条超长标题就能独自越过整份上限，使下面的硬闸在首轮 `break`，整份投影被清空。
      title: clip(thread.title, DELIVERY_THREAD_TEXT_CHARS),
      status: thread.status,
      ...(thread.targetPayoffChapter === undefined ? {} : { targetPayoffChapter: thread.targetPayoffChapter }),
      characters: [...new Set(thread.characterIds
        .map((id) => sendableNames.get(id))
        .filter((name): name is string => name !== undefined))].sort()
        .map((name) => clip(name, DELIVERY_THREAD_TEXT_CHARS))
        .slice(0, DELIVERY_THREAD_CHARACTER_LIMIT),
      readiness: {
        level: readiness.level,
        score: readiness.score,
        gaps: readiness.gaps.slice(0, DELIVERY_THREAD_GAP_LIMIT).map((gap) => clip(gap, DELIVERY_THREAD_TEXT_CHARS))
      },
      cognitionGap: clip(explainPlotThreadCognition(thread).gapSummary, DELIVERY_THREAD_TEXT_CHARS),
      evidence: normalizePlotThreadEvidence(thread)
        .filter((item) => item.status !== '已失效')
        .slice(0, DELIVERY_THREAD_EVIDENCE_LIMIT)
        .map((item) => {
          const chapterNumber = chapterNumberOf(project, item.chapterId)
          return {
            phase: item.phase,
            ...(chapterNumber === undefined ? {} : { chapterNumber }),
            excerpt: clip(item.excerpt, DELIVERY_THREAD_EXCERPT_CHARS),
            excerptTruncated: item.excerpt.length > DELIVERY_THREAD_EXCERPT_CHARS
          }
        })
    }
    const size = JSON.stringify(entry).length
    if (used + size > DELIVERY_THREAD_TOTAL_CHARS) { truncated = true; break }
    used += size
    threads.push(entry)
  }

  const scopeNote = scope.kind === 'whole-project'
    ? `本次审稿范围为整稿：投影全部伏笔，未闭环的排在前面，最多 ${DELIVERY_THREAD_LIMIT} 条。`
    : related.length === 0
      ? `本次审稿范围为第 ${scope.chapterNumber} 章：没有可确定的关联伏笔（章节锚点缺失或指向不存在章节的伏笔不参与猜测），最多 ${DELIVERY_THREAD_LIMIT} 条。`
      : `本次审稿范围为第 ${scope.chapterNumber} 章：只投影埋设、推进到该章或计划在该章回收的伏笔，最多 ${DELIVERY_THREAD_LIMIT} 条。`
  return { scope: scope.kind, scopeNote, limit: DELIVERY_THREAD_LIMIT, total: related.length, truncated, threads }
}

/**
 * 记忆引导的**有界伏笔线程投影**上限。
 *
 * 记忆引导对应的人设是「记忆伏笔管理员」（`projectAssistantCatalog.ts:62-68`），
 * `focusAreas` =「客观事实与角色认知差」「伏笔证据与回收准备度」「状态的生效与失效章节」。
 * 因此这份投影与交付审稿的伏笔台账**有意不同**：
 *   · 恒定**本章**范围（`MemoryGuideAdapter` 只接受 `chapter` 目标，不存在整稿分支）；
 *   · **保留** `cognitionGap` 与 `readiness{level,score,gaps}`；
 *   · 证据携带**生效 / 失效状态**：`已失效` 证据**不被剔除** —— 交付审稿在
 *     `boundedForeshadowLedger` 里明确丢弃它，而「失效章节」正是本领域要核对的对象；
 *   · `MEMORY_THREAD_TOTAL_CHARS` **同时约束条目总和与投影外壳**（`scope`/`scopeNote`/
 *     `limit`/`total`/`truncated`），即 `JSON.stringify(整份投影).length ≤ 6000`。
 *
 * 超出上限的部分如实标注 `truncated`，不假装「已经看过全部伏笔」。
 */
const MEMORY_THREAD_LIMIT = 10
const MEMORY_THREAD_EVIDENCE_LIMIT = 3
const MEMORY_THREAD_EXCERPT_CHARS = 200
const MEMORY_THREAD_TEXT_CHARS = 200
const MEMORY_THREAD_GAP_LIMIT = 2
const MEMORY_THREAD_CHARACTER_LIMIT = 12
const MEMORY_THREAD_TOTAL_CHARS = 6_000

/**
 * 记忆引导专用的**有界伏笔线程投影**。
 *
 * 字段白名单、排序（`comparePlotThreadOrder`）与可见性口径（复用 `canSendEntry`）与交付台账一致，
 * 但保留失效证据并携带状态，且整份（含外壳）受 6000 字符硬上限约束。绝不整条转发 `plotThreads`。
 */
function boundedMemoryThreadLedger(project: NovelProject, chapterNumber: number) {
  const sendableNames = sendableEntryNames(project)
  const related = chapterScopedPlotThreads(project, chapterNumber)
  const ordered = [...related].sort(comparePlotThreadOrder)

  // 外壳先行：`scopeNote` 参与整份长度，必须在循环前算好，否则 6000 闸会低估外壳体积。
  const scopeNote = related.length === 0
    ? `本次分析范围为第 ${chapterNumber} 章：没有可确定的关联伏笔（章节锚点缺失或指向不存在章节的伏笔不参与猜测），最多 ${MEMORY_THREAD_LIMIT} 条。`
    : `本次分析范围为第 ${chapterNumber} 章：只投影埋设、推进到该章或计划在该章回收的伏笔，含生效 / 失效状态，最多 ${MEMORY_THREAD_LIMIT} 条。`
  const shell = { scope: 'chapter' as const, scopeNote, limit: MEMORY_THREAD_LIMIT, total: related.length, truncated: false }

  const threads: Array<Record<string, unknown>> = []
  // 字符计数口径：**含外壳**。起点是空投影（`threads: []`）的整份 JSON 长度，逐条累加
  // 「条目 JSON 长度 + 1（数组逗号）」。该口径比真实长度保守约 1 字符，
  // 因此只要每次加入后仍在闸内，最终整份必然 ≤ 上限。
  let used = JSON.stringify({ ...shell, threads: [] }).length
  let truncated = false
  for (const thread of ordered) {
    if (threads.length >= MEMORY_THREAD_LIMIT) { truncated = true; break }
    const readiness = calculatePlotThreadReadiness(thread)
    const entry = {
      title: clip(thread.title, MEMORY_THREAD_TEXT_CHARS),
      status: thread.status,
      ...(thread.targetPayoffChapter === undefined ? {} : { targetPayoffChapter: thread.targetPayoffChapter }),
      characters: [...new Set(thread.characterIds
        .map((id) => sendableNames.get(id))
        .filter((name): name is string => name !== undefined))].sort()
        .map((name) => clip(name, MEMORY_THREAD_TEXT_CHARS))
        .slice(0, MEMORY_THREAD_CHARACTER_LIMIT),
      readiness: {
        level: readiness.level,
        score: readiness.score,
        gaps: readiness.gaps.slice(0, MEMORY_THREAD_GAP_LIMIT).map((gap) => clip(gap, MEMORY_THREAD_TEXT_CHARS))
      },
      cognitionGap: clip(explainPlotThreadCognition(thread).gapSummary, MEMORY_THREAD_TEXT_CHARS),
      // ★ 与交付审稿的关键差异：**不过滤** `已失效`，并携带 `status`。
      evidence: normalizePlotThreadEvidence(thread)
        .slice(0, MEMORY_THREAD_EVIDENCE_LIMIT)
        .map((item) => {
          const evidenceChapter = chapterNumberOf(project, item.chapterId)
          return {
            phase: item.phase,
            ...(evidenceChapter === undefined ? {} : { chapterNumber: evidenceChapter }),
            excerpt: clip(item.excerpt, MEMORY_THREAD_EXCERPT_CHARS),
            excerptTruncated: item.excerpt.length > MEMORY_THREAD_EXCERPT_CHARS,
            status: item.status
          }
        })
    }
    const size = JSON.stringify(entry).length
    if (used + size + 1 > MEMORY_THREAD_TOTAL_CHARS) { truncated = true; break }
    used += size + 1
    threads.push(entry)
  }

  if (related.length > threads.length) truncated = true
  const ledger = { ...shell, truncated, threads }
  // 复核整份（含外壳）长度：逐字段截断使兜底不会触发，但保留它以把「整份 ≤ 6000」变成**硬保证**。
  while (threads.length > 0 && JSON.stringify({ ...ledger, truncated: true, threads }).length > MEMORY_THREAD_TOTAL_CHARS) {
    threads.pop()
    ledger.truncated = true
  }
  return ledger
}

function deliveryContract(allowedResultKinds: readonly AssistantGuideResultKind[]): unknown {
  const contract: {
    allowedResultKinds: readonly AssistantGuideResultKind[]
    revisionProposal?: unknown
    exportPrecheck?: unknown
    note: string
  } = {
    allowedResultKinds,
    revisionProposal: schemaContract('GuideDeliveryReviewPayload', DeliveryReviewPayloadSchema),
    note: 'Do not include chapterId, projectId, targetId, version, permission, allowed/state, or adoption fields. Optional chapter evidence must quote an actual excerpt from context.manuscript[] (bounded by context.evidenceBounds); do not claim to have read material outside reviewRange.'
  }
  if (allowedResultKinds.includes('export-precheck')) {
    contract.exportPrecheck = schemaContract('GuideDeliveryExportPayload', DeliveryExportPayloadSchema)
  }
  return contract
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 32)
}

function assertProject(project: NovelProject, target: AssistantTarget): void {
  if (target.projectId !== project.id) {
    throw fail('ASSISTANT_GUIDE_PROJECT_MISMATCH', '引导目标不属于当前项目。')
  }
}

function outlineCards(project: NovelProject): ChapterOutline[] {
  return (project.outline?.volumes ?? []).flatMap((volume) => volume.chapters)
}

function findOutlineCard(project: NovelProject, id: string): ChapterOutline {
  const card = outlineCards(project).find((item) => item.id === id)
  if (!card) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到该章纲。')
  return card
}

function findBodyChapter(project: NovelProject, id: string): Chapter {
  const chapter = project.chapters.find((item) => item.id === id)
  if (!chapter) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到该正文章节。')
  return chapter
}

function outlineForBody(project: NovelProject, chapter: Chapter): ChapterOutline {
  const card = outlineCards(project).find((item) => item.id === chapter.id || item.chapterNumber === chapter.chapterNumber)
  if (!card) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到与当前正文关联的章纲。')
  return card
}

function findWorldEntry(project: NovelProject, id: string): WorldEntry {
  const entry = (project.worldBible?.entries ?? []).find((item) => item.id === id)
  if (!entry) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到该世界观条目。')
  return entry
}

function canSendEntry(entry: Pick<WorldEntry, 'aiVisibility'>): boolean {
  return entry.aiVisibility !== '永不发送' && entry.aiVisibility !== '仅审校'
}

function assertSendableEntry(entry: WorldEntry): void {
  if (!canSendEntry(entry)) {
    throw fail('ASSISTANT_GUIDE_TARGET_FORBIDDEN', '该世界观条目设置为不发送给 AI，不能作为引导上下文。')
  }
}

function compactEntry(entry: WorldEntry) {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    aliases: entry.aliases,
    summary: entry.summary,
    locked: entry.locked,
    aiVisibility: entry.aiVisibility
  }
}

function targetSummary(project: NovelProject, target: AssistantTarget): unknown {
  assertProject(project, target)
  if (target.kind === 'story-core') return { kind: target.kind, seed: project.seed }
  if (target.kind === 'outline') return { kind: target.kind, outline: project.outline ? { synopsis: project.outline.synopsis, mainConflict: project.outline.mainConflict, endingDirection: project.outline.endingDirection } : null }
  if (target.kind === 'volume') {
    const volume = project.outline?.volumes.find((item) => item.id === target.objectId)
    if (!volume) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到该卷。')
    return { kind: target.kind, volume: { id: volume.id, title: volume.title, goal: volume.goal, chapters: volume.chapters.map((chapter) => ({ id: chapter.id, chapterNumber: chapter.chapterNumber, title: chapter.title, objective: chapter.objective, conflict: chapter.conflict })) } }
  }
  if (target.kind === 'chapter') {
    const card = findOutlineCard(project, target.objectId)
    return { kind: target.kind, chapter: card }
  }
  if (target.kind === 'beat') {
    const card = findOutlineCard(project, target.objectId)
    const beat = card.beats.find((item) => item.id === target.beatId)
    if (!beat) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到该剧情步骤。')
    return { kind: target.kind, chapter: { id: card.id, chapterNumber: card.chapterNumber, title: card.title }, beat }
  }
  if (target.kind === 'storyline') {
    const storyline = (project.storylines ?? []).find((item) => item.id === target.objectId)
    if (!storyline) throw fail('ASSISTANT_GUIDE_TARGET_MISSING', '找不到该故事线。')
    return { kind: target.kind, storyline }
  }
  if (target.kind === 'world') return { kind: target.kind, worldBible: worldContext(project).worldBible }
  const entry = findWorldEntry(project, target.objectId)
  assertSendableEntry(entry)
  return { kind: target.kind, entry: compactEntry(entry) }
}

function refsFor(context: Record<string, unknown>, extra: string[] = []): string[] {
  return [...new Set([...Object.keys(context).map((key) => `context.${key}`), ...extra])]
}

function adapterContext(
  context: Record<string, unknown>,
  completionContract: unknown,
  extraRefs: string[] = [],
  allowedResultKinds?: readonly AssistantGuideResultKind[]
): AssistantGuideAdapterContext {
  return { context, allowedEvidenceRefs: refsFor(context, extraRefs), completionContract, allowedResultKinds }
}

function schemaContract(name: string, schema: z.ZodType<unknown>): unknown {
  return zodToJsonSchema(schema, name)
}

function worldContext(project: NovelProject) {
  const world = project.worldBible
  const entries = (world?.entries ?? []).filter(canSendEntry)
  return {
    worldBible: world ? {
      summary: world.summary,
      premise: world.premise,
      rules: world.rules,
      entries: entries.map(compactEntry),
      timeline: world.timeline
    } : null,
    referencedYetMissingSettings: project.reviews
      .filter((item) => item.category === '世界规则' && item.status === '待处理')
      .map((item) => ({ id: item.id, title: item.title, description: item.description }))
  }
}

function lockedNameGuard(project: NovelProject, raw: CreateWorldExpansion): void {
  const locked = new Set((project.worldBible?.entries ?? [])
    .filter((entry) => entry.locked)
    .map((entry) => entry.name.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase()))
  for (const proposed of raw.proposedEntries) {
    if (!proposed || typeof proposed !== 'object') continue
    const name = (proposed as { name?: unknown }).name
    if (typeof name !== 'string') continue
    if (locked.has(name.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase())) {
      throw fail('WORLD_ENTRY_LOCKED', `「${name}」已经锁定，AI 不能自动覆盖；请先在词条里解锁，或改为新增另一个条目。`)
    }
  }
}

function guideWorldEntryToStored(project: NovelProject, target: AssistantTarget, entry: z.infer<typeof GuideWorldEntrySchema>): WorldEntry {
  const existing = target.kind === 'world-entry' ? findWorldEntry(project, target.objectId) : undefined
  if (existing?.locked) {
    throw fail('WORLD_ENTRY_LOCKED', `「${existing.name}」已经锁定，AI 不能自动覆盖；请先在词条里解锁，或改为新增另一个条目。`)
  }
  const candidate = {
    ...entry,
    id: existing?.id ?? randomUUID(),
    locked: existing?.locked ?? false,
    aiVisibility: existing?.aiVisibility ?? '按需召回'
  }
  return WorldEntrySchema.parse(candidate)
}

function guideWorldPayloadToCreate(project: NovelProject, target: AssistantTarget, payload: unknown): CreateWorldExpansion {
  const parsed = GuideWorldPayloadSchema.parse(payload)
  const proposedEntries = parsed.proposedEntries.map((entry) => guideWorldEntryToStored(project, target, entry))
  return CreateWorldExpansionSchema.parse({ ...parsed, proposedEntries, source: 'AI 建议' })
}

function outlineScope(target: AssistantTarget): LocalRevisionScope {
  if (target.kind === 'volume' || target.kind === 'chapter' || target.kind === 'storyline') {
    return { kind: target.kind, projectId: target.projectId, objectId: target.objectId }
  }
  if (target.kind === 'beat') return { kind: 'beat', projectId: target.projectId, objectId: target.objectId, beatId: target.beatId }
  throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '该大纲目标不能使用局部修改通道。')
}

function assertOutlineTarget(target: AssistantTarget): void {
  if (
    target.kind === 'story-core' ||
    target.kind === 'outline' ||
    target.kind === 'volume' ||
    target.kind === 'chapter' ||
    target.kind === 'beat' ||
    target.kind === 'storyline'
  ) return
  throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '大纲引导只能面向故事核心、总纲、卷、章纲、剧情步骤或故事线。')
}

function saveRevision(database: NovelDatabaseService, input: {
  project: NovelProject
  kind: 'chapter-revision' | 'continuity-audit'
  target: 'chapter' | 'branch'
  targetId?: string
  summary: string
  candidate: unknown
  reviewId?: string
}): AssistantGuideResultRef {
  const proposal = database.saveRevision({
    id: randomUUID(),
    projectId: input.project.id,
    kind: input.kind,
    target: input.target,
    targetId: input.targetId,
    baseRevision: input.project.revision,
    summary: input.summary,
    candidate: input.candidate,
    status: '待处理',
    createdAt: new Date().toISOString(),
    reviewId: input.reviewId
  })
  return { kind: 'revision-proposal', proposalId: proposal.id }
}

class OutlineGuideAdapter implements AssistantGuideAdapter {
  readonly version = 1
  readonly resultKinds: readonly AssistantGuideResultKind[] = ['assistant-draft']

  constructor(private readonly database: NovelDatabaseService) {}

  readContext(project: NovelProject, target: AssistantTarget): AssistantGuideAdapterContext {
    assertProject(project, target)
    assertOutlineTarget(target)
    const context: Record<string, unknown> = {
      domain: 'outline',
      target: targetSummary(project, target)
    }
    if (target.kind === 'chapter' || target.kind === 'beat') {
      const card = findOutlineCard(project, target.objectId)
      const body = project.chapters.find((chapter) => chapter.chapterNumber === card.chapterNumber)
      if (body) context.linkedBody = { id: body.id, chapterNumber: body.chapterNumber, hasBody: body.blocks.some((block) => block.text.trim()) }
    }
    if (target.kind === 'volume') {
      const volume = project.outline?.volumes.find((item) => item.id === target.objectId)
      context.linkedBody = project.chapters
        .filter((chapter) => chapter.volumeNumber === volume?.volumeNumber)
        .map((chapter) => ({ id: chapter.id, chapterNumber: chapter.chapterNumber, hasBody: chapter.blocks.some((block) => block.text.trim()) }))
    }
    return adapterContext(context, {
      outline: schemaContract('GuideOutlinePayload', OutlinePayloadSchema),
      note: 'resultKind assistant-draft. For story-core/outline targets use initialOutline; for volume/chapter/beat/storyline targets use localRevision. IDs must be existing server IDs from context.'
    }, ['project.outline'])
  }

  complete(input: Parameters<AssistantGuideAdapter['complete']>[0]): AssistantGuideResultRef {
    if (input.resultKind !== 'assistant-draft') throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '大纲引导只能生成助手草稿。')
    const payload = OutlinePayloadSchema.parse(input.payload)
    if ('initialOutline' in payload) {
      if (input.target.kind !== 'story-core' && input.target.kind !== 'outline') {
        throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '初纲只能用于故事核心或总纲目标。')
      }
      const result = saveInitialOutlineDraft({
        database: this.database,
        project: input.project,
        candidate: payload.initialOutline,
        sourceDigest: assistantGuideContextDigest(input.context),
        updateLegacySession: false
      })
      return { kind: 'assistant-draft', draftId: result.draftId }
    }
    const scope = outlineScope(input.target)
    const changes = localRevisionChangesFromCandidate({ project: input.project, scope, candidate: payload.localRevision })
    const result = saveScopedRevisionDraft({
      database: this.database,
      project: input.project,
      scope,
      changes,
      batchChapterIds: payload.batchChapterIds,
      sourceDigest: assistantGuideContextDigest(input.context),
      summary: payload.localRevision.summary
    })
    return { kind: 'assistant-draft', draftId: result.draft.id }
  }
}

class WorldGuideAdapter implements AssistantGuideAdapter {
  readonly version = 1
  readonly resultKinds: readonly AssistantGuideResultKind[] = ['world-setting-proposal']

  constructor(private readonly database: NovelDatabaseService) {}

  readContext(project: NovelProject, target: AssistantTarget): AssistantGuideAdapterContext {
    assertProject(project, target)
    if (target.kind !== 'world' && target.kind !== 'world-entry') {
      throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '世界观引导只能面向世界观或具体设定条目。')
    }
    const context = {
      domain: 'world',
      target: target.kind === 'world-entry' ? targetSummary(project, target) : { kind: 'world' },
      ...worldContext(project)
    }
    return adapterContext(context, {
      world: schemaContract('GuideWorldPayload', GuideWorldPayloadSchema),
      note: 'resultKind world-setting-proposal. Do not include server identity, lock state, visibility policy, project IDs, adoption decisions, or formal write permissions. The server assigns entry identity and binds world-entry scope to the selected entry.'
    }, ['project.worldBible'])
  }

  complete(input: Parameters<AssistantGuideAdapter['complete']>[0]): AssistantGuideResultRef {
    if (input.resultKind !== 'world-setting-proposal') throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '世界观引导只能生成设定提案。')
    const raw = guideWorldPayloadToCreate(input.project, input.target, input.payload)
    lockedNameGuard(input.project, raw)
    const { proposal } = createSettingProposal({ database: this.database, project: input.project, raw })
    return { kind: 'world-setting-proposal', proposalId: proposal.id }
  }
}

class WritingGuideAdapter implements AssistantGuideAdapter {
  readonly version = 1
  readonly resultKinds: readonly AssistantGuideResultKind[] = ['revision-proposal']

  constructor(private readonly database: NovelDatabaseService) {}

  readContext(project: NovelProject, target: AssistantTarget): AssistantGuideAdapterContext {
    assertProject(project, target)
    if (target.kind !== 'chapter') throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '正文引导只能面向正文章节。')
    const chapter = findBodyChapter(project, target.objectId)
    const outline = outlineForBody(project, chapter)
    const context = {
      domain: 'writing',
      target: { kind: 'chapter', chapterId: chapter.id, chapterNumber: chapter.chapterNumber, outlineId: outline.id },
      chapter: { id: chapter.id, title: chapter.title, status: chapter.status, blocks: chapter.blocks },
      outline,
      approvedWorldFacts: worldContext(project).worldBible,
      priorMemory: project.memories.filter((memory) => memory.chapterNumber <= chapter.chapterNumber),
      styleSnapshot: project.settings.styleProfileSnapshot ?? null
    }
    return adapterContext(context, {
      writing: schemaContract('GuideWritingPayload', WritingPayloadSchema),
      note: 'resultKind revision-proposal. Do not include chapterId, outlineId, projectId, targetId, version or permission fields; server binds the candidate to the current body chapter.'
    }, [`chapter:${chapter.id}`, `outline-chapter:${outline.id}`])
  }

  complete(input: Parameters<AssistantGuideAdapter['complete']>[0]): AssistantGuideResultRef {
    if (input.resultKind !== 'revision-proposal') throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '正文引导只能生成修改候选。')
    if (input.target.kind !== 'chapter') throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '正文引导只能面向正文章节。')
    const payload = WritingPayloadSchema.parse(input.payload)
    const chapter = findBodyChapter(input.project, input.target.objectId)
    const outline = outlineForBody(input.project, chapter)
    const candidate = {
      ...chapter,
      title: payload.title ?? (outline.title || chapter.title),
      blocks: normalizeProse(payload.paragraphs.join('\n\n'), chapter.blocks),
      status: '待审校' as const,
      updatedAt: new Date().toISOString()
    }
    const parsed = { ...candidate, sourceDigest: chapterDigest(candidate) }
    return saveRevision(this.database, {
      project: input.project,
      kind: 'chapter-revision',
      target: 'chapter',
      targetId: chapter.id,
      summary: payload.summary ?? `第 ${chapter.chapterNumber} 章正文候选`,
      candidate: parsed
    })
  }
}

class MemoryGuideAdapter implements AssistantGuideAdapter {
  readonly version = 1
  readonly resultKinds: readonly AssistantGuideResultKind[] = ['chapter-analysis']

  constructor(private readonly database: NovelDatabaseService) {}

  readContext(project: NovelProject, target: AssistantTarget): AssistantGuideAdapterContext {
    assertProject(project, target)
    if (target.kind !== 'chapter') throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '记忆引导只能面向正文章节。')
    const chapter = findBodyChapter(project, target.objectId)
    const context = {
      domain: 'memory',
      target: { kind: 'chapter', chapterId: chapter.id, chapterNumber: chapter.chapterNumber },
      chapter,
      formalMemory: project.memories.filter((memory) => memory.chapterId === chapter.id || memory.chapterNumber <= chapter.chapterNumber),
      characterKnowledge: (project.worldBible?.entries ?? []).filter((entry) => entry.type === '角色' && canSendEntry(entry)),
      /**
       * 本章范围的**有界**伏笔线程投影。此前这里是 `threads: project.plotThreads` ——
       * 把整份台账（含 `evidencePool` / `detail` / `cognition.otherCharacters[].characterName`
       * 等内部字段）无界塞进出站上下文，既是上下文爆炸面，也是隐私泄漏面。改为与交付台账
       * 同口径的白名单投影，并保留失效证据与状态（见 `boundedMemoryThreadLedger`）。
       */
      threadLedger: boundedMemoryThreadLedger(project, chapter.chapterNumber),
      storylines: project.storylines ?? [],
      continuityRisks: project.reviews.filter((review) => review.status === '待处理')
    }
    return adapterContext(context, {
      memory: schemaContract('GuideMemoryPayload', MemoryPayloadSchema),
      note: 'resultKind chapter-analysis. Server queues analysis for the current chapter. Do not include chapterId, taskId, memory changes, thread statuses or evidence mutations.'
    }, [`chapter:${chapter.id}`])
  }

  complete(input: Parameters<AssistantGuideAdapter['complete']>[0]): AssistantGuideResultRef {
    if (input.resultKind !== 'chapter-analysis') throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '记忆引导只能排章节分析任务。')
    if (input.target.kind !== 'chapter') throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '记忆引导只能面向正文章节。')
    MemoryPayloadSchema.parse(input.payload)
    const chapter = findBodyChapter(input.project, input.target.objectId)
    const { task } = enqueueChapterAnalysis({
      database: this.database,
      project: input.project,
      chapterId: chapter.id,
      trigger: '手动分析'
    })
    return { kind: 'chapter-analysis', taskId: task.id }
  }
}

class DeliveryGuideAdapter implements AssistantGuideAdapter {
  readonly version = 1
  readonly resultKinds: readonly AssistantGuideResultKind[] = ['revision-proposal', 'export-precheck']

  constructor(private readonly database: NovelDatabaseService) {}

  readContext(project: NovelProject, target: AssistantTarget): AssistantGuideAdapterContext {
    assertProject(project, target)
    if (!['story-core', 'outline', 'chapter'].includes(target.kind)) {
      throw fail('ASSISTANT_GUIDE_TARGET_INVALID', '交付引导只能面向整稿、审稿范围或具体章节。')
    }
    const chapter = target.kind === 'chapter' ? findBodyChapter(project, target.objectId) : null
    const allowedResultKinds: readonly AssistantGuideResultKind[] = chapter ? ['revision-proposal'] : ['revision-proposal', 'export-precheck']
    /**
     * 审稿范围之内的**真实证据**：正文摘录、总纲、已批准的世界事实、已确认记忆。
     * 范围即权限：章节目标只带这一章，整稿/总纲目标才带全书（并受上面的上限约束）。
     */
    const scopedChapters = chapter ? [chapter] : project.chapters
    const context = {
      domain: 'delivery',
      target: chapter ? { kind: 'chapter', chapterId: chapter.id, chapterNumber: chapter.chapterNumber } : { kind: target.kind },
      reviewRange: chapter ? [chapter.id] : project.chapters.map((item) => item.id),
      manuscript: boundedManuscript(scopedChapters),
      manuscriptTruncated: scopedChapters.length > DELIVERY_EVIDENCE_CHAPTER_LIMIT,
      outline: project.outline
        ? { synopsis: project.outline.synopsis, mainConflict: project.outline.mainConflict, endingDirection: project.outline.endingDirection }
        : null,
      worldFacts: worldContext(project).worldBible,
      memoryFacts: boundedMemory(project),
      /**
       * 伏笔台账（有界投影）：交付审稿要看「伏笔是否闭环」，光有正文与记忆看不到台账。
       * 范围与 `reviewRange` 一致：章节目标只带与本审稿章相关的伏笔，整稿目标才带全部（仍受上限约束）。
       */
      foreshadowLedger: boundedForeshadowLedger(
        project,
        chapter ? { kind: 'chapter', chapterNumber: chapter.chapterNumber } : { kind: 'whole-project' }
      ),
      evidenceBounds: {
        manuscriptChapterLimit: DELIVERY_EVIDENCE_CHAPTER_LIMIT,
        excerptCharsPerChapter: DELIVERY_EVIDENCE_CHARS_PER_CHAPTER,
        memoryLimit: DELIVERY_EVIDENCE_MEMORY_LIMIT,
        note: '引用正文原句只能来自 manuscript[].excerpt；超出上限的内容没有读取（单章被截断时 excerptTruncated 为 true）。'
      },
      blockingIssues: project.reviews.filter((review) => review.status === '待处理' && review.severity === '高'),
      exportInputs: {
        chapterCount: project.chapters.length,
        nonEmptyChapterIds: project.chapters.filter((item) => item.blocks.some((block) => block.text.trim())).map((item) => item.id),
        pendingProposalCount: this.database.listRevisions(project.id).length
      }
    }
    return adapterContext(context, {
      delivery: deliveryContract(allowedResultKinds)
    }, ['project.reviews', 'project.exportInputs'], allowedResultKinds)
  }

  complete(input: Parameters<AssistantGuideAdapter['complete']>[0]): AssistantGuideResultRef {
    if (input.resultKind === 'export-precheck') {
      if (input.target.kind === 'chapter') throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '章节交付引导不能生成整稿导出预检。')
      const payload = DeliveryExportPayloadSchema.parse(input.payload)
      return { kind: 'export-precheck', projectRevision: input.project.revision, format: payload.format }
    }
    if (input.resultKind !== 'revision-proposal') throw fail('ASSISTANT_GUIDE_RESULT_KIND_INVALID', '交付引导不支持该结果类型。')
    const payload = DeliveryReviewPayloadSchema.parse(input.payload)
    const chapter = input.target.kind === 'chapter' ? findBodyChapter(input.project, input.target.objectId) : undefined
    const evidence = chapter && payload.finding.evidence ? [groundedEvidence(chapter, payload.finding.evidence)] : []
    const proposalId = randomUUID()
    const review = {
      id: `review-${proposalId}`,
      chapterId: chapter?.id,
      category: payload.finding.category,
      severity: payload.finding.severity,
      title: payload.finding.title,
      description: payload.finding.detail,
      evidence,
      recommendation: payload.finding.recommendation,
      status: '待处理' as const,
      createdAt: new Date().toISOString()
    }
    return saveRevision(this.database, {
      project: input.project,
      kind: 'continuity-audit',
      target: 'branch',
      targetId: 'reviews',
      summary: payload.summary,
      candidate: { reviews: [...input.project.reviews, review], sourceDigest: digest({ target: input.target, payload }) },
      reviewId: review.id
    })
  }
}

function groundedEvidence(chapter: Chapter, evidence: { blockId?: string; excerpt: string }) {
  const block = evidence.blockId
    ? chapter.blocks.find((item) => item.id === evidence.blockId)
    : chapter.blocks.find((item) => item.text.includes(evidence.excerpt))
  if (!block || !block.text.includes(evidence.excerpt)) {
    throw fail('ASSISTANT_GUIDE_EVIDENCE_INVALID', '审稿证据必须引用当前章节真实段落中的原文片段。')
  }
  return { chapterId: chapter.id, blockId: block.id, excerpt: evidence.excerpt }
}

export function assistantGuideAdapter(domain: AssistantGuideDomain, database?: NovelDatabaseService): AssistantGuideAdapter {
  if (!database) throw fail('ASSISTANT_GUIDE_ADAPTER_DATABASE_REQUIRED', '创建引导适配器需要数据库实例。')
  if (domain === 'outline') return new OutlineGuideAdapter(database)
  if (domain === 'world') return new WorldGuideAdapter(database)
  if (domain === 'writing') return new WritingGuideAdapter(database)
  if (domain === 'memory') return new MemoryGuideAdapter(database)
  return new DeliveryGuideAdapter(database)
}

export function assistantGuideAdapters(database: NovelDatabaseService): AssistantGuideAdapterRegistry {
  const adapters = new Map<AssistantGuideDomain, AssistantGuideAdapter>([
    ['outline', new OutlineGuideAdapter(database)],
    ['world', new WorldGuideAdapter(database)],
    ['writing', new WritingGuideAdapter(database)],
    ['memory', new MemoryGuideAdapter(database)],
    ['delivery', new DeliveryGuideAdapter(database)]
  ])
  return { get: (domain) => adapters.get(domain) }
}
