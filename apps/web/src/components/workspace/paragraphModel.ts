/**
 * 正文段落模型（纯函数）。
 *
 * 背景：正文编辑以前把浏览器 DOM 里的内容直接当项目模型，只在 `onBlur` 才写回 store ——
 * 保持焦点连续输入不会保存，段落 id 也可能被重建。这里把「段落级操作」和「字数口径」
 * 抽成纯函数：
 *   1. 所有函数都返回新数组，不就地改写入参；
 *   2. 段落 id 由调用方提供，模型不生成随机 id，便于测试与稳定关联；
 *   3. 字数口径全站唯一：**不计任何空白字符**（含换行、制表符、全角空格）。
 *
 * 组件只负责把键盘 / 输入法 / 粘贴事件翻译成这里的调用，不自己拼装段落结构。
 */

export type ProseBlock = { id: string; text: string }

/** 章节为空时使用的首段 id；只在数组为空这一种情况下出现，不会与既有段落冲突。 */
export const FIRST_PARAGRAPH_ID = 'p1'

/**
 * 全站唯一字数口径：忽略所有空白字符（空格、换行、制表符、全角空格）。
 * 中文写作里换行与缩进不属于正文字数，各页面必须用这一处，不能各算一套。
 */
export function countTextWords(text: string): number {
  return text.replace(/\s/g, '').length
}

export function countChapterWords(blocks: readonly ProseBlock[]): number {
  return blocks.reduce((sum, block) => sum + countTextWords(block.text), 0)
}

export function countProjectWords(chapters: readonly { blocks: readonly ProseBlock[] }[]): number {
  return chapters.reduce((sum, chapter) => sum + countChapterWords(chapter.blocks), 0)
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return length
  return Math.max(0, Math.min(length, Math.trunc(offset)))
}

/** Enter：在当前段落的指定偏移处拆成两段，前段保留原 id，新段使用调用方给出的 id。 */
export function splitBlockAt(
  blocks: readonly ProseBlock[],
  blockId: string,
  offset: number,
  newBlockId: string
): ProseBlock[] {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index < 0) return [...blocks]

  const block = blocks[index]!
  const at = clampOffset(offset, block.text.length)
  const head: ProseBlock = { id: block.id, text: block.text.slice(0, at) }
  const tail: ProseBlock = { id: newBlockId, text: block.text.slice(at) }

  return [...blocks.slice(0, index), head, tail, ...blocks.slice(index + 1)]
}

/** 段首退格：把当前段落并入上一段，返回合并后的段落与接缝光标位置；无可合并时返回 undefined。 */
export function mergeWithPrevious(
  blocks: readonly ProseBlock[],
  blockId: string
): { blocks: ProseBlock[]; caretOffset: number } | undefined {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index <= 0) return undefined

  const previous = blocks[index - 1]!
  const current = blocks[index]!
  const caretOffset = previous.text.length
  const merged: ProseBlock = { id: previous.id, text: previous.text + current.text }

  return {
    blocks: [...blocks.slice(0, index - 1), merged, ...blocks.slice(index + 1)],
    caretOffset
  }
}

/**
 * 粘贴 / 输入多段纯文本：按换行切段，第一段并入光标前内容，最后一段并入光标后内容，
 * 中间段落各自成为新段落。换行以外的空白（制表符等）保留原样。
 */
export function insertPlainText(
  blocks: readonly ProseBlock[],
  blockId: string,
  offset: number,
  text: string,
  makeBlockId: (index: number) => string
): { blocks: ProseBlock[]; caret: { blockId: string; offset: number } } {
  const index = blocks.findIndex((block) => block.id === blockId)
  if (index < 0) {
    return { blocks: [...blocks], caret: { blockId, offset } }
  }

  const block = blocks[index]!
  const at = clampOffset(offset, block.text.length)
  const head = block.text.slice(0, at)
  const tail = block.text.slice(at)

  if (text === '') {
    return { blocks: [...blocks], caret: { blockId, offset: at } }
  }

  const segments = text.split(/\r?\n/)
  const inserted: ProseBlock[] = segments.map((segment, segmentIndex) => {
    if (segmentIndex === 0) {
      // 单段粘贴：光标前 + 粘贴内容 + 光标后，仍留在同一段
      return { id: block.id, text: segments.length === 1 ? head + segment + tail : head + segment }
    }
    const isLast = segmentIndex === segments.length - 1
    return { id: makeBlockId(segmentIndex - 1), text: isLast ? segment + tail : segment }
  })

  const last = inserted[inserted.length - 1]!
  const caretOffset = segments.length === 1
    ? head.length + segments[0]!.length
    : segments[segments.length - 1]!.length

  return {
    blocks: [...blocks.slice(0, index), ...inserted, ...blocks.slice(index + 1)],
    caret: { blockId: last.id, offset: caretOffset }
  }
}

/** 段落归一化：至少保留一段，并去掉末尾多余的空白段（避免空壳段落越积越多）。 */
export function normalizeBlocks(blocks: readonly ProseBlock[]): ProseBlock[] {
  const result = [...blocks]
  while (result.length > 1 && result[result.length - 1]!.text.trim() === '') result.pop()
  if (result.length === 0) return [{ id: FIRST_PARAGRAPH_ID, text: '' }]
  return result
}
