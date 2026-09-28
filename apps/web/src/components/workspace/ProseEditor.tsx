import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import {
  FIRST_PARAGRAPH_ID,
  countChapterWords,
  insertPlainText,
  mergeWithPrevious,
  normalizeBlocks,
  splitBlockAt,
  type ProseBlock
} from './paragraphModel'

/**
 * 纯文本段落编辑器。
 *
 * 为什么不用受控 `contentEditable`：React 每次重渲染都会改写文本节点，
 * 中文输入法组合期间会打断候选、也会把光标顶回段首。这里采用
 * 「React 不管理文本节点 + 输入即提交」的写法：
 *   1. 每个段落是一个 `contentEditable` 元素，`key` 是稳定段落 id；
 *   2. 文本内容只在「与模型不一致且不在组合中」时由 effect 写入 DOM；
 *   3. `input` 事件立即把改动提交给上层（不再等 onBlur），因此保持焦点的输入也会进入
 *      统一保存通道；组合期间（中文输入法）不提交，`compositionend` 后提交最终文字；
 *   4. Enter 拆分、段首退格合并、多段粘贴都走 `paragraphModel` 的纯函数；
 *   5. 撤销 / 重做由本组件维护一份有界快照栈（Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y），
 *      撤销本身也是一次普通提交，因此同样会被保存。
 *
 * 该组件不关心 store：上层拿到 `onCommit(blocks)` 后走 `updateProject` 即可。
 */

const HISTORY_LIMIT = 50

function caretOffset(element: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return element.textContent?.length ?? 0
  const range = selection.getRangeAt(0)
  if (!element.contains(range.endContainer)) return element.textContent?.length ?? 0
  const prefix = range.cloneRange()
  prefix.selectNodeContents(element)
  prefix.setEnd(range.endContainer, range.endOffset)
  return prefix.toString().length
}

function placeCaret(element: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  const target = Math.max(0, Math.min(offset, element.textContent?.length ?? 0))

  let remaining = target
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }

  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function ProseEditor({
  blocks,
  onCommit
}: {
  blocks: readonly ProseBlock[]
  onCommit: (blocks: ProseBlock[]) => void
}): React.JSX.Element {
  const elements = useRef(new Map<string, HTMLParagraphElement | null>())
  const composing = useRef(false)
  const pendingCaret = useRef<{ blockId: string; offset: number } | null>(null)
  const history = useRef<ProseBlock[][]>([])
  const historyIndex = useRef(-1)
  const idSeed = useRef(0)

  const paragraphs: readonly ProseBlock[] = blocks.length > 0 ? blocks : [{ id: FIRST_PARAGRAPH_ID, text: '' }]

  const nextBlockId = useCallback((): string => {
    idSeed.current += 1
    return `p-${Date.now().toString(36)}-${idSeed.current}`
  }, [])

  const commit = useCallback(
    (next: readonly ProseBlock[], caret?: { blockId: string; offset: number }): void => {
      const snapshot = next.map((block) => ({ ...block }))
      history.current = [...history.current.slice(0, historyIndex.current + 1), snapshot].slice(-HISTORY_LIMIT)
      historyIndex.current = history.current.length - 1
      if (caret) pendingCaret.current = caret
      onCommit(snapshot)
    },
    [onCommit]
  )

  // 首次挂载时把当前正文作为撤销栈的起点
  useEffect(() => {
    if (history.current.length === 0) {
      history.current = [paragraphs.map((block) => ({ ...block }))]
      historyIndex.current = 0
    }
    // 只在挂载时初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React 不管理文本节点：只在模型与 DOM 不一致、且没有正在组合输入时写入
  useEffect(() => {
    for (const block of paragraphs) {
      const element = elements.current.get(block.id)
      if (!element) continue
      if (composing.current) continue
      if (element.textContent !== block.text) element.textContent = block.text
    }
  }, [paragraphs])

  // 结构变化后把光标放回作者期望的位置
  useLayoutEffect(() => {
    const target = pendingCaret.current
    if (!target) return
    const element = elements.current.get(target.blockId)
    if (!element) return
    pendingCaret.current = null
    element.focus()
    placeCaret(element, target.offset)
  })

  function withText(blockId: string, text: string): ProseBlock[] {
    return paragraphs.map((block) => (block.id === blockId ? { ...block, text } : { ...block }))
  }

  function undo(): void {
    if (historyIndex.current <= 0) return
    historyIndex.current -= 1
    pendingCaret.current = null
    onCommit(history.current[historyIndex.current]!.map((block) => ({ ...block })))
  }

  function redo(): void {
    if (historyIndex.current >= history.current.length - 1) return
    historyIndex.current += 1
    pendingCaret.current = null
    onCommit(history.current[historyIndex.current]!.map((block) => ({ ...block })))
  }

  const totalWords = countChapterWords(paragraphs)

  return (
    <div
      className="mjp-prose"
      data-words={totalWords}
      onBlur={(event) => {
        // 焦点离开整个正文区时清掉末尾多余空段，避免空壳段落越积越多
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        const normalized = normalizeBlocks(paragraphs)
        if (normalized.length !== paragraphs.length) commit(normalized)
      }}
    >
      {paragraphs.map((block) => (
        <p
          key={block.id}
          className="para"
          contentEditable
          suppressContentEditableWarning
          data-block-id={block.id}
          ref={(element) => {
            if (element) elements.current.set(block.id, element)
            else elements.current.delete(block.id)
          }}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(event) => {
            composing.current = false
            const text = event.currentTarget.textContent ?? ''
            if (text !== block.text) commit(withText(block.id, text))
          }}
          onInput={(event) => {
            // 组合输入（中文输入法）期间不提交，等 compositionend
            if (composing.current) return
            const text = event.currentTarget.textContent ?? ''
            if (text !== block.text) commit(withText(block.id, text))
          }}
          onKeyDown={(event) => {
            const meta = event.ctrlKey || event.metaKey
            if (meta && event.key.toLowerCase() === 'z') {
              event.preventDefault()
              if (event.shiftKey) redo()
              else undo()
              return
            }
            if (meta && event.key.toLowerCase() === 'y') {
              event.preventDefault()
              redo()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              const offset = caretOffset(event.currentTarget)
              const newBlockId = nextBlockId()
              commit(splitBlockAt(paragraphs, block.id, offset, newBlockId), { blockId: newBlockId, offset: 0 })
              return
            }
            if (event.key === 'Backspace' && caretOffset(event.currentTarget) === 0) {
              const index = paragraphs.findIndex((item) => item.id === block.id)
              if (index <= 0) return
              const previousId = paragraphs[index - 1]!.id
              const merged = mergeWithPrevious(paragraphs, block.id)
              if (!merged) return
              event.preventDefault()
              commit(merged.blocks, { blockId: previousId, offset: merged.caretOffset })
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text/plain')
            if (text === '') return
            event.preventDefault()
            const offset = caretOffset(event.currentTarget)
            const result = insertPlainText(paragraphs, block.id, offset, text, () => nextBlockId())
            commit(result.blocks, result.caret)
          }}
        />
      ))}
    </div>
  )
}
