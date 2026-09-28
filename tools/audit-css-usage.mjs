import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const workspaceRoot = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(workspaceRoot, 'apps', 'web', 'src')
const stylesheetEntryPath = path.join(sourceRoot, 'styles.css')
// These values come from typed runtime data and are appended to className as-is.
const runtimeClassSafelist = new Set(['user', 'assistant'])

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(entryPath)
    return /\.[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\.[jt]sx?$/.test(entry.name) ? [entryPath] : []
  })
}

function tokens(value) {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
}

function templatePatterns(node) {
  if (!ts.isTemplateExpression(node)) return []
  const marker = '\u0000'
  const combined = `${node.head.text}${node.templateSpans.map((span) => `${marker}${span.literal.text}`).join('')}`
  return combined.split(/\s+/).filter((part) => part.includes(marker) && part.replaceAll(marker, '')).map((part) => {
    const escaped = part.split(marker).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return new RegExp(`^${escaped.join('.+')}$`)
  })
}

function collectStylesheets(filePath, seen = new Set()) {
  const resolvedPath = path.resolve(filePath)
  if (seen.has(resolvedPath)) return []
  seen.add(resolvedPath)
  const css = fs.readFileSync(resolvedPath, 'utf8')
  const imported = [...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'))
    .flatMap((specifier) => collectStylesheets(path.resolve(path.dirname(resolvedPath), specifier), seen))
  return [{ filePath: resolvedPath, css }, ...imported]
}

const stylesheets = collectStylesheets(stylesheetEntryPath)
const cssClasses = new Map()
for (const { filePath, css } of stylesheets) {
  const relativePath = path.relative(workspaceRoot, filePath)
  const selectorCss = css.replace(/@import\s+(?:url\(\s*)?["'][^"']+["']\s*\)?[^;]*;/g, (value) => ' '.repeat(value.length))
  for (const match of selectorCss.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
    const name = match[1]
    const line = selectorCss.slice(0, match.index).split('\n').length
    const locations = cssClasses.get(name) ?? []
    locations.push(`${relativePath}:${line}`)
    cssClasses.set(name, locations)
  }
}

const used = new Map()
const dynamicPatterns = []
for (const filePath of walk(sourceRoot)) {
  const source = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const relativePath = path.relative(workspaceRoot, filePath)

  function record(value, line) {
    for (const token of tokens(value)) {
      if (!cssClasses.has(token)) continue
      const locations = used.get(token) ?? []
      locations.push(`${relativePath}:${line}`)
      used.set(token, locations)
    }
  }

  function visit(node) {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'className' && node.initializer) {
      function recordClassValue(candidate) {
        if (ts.isStringLiteralLike(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) record(candidate.text, line)
        if (ts.isTemplateExpression(candidate)) {
          record(candidate.head.text, line)
          for (const span of candidate.templateSpans) record(span.literal.text, line)
          for (const pattern of templatePatterns(candidate)) dynamicPatterns.push({ pattern, location: `${relativePath}:${line}` })
        }
        ts.forEachChild(candidate, recordClassValue)
      }
      recordClassValue(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const dynamic = new Map()
for (const name of cssClasses.keys()) {
  const matches = dynamicPatterns.filter(({ pattern }) => pattern.test(name))
  if (matches.length) dynamic.set(name, matches.map(({ location }) => location))
}

const unused = [...cssClasses.entries()]
  .filter(([name]) => !runtimeClassSafelist.has(name) && !used.has(name) && !dynamic.has(name))
  .sort((left, right) => left[1][0].localeCompare(right[1][0], 'zh-CN'))

const showUsed = process.argv.includes('--used')
const shouldPrune = process.argv.includes('--prune')
const shouldPreviewPrune = process.argv.includes('--preview-prune')
const report = showUsed
  ? [...cssClasses.entries()].filter(([name]) => used.has(name) || dynamic.has(name)).sort((left, right) => left[1][0].localeCompare(right[1][0], 'zh-CN'))
  : unused

console.log(`样式文件：${stylesheets.length}（入口 1，模块 ${Math.max(0, stylesheets.length - 1)}）`)
console.log(`样式类总数：${cssClasses.size}`)
console.log(`源码明确使用：${used.size}`)
console.log(`动态类名匹配：${dynamic.size}`)
console.log(`待人工确认：${unused.length}`)
console.log('')
for (const [name, locations] of report) console.log(`${locations[0]}  .${name}`)

function splitSelectors(value) {
  const output = []
  let start = 0
  let quote = ''
  let parentheses = 0
  let brackets = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(') parentheses += 1
    else if (character === ')') parentheses -= 1
    else if (character === '[') brackets += 1
    else if (character === ']') brackets -= 1
    else if (character === ',' && !parentheses && !brackets) {
      output.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  output.push(value.slice(start).trim())
  return output.filter(Boolean)
}

function selectorIsUsed(selector) {
  const names = [...selector.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((match) => match[1])
  if (!names.length) return true
  return names.every((name) => runtimeClassSafelist.has(name) || used.has(name) || dynamicPatterns.some(({ pattern }) => pattern.test(name)))
}

function findBlockEnd(value, openIndex) {
  let depth = 1
  let quote = ''
  let comment = false
  for (let index = openIndex + 1; index < value.length; index += 1) {
    const character = value[index]
    const next = value[index + 1]
    if (comment) {
      if (character === '*' && next === '/') { comment = false; index += 1 }
      continue
    }
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '*') { comment = true; index += 1 }
    else if (character === '"' || character === "'") quote = character
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return index
  }
  throw new Error(`CSS 块缺少右花括号，位置 ${openIndex}`)
}

function filterCssRules(value) {
  let cursor = 0
  let output = ''
  while (cursor < value.length) {
    let quote = ''
    let comment = false
    let parentheses = 0
    let brackets = 0
    let boundary = -1
    let boundaryType = ''
    for (let index = cursor; index < value.length; index += 1) {
      const character = value[index]
      const next = value[index + 1]
      if (comment) {
        if (character === '*' && next === '/') { comment = false; index += 1 }
        continue
      }
      if (quote) {
        if (character === '\\') index += 1
        else if (character === quote) quote = ''
        continue
      }
      if (character === '/' && next === '*') { comment = true; index += 1 }
      else if (character === '"' || character === "'") quote = character
      else if (character === '(') parentheses += 1
      else if (character === ')') parentheses -= 1
      else if (character === '[') brackets += 1
      else if (character === ']') brackets -= 1
      else if (!parentheses && !brackets && (character === '{' || character === ';')) {
        boundary = index
        boundaryType = character
        break
      }
    }
    if (boundary < 0) return output + value.slice(cursor)
    if (boundaryType === ';') {
      output += value.slice(cursor, boundary + 1)
      cursor = boundary + 1
      continue
    }

    const close = findBlockEnd(value, boundary)
    const rawPrelude = value.slice(cursor, boundary)
    const trimmedPrelude = rawPrelude.trim()
    const body = value.slice(boundary + 1, close)
    if (trimmedPrelude.startsWith('@')) {
      if (/^@(?:media|supports|layer|container|document)\b/i.test(trimmedPrelude)) {
        const filteredBody = filterCssRules(body)
        if (filteredBody.trim()) output += `${rawPrelude}{${filteredBody}}`
      } else {
        output += value.slice(cursor, close + 1)
      }
    } else {
      const leading = rawPrelude.match(/^(\s*(?:(?:\/\*[\s\S]*?\*\/)\s*)*)/)?.[1] ?? ''
      const selectorText = rawPrelude.slice(leading.length).trim()
      const keptSelectors = splitSelectors(selectorText).filter(selectorIsUsed)
      if (keptSelectors.length) output += `${leading}${keptSelectors.join(', ')}{${body}}`
    }
    cursor = close + 1
  }
  return output
}

if (shouldPrune || shouldPreviewPrune) {
  let originalLength = 0
  let filteredLength = 0
  let changedFiles = 0
  for (const { filePath, css } of stylesheets) {
    const filtered = filterCssRules(css).replace(/\n{3,}/g, '\n\n')
    if (!filtered.trim()) throw new Error(`清理结果为空，已拒绝写入：${path.relative(workspaceRoot, filePath)}`)
    originalLength += css.length
    filteredLength += filtered.length
    if (filtered !== css) changedFiles += 1
    if (shouldPrune) fs.writeFileSync(filePath, filtered, 'utf8')
  }
  console.log('')
  console.log(`${shouldPrune ? '已清理' : '清理预览'}：${originalLength.toLocaleString()} → ${filteredLength.toLocaleString()} 字符（减少 ${(originalLength - filteredLength).toLocaleString()}，涉及 ${changedFiles} 个文件）`)
}
