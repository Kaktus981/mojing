import { randomUUID } from 'node:crypto'
import { SceneQualityFindingSchema, type Chapter, type ChapterOutline, type NovelProject, type SceneQualityFinding } from '../../contracts/src'
import { chapterDigest, chapterText } from './novelMemory'

const TERMINAL = /[。！？!?；;：:”’」』）】》…]$/u
const REPEATED_PUNCTUATION = /([，。！？；：、])\1{1,}/u
const TECHNICAL_LEAK = /```|(?:chapterId|proposalId|scene-beats|worldBible|JSON Schema|schemaVersion)|^\s*[\[{]/mu
const PLACEHOLDER = /(?:待补充|待填写|TODO|未命名|\{\{|\}\})/u

/**
 * 只执行置信度较高、可解释的本地检查，不根据“省略主语”这类正常中文表达
 * 做武断判断。结果绑定本次章节候选摘要，候选被修改后可安全标记为失效。
 */
export function auditChapterLocally(chapter: Chapter, outline: ChapterOutline, project: NovelProject, createdAt = new Date().toISOString()): SceneQualityFinding[] {
  const digest = chapterDigest(chapter), text = chapterText(chapter)
  const findings: SceneQualityFinding[] = []
  const add = (input: Omit<SceneQualityFinding, 'id' | 'chapterId' | 'baseCandidateDigest' | 'status' | 'createdAt'>): void => {
    findings.push(SceneQualityFindingSchema.parse({ ...input, id: randomUUID(), chapterId: chapter.id, baseCandidateDigest: digest, status: '待处理', createdAt }))
  }

  if (!text.trim()) add({ category: '文本异常', severity: '高', confidence: 1, evidence: { chapterId: chapter.id, blockId: chapter.blocks[0]?.id, excerpt: '' }, explanation: '章节候选没有正文内容。', suggestedReplacement: '', source: '本地规则' })
  chapter.blocks.forEach((block, index) => {
    const value = block.text.trim()
    if (!value) return
    const punctuation = REPEATED_PUNCTUATION.exec(value)
    if (punctuation) add({ category: '文本异常', severity: '低', confidence: 1, sceneIndex: index, evidence: { chapterId: chapter.id, blockId: block.id, excerpt: punctuation[0] }, explanation: '段落中出现连续重复的中文标点。', suggestedReplacement: punctuation[1], source: '本地规则' })
    if (TECHNICAL_LEAK.test(value)) add({ category: '文本异常', severity: '高', confidence: .99, sceneIndex: index, evidence: { chapterId: chapter.id, blockId: block.id, excerpt: value.slice(0, 160) }, explanation: '正文疑似泄漏了内部字段、JSON 或技术标记。', suggestedReplacement: '', source: '本地规则' })
    if (PLACEHOLDER.test(value)) add({ category: '文本异常', severity: '中', confidence: .98, sceneIndex: index, evidence: { chapterId: chapter.id, blockId: block.id, excerpt: value.match(PLACEHOLDER)?.[0] ?? value.slice(0, 80) }, explanation: '正文包含待补充或模板占位符。', suggestedReplacement: '', source: '本地规则' })
    if (value.length >= 120 && !TERMINAL.test(value)) add({ category: '文本异常', severity: '中', confidence: .95, sceneIndex: index, evidence: { chapterId: chapter.id, blockId: block.id, excerpt: value.slice(-120) }, explanation: '段落末尾没有完整句末标点，可能在生成时被截断。', suggestedReplacement: '', source: '本地规则' })
  })

  const constraints = project.worldConstraints.filter((item) => item.status === '已确认' || item.status === '已锁定')
  for (const constraint of constraints) {
    for (const forbidden of constraint.forbiddenUsages) {
      const block = chapter.blocks.find((item) => item.text.includes(forbidden.phrase))
      if (!block) continue
      add({ category: '术语冲突', severity: constraint.status === '已锁定' ? '高' : '中', confidence: 1, evidence: { chapterId: chapter.id, blockId: block.id, excerpt: forbidden.phrase }, explanation: `正文使用了术语“${constraint.term}”的禁止说法：${forbidden.reason}`, suggestedReplacement: forbidden.suggestedReplacement, source: '本地规则' })
    }
  }

  // 未来才生效的事实不能提前泄漏到当前候选；只检查近乎原样的长片段，避免
  // 把正常的主题相似或伏笔暗示误报为知识越界。
  for (const memory of project.memories) {
    for (const fact of memory.facts) {
      if (!fact.appliesFromChapter || fact.appliesFromChapter <= chapter.chapterNumber) continue
      const normalizedFact = normalizeComparable(fact.content)
      if (normalizedFact.length < 8 || !normalizeComparable(text).includes(normalizedFact)) continue
      const block = chapter.blocks.find((item) => normalizeComparable(item.text).includes(normalizedFact))
      add({ category: '知识越界', severity: '高', confidence: .98, evidence: { chapterId: chapter.id, blockId: block?.id, excerpt: block?.text.match(new RegExp(escapeRegExp(fact.content.slice(0, Math.min(80, fact.content.length))), 'u'))?.[0] ?? fact.content.slice(0, 80) }, explanation: `这段内容对应第 ${fact.appliesFromChapter} 章后才生效的事实，当前章节可能提前泄漏。`, suggestedReplacement: '', source: '本地规则' })
    }
  }

  // 仅在章纲明确指定角色且全文完全没有其姓名/别名时提示，避免误报正常代词省略。
  const entries = project.worldBible?.entries ?? []
  outline.beats.forEach((beat, index) => {
    const names = beat.characterIds.flatMap((id) => {
      const entry = entries.find((item) => item.id === id)
      return entry ? [entry.name, ...entry.aliases] : []
    }).filter(Boolean)
    if (names.length && !names.some((name) => text.includes(name))) add({ category: '人物缺失', severity: '中', confidence: .9, beatId: beat.id, sceneIndex: index, evidence: { chapterId: chapter.id, excerpt: beat.title }, explanation: `剧情步骤“${beat.title}”指定的角色没有在正文中出现姓名或别名。`, suggestedReplacement: '', source: '本地规则' })
    if (beat.location && !text.includes(beat.location)) add({ category: '场景错位', severity: '低', confidence: .82, beatId: beat.id, sceneIndex: index, evidence: { chapterId: chapter.id, excerpt: beat.title }, explanation: `剧情步骤指定地点“${beat.location}”，正文没有出现该地点名称，请确认场景是否写对。`, suggestedReplacement: '', source: '本地规则' })
  })
  return [...new Map(findings.map((item) => [`${item.category}\0${item.evidence.blockId}\0${item.evidence.excerpt}`, item])).values()]
}

function normalizeComparable(value: string): string {
  return value.replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase()
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function isSceneQualityFindingStale(finding: SceneQualityFinding, chapter: Chapter): boolean {
  return finding.chapterId !== chapter.id || chapterDigest(chapter) !== finding.baseCandidateDigest || (finding.evidence.blockId ? chapter.blocks.find((block) => block.id === finding.evidence.blockId)?.text.includes(finding.evidence.excerpt) !== true : !chapterText(chapter).includes(finding.evidence.excerpt))
}

export function applySceneQualityRecommendation(chapter: Chapter, finding: SceneQualityFinding, replacement = finding.suggestedReplacement ?? ''): Chapter {
  if (isSceneQualityFindingStale(finding, chapter)) throw Object.assign(new Error('章节候选内容已经变化，这条修复建议已失效，请重新审校。'), { code: 'SCENE_QUALITY_FINDING_STALE' })
  if (!finding.evidence.blockId) throw new Error('场景问题缺少可定位的正文段落。')
  const next = structuredClone(chapter)
  const block = next.blocks.find((item) => item.id === finding.evidence.blockId)
  if (!block || block.text.split(finding.evidence.excerpt).length !== 2) throw Object.assign(new Error('正文证据不唯一，无法安全应用局部修复。'), { code: 'SCENE_QUALITY_EVIDENCE_AMBIGUOUS' })
  block.text = block.text.replace(finding.evidence.excerpt, replacement)
  next.sourceDigest = chapterDigest(next)
  next.updatedAt = new Date().toISOString()
  return next
}

export function normalizeAiSceneFindings(chapter: Chapter, raw: Array<Omit<SceneQualityFinding, 'id' | 'chapterId' | 'baseCandidateDigest' | 'status' | 'createdAt' | 'source'>>, createdAt = new Date().toISOString()): SceneQualityFinding[] {
  const digest = chapterDigest(chapter)
  return raw.flatMap((item) => {
    const block = item.evidence.blockId ? chapter.blocks.find((candidate) => candidate.id === item.evidence.blockId) : undefined
    const sourceText = block?.text ?? chapterText(chapter)
    if (!sourceText.includes(item.evidence.excerpt)) return []
    return [SceneQualityFindingSchema.parse({ ...item, id: randomUUID(), chapterId: chapter.id, evidence: { ...item.evidence, chapterId: chapter.id }, baseCandidateDigest: digest, status: '待处理', source: 'AI 深度审校', createdAt })]
  })
}
