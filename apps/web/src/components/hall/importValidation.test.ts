import { describe, expect, it } from 'vitest'
import { MAX_NOVEL_IMPORT_BYTES, NOVEL_BACKUP_ACCEPT, NOVEL_IMPORT_ACCEPT, NOVEL_MANUSCRIPT_ACCEPT, validateNovelImportFile } from './importValidation'

describe('小说导入文件校验', () => {
  it('接受服务端现有格式，包含完整的 markdown 扩展名', () => {
    expect(NOVEL_IMPORT_ACCEPT).toContain('.markdown')
    for (const name of ['novel.txt', 'novel.md', 'novel.markdown', 'novel.docx', 'novel.json', 'NOVEL.TXT']) {
      expect(validateNovelImportFile({ name, size: 1024 })).toBeUndefined()
    }
  })

  it('在请求前拒绝不支持的格式', () => {
    expect(validateNovelImportFile({ name: 'novel.rtf', size: 1024 })).toBe('仅支持 TXT、Markdown、DOCX 和“墨境”JSON。')
  })

  it('在请求前拒绝超过服务端 20 MB 限制的文件', () => {
    expect(validateNovelImportFile({ name: 'novel.txt', size: MAX_NOVEL_IMPORT_BYTES + 1 })).toBe('文件超过 20 MB，请压缩或拆分后再导入。')
  })

  it('导入文稿与恢复备份分别限制文件类型，避免把备份当成普通文稿', () => {
    expect(NOVEL_MANUSCRIPT_ACCEPT).toBe('.txt,.md,.markdown,.docx')
    expect(NOVEL_BACKUP_ACCEPT).toBe('.json')
    expect(validateNovelImportFile({ name: 'story.json', size: 1024 }, 'manuscript')).toBe('请选择 TXT、Markdown 或 DOCX 文稿。')
    expect(validateNovelImportFile({ name: 'story.docx', size: 1024 }, 'backup')).toBe('请选择墨境导出的 JSON 备份。')
    expect(validateNovelImportFile({ name: 'story.json', size: 1024 }, 'backup')).toBeUndefined()
  })
})
