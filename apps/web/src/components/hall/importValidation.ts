export const MAX_NOVEL_IMPORT_BYTES = 20 * 1024 * 1024
export const NOVEL_MANUSCRIPT_ACCEPT = '.txt,.md,.markdown,.docx'
export const NOVEL_BACKUP_ACCEPT = '.json'
export const NOVEL_IMPORT_ACCEPT = `${NOVEL_MANUSCRIPT_ACCEPT},${NOVEL_BACKUP_ACCEPT}`

const supportedExtensions = new Set(NOVEL_IMPORT_ACCEPT.split(','))
const manuscriptExtensions = new Set(NOVEL_MANUSCRIPT_ACCEPT.split(','))

export function validateNovelImportFile(file: Pick<File, 'name' | 'size'>, kind?: 'manuscript' | 'backup'): string | undefined {
  const dot = file.name.lastIndexOf('.')
  const extension = dot >= 0 ? file.name.slice(dot).toLocaleLowerCase('en-US') : ''
  if (kind === 'manuscript' && !manuscriptExtensions.has(extension)) return '请选择 TXT、Markdown 或 DOCX 文稿。'
  if (kind === 'backup' && extension !== NOVEL_BACKUP_ACCEPT) return '请选择墨境导出的 JSON 备份。'
  if (!supportedExtensions.has(extension)) return '仅支持 TXT、Markdown、DOCX 和“墨境”JSON。'
  if (file.size > MAX_NOVEL_IMPORT_BYTES) return '文件超过 20 MB，请压缩或拆分后再导入。'
  return undefined
}
