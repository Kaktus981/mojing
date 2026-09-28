import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import type { NovelProject, StyleProfileDraft } from '../../contracts/src'
import { ImportStyleSampleFileSchema, ImportStyleSampleSchema, NovelProjectSchema, StyleSampleKindSchema } from '../../contracts/src'
import { NovelDatabaseService } from './novelDatabase'
import { makeNovel } from './novelTestFactory'
import {
  createManualStyleProfile, normalizeSampleText, previewStyleSample, saveStyleSample, selectedSampleText, splitSegments, updateStyleProfileVersion
} from './styleLibrary'
import { extractSampleTextFromFile } from './styleSampleFile'

const LONG_SAMPLE = Array.from({ length: 30 }, (_, index) =>
  `第${index + 1}段。林砚沿着湿冷的石阶往下走，听见远处传来的钟声在巷子里折了几个弯，像有人在低声重复一句听不清的话。`
).join('\n\n')

function setup() {
  const database = new NovelDatabaseService(':memory:')
  const project = makeNovel(1)
  database.createProject(project)
  return { database, project }
}

const draft: StyleProfileDraft = {
  name: '冷静克制',
  description: '以动作和事实推进，关键处少量修辞。',
  traits: { sentenceRhythm: '短句为主', dialogueStyle: '少修饰', descriptionStyle: '白描' } as never,
  guidelines: ['先写动作再写情绪'],
  avoidPatterns: ['不要连续三段用同类比喻']
}

describe('样文导入（D4）', () => {
  it('粘贴、TXT、Markdown 与项目正文都能切出实际文本', () => {
    for (const kind of ['粘贴', 'TXT', 'Markdown', '项目正文'] as const) {
      const preview = previewStyleSample({ name: '样文', kind, content: LONG_SAMPLE })
      expect(preview.characterCount, `${kind} 必须有实际文本`).toBeGreaterThan(1_000)
      expect(preview.segments.length).toBeGreaterThan(0)
      expect(preview.segments[0]!.excerpt.length).toBeGreaterThan(0)
    }
  })

  it('EPUB 走文件导入路径；粘贴路径的入参语义保持不变', () => {
    expect(StyleSampleKindSchema.options).toContain('EPUB')
    // 粘贴路径仍是纯文本入参：老客户端的语义完全不变，EPUB 只从文件型入参进入。
    const pasteKinds = ImportStyleSampleSchema.shape.kind.options
    expect(pasteKinds).not.toContain('EPUB')
    expect(ImportStyleSampleFileSchema.shape.kind.options).toContain('EPUB')
    expect(ImportStyleSampleFileSchema.safeParse({
      name: '样书', filename: '样书.epub', kind: 'EPUB', dataBase64: 'ZmFrZQ=='
    }).success).toBe(true)
    expect(ImportStyleSampleFileSchema.safeParse({
      name: '样书', filename: '样书.epub', kind: 'EPUB', dataBase64: 'ZmFrZQ==', extra: 1
    }).success).toBe(false)
  })

  it('空文件、全空白与过短样本都给出明确错误，且不丢已有画像', () => {
    const { database } = setup()
    const existing = createManualStyleProfile(database, draft)
    expect(() => previewStyleSample({ name: '空', kind: 'TXT', content: '   \n\n  ' })).toThrowError(/样文是空的/)
    expect(() => previewStyleSample({ name: '短', kind: 'TXT', content: '太短了' })).toThrowError(/建议至少/)
    expect(database.listStyleProfiles().map((item) => item.id)).toContain(existing.id)
    database.close()
  })

  it('切段覆盖全文且不重叠，作者只把勾选的段发出去', () => {
    const text = normalizeSampleText(LONG_SAMPLE)
    const segments = splitSegments(text)
    let cursor = 0
    for (const segment of segments) {
      expect(segment.start).toBeGreaterThanOrEqual(cursor)
      expect(segment.end).toBeGreaterThan(segment.start)
      cursor = segment.end
    }

    const sample = saveStyleSample(new NovelDatabaseService(':memory:'), { name: '样文', kind: 'TXT', content: LONG_SAMPLE })
    expect(segments.length, '长样文要切成多段才能选').toBeGreaterThan(1)
    const only = selectedSampleText(sample, [segments[0]!.id])
    expect(only.sentCharacterCount).toBeLessThan(LONG_SAMPLE.replace(/\s/g, '').length)
    expect(only.text).toContain('第1段')
    expect(only.evidence[0]).toContain('第 1 段')

    const all = selectedSampleText(sample, segments.map((item) => item.id))
    expect(all.sentCharacterCount).toBe(sample.text.replace(/\s/g, '').length)
  })

  it('一段都不选就分析会被拒绝', () => {
    const database = new NovelDatabaseService(':memory:')
    const sample = saveStyleSample(database, { name: '样文', kind: 'TXT', content: LONG_SAMPLE })
    expect(() => selectedSampleText(sample, [])).toThrowError(/至少勾选一段/)
    expect(() => selectedSampleText(sample, ['不存在的段'])).toThrowError(/至少勾选一段/)
    database.close()
  })

  it('样文本身被持久化，刷新后仍能取回用于重选', () => {
    const database = new NovelDatabaseService(':memory:')
    const saved = saveStyleSample(database, { name: '潮汐样章', kind: 'TXT', content: LONG_SAMPLE })
    const reloaded = database.getStyleSample(saved.id)!
    expect(reloaded.name).toBe('潮汐样章')
    expect(reloaded.segments.length).toBe(saved.segments.length)
    expect(database.listStyleSamples()).toHaveLength(1)
    database.close()
  })
})

describe('文风使用记录', () => {
  it('绑定和停用与项目版本一起保存，记录所用画像而不保存样文正文', () => {
    const { database, project } = setup()
    const profile = createManualStyleProfile(database, draft)
    const initial = database.getProject(project.id)
    const bound = database.saveStyleProfileBinding({
      ...initial,
      settings: { ...initial.settings, activeStyleProfileId: profile.id, styleProfileSnapshot: {
        profileId: profile.id, name: profile.name, description: profile.description,
        traits: profile.traits, guidelines: profile.guidelines, avoidPatterns: profile.avoidPatterns,
        sourceKind: profile.sourceKind, capturedAt: new Date().toISOString()
      } }
    }, initial.revision, { action: '绑定', profileId: profile.id, profileName: profile.name })
    const settings = { ...bound.settings }
    delete settings.activeStyleProfileId
    delete settings.styleProfileSnapshot
    database.saveStyleProfileBinding({ ...bound, settings }, bound.revision, { action: '停用', profileId: profile.id, profileName: profile.name })

    expect(database.listStyleProfileUsage(project.id).map((item) => [item.action, item.profileName])).toEqual([
      ['停用', profile.name], ['绑定', profile.name]
    ])
    expect(database.listStyleProfileUsage(project.id).every((item) => !('text' in item))).toBe(true)
    database.close()
  })
})

describe('文风库与绑定（D4）', () => {
  it('没有模型也能手写建立并保存画像', () => {
    const { database } = setup()
    const profile = createManualStyleProfile(database, draft)
    expect(profile.sourceKind).toBe('用户创建')
    expect(profile.id).toBeTruthy()
    expect(() => createManualStyleProfile(database, { ...draft, description: '', guidelines: [], avoidPatterns: [] }))
      .toThrowError(/至少写一句/)
    database.close()
  })

  it('修改画像产生新版本，已绑定项目的快照不会自动升级', () => {
    const { database, project } = setup()
    const profile = createManualStyleProfile(database, draft)
    const snapshot = {
      profileId: profile.id, name: profile.name, description: profile.description, traits: profile.traits,
      guidelines: [...profile.guidelines], avoidPatterns: [...profile.avoidPatterns],
      sourceKind: profile.sourceKind, capturedAt: '2026-09-15T00:00:00.000Z'
    }
    const bound = database.getProject(project.id)
    database.saveProject({ ...bound, settings: { ...bound.settings, activeStyleProfileId: profile.id, styleProfileSnapshot: snapshot } }, bound.revision, '绑定文风范本', '文笔工坊')

    updateStyleProfileVersion(database, profile.id, { description: '改成另一种说明' })
    const after = database.getProject(project.id)
    expect(database.getStyleProfile(profile.id)!.description).toBe('改成另一种说明')
    expect(after.settings.styleProfileSnapshot?.description, '快照不随画像变化').toBe(draft.description)
    expect(after.settings.styleProfileSnapshot?.profileId).toBe(profile.id)
    database.close()
  })

  it('停用绑定保留正文，只移除项目上的画像引用', () => {
    const { database, project } = setup()
    const profile = createManualStyleProfile(database, draft)
    const current = database.getProject(project.id)
    const bound = database.saveProject({
      ...current,
      settings: {
        ...current.settings, activeStyleProfileId: profile.id,
        styleProfileSnapshot: {
          profileId: profile.id, name: profile.name, description: profile.description, traits: profile.traits,
          guidelines: profile.guidelines, avoidPatterns: profile.avoidPatterns, sourceKind: profile.sourceKind,
          capturedAt: new Date().toISOString()
        }
      }
    }, current.revision, '绑定文风范本', '文笔工坊')
    const bodyBefore = bound.chapters[0]!.blocks.map((item) => item.text)

    const settings = { ...database.getProject(project.id).settings }
    delete settings.activeStyleProfileId
    delete settings.styleProfileSnapshot
    const unbound = database.saveProject({ ...database.getProject(project.id), settings }, database.getProject(project.id).revision, '停用文风范本', '文笔工坊')
    expect(unbound.settings.activeStyleProfileId).toBeUndefined()
    expect(unbound.chapters[0]!.blocks.map((item) => item.text)).toEqual(bodyBefore)
    // 画像本身还在库里，只是不再绑定到这个项目。
    expect(database.getStyleProfile(profile.id)).toBeTruthy()
    database.close()
  })

  it('项目片段可以来自本项目正文并作为样文来源', () => {
    const database = new NovelDatabaseService(':memory:')
    const base = structuredClone(makeNovel(3)) as NovelProject
    for (const chapter of base.chapters) {
      chapter.blocks = [{ id: `${chapter.id}-b`, text: LONG_SAMPLE.slice(0, 1_500) }]
    }
    const project = NovelProjectSchema.parse(base)
    database.createProject(project)
    const fromProject = project.chapters.map((chapter) => chapter.blocks.map((block) => block.text).join('\n')).join('\n\n')
    expect(() => previewStyleSample({ name: '本项目正文', kind: '项目正文', content: fromProject })).not.toThrow()
    database.close()
  })
})

/* ------------------------------ 真实文件型导入（EPUB / DOCX） ------------------------------ */

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

/** 在测试里亲手拼出真实 ZIP 字节：EOCD → Central Directory → Local File Header。 */
function buildZip(files: ZipFileFixture[]): Buffer {
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

function epubFixture(options: { encryption?: boolean; container?: boolean } = {}): Buffer {
  const body = CHAPTER_PARAGRAPHS.map((paragraph) => `<p>${paragraph}</p>`).join('\n')
  const files: ZipFileFixture[] = [
    { name: 'mimetype', content: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', content: CONTAINER_XML },
    { name: 'OEBPS/content.opf', content: CONTENT_OPF },
    { name: 'OEBPS/style.css', content: '.x{color:#f0f}' },
    { name: 'OEBPS/chapter1.xhtml', content: chapterXhtml('第一章 潮汐', body) },
    { name: 'OEBPS/chapter2.xhtml', content: chapterXhtml('第二章 回声', body) }
  ]
  if (options.encryption) files.push({ name: 'META-INF/encryption.xml', content: '<encryption><EncryptedData>DRM</EncryptedData></encryption>' })
  return buildZip(files)
}

async function docxFixture(): Promise<Buffer> {
  const document = new Document({
    sections: [{
      children: CHAPTER_PARAGRAPHS.map((paragraph) =>
        new Paragraph({ children: [new TextRun({ text: paragraph })] }))
    }]
  })
  return Packer.toBuffer(document)
}

describe('文件型样文导入（D4 / EPUB / DOCX）', () => {
  it('真实 EPUB：按段落取回正文，标签、脚本、样式被剥离，实体被解码', async () => {
    const { text, warnings } = await extractSampleTextFromFile({ kind: 'EPUB', filename: '样书.epub', data: epubFixture() })

    expect(text).toContain('潮汐&古钟') // &amp; 已解码
    expect(text).not.toContain('&amp;')
    expect(text).not.toContain('&nbsp;')
    expect(text).not.toContain('不该出现的脚本')
    expect(text).not.toContain('color:#f0f')
    expect(text).not.toContain('<p>')
    // 两章都读到，且段落之间保留空行 → 能切出多段。
    expect(text).toContain('第一章 潮汐')
    expect(text).toContain('第二章 回声')
    const segments = splitSegments(normalizeSampleText(text))
    expect(segments.length, '长 EPUB 必须能切出多段').toBeGreaterThan(1)
    expect(warnings).toEqual([])

    const preview = previewStyleSample({ name: '样书.epub', kind: 'EPUB', content: text })
    expect(preview.characterCount).toBeGreaterThan(1_000)

    // 勾选单段时只发那一段。
    const sample = saveStyleSample(new NovelDatabaseService(':memory:'), { name: '样书.epub', kind: 'EPUB', content: text })
    const only = selectedSampleText(sample, [segments[0]!.id])
    expect(only.sentCharacterCount).toBeLessThan(sample.text.replace(/\s/g, '').length)
    expect(only.text).toContain('第1段')
    expect(only.evidence[0]).toContain('第 1 段')
  })

  it('带 DRM 的 EPUB 明确报「数字版权保护」而不是假装读到空正文', async () => {
    await expect(extractSampleTextFromFile({ kind: 'EPUB', filename: 'drm.epub', data: epubFixture({ encryption: true }) }))
      .rejects.toMatchObject({ code: 'STYLE_FILE_ENCRYPTED', message: expect.stringContaining('数字版权保护') })
  })

  it('只声明字体混淆的 encryption.xml 不当作 DRM，正文仍能取回', async () => {
    const body = CHAPTER_PARAGRAPHS.map((paragraph) => `<p>${paragraph}</p>`).join('\n')
    const data = buildZip([
      { name: 'mimetype', content: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', content: CONTAINER_XML },
      {
        name: 'META-INF/encryption.xml',
        content: '<?xml version="1.0"?><encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#">'
          + '<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></enc:EncryptedData></encryption>'
      },
      { name: 'OEBPS/content.opf', content: CONTENT_OPF },
      { name: 'OEBPS/chapter1.xhtml', content: chapterXhtml('第一章 潮汐', body) },
      { name: 'OEBPS/chapter2.xhtml', content: chapterXhtml('第二章 回声', body) }
    ])
    const { text } = await extractSampleTextFromFile({ kind: 'EPUB', filename: 'font.epub', data })
    expect(text).toContain('潮汐&古钟')
  })

  it('损坏 / 截断的 ZIP 与改名成 .epub 的纯文本都报「不是有效的 EPUB」', async () => {
    const valid = epubFixture()
    const truncated = valid.subarray(0, valid.length - 30)
    await expect(extractSampleTextFromFile({ kind: 'EPUB', filename: 'broken.epub', data: truncated }))
      .rejects.toMatchObject({ code: 'STYLE_FILE_NOT_ZIP', message: expect.stringContaining('不是有效的 EPUB') })

    const plain = Buffer.from('这只是一段普通文字，被误改成了 .epub 扩展名。'.repeat(40), 'utf8')
    await expect(extractSampleTextFromFile({ kind: 'EPUB', filename: 'fake.epub', data: plain }))
      .rejects.toMatchObject({ code: 'STYLE_FILE_NOT_ZIP' })
  })

  it('缺少 META-INF/container.xml 的 ZIP 报「缺少 container.xml」', async () => {
    const data = buildZip([
      { name: 'mimetype', content: 'application/epub+zip', store: true },
      { name: 'OEBPS/content.opf', content: CONTENT_OPF }
    ])
    await expect(extractSampleTextFromFile({ kind: 'EPUB', filename: 'nocontainer.epub', data }))
      .rejects.toMatchObject({ code: 'STYLE_FILE_NOT_EPUB', message: expect.stringContaining('container.xml') })
  })

  it('真实 DOCX：mammoth 取回纯文本，段落可切分', async () => {
    const data = await docxFixture()
    const { text } = await extractSampleTextFromFile({ kind: 'DOCX', filename: '样文.docx', data })
    expect(text).toContain('潮汐钟的指针停在子夜')
    expect(splitSegments(normalizeSampleText(text)).length).toBeGreaterThan(1)
    expect(previewStyleSample({ name: '样文.docx', kind: 'DOCX', content: text }).characterCount).toBeGreaterThan(1_000)
  })

  it('TXT / Markdown 去 BOM 后按原文取回', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(LONG_SAMPLE, 'utf8')])
    const txt = await extractSampleTextFromFile({ kind: 'TXT', filename: 'a.txt', data: bom })
    expect(txt.text.startsWith('第1段')).toBe(true)
    const markdown = await extractSampleTextFromFile({ kind: 'Markdown', filename: 'a.md', data: Buffer.from(`# 标题\n\n${LONG_SAMPLE}`, 'utf8') })
    expect(markdown.text).toContain('# 标题')
  })

  it('空文件与超过 60MB 的文件都给出明确错误', async () => {
    await expect(extractSampleTextFromFile({ kind: 'TXT', filename: 'empty.txt', data: Buffer.alloc(0) }))
      .rejects.toMatchObject({ code: 'STYLE_FILE_NO_TEXT' })
    const huge = Buffer.alloc(60 * 1024 * 1024 + 1)
    await expect(extractSampleTextFromFile({ kind: 'TXT', filename: 'huge.txt', data: huge }))
      .rejects.toMatchObject({ code: 'STYLE_FILE_TOO_LARGE', message: expect.stringContaining('文件太大') })
  })
})
