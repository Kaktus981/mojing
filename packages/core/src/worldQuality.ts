import { createHash, randomUUID } from 'node:crypto'
import { WorldBibleSchema, WorldEntrySchema, WorldQualityFindingSchema, type WorldBible, type WorldConstraint, type WorldEntry, type WorldQualityFinding } from '../../contracts/src'

const TERMINAL = /[。！？!?；;：:”’」』）】》…]$/u
const REPEATED_PUNCTUATION = /([，。！？；：、])\1{1,}/u
const BLOCKED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function worldFieldDigest(value: string): string { return createHash('sha256').update(value.normalize('NFC')).digest('hex') }

export type WorldQualityTarget = WorldBible | WorldEntry

export function isWorldQualityFindingStale(finding: WorldQualityFinding, target: WorldQualityTarget): boolean {
  const value = getString(target, finding.evidence.fieldPath)
  return value === undefined || worldFieldDigest(value) !== finding.baseFieldDigest || occurrences(value, finding.evidence.excerpt) !== 1
}

/** 免费本地检查只处理确定性问题，不猜测中文是否省略了主语。 */
export function auditWorldLocally(target: WorldQualityTarget, constraints: WorldConstraint[], source: WorldQualityFinding['source'] = '本地规则', createdAt = new Date().toISOString()): WorldQualityFinding[] {
  const findings: WorldQualityFinding[] = []
  const active = constraints.filter((item) => item.status === '已确认' || item.status === '已锁定')
  for (const field of textFields(target)) {
    for (const constraint of active) {
      for (const usage of constraint.forbiddenUsages) {
        if (!field.value.includes(usage.phrase)) continue
        findings.push(makeFinding(field, { type: '术语误用', severity: constraint.status === '已锁定' ? '高' : '中', confidence: 1, constraintIds: [constraint.id], explanation: usage.reason, suggestedReplacement: usage.suggestedReplacement, excerpt: usage.phrase, source, createdAt }))
      }
      const birthMismatch = `${constraint.term}出生率`
      if (field.value.includes(birthMismatch)) findings.push(makeFinding(field, { type: '主语指代', severity: constraint.status === '已锁定' ? '高' : '中', confidence: .99, constraintIds: [constraint.id], excerpt: birthMismatch, explanation: `“${constraint.term}”被定义为“${constraint.definition}”，不会自行出生；应说明具有它的主体。`, suggestedReplacement: `具${constraint.term}的新生灵比例`, source, createdAt }))
      if (constraint.notDefinition && /自然资源|矿产|矿藏|可开采/u.test(constraint.notDefinition)) {
        const resource = new RegExp(`${escapeRegExp(constraint.term)}.{0,8}(?:资源枯竭|矿藏|开采|采掘|产量)`, 'u').exec(field.value)
        if (resource) findings.push(makeFinding(field, { type: '设定冲突', severity: constraint.status === '已锁定' ? '高' : '中', confidence: .98, constraintIds: [constraint.id], excerpt: resource[0], explanation: `“${constraint.term}”明确不是“${constraint.notDefinition}”。`, suggestedReplacement: '', source, createdAt }))
      }
      for (const question of constraint.unresolvedQuestions) {
        const concernsAfterDeath = /死后|死者|遗骨/u.test(question), concernsUse = /取用|交易|利用|回收|转移/u.test(question)
        if (!concernsAfterDeath && !concernsUse) continue
        const sentence = field.value.split(/(?<=[。！？!?])/u).find((item) => item.includes(constraint.term) && (!concernsAfterDeath || /死后|死者|遗骨/u.test(item)) && (!concernsUse || /取用|交易|利用|回收|转移|黑市/u.test(item)))?.trim()
        if (sentence) findings.push(makeFinding(field, { type: '无依据事实', severity: '中', confidence: .92, constraintIds: [constraint.id], excerpt: sentence, explanation: `“${question}”仍标记为尚未确定，当前文字已经替作者作出结论。`, suggestedReplacement: '', source, createdAt }))
      }
    }
    const repeated = repeatedSentence(field.value)
    if (repeated) findings.push(makeFinding(field, { type: '重复啰嗦', severity: '低', confidence: 1, constraintIds: [], excerpt: repeated, explanation: '同一句内容在该字段中重复出现。', suggestedReplacement: '', source, createdAt }))
    const punctuation = REPEATED_PUNCTUATION.exec(field.value)
    if (punctuation) findings.push(makeFinding(field, { type: '文本异常', severity: '低', confidence: 1, constraintIds: [], excerpt: punctuation[0], explanation: '出现连续重复的中文标点。', suggestedReplacement: punctuation[1]!, source, createdAt }))
    if (field.longForm && field.value.trim().length >= 80 && !TERMINAL.test(field.value.trim())) findings.push(makeFinding(field, { type: '文本异常', severity: '中', confidence: .96, constraintIds: [], excerpt: field.value.trim().slice(-80), explanation: '长文本没有完整句末标点，可能在生成时被截断。', source, createdAt }))
  }
  return [...new Map(findings.map((item) => [`${item.type}\0${item.evidence.fieldPath}\0${item.evidence.excerpt}`, item])).values()]
}

export const auditWorldBibleLocally = auditWorldLocally

export function applyWorldQualityRecommendation(target: WorldBible, finding: WorldQualityFinding, replacement?: string): WorldBible
export function applyWorldQualityRecommendation(target: WorldEntry, finding: WorldQualityFinding, replacement?: string): WorldEntry
export function applyWorldQualityRecommendation(target: WorldQualityTarget, finding: WorldQualityFinding, replacement?: string): WorldQualityTarget
export function applyWorldQualityRecommendation(target: WorldQualityTarget, finding: WorldQualityFinding, replacement = finding.suggestedReplacement ?? ''): WorldQualityTarget {
  if (isWorldQualityFindingStale(finding, target)) throw Object.assign(new Error('世界观内容已经变化，这条修复候选已失效，请重新审校。'), { code: 'WORLD_QUALITY_FINDING_STALE' })
  const next = structuredClone(target), current = getString(next, finding.evidence.fieldPath)!
  setString(next, finding.evidence.fieldPath, current.replace(finding.evidence.excerpt, replacement))
  return isWorldEntryTarget(target) ? WorldEntrySchema.parse(next) : WorldBibleSchema.parse(next)
}

export function normalizeAiWorldFindings(target: WorldQualityTarget, raw: Array<Omit<WorldQualityFinding, 'id' | 'baseFieldDigest' | 'status' | 'source' | 'createdAt'>>, createdAt = new Date().toISOString()): WorldQualityFinding[] {
  return raw.flatMap((item) => {
    const value = getString(target, item.evidence.fieldPath)
    if (!value || occurrences(value, item.evidence.excerpt) !== 1) return []
    return [WorldQualityFindingSchema.parse({ ...item, id: randomUUID(), baseFieldDigest: worldFieldDigest(value), status: '待处理', source: 'AI 语义审校', createdAt })]
  })
}

type Field = { path: string; value: string; longForm: boolean }
function textFields(target: WorldQualityTarget): Field[] {
  if (isWorldEntryTarget(target)) return entryTextFields(target)
  const world = target
  const result: Field[] = [f('/summary', world.summary, true), f('/premise', world.premise, true), f('/geography', world.geography, true), f('/historySummary', world.historySummary, true)]
  world.themes.forEach((value, index) => result.push(f(`/themes/${index}`, value, false)))
  world.rules.forEach((value, index) => result.push(f(`/rules/${index}`, value, true)))
  world.entries.forEach((entry, index) => { const base = `/entries/${index}`; result.push(f(`${base}/name`, entry.name, false), f(`${base}/summary`, entry.summary, true), f(`${base}/notes`, entry.notes, true)); collectStrings(entry.details, `${base}/details`, result); collectStrings(entry.customFields, `${base}/customFields`, result) })
  world.timeline.forEach((event, index) => result.push(f(`/timeline/${index}/title`, event.title, false), f(`/timeline/${index}/description`, event.description, true)))
  return result.filter((item) => item.value.trim())
}
function entryTextFields(entry: WorldEntry, base = ''): Field[] {
  const result = [f(`${base}/name`, entry.name, false), f(`${base}/summary`, entry.summary, true), f(`${base}/notes`, entry.notes, true)]
  collectStrings(entry.details, `${base}/details`, result)
  collectStrings(entry.customFields, `${base}/customFields`, result)
  return result.filter((item) => item.value.trim())
}
function isWorldEntryTarget(value: WorldQualityTarget): value is WorldEntry { return 'type' in value }
function f(path: string, value: string, longForm: boolean): Field { return { path, value, longForm } }
function collectStrings(value: unknown, path: string, result: Field[]): void { if (typeof value === 'string') { result.push(f(path, value, value.length >= 40)); return } if (Array.isArray(value)) { value.forEach((item, index) => collectStrings(item, `${path}/${index}`, result)); return } if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => collectStrings(item, `${path}/${escapePointer(key)}`, result)) }
function makeFinding(field: Field, input: Omit<WorldQualityFinding, 'id' | 'evidence' | 'baseFieldDigest' | 'status' | 'createdAt'> & { excerpt: string; createdAt: string }): WorldQualityFinding { return WorldQualityFindingSchema.parse({ ...input, id: randomUUID(), evidence: { fieldPath: field.path, excerpt: input.excerpt }, baseFieldDigest: worldFieldDigest(field.value), status: '待处理', createdAt: input.createdAt }) }
function repeatedSentence(value: string): string | undefined { const seen = new Set<string>(); for (const sentence of value.split(/(?<=[。！？!?；;])/u).map((item) => item.trim()).filter((item) => item.length >= 8)) { if (seen.has(sentence)) return sentence; seen.add(sentence) } }
function occurrences(value: string, excerpt: string): number { let count = 0; for (let from = 0;;) { const index = value.indexOf(excerpt, from); if (index < 0) return count; count += 1; from = index + Math.max(1, excerpt.length) } }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function escapePointer(value: string): string { return value.replaceAll('~', '~0').replaceAll('/', '~1') }
function unescapePointer(value: string): string { return value.replaceAll('~1', '/').replaceAll('~0', '~') }
function segments(path: string): string[] | undefined { if (!path.startsWith('/')) return undefined; const result = path.slice(1).split('/').map(unescapePointer); return result.some((item) => BLOCKED_SEGMENTS.has(item)) ? undefined : result }
function getString(root: unknown, path: string): string | undefined { const parts = segments(path); if (!parts) return; let current: unknown = root; for (const part of parts) { if (Array.isArray(current) && /^\d+$/u.test(part)) current = current[Number(part)]; else if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) current = (current as Record<string, unknown>)[part]; else return } return typeof current === 'string' ? current : undefined }
function setString(root: unknown, path: string, value: string): void { const parts = segments(path); if (!parts?.length) throw new Error('无效的世界观字段。'); let current: unknown = root; for (const part of parts.slice(0, -1)) { if (Array.isArray(current) && /^\d+$/u.test(part)) current = current[Number(part)]; else if (current && typeof current === 'object') current = (current as Record<string, unknown>)[part]; else throw new Error('无效的世界观字段。') } const leaf = parts.at(-1)!; if (Array.isArray(current) && /^\d+$/u.test(leaf)) current[Number(leaf)] = value; else if (current && typeof current === 'object') (current as Record<string, unknown>)[leaf] = value; else throw new Error('无效的世界观字段。') }
