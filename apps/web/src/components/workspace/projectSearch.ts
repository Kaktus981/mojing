import type { NovelProject } from '../../../../../packages/contracts/src'
import type { WorkspaceNavigationTarget } from './workspaceNavigation'

/**
 * 项目内全局搜索（限定当前项目）。
 *
 * 纯客户端检索：state.project 已持有全量 NovelProject，六域数据都在里面，
 * 不需要新增后端接口。覆盖 正文 / 章纲 / 世界观 / 记忆 / 伏笔 / 故事线，
 * 结果返回「类型 + 标题 + 命中片段 + 落点」，点击落点即可定位原对象所在页面。
 *
 * 约定：
 *   - query.trim() 为空 → 返回 []（不返回全量）；
 *   - 大小写不敏感；
 *   - 每个域限制条数（默认 20）防爆；
 *   - 集合字段一律 `?? []` 兜底：搜索框挂在工作区常驻工具条上、每次按键都全量遍历，
 *     少一条数据最多是少一条命中，绝不能让整页跟着崩。
 */

export type ProjectSearchKind = '正文' | '章纲' | '世界观' | '记忆' | '伏笔' | '故事线'

export type ProjectSearchHit = {
  kind: ProjectSearchKind
  title: string
  snippet: string
  target: WorkspaceNavigationTarget
  /** 原对象 id；空串表示只跳到所属页面、不精确定位到具体对象。 */
  focusId: string
}

export const PROJECT_SEARCH_KINDS: readonly ProjectSearchKind[] = [
  '正文', '章纲', '世界观', '记忆', '伏笔', '故事线'
] as const

const DEFAULT_LIMIT_PER_KIND = 20
const SNIPPET_RADIUS = 40
const SNIPPET_HARD_LIMIT = 80

/** 在命中文本里取一段围绕 query 的片段；超长则加省略号，且不泄露未命中正文。 */
export function snippetOf(haystack: string, query: string, radius: number = SNIPPET_RADIUS): string {
  const text = haystack ?? ''
  const norm = text.toLowerCase()
  const q = (query ?? '').toLowerCase()
  if (!q) return text.length > SNIPPET_HARD_LIMIT ? text.slice(0, SNIPPET_HARD_LIMIT) + '…' : text

  const idx = norm.indexOf(q)
  if (idx < 0) {
    return text.length > SNIPPET_HARD_LIMIT ? text.slice(0, SNIPPET_HARD_LIMIT) + '…' : text
  }
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end) + suffix
}

export function searchProject(project: NovelProject, query: string, limitPerKind?: number): ProjectSearchHit[] {
  const q = query.trim()
  if (!q) return []
  const ql = q.toLowerCase()
  const limit = limitPerKind ?? DEFAULT_LIMIT_PER_KIND

  const byKind: Record<ProjectSearchKind, ProjectSearchHit[]> = {
    正文: [], 章纲: [], 世界观: [], 记忆: [], 伏笔: [], 故事线: []
  }

  // 正文：命中任一正文块即整章算一条命中，片段取首个命中块。
  for (const chapter of project.chapters ?? []) {
    const title = `第${chapter.chapterNumber}章 · ${chapter.title}`
    const matched = chapter.blocks.find((block) => block.text.toLowerCase().includes(ql))
    if (matched) {
      byKind['正文'].push({ kind: '正文', title, snippet: snippetOf(matched.text, q), target: { stageId: 'writing', subnavId: 'prose-editor' }, focusId: chapter.id })
    }
  }

  // 章纲：卷纲里的章节，命中七字段之一即算一条。
  for (const volume of project.outline?.volumes ?? []) {
    for (const chapter of volume.chapters ?? []) {
      const title = `第${chapter.chapterNumber}章 · ${chapter.title || '未命名'}`
      const fields = [chapter.title, chapter.objective, chapter.conflict, chapter.turningPoint, chapter.reveal, chapter.endingHook]
      const matched = fields.find((field) => (field ?? '').toLowerCase().includes(ql))
      if (matched) {
        byKind['章纲'].push({ kind: '章纲', title, snippet: snippetOf(matched, q), target: { stageId: 'outline', subnavId: 'chapter-beats' }, focusId: chapter.id })
      }
    }
  }

  // 世界观：总览四字段、规则、词条名，以及世界约束的术语/定义。
  const world = project.worldBible
  if (world) {
    const overviewFields: Array<[string, string]> = [
      ['世界摘要', world.summary], ['核心前提', world.premise], ['地理', world.geography], ['历史概览', world.historySummary]
    ]
    for (const [label, text] of overviewFields) {
      if (text.toLowerCase().includes(ql)) {
        byKind['世界观'].push({ kind: '世界观', title: label, snippet: snippetOf(text, q), target: { stageId: 'world', subnavId: 'world-overview' }, focusId: '' })
      }
    }
    for (const rule of world.rules) {
      if (rule.toLowerCase().includes(ql)) {
        byKind['世界观'].push({ kind: '世界观', title: '世界规则', snippet: snippetOf(rule, q), target: { stageId: 'world', subnavId: 'world-overview' }, focusId: '' })
      }
    }
    for (const entry of world.entries) {
      if (entry.name.toLowerCase().includes(ql)) {
        byKind['世界观'].push({ kind: '世界观', title: entry.name, snippet: snippetOf(entry.name, q), target: { stageId: 'world', subnavId: 'world-entries' }, focusId: entry.id })
      }
    }
  }
  for (const constraint of project.worldConstraints ?? []) {
    const termHit = constraint.term.toLowerCase().includes(ql)
    const defHit = constraint.definition.toLowerCase().includes(ql)
    if (termHit || defHit) {
      const matched = termHit ? constraint.term : constraint.definition
      byKind['世界观'].push({ kind: '世界观', title: constraint.term, snippet: snippetOf(matched, q), target: { stageId: 'world', subnavId: 'rules-boundaries' }, focusId: constraint.id })
    }
  }

  // 记忆：每章一条记忆，命中其任一文本维度即算一条。
  for (const memory of project.memories ?? []) {
    const title = `第${memory.chapterNumber}章记忆`
    const fields = [
      memory.summary,
      ...(memory.keyEvents ?? []),
      ...(memory.objectStates ?? []),
      ...(memory.timelineEvents ?? []),
      ...(memory.styleSignals ?? []),
      ...(memory.facts ?? []).map((fact) => fact.content),
      ...(memory.characterStates ?? []).map((state) => `${state.characterName}${state.location}${state.goal}`)
    ]
    const matched = fields.find((field) => (field ?? '').toLowerCase().includes(ql))
    if (matched) {
      byKind['记忆'].push({ kind: '记忆', title, snippet: snippetOf(matched, q), target: { stageId: 'memory', subnavId: 'memory-ledger' }, focusId: memory.chapterId })
    }
  }

  // 伏笔：命中标题或任一说明字段即算一条。
  for (const thread of project.plotThreads ?? []) {
    const fields = [thread.title, thread.detail, thread.setupMethod, thread.resolutionMethod]
    const matched = fields.find((field) => (field ?? '').toLowerCase().includes(ql))
    if (matched) {
      byKind['伏笔'].push({ kind: '伏笔', title: thread.title, snippet: snippetOf(matched, q), target: { stageId: 'memory', subnavId: 'foreshadowing' }, focusId: thread.id })
    }
  }

  // 故事线：命中标题或任一正文维度即算一条。
  for (const line of project.storylines ?? []) {
    const fields = [
      line.title, line.whyNecessary, line.openingState, line.finalGoal, line.endCondition,
      ...(line.keyNodes ?? []).map((node) => `${node.title}${node.description}`)
    ]
    const matched = fields.find((field) => (field ?? '').toLowerCase().includes(ql))
    if (matched) {
      byKind['故事线'].push({ kind: '故事线', title: line.title, snippet: snippetOf(matched, q), target: { stageId: 'outline', subnavId: 'storylines' }, focusId: line.id })
    }
  }

  return PROJECT_SEARCH_KINDS.flatMap((kind) => byKind[kind].slice(0, limit))
}
