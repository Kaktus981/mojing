import { describe, expect, it } from 'vitest'

/**
 * M9-04 · 作者可见文案守卫。
 *
 * 背景：「唯一写入口」「契约必填」「storylines 字段」这类词是写给开发者的。
 * 一旦它们落进 JSX 文本或 hint / desc / description 属性，非技术作者就会在界面上看到，
 * 破坏「面向非技术作者」的产品定位。这份守卫把工作区（components/workspace）下所有会被
 * 渲染的源码都当作潜在作者可见文案来检查，命中禁用词即失败。
 *
 * 两条排除规则，各有用意：
 *   1. *.test.ts(x) 里 describe / it 的名字会出现「契约必填」这类词，那是给开发者读的测试名，
 *      不是作者可见文案，整类排除。
 *   2. 注释（块注释与逐行 //）里的词同样是给开发者看的：先剔除注释、再匹配。
 */

/**
 * 用 Vite 的 import.meta.glob 在构建期把工作区源码原文（?raw）一次性抓进来。
 * 刻意不用 node:fs：前端 tsconfig（tsconfig.web.json）只挂了 "vite/client" 类型，
 * 引入 node 内置模块会让 `npm run typecheck` 直接报「找不到 node:fs」。
 * 键形如 './views/review/reviewModel.ts'，值是该文件的原始字符串。
 */
const RAW_SOURCES = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/**
 * 真正会被渲染给作者的现役文件（被集成模块 import 进渲染树）。
 * 它们必须留在扫描集合里，一旦被误排除，本守卫就会失去意义。
 */
const REACHABLE_FILES = [
  'views/idea/ideaModel.ts',
  'views/outline/outlineModel.ts',
  'views/outline/OutlineFoundationPage.tsx'
] as const

/** 测试文件（describe / it 里的词不算作者可见文案）。 */
const TEST_FILE_PATTERN = /\.test\.(?:ts|tsx)$/

/** 禁用词表：短语级，命中子串即算。逐条对应 M9 要清理的开发词汇。 */
const BANNED_PHRASES = [
  '唯一写入口',
  '写入入口',
  '字段路径',
  '来自契约',
  '契约规定',
  '契约必填',
  '契约要求',
  '底层字段',
  'target 字段',
  'storylines 字段',
  '旧字段',
  '条目级',
  '正反双向收集',
  '本模块写入口',
  '未实现',
  '尚未接通',
  '未接通',
  '端点',
  '接口',
  '契约'
] as const

/**
 * 源码级标识符：绝不允许出现在会被渲染的作者可见文案里。
 * 刻意不含 `project.` 前缀的字段名（project.seed / project.settings /
 * project.worldConstraints 等）：那是数据模型本身的真实引用，可能合法地出现在代码里，
 * 不能一概而论。这里只拦路径、模块名、函数调用与 key=value 形态的源码痕迹。
 */
const SOURCE_IDENTIFIER_PATTERN = /apps\/web|mojingServer|applyRevision|generate\(|target=|worldBible/

/** 去掉 './' 前缀，得到相对工作区根的路径。 */
function toRelativeKey(globKey: string): string {
  return globKey.replace(/^\.\//, '')
}

/**
 * 剔除注释，保留换行数以免打乱行号。
 * 先块注释（保留其内部换行），再逐行 //（不含换行的部分整体删除）。
 */
function stripComments(source: string): string {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, (block) => {
    const lineBreaks = block.match(/\n/g)
    return lineBreaks ? '\n'.repeat(lineBreaks.length) : ' '
  })
  return withoutBlockComments.replace(/\/\/[^\n]*/g, '')
}

/** 找出某文件里所有命中，返回 `文件:行号: 词`。 */
function findHits(filePath: string, rawSource: string): string[] {
  const hits: string[] = []
  stripComments(rawSource)
    .split('\n')
    .forEach((line, index) => {
      for (const phrase of BANNED_PHRASES) {
        if (line.includes(phrase)) hits.push(`${filePath}:${index + 1}: ${phrase}`)
      }
    })
  return hits
}

/** 找出某文件里命中的源码标识符，返回 `文件:行号: 词`。 */
function findIdentifierHits(filePath: string, rawSource: string): string[] {
  const hits: string[] = []
  stripComments(rawSource)
    .split('\n')
    .forEach((line, index) => {
      const match = line.match(SOURCE_IDENTIFIER_PATTERN)
      if (match) hits.push(`${filePath}:${index + 1}: ${match[0]}`)
    })
  return hits
}

/** 参与检查的源码：排除测试文件。 */
function scannedEntries(): [string, string][] {
  return Object.entries(RAW_SOURCES)
    .map(([key, raw]): [string, string] => [toRelativeKey(key), raw])
    .filter(([relativePath]) => !TEST_FILE_PATTERN.test(relativePath))
}

describe('作者可见文案守卫（M9-04）', () => {
  const allRelativeKeys = Object.keys(RAW_SOURCES).map(toRelativeKey)

  it('扫描集合非空，确实读到了工作区源码', () => {
    expect(allRelativeKeys.length).toBeGreaterThan(0)
    expect(scannedEntries().length).toBeGreaterThan(0)
  })

  it('现役文件被留在扫描集合里', () => {
    const scannedKeys = new Set(scannedEntries().map(([relativePath]) => relativePath))
    for (const file of REACHABLE_FILES) {
      expect(allRelativeKeys).toContain(file)
      expect(scannedKeys.has(file)).toBe(true)
    }
  })

  it('会被渲染的作者可见文案里不出现开发词汇', () => {
    const hits = scannedEntries().flatMap(([relativePath, raw]) => findHits(relativePath, raw))

    expect(hits).toEqual([])
  })

  it('现役文件里不出现源码标识符', () => {
    const scannedByKey = new Map(scannedEntries())
    const hits: string[] = []
    for (const file of REACHABLE_FILES) {
      const raw = scannedByKey.get(file)
      expect(raw).toBeDefined()
      if (raw) hits.push(...findIdentifierHits(file, raw))
    }

    expect(hits).toEqual([])
  })
})
