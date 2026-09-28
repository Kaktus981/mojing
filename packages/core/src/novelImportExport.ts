import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { NovelProjectSchema, type GenreTemplate, type NovelProject, type NovelSettings } from '../../contracts/src'
import { chapterDigest, chapterText, normalizeProse } from './novelMemory'
import { establishPlanningDigestBaseline } from './novelPlanning'

export const NOVEL_IMPORT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.docx', '.json'])
export const STYLE_LEARNING_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.docx'])

/** 提取供抽象文风分析使用的纯文本；不会在数据库中保存上传文件或原文。 */
export async function extractStyleLearningText(filename: string, buffer: Buffer): Promise<string> {
  const extension = extname(filename).toLowerCase()
  if (!STYLE_LEARNING_EXTENSIONS.has(extension)) throw Object.assign(new Error('文笔学习仅支持 TXT、Markdown 和 DOCX。'), { code: 'STYLE_FILE_UNSUPPORTED' })
  const text = extension === '.docx' ? (await mammoth.extractRawText({ buffer })).value : buffer.toString('utf8')
  const normalized = text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
  if (normalized.replace(/\s/g, '').length < 1_000) throw Object.assign(new Error('用于学习的正文太短，建议至少上传 1000 个汉字。'), { code: 'STYLE_SAMPLE_TOO_SHORT' })
  return normalized
}

export async function importNovelBuffer(filename: string, buffer: Buffer): Promise<NovelProject> {
  const extension = extname(filename).toLowerCase()
  if (!NOVEL_IMPORT_EXTENSIONS.has(extension)) throw new Error('仅支持 TXT、Markdown、DOCX 和“墨境”JSON。')
  if (extension === '.json') {
    const value = JSON.parse(buffer.toString('utf8')) as unknown
    const parsed = NovelProjectSchema.safeParse(value)
    if (!parsed.success) throw new Error('该 JSON 不是“墨境”小说项目；旧漫剧项目不兼容且不会被隐式转换。')
    return establishPlanningDigestBaseline({ ...parsed.data, id: randomUUID(), title: `${parsed.data.title}（导入）`, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  }
  let text: string
  if (extension === '.docx') {
    try { text = (await mammoth.extractRawText({ buffer })).value }
    catch { throw new Error('这份 DOCX 无法读取，文件可能已损坏。') }
  } else text = buffer.toString('utf8')
  return createImportedNovel(basename(filename, extension), text)
}

export function createImportedNovel(title: string, text: string): NovelProject {
  const now = new Date().toISOString()
  const sections = splitChapters(text)
  const chapters = sections.map((section, index) => {
    const blocks = normalizeProse(section.body)
    const chapter = { id: randomUUID(), volumeNumber: 1, chapterNumber: index + 1, title: section.title || `第 ${index + 1} 章`, blocks, status: '草稿' as const, sourceDigest: '', updatedAt: now }
    chapter.sourceDigest = chapterDigest(chapter)
    return chapter
  })
  return NovelProjectSchema.parse({ schemaVersion: 2, id: randomUUID(), title: title || '导入的小说', seed: text.slice(0, 2_000) || '从导入正文建立小说项目', settings: defaultSettings('通用', Math.max(80_000, text.replace(/\s/g, '').length)), status: '待规划', revision: 0, chapters, memories: [], plotThreads: [], branches: [], reviews: [], createdAt: now, updatedAt: now })
}

export function defaultSettings(genreTemplate: GenreTemplate = '通用', targetWords = 300_000): NovelSettings {
  return { genreTemplate, targetWords, plannedVolumes: 3, plannedChapters: 120, pointOfView: '第三人称限知', tense: '过去时', audience: '中文长篇小说读者', style: '清晰、克制、有画面感，人物行为由动机推动', contentLimits: '避免套路化复刻和无理由人物转变', rhetoricIntensity: 1, writingDetail: '标准', writingGenerationMode: '协作生成', chapterTargetWords: 2_000, chapterAutoAnalyze: false, language: '简体中文' }
}

export async function exportNovel(project: NovelProject, format: 'json' | 'docx' | 'txt' | 'md'): Promise<Buffer> {
  if (format === 'json') return Buffer.from(JSON.stringify(project, null, 2), 'utf8')
  if (format === 'txt' || format === 'md') return Buffer.from(buildText(project, format === 'md'), 'utf8')
  const children: Paragraph[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(project.title)] })]
  let volume = -1
  for (const chapter of [...project.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    if (chapter.volumeNumber !== volume) {
      volume = chapter.volumeNumber
      const volumeOutline = project.outline?.volumes.find((item) => item.volumeNumber === volume)
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: `第 ${volume} 卷${volumeOutline?.title ? ` ${volumeOutline.title}` : ''}` }))
    }
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: `第 ${chapter.chapterNumber} 章 ${chapter.title}` }))
    chapter.blocks.forEach((block) => children.push(new Paragraph({ children: [new TextRun(block.text)], indent: { firstLine: 480 }, spacing: { line: 360, after: 120 } })))
  }
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })))
}

function buildText(project: NovelProject, markdown: boolean): string {
  const lines: string[] = [markdown ? `# ${project.title}` : project.title]
  let volume = -1
  for (const chapter of [...project.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    if (chapter.volumeNumber !== volume) {
      volume = chapter.volumeNumber
      const title = project.outline?.volumes.find((item) => item.volumeNumber === volume)?.title ?? ''
      lines.push('', markdown ? `## 第 ${volume} 卷 ${title}` : `第 ${volume} 卷 ${title}`)
    }
    lines.push('', markdown ? `### 第 ${chapter.chapterNumber} 章 ${chapter.title}` : `第 ${chapter.chapterNumber} 章 ${chapter.title}`, '', chapterText(chapter))
  }
  return lines.join('\n')
}

function splitChapters(text: string): Array<{ title: string; body: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return [{ title: '第 1 章', body: '' }]
  const matches = [...normalized.matchAll(/^(?:#{1,3}\s*)?(第[零一二三四五六七八九十百千万\d]+章[^\n]*)$/gm)]
  if (!matches.length) return [{ title: '第 1 章', body: normalized }]
  return matches.map((match, index) => ({ title: match[1]!.replace(/^#+\s*/, '').trim(), body: normalized.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? normalized.length).trim() }))
}
