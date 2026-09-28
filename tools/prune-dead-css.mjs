// 保守型死 CSS 核对器 / 字节级切除器
//
// 定位：与 tools/audit-css-usage.mjs（只读审计）、tools/audit-orphan-reachability.mjs（孤儿可达性）
// 同族的「写盘工具」。审计器告诉你「有多少类名没人用」，本工具告诉你「哪些规则可以整条删，且删了不会连坐」。
//
// 判据：只处理 Tier A —— 一条规则里【所有】class 在全仓语料中都零引用 → 该规则必然命中不到任何元素 → 可整条删。
//       Tier B/C（逗号分组里部分分支死亡、或单分支混合活死）一律只报告，不动文本。
//
// 用法：
//   node tools/prune-dead-css.mjs                       # 预览，不写盘（默认目标 apps/web/src/styles.css）
//   node tools/prune-dead-css.mjs --apply               # 字节级切除并写盘
//   node tools/prune-dead-css.mjs --list                # 额外打印全部待删选择器
//   node tools/prune-dead-css.mjs --target=apps/web/src/90-writing-first-shell.css
//
// 为什么必须字节级切除、不能整行删：
//   本仓 styles.css 存在压缩写法（一行挤多条规则，如 .stage-chat-* 整块），按行删会连坐同行的活规则。
//   本工具解析出每条规则的「选择器首字符下标 → 闭合括号」字符区间，倒序 splice，其余字节不动。
//   两个必踩的坑已内置处理：① 删除起点用真实首字符下标（不能用 prelude.length 反推，否则行首残留点号）；
//   ② 仓库是 CRLF，吞换行须按 2 字符处理，否则死规则退化成空行。
//
// 已知局限（重要）：
//   语料是「超集」——只要某个类名在任何文本文件里出现过（含 .md 文档、测试断言如
//   not.toContain('stage-chat-launcher')），就算「活着」。因此本工具偏保守，会漏删一部分实际已死的规则。
//   想再收紧，需要把语料从「全词元」换成「className 字面量」（参考 tools/audit-css-usage.mjs 的提取口径）。

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const targetArg = process.argv.find((a) => a.startsWith('--target='))
const TARGET = path.resolve(ROOT, targetArg ? targetArg.slice('--target='.length) : 'apps/web/src/styles.css')
const APPLY = process.argv.includes('--apply')
const LIST = process.argv.includes('--list')

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'release', 'backups', '.git', '.husky', '.vscode'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.htm', '.md', '.json'])
// 与 tools/audit-css-usage.mjs 保持一致：这两个类名由运行期数据拼进 className，属合法动态使用。
const SAFELIST = new Set(['user', 'assistant'])

function isExcluded(rel) {
  return rel.split('/').some((seg) => EXCLUDE_DIRS.has(seg) || seg.startsWith('.tmp-'))
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(ROOT, full).replace(/\\/g, '/')
    if (isExcluded(rel)) continue
    if (entry.isDirectory()) walk(full, out)
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
  return out
}

// ---------- 1. 全仓语料（超集，越宽越保守） ----------
const corpusFiles = walk(ROOT)
const corpusTokens = new Set()
const dynamicPrefixes = new Set()
for (const file of corpusFiles) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const m of text.matchAll(/-?[_a-zA-Z][_a-zA-Z0-9-]*/g)) corpusTokens.add(m[0])
  // 动态拼接守卫：`foo-${expr}` / `foo-" + expr` / `foo-' + expr`
  for (const m of text.matchAll(/([_a-zA-Z][_a-zA-Z0-9-]*?)-(?=\$\{)/g)) dynamicPrefixes.add(m[1])
  for (const m of text.matchAll(/([_a-zA-Z][_a-zA-Z0-9-]*?)-(?=["'`]\s*\+)/g)) dynamicPrefixes.add(m[1])
  for (const m of text.matchAll(/([_a-zA-Z][_a-zA-Z0-9-]*?)-(?=["'`]\s*,)/g)) dynamicPrefixes.add(m[1])
}

function isDeadClass(name) {
  if (SAFELIST.has(name)) return false
  if (corpusTokens.has(name)) return false
  for (const prefix of dynamicPrefixes) if (name.startsWith(prefix)) return false
  return true
}

// ---------- 2. 解析目标样式表为「规则 + 真实字符区间」 ----------
const css = fs.readFileSync(TARGET, 'utf8')

function matchBrace(text, openIndex) {
  let depth = 1
  let quote = ''
  let comment = false
  for (let i = openIndex + 1; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (comment) {
      if (ch === '*' && next === '/') { comment = false; i += 1 }
      continue
    }
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '/' && next === '*') { comment = true; i += 1 }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return i }
  }
  throw new Error('花括号未配平，起点 ' + openIndex)
}

// 扫描出所有「基础规则」（含 @media 内部的）；@keyframes / @font-face 等整块跳过
// 同时记录条件性 @ 包装块（@media/@supports/...）的区间，供后续清理空壳使用
function scanRules(text) {
  const rules = []
  const atRules = []
  let segStart = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close < 0 ? text.length : close + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i += 1
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1
        i += 1
      }
      i += 1
      continue
    }
    if (ch === '{') {
      const prelude = text.slice(segStart, i)
      const trimmed = prelude.trim()
      if (trimmed.startsWith('@')) {
        if (/^@(media|supports|layer|container|document|scope)\b/i.test(trimmed)) {
          const close = matchBrace(text, i)
          const lead = prelude.match(/^\s*/)[0].length
          atRules.push({
            preludeStart: segStart + lead,
            braceIndex: i,
            bodyEnd: close,
            name: trimmed.split(/[\s(]/)[0]
          })
          segStart = i + 1
          i += 1
          continue
        }
        const close = matchBrace(text, i)
        i = close + 1
        segStart = i
        continue
      }
      const close = matchBrace(text, i)
      // 真实选择器首字符下标（不能用 prelude.length 反推，否则首字符前会残留空白/换行）
      const lead = prelude.match(/^\s*/)[0].length
      rules.push({
        preludeStart: segStart + lead,
        braceIndex: i,
        bodyEnd: close,
        selector: prelude.slice(lead).trim()
      })
      i = close + 1
      segStart = i
      continue
    }
    if (ch === '}') {
      i += 1
      segStart = i
      continue
    }
    if (ch === ';') {
      i += 1
      segStart = i
      continue
    }
    i += 1
  }
  return { rules, atRules }
}

function splitBranches(selector) {
  const out = []
  let start = 0
  let quote = ''
  let parens = 0
  let brackets = 0
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') parens += 1
    else if (ch === ')') parens -= 1
    else if (ch === '[') brackets += 1
    else if (ch === ']') brackets -= 1
    else if (ch === ',' && !parens && !brackets) {
      out.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(selector.slice(start).trim())
  return out.filter(Boolean)
}

const classOf = (text) => [...text.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((m) => m[1])

// 含「带类名参数的函数式伪类」的选择器语义复杂（:not() 取反、:is()/:where() 取或），
// 不使用「任一类死亡即整支死亡」的简化推断，只沿用「全部类死亡」这一无争议判据。
const RISKY_FUNCTIONAL = /:(?:not|is|where|matches|any|has|nth-child|nth-last-child|nth-of-type|nth-last-of-type|host|host-context|slotted)\s*\(/i

// 返回：'all'（该支全部类死亡）/ 'any'（该支至少一个类死亡，且无高风险伪类）/ 'alive'
function branchVerdict(branch) {
  const names = classOf(branch)
  if (!names.length) return 'alive'
  if (names.every(isDeadClass)) return 'all'
  if (!RISKY_FUNCTIONAL.test(branch) && names.some(isDeadClass)) return 'any'
  return 'alive'
}

const { rules } = scanRules(css)

const tierA = []   // ≥1 支死亡且无存活支 → 整条删
const tierB = []   // 有死亡支，也有存活支 → 只报告
const tierC = []   // 无死亡支，但含死亡类名（多为 :not/.is 场景）→ 只报告
const tierD = []   // 完全存活

for (const rule of rules) {
  const branches = splitBranches(rule.selector)
  if (!branches.length) continue
  if (!branches.some((b) => classOf(b).length)) continue

  const verdicts = branches.map(branchVerdict)
  const deadCount = verdicts.filter((v) => v !== 'alive').length

  if (deadCount === branches.length) tierA.push(rule)
  else if (deadCount > 0) tierB.push(rule)
  else if (branches.some((b) => classOf(b).some(isDeadClass))) tierC.push(rule)
  else tierD.push(rule)
}

// ---------- 3. 计算切除区间（整行安全时才扩到行边界） ----------
function regionFor(rule) {
  let start = rule.preludeStart
  let end = rule.bodyEnd + 1
  const lineStart = css.lastIndexOf('\n', start - 1) + 1
  if (css.slice(lineStart, start).trim() === '') start = lineStart
  const lineEnd = css.indexOf('\n', end)
  const tail = lineEnd < 0 ? css.slice(end) : css.slice(end, lineEnd)
  if (tail.trim() === '') end = lineEnd < 0 ? css.length : lineEnd + 1
  return [start, end]
}

const regions = tierA.map(regionFor).sort((a, b) => a[0] - b[0])
for (let i = 1; i < regions.length; i += 1) {
  if (regions[i][0] < regions[i - 1][1]) throw new Error('切除区间重叠，已中止：' + regions[i].join('-'))
}

let pruned = css
for (let i = regions.length - 1; i >= 0; i -= 1) {
  pruned = pruned.slice(0, regions[i][0]) + pruned.slice(regions[i][1])
}

// 清理被删空的 @media/@supports 等条件性包装块（仅当块体已是纯空白时，反复进行直到稳定）
let emptyAtRemoved = 0
for (;;) {
  const { atRules } = scanRules(pruned)
  const empties = atRules
    .filter((at) => pruned.slice(at.braceIndex + 1, at.bodyEnd).trim() === '')
    .map((at) => {
      let start = at.preludeStart
      let end = at.bodyEnd + 1
      const lineStart = pruned.lastIndexOf('\n', start - 1) + 1
      if (pruned.slice(lineStart, start).trim() === '') start = lineStart
      const lineEnd = pruned.indexOf('\n', end)
      const tail = lineEnd < 0 ? pruned.slice(end) : pruned.slice(end, lineEnd)
      if (tail.trim() === '') end = lineEnd < 0 ? pruned.length : lineEnd + 1
      return [start, end]
    })
    .sort((a, b) => a[0] - b[0])
  if (!empties.length) break
  emptyAtRemoved += empties.length
  for (let i = empties.length - 1; i >= 0; i -= 1) {
    pruned = pruned.slice(0, empties[i][0]) + pruned.slice(empties[i][1])
  }
}

// ---------- 4. 自检 ----------
const problems = []
const warnings = []

function balanceOf(text) {
  let depth = 0
  let quote = ''
  let comment = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (comment) { if (ch === '*' && next === '/') { comment = false; i += 1 } continue }
    if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = ''; continue }
    if (ch === '/' && next === '*') { comment = true; i += 1 }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    if (depth < 0) return '负数 depth=' + depth
  }
  return depth === 0 ? 'OK' : '残留 depth=' + depth
}

// 4.1 花括号配平
const before = balanceOf(css)
const after = balanceOf(pruned)
if (before !== 'OK' || after !== 'OK') problems.push(`花括号配平：原 ${before} / 新 ${after}`)

// 4.2 结构等价：新文件里应当只剩「非 Tier A 规则」，且每条规则的 选择器+规则体 逐字不变
const norm = (value) => value.replace(/\s+/g, ' ').trim()
const fingerprint = (rule) => norm(rule.selector) + '\u0001' + css.slice(rule.braceIndex + 1, rule.bodyEnd)
const fingerprintOf = (rule, text) => norm(rule.selector) + '\u0001' + text.slice(rule.braceIndex + 1, rule.bodyEnd)

const tierASet = new Set(tierA)
const expectedKept = rules.filter((r) => !tierASet.has(r) && norm(r.selector) !== '')
const expectedFingerprints = expectedKept.map((r) => fingerprint(r)).sort()

const prunedRules = scanRules(pruned).rules.filter((r) => norm(r.selector) !== '')
const actualFingerprints = prunedRules.map((r) => fingerprintOf(r, pruned)).sort()

if (expectedFingerprints.length !== actualFingerprints.length) {
  problems.push(`规则条数不符：期望保留 ${expectedFingerprints.length}，实际 ${actualFingerprints.length}`)
} else {
  for (let i = 0; i < expectedFingerprints.length; i += 1) {
    if (expectedFingerprints[i] !== actualFingerprints[i]) {
      problems.push(`第 ${i + 1} 条被改动（非纯删除）：${norm(expectedFingerprints[i].split('\u0001')[0]).slice(0, 80)}`)
      break
    }
  }
}

// 4.3 被连带移除的「活类名」——不是错误，但要逐条人工确认
const prunedClasses = new Set(classOf(pruned))
const coincidence = [...new Set(classOf(css))]
  .filter((name) => !prunedClasses.has(name) && !isDeadClass(name))
const coincidenceRules = new Map()
for (const name of coincidence) {
  coincidenceRules.set(name, tierA.filter((r) => classOf(r.selector).includes(name)).map((r) => norm(r.selector)))
}

// 4.4 病态残留
const degenerate = (pruned.match(/^[ \t]*\.[ \t]*$/gm) || []).length
if (degenerate) problems.push('病态残留行（仅剩点号）：' + degenerate)

// ---------- 5. 报告 ----------
const pad = (n) => n.toLocaleString('en-US')
console.log('目标: ' + path.relative(ROOT, TARGET).replace(/\\/g, '/'))
console.log('=== 语料 ===')
console.log(`文件 ${pad(corpusFiles.length)} 个，词元 ${pad(corpusTokens.size)} 个，动态前缀 ${dynamicPrefixes.size} 个`)
console.log('')
console.log('=== 规则分层 ===')
console.log(`Tier A 可整条删        : ${pad(tierA.length)} 条   ← 本次切除对象`)
console.log(`Tier B 部分分支死      : ${pad(tierB.length)} 条   ← 只报告（逗号分组，删支需重排文本）`)
console.log(`Tier C 含死类但支存活  : ${pad(tierC.length)} 条   ← 只报告（:not()/:is() 等场景）`)
console.log(`Tier D 完全存活        : ${pad(tierD.length)} 条`)
console.log('')
console.log('=== 体积 ===')
console.log(`styles.css : ${pad(css.length)} → ${pad(pruned.length)} 字符（减少 ${pad(css.length - pruned.length)}，${(100 * (css.length - pruned.length) / css.length).toFixed(1)}%）`)
console.log('')
console.log('=== 自检 ===')
console.log(`花括号配平        : 原 ${before} / 新 ${after}`)
console.log(`结构等价          : 保留 ${pad(expectedFingerprints.length)} 条，逐条选择器+规则体比对 ${problems.length ? '失败' : '一致'}`)
console.log(`病态残留行        : ${degenerate}`)
console.log(`清掉的空 @ 包装块 : ${emptyAtRemoved} 个`)
console.log(`连带移除的活类名  : ${pad(coincidence.length)} 个（见下，需人工确认）`)
console.log(problems.length ? '\n!!! 硬性问题：\n  ' + problems.join('\n  ') : '\n硬性自检全部通过')

if (coincidence.length) {
  console.log('\n=== 连带移除的活类名明细（每个最多列 3 条被删规则）===')
  for (const name of coincidence.sort()) {
    console.log(`\n  .${name}`)
    for (const sel of coincidenceRules.get(name).slice(0, 3)) console.log(`      ${sel.slice(0, 110)}`)
    const extra = coincidenceRules.get(name).length - 3
    if (extra > 0) console.log(`      … 另有 ${extra} 条`)
  }
}

if (LIST) {
  console.log('\n=== Tier A 待删选择器 ===')
  for (const rule of tierA) console.log('  ' + rule.selector.replace(/\s+/g, ' ').slice(0, 120))
}

const prefixHist = new Map()
for (const name of prunedClasses.size ? [...new Set(classOf(css))].filter((n) => !prunedClasses.has(n)) : []) {
  const head = name.split('-')[0]
  prefixHist.set(head, (prefixHist.get(head) || 0) + 1)
}
console.log('\n=== 删除类名归属（Top 20，按名字首段聚合）===')
console.log([...prefixHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .map(([k, v]) => `${k}: ${v}`).join('  |  '))

if (APPLY) {
  if (problems.length) throw new Error('自检未通过，拒绝写盘')
  fs.writeFileSync(TARGET, pruned, 'utf8')
  console.log('\n[已写盘] ' + path.relative(ROOT, TARGET).replace(/\\/g, '/'))
} else {
  console.log('\n[预览模式] 未写盘。加 --apply 执行切除。')
}
