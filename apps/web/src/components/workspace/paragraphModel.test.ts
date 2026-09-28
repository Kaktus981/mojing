import { describe, expect, it } from 'vitest'

import {
  countChapterWords,
  countProjectWords,
  countTextWords,
  insertPlainText,
  mergeWithPrevious,
  normalizeBlocks,
  splitBlockAt
} from './paragraphModel'

/**
 * 正文段落模型的纯函数测试。
 *
 * 为什么先写这一层：正文编辑以前把「浏览器 DOM 里的任意内容」直接当项目模型，
 * 只在 onBlur 才写回 store，导致保持焦点的输入根本不会保存，段落 id 也可能被重建。
 * 这里把段落级操作抽成纯函数，让「拆分 / 合并 / 多段粘贴 / 字数口径」可以被直接证明，
 * 组件只负责把事件翻译成这些函数调用。
 */

const blocks = (...texts: string[]) => texts.map((text, index) => ({ id: `b${index + 1}`, text }))

describe('字数口径', () => {
  it('不计任何空白字符（含换行、制表、全角空格）', () => {
    expect(countTextWords('')).toBe(0)
    expect(countTextWords('   \n\t ')).toBe(0)
    expect(countTextWords('钟声会改写昨天')).toBe(7)
    expect(countTextWords('钟声 会改写\n昨天')).toBe(7)
    expect(countTextWords('全角　空格')).toBe(4)
  })

  it('章节字数按段落累计', () => {
    expect(countChapterWords([])).toBe(0)
    expect(countChapterWords(blocks('第一段', '第二段 三字'))).toBe(3 + 5)
  })

  it('全书字数与章节字数同源', () => {
    expect(countProjectWords([])).toBe(0)
    expect(countProjectWords([{ blocks: blocks('一二三') }, { blocks: blocks('四五') }])).toBe(5)
  })
})

describe('拆分段落（Enter）', () => {
  it('在光标处拆成两段，保留前段的稳定 id，新段使用新 id', () => {
    const result = splitBlockAt(blocks('前半后半'), 'b1', 2, 'new-1')

    expect(result.map((block) => block.id)).toEqual(['b1', 'new-1'])
    expect(result.map((block) => block.text)).toEqual(['前半', '后半'])
  })

  it('在段首拆分时前段为空，在段尾拆分时新段为空', () => {
    expect(splitBlockAt(blocks('全部'), 'b1', 0, 'n').map((block) => block.text)).toEqual(['', '全部'])
    expect(splitBlockAt(blocks('全部'), 'b1', 2, 'n').map((block) => block.text)).toEqual(['全部', ''])
  })

  it('不改动其他段落，也不就地修改原数组', () => {
    const source = blocks('甲', '乙丙', '丁')
    const result = splitBlockAt(source, 'b2', 1, 'n')

    expect(result.map((block) => block.text)).toEqual(['甲', '乙', '丙', '丁'])
    expect(source.map((block) => block.text)).toEqual(['甲', '乙丙', '丁'])
  })

  it('目标段落不存在时原样返回', () => {
    const source = blocks('甲')
    expect(splitBlockAt(source, 'missing', 0, 'n')).toEqual(source)
  })
})

describe('合并段落（段首退格）', () => {
  it('与上一段合并，光标停在接缝处', () => {
    const result = mergeWithPrevious(blocks('前半', '后半'), 'b2')!

    expect(result.blocks.map((block) => block.id)).toEqual(['b1'])
    expect(result.blocks[0]!.text).toBe('前半后半')
    expect(result.caretOffset).toBe(2)
  })

  it('第一段没有上一段可合并时返回 undefined', () => {
    expect(mergeWithPrevious(blocks('唯一'), 'b1')).toBeUndefined()
    expect(mergeWithPrevious(blocks('甲', '乙'), 'missing')).toBeUndefined()
  })

  it('空段落合并后不会留下空壳', () => {
    const result = mergeWithPrevious(blocks('甲', ''), 'b2')!
    expect(result.blocks.map((block) => block.text)).toEqual(['甲'])
    expect(result.caretOffset).toBe(1)
  })
})

describe('多段粘贴', () => {
  it('单行粘贴插入到光标处', () => {
    const result = insertPlainText(blocks('前后'), 'b1', 1, '中间', (index) => `n${index}`)

    expect(result.blocks.map((block) => block.text)).toEqual(['前中间后'])
    expect(result.caret).toEqual({ blockId: 'b1', offset: 3 })
  })

  it('多行粘贴按换行切成多段，光标落在最后一段末尾', () => {
    const result = insertPlainText(blocks('头尾'), 'b1', 1, '甲\n乙\n丙', (index) => `n${index}`)

    expect(result.blocks.map((block) => block.text)).toEqual(['头甲', '乙', '丙尾'])
    expect(result.blocks.map((block) => block.id)).toEqual(['b1', 'n0', 'n1'])
    expect(result.caret).toEqual({ blockId: 'n1', offset: 1 })
  })

  it('兼容 CRLF，且不把制表符当成段落分隔', () => {
    const crlf = insertPlainText(blocks(''), 'b1', 0, '甲\r\n乙', (index) => `n${index}`)
    expect(crlf.blocks.map((block) => block.text)).toEqual(['甲', '乙'])

    const tab = insertPlainText(blocks(''), 'b1', 0, '甲\t乙', (index) => `n${index}`)
    expect(tab.blocks.map((block) => block.text)).toEqual(['甲\t乙'])
  })

  it('粘贴内容为空时不产生新段落', () => {
    const result = insertPlainText(blocks('原文'), 'b1', 2, '', (index) => `n${index}`)
    expect(result.blocks.map((block) => block.text)).toEqual(['原文'])
  })
})

describe('段落归一化', () => {
  it('至少保留一段，并去掉末尾多余空白段', () => {
    expect(normalizeBlocks([])).toEqual([{ id: 'p1', text: '' }])
    expect(normalizeBlocks(blocks('甲', '', ''))).toEqual([{ id: 'b1', text: '甲' }])
    expect(normalizeBlocks(blocks('甲', '乙'))).toEqual(blocks('甲', '乙'))
  })
})
