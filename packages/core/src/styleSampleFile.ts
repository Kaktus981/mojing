import { inflateRawSync } from 'node:zlib'
import mammoth from 'mammoth'

/**
 * 文件型样文取文（TXT / Markdown / DOCX / EPUB）。
 *
 * 设计约束（D4）：
 *  - **零模型请求**：这里只做「字节 → 纯文本」，不发起任何模型调用。
 *  - **不写文件系统**：ZIP 只在内存里解析与解压，绝不落盘，也不把条目名当路径使用。
 *  - **防御式解析**：对 ZIP64、加密标志、越界偏移、条目数与大小异常、解压炸弹都明确报错，
 *    而不是把损坏文件当成「读到了空正文」。
 *  - 统一返回带空行分隔的段落文本，`styleLibrary.splitSegments()` 才能切出合理片段。
 *
 * 说明：DOCX 走已声明依赖 `mammoth.extractRawText`，它是异步 API；因此统一入口
 * `extractSampleTextFromFile` 返回 Promise（与需求书里「同步」的建议签名有一处有意偏差）。
 */

/** 单份样文原始字节上限：超过就请作者先节选。 */
export const STYLE_FILE_MAX_BYTES = 60 * 1024 * 1024
/** 单份样文累计解压上限：防「解压炸弹」把内存打满。 */
export const STYLE_FILE_MAX_INFLATED_BYTES = 64 * 1024 * 1024
/** 一次最多接受多少个 ZIP 条目，避免恶意条目表拖垮解析。 */
const MAX_ZIP_ENTRIES = 100_000

export type StyleSampleFileKind = 'TXT' | 'Markdown' | 'DOCX' | 'EPUB'

export interface ExtractSampleFileInput {
  kind: StyleSampleFileKind
  filename: string
  data: Buffer
}

export interface ExtractedSampleText {
  text: string
  warnings: string[]
}

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** 错误文案集中在一处，界面与测试都据此断言「人话」。 */
export const STYLE_FILE_MESSAGES = {
  encrypted: '这本 EPUB 带了数字版权保护（DRM），无法读取正文；请换一份没有加密的样文。',
  notZip: '这个文件不是有效的 EPUB（不是 ZIP 容器）。',
  notEpub: '这个 EPUB 缺少 META-INF/container.xml，无法定位正文。',
  noText: '这份文件里没有可用的正文文字。',
  tooLarge: '文件太大（超过 60MB），请先节选一部分再导入。',
  unsupported: '这份文件的格式暂不支持，请换一份 TXT / Markdown / DOCX / EPUB。'
} as const

/* ------------------------------ ZIP 只读解析 ------------------------------ */

const EOCD_SIGNATURE = 0x0605_4b50
const EOCD64_LOCATOR_SIGNATURE = 0x0706_4b50
const CD_SIGNATURE = 0x0201_4b50
const LFH_SIGNATURE = 0x0403_4b50

interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  encrypted: boolean
}

function readU16(buffer: Buffer, offset: number): number | undefined {
  return offset >= 0 && offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : undefined
}

function readU32(buffer: Buffer, offset: number): number | undefined {
  return offset >= 0 && offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : undefined
}

/** 把条目名当**不透明字符串**处理：统一斜杠、拒绝任何 `..` 路径穿越语义。 */
function sanitizeEntryName(raw: string): string {
  const name = raw.replace(/\\/g, '/').replace(/^\//, '')
  if (!name) return ''
  if (name.split('/').some((segment) => segment === '..')) return ''
  return name
}

/** 归一化 zip 内路径（去掉 `.`、折叠 `..`），仅用于字符串比较，从不用于文件系统。 */
function normalizeZipPath(path: string): string {
  const parts: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') { parts.pop(); continue }
    parts.push(segment)
  }
  return parts.join('/')
}

function decodePercent(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/**
 * 极简 ZIP 读取器：End of Central Directory → Central Directory → Local File Header。
 * 只支持 stored(0) 与 deflate(8) 两种压缩方式，其余明确报错。
 */
class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>()
  private readonly normalized = new Map<string, string>()
  private inflatedTotal = 0

  constructor(private readonly data: Buffer) { this.parse() }

  tryRead(name: string): Buffer | undefined {
    const entry = this.resolve(name)
    return entry ? this.inflate(entry) : undefined
  }

  private resolve(name: string): ZipEntry | undefined {
    const direct = this.entries.get(name)
    if (direct) return direct
    const canonical = this.normalized.get(normalizeZipPath(decodePercent(name)))
    return canonical ? this.entries.get(canonical) : undefined
  }

  private parse(): void {
    const data = this.data
    if (data.length < 22) throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)

    // EOCD 位于文件末尾，注释最长 65535 字节，向前扫描签名。
    let eocd = -1
    const lowest = Math.max(0, data.length - 22 - 0xffff)
    for (let cursor = data.length - 22; cursor >= lowest; cursor--) {
      if (readU32(data, cursor) === EOCD_SIGNATURE) { eocd = cursor; break }
    }
    if (eocd < 0) throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)

    const totalEntries = readU16(data, eocd + 10) ?? 0
    const directorySize = readU32(data, eocd + 12) ?? 0
    const directoryOffset = readU32(data, eocd + 16) ?? 0

    // ZIP64 防御：定位器存在或任一字段溢出都说明这是 ZIP64 结构，暂不支持。
    const zip64Locator = eocd >= 20 && readU32(data, eocd - 20) === EOCD64_LOCATOR_SIGNATURE
    if (zip64Locator || totalEntries === 0xffff || directoryOffset === 0xffff_ffff || directorySize === 0xffff_ffff) {
      throw fail('STYLE_FILE_UNSUPPORTED', '这份 EPUB 使用了暂不支持的 ZIP64 格式，请用普通 ZIP 重新导出。')
    }
    if (totalEntries > MAX_ZIP_ENTRIES) {
      throw fail('STYLE_FILE_UNSUPPORTED', '这份 EPUB 的条目数量异常，已停止解析。')
    }
    if (directoryOffset > data.length || directoryOffset + directorySize > data.length || directoryOffset > eocd) {
      throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)
    }

    let cursor = directoryOffset
    for (let index = 0; index < totalEntries; index++) {
      if (readU32(data, cursor) !== CD_SIGNATURE) throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)
      const flags = readU16(data, cursor + 8) ?? 0
      const method = readU16(data, cursor + 10) ?? 0
      const compressedSize = readU32(data, cursor + 20) ?? 0
      const uncompressedSize = readU32(data, cursor + 24) ?? 0
      const nameLength = readU16(data, cursor + 28) ?? 0
      const extraLength = readU16(data, cursor + 30) ?? 0
      const commentLength = readU16(data, cursor + 32) ?? 0
      const localHeaderOffset = readU32(data, cursor + 42) ?? 0
      const nameStart = cursor + 46
      const nameEnd = nameStart + nameLength
      if (nameEnd > data.length) throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)

      const rawName = data.toString('utf8', nameStart, nameEnd)
      cursor = nameEnd + extraLength + commentLength

      const name = sanitizeEntryName(rawName)
      if (!name || this.entries.has(name)) continue
      this.entries.set(name, {
        name, compressionMethod: method, compressedSize, uncompressedSize, localHeaderOffset,
        encrypted: (flags & 0x1) !== 0 || method === 99
      })
      const canonical = normalizeZipPath(name)
      if (!this.normalized.has(canonical)) this.normalized.set(canonical, name)
    }
  }

  private inflate(entry: ZipEntry): Buffer {
    if (entry.encrypted) throw fail('STYLE_FILE_ENCRYPTED', STYLE_FILE_MESSAGES.encrypted)
    if (this.inflatedTotal + entry.uncompressedSize > STYLE_FILE_MAX_INFLATED_BYTES) {
      throw fail('STYLE_FILE_UNSUPPORTED', '这份 EPUB 解压后体积过大，已停止解析。')
    }

    const headerOffset = entry.localHeaderOffset
    if (readU32(this.data, headerOffset) !== LFH_SIGNATURE) {
      throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)
    }
    const nameLength = readU16(this.data, headerOffset + 26)
    const extraLength = readU16(this.data, headerOffset + 28)
    if (nameLength === undefined || extraLength === undefined) {
      throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)
    }
    const dataStart = headerOffset + 30 + nameLength + extraLength
    const dataEnd = dataStart + entry.compressedSize
    if (dataStart > this.data.length || dataEnd > this.data.length) {
      throw fail('STYLE_FILE_NOT_ZIP', STYLE_FILE_MESSAGES.notZip)
    }
    const compressed = this.data.subarray(dataStart, dataEnd)

    let output: Buffer
    if (entry.compressionMethod === 0) {
      output = Buffer.from(compressed)
    } else if (entry.compressionMethod === 8) {
      const remaining = STYLE_FILE_MAX_INFLATED_BYTES - this.inflatedTotal
      try {
        output = inflateRawSync(compressed, { maxOutputLength: Math.max(remaining, 1) })
      } catch {
        throw fail('STYLE_FILE_UNSUPPORTED', '这份 EPUB 的压缩数据无法解压，文件可能已损坏。')
      }
    } else {
      throw fail('STYLE_FILE_UNSUPPORTED', `这份 EPUB 使用了暂不支持的压缩方式（${entry.compressionMethod}）。`)
    }
    this.inflatedTotal += output.length
    return output
  }
}

/* ------------------------------ HTML / XHTML 取文 ------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  middot: '·', times: '×', divide: '÷', copy: '©', reg: '®', deg: '°',
  laquo: '«', raquo: '»', sect: '§', para: '¶', bull: '•', prime: '′', Prime: '″', minus: '−'
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10_ffff) return whole
      try { return String.fromCodePoint(code) } catch { return whole }
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}

/**
 * XHTML/HTML → 纯文本：
 * 去掉注释、脚本与样式（含内容）、head/nav/svg；块级标签退化成空行，
 * 于是段落之间保留空行，`splitSegments()` 才能切段。
 */
function htmlToPlainText(html: string): string {
  let text = html
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/<\s*(script|style|head|title|nav|svg)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  text = text.replace(/<\s*\/\s*(p|div|section|article|li|blockquote|h[1-6]|tr|dd|dt|figcaption|br)\s*>/gi, '\n\n')
  text = text.replace(/<\s*br\b[^>]*\/?>/gi, '\n')
  text = text.replace(/<[^>]*>/g, '')
  text = decodeEntities(text)
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(tag)) !== null) {
    attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? ''
  }
  return attributes
}

/** manifest：id → { href, mediaType }。 */
function parseManifest(opf: string): Map<string, { href: string; mediaType: string }> {
  const manifest = new Map<string, { href: string; mediaType: string }>()
  const pattern = /<item\b[^>]*\/?>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(opf)) !== null) {
    const attributes = parseAttributes(match[0])
    if (attributes.id && attributes.href) {
      manifest.set(attributes.id, { href: attributes.href, mediaType: (attributes['media-type'] ?? '').toLowerCase() })
    }
  }
  return manifest
}

/** spine：按阅读顺序返回 idref 列表。 */
function parseSpine(opf: string): string[] {
  const ids: string[] = []
  const pattern = /<itemref\b[^>]*\/?>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(opf)) !== null) {
    const idref = parseAttributes(match[0]).idref
    if (idref) ids.push(idref)
  }
  return ids
}

function dirnameOf(path: string): string {
  const segments = path.split('/')
  segments.pop()
  return segments.join('/')
}

/** 把 OPF 里的 href 解析成 zip 内条目名：支持 `../`、百分号转义与根相对路径。 */
function resolveHref(baseDir: string, href: string): string {
  const clean = decodePercent(href.split('#')[0]!.split('?')[0]!)
  if (clean.startsWith('/')) return normalizeZipPath(clean)
  return normalizeZipPath(baseDir ? `${baseDir}/${clean}` : clean)
}

function isMarkupMediaType(mediaType: string, href: string): boolean {
  if (mediaType === 'application/xhtml+xml' || mediaType === 'text/html') return true
  return /\.x?html?$/i.test(href.split('#')[0]!)
}

/**
 * `META-INF/encryption.xml` 既用于 DRM，也用于 **IDPF 字体混淆**（正文可正常读取）。
 * 只有声明了非字体混淆算法时才判定为 DRM，避免把没加密正文的电子书误报成「数字版权保护」。
 */
function encryptionBlocksText(xml: string): boolean {
  const algorithms = [...xml.matchAll(/Algorithm\s*=\s*"([^"]*)"/gi)].map((match) => match[1] ?? '')
  if (algorithms.length === 0) return true
  return algorithms.some((algorithm) => !/idpf\.org\/2008\/embedding/i.test(algorithm))
}

function extractEpubText(archive: ZipArchive): ExtractedSampleText {
  // EPUB 的 DRM 通过 META-INF/encryption.xml 声明；ZIP 级加密在读取条目时另行报错。
  const encryption = archive.tryRead('META-INF/encryption.xml')
  if (encryption && encryptionBlocksText(encryption.toString('utf8'))) {
    throw fail('STYLE_FILE_ENCRYPTED', STYLE_FILE_MESSAGES.encrypted)
  }

  const container = archive.tryRead('META-INF/container.xml')
  if (!container) throw fail('STYLE_FILE_NOT_EPUB', STYLE_FILE_MESSAGES.notEpub)

  const rootfile = /<rootfile\b[^>]*\/?>/i.exec(container.toString('utf8'))
  const fullPath = rootfile ? parseAttributes(rootfile[0])['full-path'] : undefined
  if (!fullPath) throw fail('STYLE_FILE_NOT_EPUB', STYLE_FILE_MESSAGES.notEpub)

  const opfPath = normalizeZipPath(decodePercent(fullPath))
  const opf = archive.tryRead(opfPath)
  if (!opf) throw fail('STYLE_FILE_NOT_EPUB', STYLE_FILE_MESSAGES.notEpub)

  const opfText = opf.toString('utf8')
  const baseDir = dirnameOf(opfPath)
  const manifest = parseManifest(opfText)
  const spine = parseSpine(opfText)
  const warnings: string[] = []

  // 没有可用 spine 时，退化为按 manifest 顺序取全部 XHTML，兼容纯 spine / 无 NCX 的书。
  const order = spine.length > 0
    ? spine
    : [...manifest.entries()].filter(([, item]) => isMarkupMediaType(item.mediaType, item.href)).map(([id]) => id)
  if (spine.length === 0 && order.length > 0) warnings.push('这份 EPUB 没有 spine 顺序信息，已按目录顺序读取。')

  const parts: string[] = []
  for (const id of order) {
    const item = manifest.get(id)
    if (!item) { warnings.push(`EPUB 里的章节引用 ${id} 找不到对应文件，已跳过。`); continue }
    if (!isMarkupMediaType(item.mediaType, item.href)) continue
    const raw = archive.tryRead(resolveHref(baseDir, item.href))
    if (!raw) { warnings.push(`章节 ${item.href} 在文件中缺失，已跳过。`); continue }
    const plain = htmlToPlainText(raw.toString('utf8'))
    if (plain) parts.push(plain)
  }

  const text = parts.join('\n\n').trim()
  if (!text) throw fail('STYLE_FILE_NO_TEXT', STYLE_FILE_MESSAGES.noText)
  return { text, warnings }
}

/* ------------------------------ 各类型入口 ------------------------------ */

function stripBom(value: string): string { return value.replace(/^\uFEFF/, '') }

function finishPlainText(raw: string): ExtractedSampleText {
  const text = stripBom(raw).replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  if (!text.trim()) throw fail('STYLE_FILE_NO_TEXT', STYLE_FILE_MESSAGES.noText)
  return { text, warnings: [] }
}

async function extractDocxText(data: Buffer): Promise<ExtractedSampleText> {
  let value: string
  try {
    value = (await mammoth.extractRawText({ buffer: data })).value
  } catch (error) {
    throw fail('STYLE_FILE_UNSUPPORTED', `无法解析 Word 文档：${error instanceof Error ? error.message : String(error)}`)
  }
  return finishPlainText(value)
}

/**
 * 统一入口：字节 → 段落文本（空行分隔）+ 如实警告。
 * 抛出的错误带 `code`，HTTP 层据此返回 400。
 */
export async function extractSampleTextFromFile(input: ExtractSampleFileInput): Promise<ExtractedSampleText> {
  const { kind, filename, data } = input
  void filename // 仅用于诊断；取文逻辑不依赖文件名，避免被扩展名误导。
  if (!Buffer.isBuffer(data) || data.length === 0) throw fail('STYLE_FILE_NO_TEXT', STYLE_FILE_MESSAGES.noText)
  if (data.length > STYLE_FILE_MAX_BYTES) throw fail('STYLE_FILE_TOO_LARGE', STYLE_FILE_MESSAGES.tooLarge)

  switch (kind) {
    case 'TXT':
    case 'Markdown':
      return finishPlainText(data.toString('utf8'))
    case 'DOCX':
      return extractDocxText(data)
    case 'EPUB':
      return extractEpubText(new ZipArchive(data))
    default:
      throw fail('STYLE_FILE_UNSUPPORTED', STYLE_FILE_MESSAGES.unsupported)
  }
}
