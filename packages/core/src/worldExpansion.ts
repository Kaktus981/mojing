import { createHash, randomUUID } from 'node:crypto'
import {
  CreateWorldExpansionSchema, WorldEntrySchema, WorldExpansionProposalSchema,
  type CreateWorldExpansion, type NovelProject, type WorldBible, type WorldExpansionProposal, type WorldExpansionConflict,
  type WorldCausalLink
} from '../../contracts/src'
import { chapterText } from './novelMemory'

/** 只对结构化世界观内容生成摘要；更新时间和待处理状态不会导致候选错位。 */
export function worldBibleDigest(world: WorldBible): string {
  return createHash('sha256').update(JSON.stringify({ summary: world.summary, premise: world.premise, themes: world.themes, rules: world.rules, geography: world.geography, historySummary: world.historySummary, entries: world.entries, timeline: world.timeline })).digest('hex')
}

export interface WorldExpansionPreview {
  proposal: WorldExpansionProposal
  parsedEntries: ReturnType<typeof parseExpansionEntries>
}

/**
 * 预览世界观扩展的影响。新增词条只作为候选，所有受影响正文和章纲
 * 都会被标为待复核，不能因为扩展而静默重写旧章节。
 */
export function previewWorldExpansion(project: NovelProject, raw: CreateWorldExpansion, options: { now?: string; createId?: () => string } = {}): WorldExpansionPreview {
  if (!project.worldBible) throw Object.assign(new Error('请先建立世界观，再进行世界观扩展。'), { code: 'WORLD_REQUIRED' })
  const input = CreateWorldExpansionSchema.parse(raw)
  const now = options.now ?? new Date().toISOString()
  const createId = options.createId ?? randomUUID
  const parsedEntries = parseExpansionEntries(input.proposedEntries)
  const existingByName = new Map(project.worldBible.entries.flatMap((entry) => [entry.name, ...entry.aliases]).map((name) => [normalize(name), name]))
  const conflicts: WorldExpansionConflict[] = parsedEntries.conflicts.map((conflict) => ({ ...conflict, relatedChapterIds: [] }))
  const terms: string[] = []
  for (const entry of parsedEntries.entries) {
    terms.push(entry.name, ...entry.aliases)
    const duplicate = existingByName.get(normalize(entry.name))
    if (duplicate) conflicts.push({ kind: '名称重复', severity: '高', message: `新增词条“${entry.name}”与现有词条“${duplicate}”重名，请确认是补充原词条还是建立不同概念。`, relatedChapterIds: [] })
    for (const alias of entry.aliases) {
      const aliasOwner = existingByName.get(normalize(alias))
      if (aliasOwner && aliasOwner !== entry.name) conflicts.push({ kind: '名称重复', severity: '中', message: `别名“${alias}”已经被现有资料“${aliasOwner}”使用，可能导致召回混淆。`, relatedChapterIds: [] })
    }
  }
  const normalizedTerms = [...new Set(terms.map(normalize).filter(Boolean))]
  const planned = new Set(input.plannedChapterNumbers)
  const source = new Set(input.sourceChapterIds)
  const affectedChapterIds = project.chapters.filter((chapter) => source.has(chapter.id) || planned.has(chapter.chapterNumber) || normalizedTerms.some((term) => chapterText(chapter).toLocaleLowerCase().includes(term))).map((chapter) => chapter.id)
  const affectedOutlineChapterIds = project.outline?.volumes.flatMap((volume) => volume.chapters).filter((chapter) => planned.has(chapter.chapterNumber) || normalizedTerms.some((term) => JSON.stringify(chapter).includes(term))).map((chapter) => chapter.id) ?? []
  const affectedMemoryIds = project.memories.filter((memory) => affectedChapterIds.includes(memory.chapterId) || normalizedTerms.some((term) => JSON.stringify(memory).toLocaleLowerCase().includes(term))).map((memory) => memory.id)
  const affectedThreadIds = project.plotThreads.filter((thread) => affectedChapterIds.includes(thread.setupChapterId ?? '') || affectedChapterIds.includes(thread.resolutionChapterId ?? '') || thread.progress.some((item) => affectedChapterIds.includes(item.chapterId)) || normalizedTerms.some((term) => JSON.stringify(thread).toLocaleLowerCase().includes(term))).map((thread) => thread.id)
  const affectedStorylineIds = (project.storylines ?? []).filter((line) => line.chapterPlans.some((item) => affectedChapterIds.includes(item.chapterId) || planned.has(item.chapterNumber)) || line.entryIds.some((entryId) => parsedEntries.entries.some((entry) => entry.id === entryId)) || normalizedTerms.some((term) => JSON.stringify(line).toLocaleLowerCase().includes(term))).map((line) => line.id)
  if (affectedChapterIds.length > 0 && input.transitionPlan.length === 0) conflicts.push({ kind: '正文尚无铺垫', severity: '中', message: '已有正文会使用新增设定，但没有提供过渡/铺垫计划；建议先安排首次出现、角色认知或解释节点。', relatedChapterIds: affectedChapterIds })
  if (affectedOutlineChapterIds.length === 0 && input.plannedChapterNumbers.length === 0) conflicts.push({ kind: '大纲引用缺失', severity: '低', message: '当前扩展没有绑定近期章纲，应用后需要手动安排首次出场和后续作用。', relatedChapterIds: [] })
  const uniqueConflicts = [...new Map(conflicts.map((item) => [`${item.kind}\0${item.message}`, item])).values()]
  const high = uniqueConflicts.filter((item) => item.severity === '高').length
  const medium = uniqueConflicts.filter((item) => item.severity === '中').length
  const causalChain = input.causalChain?.length ? input.causalChain : deriveCausalChain(parsedEntries.entries, input.transitionPlan, input.reason, createId)
  const unresolvedQuestions = input.unresolvedQuestions?.length ? input.unresolvedQuestions : deriveUnresolvedQuestions(parsedEntries.entries)
  const proposal = WorldExpansionProposalSchema.parse({
    id: createId(), title: input.title, reason: input.reason, baseRevision: project.revision, baseWorldDigest: worldBibleDigest(project.worldBible),
    proposedEntries: parsedEntries.entries, sourceChapterIds: input.sourceChapterIds, plannedChapterNumbers: input.plannedChapterNumbers,
    transitionPlan: input.transitionPlan, affectedChapterIds, affectedOutlineChapterIds, affectedMemoryIds, affectedThreadIds, affectedStorylineIds, conflicts: uniqueConflicts,
    causalChain, unresolvedQuestions,
    impactSummary: `新增 ${parsedEntries.entries.length} 个世界词条，将影响 ${affectedChapterIds.length} 章正文、${affectedOutlineChapterIds.length} 张章纲、${affectedMemoryIds.length} 条记忆、${affectedThreadIds.length} 条伏笔和 ${affectedStorylineIds.length} 条剧情线；${high ? `${high} 个高风险冲突` : '没有高风险冲突'}${medium ? `、${medium} 个需要铺垫或核对的问题` : ''}。应用后相关内容只进入待复核，不会自动重写。`,
    status: '待确认', createdAt: now, updatedAt: now
  })
  return { proposal, parsedEntries }
}

/**
 * 因果链只生成“需要作者确认”的检查骨架，不替作者发明社会制度或剧情事实。
 * 这样扩展世界观时既能看到完整影响路径，又不会把模型猜测偷偷写成正式设定。
 */
function deriveCausalChain(entries: ReturnType<typeof parseExpansionEntries>['entries'], transitions: CreateWorldExpansion['transitionPlan'], reason: string, createId: () => string): WorldCausalLink[] {
  const first = entries[0]
  const names = entries.map((entry) => entry.name).join('、') || '新增设定'
  const safeTransitions = transitions ?? []
  return [
    { id: createId(), layer: '底层规则', title: `明确“${names}”的本质`, description: first ? `${first.name}（${first.type}）：${first.summary || '尚未补充定义。'}这是新增候选的基础描述，尚未成为正式事实。` : '请补充新增设定的本质、来源和边界。', sourceEntryIds: entries.map((entry) => entry.id), status: '待确认' },
    { id: createId(), layer: '社会影响', title: '检查制度与资源影响', description: `待作者确认：${reason || '这次扩展的原因'}会否改变国家、势力、资源、法律、贸易或日常生活？若不会，请明确写“无变化”。`, sourceEntryIds: entries.map((entry) => entry.id), status: '待确认' },
    { id: createId(), layer: '人物与势力', title: '检查人物认知与选择', description: '待作者确认：哪些角色或势力会知道这项设定？它会改变谁的目标、关系、风险或行动？未知部分保持未决定。', sourceEntryIds: entries.map((entry) => entry.id), status: '待确认' },
    { id: createId(), layer: '剧情呈现', title: '安排自然出现位置', description: safeTransitions.length ? safeTransitions.map((item) => `第${item.chapterNumber}章：${item.purpose}`).join('；') : '尚未安排章节；建议先确定首次出现、解释和产生剧情作用的章节。', sourceEntryIds: entries.map((entry) => entry.id), status: '待确认' }
  ]
}

function deriveUnresolvedQuestions(entries: ReturnType<typeof parseExpansionEntries>['entries']): string[] {
  const names = entries.map((entry) => `“${entry.name}”`).join('、') || '这项设定'
  return [
    `${names}是否可以被消耗、交易、继承或复制？`,
    `哪些角色或势力在第几章开始知道${names}？`,
    `如果${names}影响旧规则，旧正文需要在哪些章节增加过渡或复核？`
  ]
}

/** 应用前再次核对项目版本和世界观摘要，防止在作者修改后把旧扩展套到新资料上。 */
export function applyWorldExpansion(project: NovelProject, raw: WorldExpansionProposal, options: { allowRisk?: boolean; reason?: string } = {}): NovelProject {
  if (!project.worldBible) throw Object.assign(new Error('请先建立世界观。'), { code: 'WORLD_REQUIRED' })
  const proposal = WorldExpansionProposalSchema.parse(raw)
  if (proposal.status !== '待确认') throw new Error(`该世界观扩展当前为“${proposal.status}”，不能重复应用。`)
  if (project.revision !== proposal.baseRevision || worldBibleDigest(project.worldBible) !== proposal.baseWorldDigest) throw Object.assign(new Error('世界观或项目版本已经变化，这份扩展候选已失效，请重新预览。'), { code: 'WORLD_EXPANSION_STALE' })
  const high = proposal.conflicts.filter((item) => item.severity === '高')
  if (high.length && !options.allowRisk) throw Object.assign(new Error(`扩展候选有 ${high.length} 个高风险冲突，请先处理或明确带风险应用。`), { code: 'WORLD_EXPANSION_CONFLICT' })
  const next = structuredClone(project)
  const entries = parseExpansionEntries(proposal.proposedEntries).entries
  for (const entry of entries) {
    const byId = next.worldBible!.entries.findIndex((item) => item.id === entry.id)
    const byName = next.worldBible!.entries.findIndex((item) => normalize(item.name) === normalize(entry.name))
    if (byId >= 0) next.worldBible!.entries[byId] = entry
    else if (byName >= 0) next.worldBible!.entries[byName] = { ...next.worldBible!.entries[byName]!, ...entry, id: next.worldBible!.entries[byName]!.id }
    else next.worldBible!.entries.push(entry)
  }
  next.worldBible!.status = '草稿'
  next.worldBible!.updatedAt = new Date().toISOString()
  const affected = new Set(proposal.affectedOutlineChapterIds)
  for (const volume of next.outline?.volumes ?? []) for (const chapter of volume.chapters) if (affected.has(chapter.id)) {
    chapter.downstreamReviewStatus = '待复核'
    chapter.downstreamReviewReason = `世界观扩展“${proposal.title}”已应用，需要核对首次出场、人物认知和过渡铺垫。`
  }
  const now = new Date().toISOString()
  for (const chapterId of proposal.affectedChapterIds) {
    const chapter = next.chapters.find((item) => item.id === chapterId)
    if (!chapter || !chapter.blocks.some((block) => block.text.trim())) continue
    if (next.reviews.some((review) => review.chapterId === chapterId && review.title === '世界观扩展后复核正文' && review.status === '待处理')) continue
    next.reviews.push({ id: randomUUID(), chapterId, category: '世界规则', severity: high.length ? '高' : '中', title: '世界观扩展后复核正文', description: `世界观扩展“${proposal.title}”可能改变本章对新增设定的理解；正文不会被自动改写。`, evidence: [], recommendation: '按过渡计划检查首次出现、角色认知、因果和与旧规则的衔接。', status: '待处理', createdAt: now })
  }
  const existingProposals = next.worldExpansionProposals ?? []
  const stored = existingProposals.findIndex((item) => item.id === proposal.id)
  const applied = { ...proposal, status: '已应用' as const, updatedAt: now }
  if (stored >= 0) existingProposals[stored] = applied
  else existingProposals.push(applied)
  next.worldExpansionProposals = existingProposals
  return next
}

function parseExpansionEntries(values: unknown[]): { entries: ReturnType<typeof WorldEntrySchema.parse>[]; conflicts: Array<Omit<WorldExpansionConflict, 'relatedChapterIds'>> } {
  const entries: ReturnType<typeof WorldEntrySchema.parse>[] = []
  const conflicts: Array<Omit<WorldExpansionConflict, 'relatedChapterIds'>> = []
  for (const value of values) {
    const parsed = WorldEntrySchema.safeParse(value)
    if (parsed.success) entries.push(parsed.data)
    else conflicts.push({ kind: '未知', severity: '高', message: '有一项新增资料不符合世界词条格式，无法安全合并；请在候选中补齐类型、名称和详细资料。' })
  }
  return { entries, conflicts }
}

function normalize(value: string): string { return value.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase() }
