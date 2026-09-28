// 孤儿文件三级分类：排除测试与类型声明后，看谁引用谁。
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

// 从脚本自身位置反推仓库根，使 `node tools/audit-orphan-reachability.mjs`
// 在任意 cwd 下都能正确工作。
const ROOT = resolve(import.meta.dirname, '..')
const SRC = resolve(ROOT, 'apps/web/src')
const ENTRY = resolve(SRC, 'main.tsx')
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '.css', '.json']

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const e of EXTS) {
    const p = base + e
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  for (const e of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + e
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}
const IMPORT_RE = /(?:^|[^\w$])(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
function deps(file) {
  const out = []
  if (!/\.(t|j)sx?$/.test(file)) return out
  let src
  try { src = readFileSync(file, 'utf8') } catch { return out }
  IMPORT_RE.lastIndex = 0
  let m
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1] || m[2] || m[3]
    if (!spec) continue
    const r = resolveSpec(file, spec)
    if (r) out.push(r)
  }
  return out
}
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = resolve(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(t|j)sx?$/.test(e.name)) acc.push(p)
  }
  return acc
}
function bfs(start) {
  const seen = new Set(start)
  const q = [...start]
  while (q.length) {
    for (const d of deps(q.shift())) if (!seen.has(d)) { seen.add(d); q.push(d) }
  }
  return seen
}

const all = walk(SRC)
const isTest = (f) => /\.test\.(t|j)sx?$/.test(f)
const sources = all.filter((f) => !isTest(f) && !f.endsWith('.d.ts'))
const tests = all.filter(isTest)

const reachable = bfs([ENTRY])
const orphanSrc = sources.filter((f) => !reachable.has(f))

// 从所有测试文件出发能到达的模块
const fromTests = bfs(tests)

const onlyTests = orphanSrc.filter((f) => fromTests.has(f))
const trulyDead = orphanSrc.filter((f) => !fromTests.has(f))

console.log(`源码文件(不含测试/声明): ${sources.length}   测试文件: ${tests.length}`)
console.log(`从 main.tsx 可达: ${[...reachable].filter((f) => sources.includes(f)).length}`)
console.log(`孤儿源文件: ${orphanSrc.length}  =  仅被测试引用 ${onlyTests.length}  +  完全无人引用 ${trulyDead.length}`)
console.log('\n=== 类别 1：完全无人引用（连测试都不 import）===')
for (const f of trulyDead) console.log('  ' + relative(SRC, f).replace(/\\/g, '/'))
console.log('\n=== 类别 2：仅被测试文件引用 ===')
console.log(`  （经测试文件可达的模块共 ${fromTests.size} 个）`)
for (const f of onlyTests) console.log('  ' + relative(SRC, f).replace(/\\/g, '/'))
