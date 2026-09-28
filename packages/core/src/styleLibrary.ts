import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  StyleSamplePreviewSchema, StyleSampleSchema, type StyleProfile, type StyleProfileDraft,
  type StyleSample, type StyleSampleSegment
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }

/** 切段的最大长度：段落太长不好选，太短又失去上下文。 */
const SEGMENT_TARGET = 1_200
const MIN_ANALYZABLE = 1_000

/**
 * 样文是**不可信观察材料**：只用来抽象技法，不进入正式内容，也不被当作指令。
 * 这里只做纯文本规范化与切段，**不调用任何模型**——导入本身零模型请求（D4）。
 */
export function normalizeSampleText(raw: string): string {
  return raw.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()
}

export function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32)
}

/** 按空行/段落切成可选片段；作者只把勾选的片段发给模型。 */
export function splitSegments(text: string): StyleSampleSegment[] {
  const parts = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  const merged: string[] = []
  let buffer = ''
  for (const part of parts) {
    if (buffer && buffer.length + part.length > SEGMENT_TARGET) { merged.push(buffer); buffer = part } else { buffer = buffer ? `${buffer}\n\n${part}` : part }
  }
  if (buffer) merged.push(buffer)

  const segments: StyleSampleSegment[] = []
  let cursor = 0
  merged.forEach((part, index) => {
    const start = text.indexOf(part, cursor)
    const from = start >= 0 ? start : cursor
    const end = from + part.length
    cursor = end
    segments.push({
      id: `seg-${index + 1}`, label: `第 ${index + 1} 段（${part.replace(/\s/g, '').length} 字）`,
      start: from, end, characterCount: part.replace(/\s/g, '').length,
      excerpt: part.replace(/\s+/g, ' ').slice(0, 60)
    })
  })
  return segments
}

export function previewStyleSample(input: { name: string; kind: StyleSample['kind']; content: string }): z.infer<typeof StyleSamplePreviewSchema> {
  const text = normalizeSampleText(input.content)
  if (!text) throw fail('STYLE_SAMPLE_EMPTY', '样文是空的；请粘贴或选择有内容的文件。')
  if (text.replace(/\s/g, '').length < MIN_ANALYZABLE) {
    throw fail('STYLE_SAMPLE_TOO_SHORT', `可用于分析的字数只有 ${text.replace(/\s/g, '').length}，建议至少 ${MIN_ANALYZABLE} 字。`)
  }
  const segments = splitSegments(text)
  if (segments.length === 0) throw fail('STYLE_SAMPLE_EMPTY', '样文里没有可用段落。')
  return StyleSamplePreviewSchema.parse({
    name: input.name, kind: input.kind, digest: digestOf(text),
    characterCount: text.replace(/\s/g, '').length, segments,
    warnings: text.length > 200_000 ? ['样文很长，建议只勾选最具代表性的几段。'] : []
  })
}

export function saveStyleSample(database: NovelDatabaseService, input: { name: string; kind: StyleSample['kind']; content: string }): StyleSample {
  const preview = previewStyleSample(input)
  const sample = StyleSampleSchema.parse({
    id: `sample-${randomUUID()}`, name: input.name, kind: input.kind,
    text: normalizeSampleText(input.content), digest: preview.digest,
    segments: preview.segments, createdAt: new Date().toISOString()
  })
  return database.saveStyleSample(sample)
}

/**
 * 只把**作者勾选的片段**拼成待发送文本。
 * 返回 `sentCharacterCount` 与 `evidence`，让界面能如实说明「这次到底发了多少、依据在哪」。
 */
export function selectedSampleText(sample: StyleSample, segmentIds: string[]): { text: string; evidence: string[]; sentCharacterCount: number } {
  const chosen = sample.segments.filter((segment) => segmentIds.includes(segment.id))
  if (chosen.length === 0) throw fail('STYLE_SEGMENT_REQUIRED', '请至少勾选一段样文再分析。')
  const text = chosen.map((segment) => sample.text.slice(segment.start, segment.end)).join('\n\n')
  return {
    text,
    evidence: chosen.map((segment) => `${segment.label}：${segment.excerpt}`),
    sentCharacterCount: text.replace(/\s/g, '').length
  }
}

/**
 * 手写画像：完全不需要模型。
 * 没有配置模型服务时作者照样能建立并绑定自己的文风（D4）。
 */
export function createManualStyleProfile(
  database: NovelDatabaseService,
  draft: StyleProfileDraft
): StyleProfile {
  const empty = [draft.description.trim(), ...draft.guidelines, ...draft.avoidPatterns].filter(Boolean).join('')
  if (!empty.trim()) throw fail('STYLE_PROFILE_EMPTY', '至少写一句文风说明或一条建议，才能保存画像。')
  return database.createStyleProfile(draft, { kind: '用户创建', name: draft.name })
}

/** 画像更新产生新版本；已绑定项目用的是快照，不会自动升级（D4）。 */
export function updateStyleProfileVersion(database: NovelDatabaseService, id: string, patch: Partial<StyleProfileDraft>): StyleProfile {
  return database.updateStyleProfile(id, patch)
}
