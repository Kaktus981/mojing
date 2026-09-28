import { deflateRawSync } from 'node:zlib'

/**
 * E2E 样文夹具：在测试进程里亲手拼出**真实 ZIP / EPUB 字节**。
 *
 * 不使用 `page.route` 伪造应用数据：喂给界面的就是一条条真实的 zip 记录，
 * 服务端走的也是真实的「EOCD → Central Directory → Local File Header → inflate」路径。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb8_8320 ^ (value >>> 1)) : (value >>> 1)
    table[n] = value >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffff_ffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffff_ffff) >>> 0
}

interface ZipFileFixture { name: string; content: string; store?: boolean }

/** 拼一个最小但合法的 ZIP：stored(0) 与 deflate(8) 两种压缩方式。 */
export function buildZip(files: ZipFileFixture[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const raw = Buffer.from(file.content, 'utf8')
    const method = file.store ? 0 : 8
    const compressed = file.store ? raw : deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // 通用标志：UTF-8 名称
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x0201_4b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + compressed.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x0605_4b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const CHAPTER_PARAGRAPHS = Array.from({ length: 24 }, (_, index) =>
  `第${index + 1}段。潮汐钟的指针停在子夜，林砚把手贴在冰冷的铜面上，听见墙体内部传来齿轮咬合的回声，那是旧城在午夜翻身的声音，也是记忆被重新誊写的声音。`
)

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const CONTENT_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>样书</dc:title></metadata>
  <manifest>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ch1" href="chapter%31.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="../OEBPS/chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body>
<h1>${title}</h1>
<script>alert('不该出现的脚本')</script>
<style>.x{color:#f0f}</style>
<p>海&amp;城&nbsp;记：潮汐&amp;古钟在此处相认。</p>
${body}
</body></html>`
}

export interface EpubFixtureOptions { encryption?: boolean; omitContainer?: boolean }

/** 一份可用的 EPUB（两章、含 script/style 干扰与实体、去空白后 > 1000 字）。 */
export function epubFixture(options: EpubFixtureOptions = {}): Buffer {
  const body = CHAPTER_PARAGRAPHS.map((paragraph) => `<p>${paragraph}</p>`).join('\n')
  const files: ZipFileFixture[] = [{ name: 'mimetype', content: 'application/epub+zip', store: true }]
  if (!options.omitContainer) files.push({ name: 'META-INF/container.xml', content: CONTAINER_XML })
  files.push(
    { name: 'OEBPS/content.opf', content: CONTENT_OPF },
    { name: 'OEBPS/style.css', content: '.x{color:#f0f}' },
    { name: 'OEBPS/chapter1.xhtml', content: chapterXhtml('第一章 潮汐', body) },
    { name: 'OEBPS/chapter2.xhtml', content: chapterXhtml('第二章 回声', body) }
  )
  if (options.encryption) files.push({ name: 'META-INF/encryption.xml', content: '<encryption><EncryptedData>DRM</EncryptedData></encryption>' })
  return buildZip(files)
}

/** 被误改成 .epub 的普通文本：不是 ZIP 容器。 */
export function notAZipFixture(): Buffer {
  return Buffer.from('这不是一个 ZIP 容器，只是一段被误改扩展名的普通文字。'.repeat(40), 'utf8')
}
