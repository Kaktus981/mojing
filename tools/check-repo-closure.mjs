#!/usr/bin/env node
/**
 * 墨境 · 阶段 0.5C 仓库闭包守卫
 * ============================================================
 * 目的：保证「所有正式相对导入与 package exports 都能在提交树中解析」。
 *
 * 判定分两层，两层都成立才算「闭包基线可独立构建」：
 *
 *   Tier 1 · 磁盘闭包（buildable）
 *     - 正式源码里每一条相对 import/export 都能在磁盘上解析到真实文件；
 *     - 每个 workspace package.json 的 exports / main 目标都存在于磁盘。
 *     含义：当前工作树可被 typecheck / vite / vitest 解析，即「现在能构建」。
 *
 *   Tier 2 · 提交树闭包（reproducible）
 *     - 从 git 索引（= 待提交树）取回每个已跟踪源码的内容，重新解析其导入，
 *       要求每个相对目标都存在于同一棵树中；
 *     - 每个 workspace package.json 的 exports / main 目标都已在树中；
 *     - 正式源码根下不应存在「磁盘有、树里没有」的源码。
 *     含义：换一台机器 check out 这个提交后仍能独立构建，即「可复现」。
 *
 * Tier 2 的缺失目标会区分处置动作：
 *   TREE_DANGLING_ADDABLE  目标磁盘存在但未跟踪 -> git add 即可闭合
 *   TREE_DANGLING_BROKEN   目标磁盘也不存在     -> 必须修掉该导入
 *
 * 用法：
 *   node tools/check-repo-closure.mjs                     # 门禁 = Tier 1，同时打印 Tier 2 清单
 *   node tools/check-repo-closure.mjs --strict            # 门禁 = Tier 1 + Tier 2 闭包（提交树无断裂导入）
 *   node tools/check-repo-closure.mjs --strict-all        # 再加「正式源码根无未跟踪源码」这一类洁净要求
 *   node tools/check-repo-closure.mjs --json              # 机器可读报告
 *   node tools/check-repo-closure.mjs --write-landing F   # 把待落地清单写入文件 F
 *
 * 退出码：0 = 通过；1 = 命中门禁违规。
 *
 * 「闭包」与「洁净」是两件事：
 *   - 闭包（closureOk）：提交树里不存在解析不了的正式导入 / package exports 目标。
 *     这是本守卫的核心要求，可按第四节清单通过 git add 闭合。
 *   - 洁净（hygieneOk）：正式源码根下不再有未纳入版本控制的源码。
 *     受 E0 与 fixture 决策约束，故单独用 --strict-all 约束。
 *
 * 扫描范围（正式源码根）见 SOURCE_ROOTS / ROOT_FILES。
 * 明确不纳入：backups、.agents、examples（静态预览稿）、构建产物
 * （out/release/dist/test-results）、.tmp-* 临时目录与 node_modules。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 正式源码根目录（相对仓库根，POSIX 分隔符） */
export const SOURCE_ROOTS = [
  'packages/contracts/src',
  'packages/core/src',
  'apps/api/src',
  'apps/desktop/src',
  'apps/web/src',
  'tests',
  'tools'
]

/** 根级正式入口/配置文件 */
export const ROOT_FILES = [
  'electron.vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'apps/web/vite.config.ts'
]

/** 不参与闭包判定的路径前缀（相对仓库根，POSIX 分隔符） */
export const EXCLUDED_PREFIXES = [
  'backups/',
  '.agents/',
  '.workbuddy/',
  'examples/',
  'node_modules/',
  'out/',
  'release/',
  'dist/',
  'test-results/',
  'playwright-report/',
  'coverage/',
  '.tmp-'
]

/** 可解析的源码扩展名 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
/** 可作为导入目标的全部扩展名（含样式与数据） */
const TARGET_EXTENSIONS = [...SOURCE_EXTENSIONS, '.json', '.css']

/** workspace 子包所在的分组目录 */
const WORKSPACE_GROUPS = ['packages', 'apps']

// --------------------------------------------------------------------------
// 基础工具
// --------------------------------------------------------------------------

function toPosix(value) {
  return value.split('\\').join('/')
}

function walkFiles(absDir, accumulator = []) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name)
    if (entry.isDirectory()) walkFiles(abs, accumulator)
    else if (entry.isFile()) accumulator.push(abs)
  }
  return accumulator
}

function isExcluded(relPosix) {
  return EXCLUDED_PREFIXES.some((prefix) => relPosix.startsWith(prefix))
}

function isSourceFile(relPosix) {
  return SOURCE_EXTENSIONS.some((ext) => relPosix.endsWith(ext))
}

/** 判断一个仓库相对路径是否属于「正式源码」范围 */
function isOfficialSourcePath(relPosix) {
  if (ROOT_FILES.includes(relPosix)) return true
  return SOURCE_ROOTS.some((root) => relPosix.startsWith(`${root}/`))
}

/** 读取 git 索引（= 待提交树）中的文件清单 */
function readTrackedFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  const set = new Set()
  for (const item of out.split('\u0000')) if (item) set.add(toPosix(item))
  return set
}

/** 批量取回索引中若干路径的内容（= 提交树里的真实内容） */
function readTreeContents(repoRoot, relPaths) {
  const contents = new Map()
  if (relPaths.length === 0) return contents
  const input = relPaths.map((p) => `:${p}`).join('\n') + '\n'
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input,
    maxBuffer: 512 * 1024 * 1024
  })
  const order = []
  let offset = 0
  while (offset < out.length) {
    const nl = out.indexOf(0x0a, offset)
    if (nl === -1) break
    const header = out.toString('utf8', offset, nl)
    offset = nl + 1
    const parts = header.split(' ')
    if (parts.length < 3) break
    const size = Number(parts[2])
    if (!Number.isFinite(size)) break
    order.push(out.toString('utf8', offset, offset + size))
    offset += size + 1
  }
  relPaths.forEach((relPath, index) => {
    if (index < order.length) contents.set(relPath, order[index])
  })
  return contents
}

// --------------------------------------------------------------------------
// 导入说明符抽取
// --------------------------------------------------------------------------

const SPECIFIER_PATTERNS = [
  // import ... from 'x' / export ... from 'x'（含 import type / export type）
  /(?:^|[\s;{(=])(?:import|export)\s+[^;'"`]*?from\s*['"]([^'"\n]+)['"]/gm,
  // 动态 import('x')
  /(?:^|[\s;{(=])import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/gm,
  // require('x')
  /(?:^|[\s;{(=])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/gm,
  // 副作用 import 'x'
  /(?:^|[\s;{(=])import\s+['"]([^'"\n]+)['"]/gm
]

function extractSpecifiers(text) {
  const found = new Set()
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) found.add(match[1])
    }
  }
  return [...found]
}

/** 去掉 vite 查询串/哈希，例如 './styles.css?raw' -> './styles.css' */
function stripQuery(specifier) {
  return specifier.split('?')[0].split('#')[0]
}

/** 相对说明符 -> 磁盘候选绝对路径（按解析优先级） */
function diskCandidates(absFromDir, specifier) {
  const base = resolve(absFromDir, specifier)
  const candidates = [base]
  for (const ext of TARGET_EXTENSIONS) candidates.push(base + ext)
  for (const ext of TARGET_EXTENSIONS) candidates.push(join(base, `index${ext}`))
  return candidates
}

/** 相对说明符 -> 提交树候选路径（POSIX，相对仓库根） */
function treeCandidates(fromRelPosix, specifier) {
  const base = toPosix(join(dirname(fromRelPosix), specifier))
  const candidates = [base]
  for (const ext of TARGET_EXTENSIONS) candidates.push(base + ext)
  for (const ext of TARGET_EXTENSIONS) candidates.push(`${base}/index${ext}`)
  return candidates
}

function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function firstInTree(candidates, tracked) {
  for (const candidate of candidates) if (tracked.has(candidate)) return candidate
  return null
}

// --------------------------------------------------------------------------
// workspace package.json 与 exports / main 目标
// --------------------------------------------------------------------------

function loadWorkspacePackages(repoRoot) {
  const packages = []
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(repoRoot, group)
    if (!existsSync(groupDir)) continue
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestRel = `${group}/${entry.name}/package.json`
      const manifestAbs = join(repoRoot, manifestRel)
      if (!existsSync(manifestAbs)) continue
      let json
      try {
        json = JSON.parse(readFileSync(manifestAbs, 'utf8'))
      } catch {
        continue
      }
      if (!json.name) continue
      packages.push({ name: json.name, dir: `${group}/${entry.name}`, manifestRel, json })
    }
  }
  return packages
}

/** 归一化 exports/main/types 字段，返回 [{ subpath, target }] */
function exportEntries(json) {
  const entries = []
  const push = (subpath, target) => {
    if (typeof target === 'string' && target.startsWith('./')) entries.push({ subpath, target })
  }
  const exportsField = json.exports
  if (typeof exportsField === 'string') {
    push('.', exportsField)
  } else if (exportsField && typeof exportsField === 'object') {
    for (const [key, value] of Object.entries(exportsField)) {
      if (typeof value === 'string') push(key, value)
      else if (value && typeof value === 'object') {
        for (const conditionTarget of Object.values(value)) push(key, conditionTarget)
      }
    }
  }
  if (typeof json.main === 'string' && json.main.startsWith('./')) push('(main)', json.main)
  if (typeof json.types === 'string' && json.types.startsWith('./')) push('(types)', json.types)
  return entries
}

/** 把 '@mojing/contracts/schemas' 这类说明符映射到仓库内目标文件 */
function mapPackageSpecifier(specifier, packages) {
  const cleaned = stripQuery(specifier)
  for (const pkg of packages) {
    if (cleaned !== pkg.name && !cleaned.startsWith(`${pkg.name}/`)) continue
    const subpath = cleaned === pkg.name ? '.' : `./${cleaned.slice(pkg.name.length + 1)}`
    const matched = exportEntries(pkg.json).find((entry) => entry.subpath === subpath)
    return { pkg, subpath, target: matched ? matched.target : null }
  }
  return null
}

// --------------------------------------------------------------------------
// 主审计
// --------------------------------------------------------------------------

/**
 * 审计仓库闭包。
 * @param {{ repoRoot?: string }} [options]
 */
export function auditRepoClosure(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd())
  const tracked = readTrackedFiles(repoRoot)
  const packages = loadWorkspacePackages(repoRoot)

  // ---- 磁盘侧扫描集合：正式源码根 + 根级入口文件 ----
  const diskScanTargets = []
  for (const root of SOURCE_ROOTS) {
    const absRoot = join(repoRoot, root)
    if (!existsSync(absRoot)) continue
    for (const abs of walkFiles(absRoot)) {
      const relPosix = toPosix(relative(repoRoot, abs))
      if (isExcluded(relPosix) || !isSourceFile(relPosix)) continue
      diskScanTargets.push(relPosix)
    }
  }
  for (const relPosix of ROOT_FILES) {
    if (existsSync(join(repoRoot, relPosix))) diskScanTargets.push(relPosix)
  }
  diskScanTargets.sort()

  // ---- 提交树侧扫描集合：从索引取，不依赖磁盘是否存在 ----
  const treeScanTargets = [...tracked]
    .filter((relPosix) => !isExcluded(relPosix) && isSourceFile(relPosix) && isOfficialSourcePath(relPosix))
    .sort()
  const treeContents = readTreeContents(repoRoot, treeScanTargets)

  const tier1Dangling = []
  const treeDanglingAddable = []
  const treeDanglingBroken = []
  const packageTargetMissing = []
  const packageTargetUntracked = []
  const untrackedSources = []
  const worktreeMissing = []
  let edgeCount = 0

  /** Tier 1：判定一条相对导入在磁盘上是否可解析 */
  const inspectDiskRelative = (importerRel, specifier, fromDirAbs) => {
    const cleaned = stripQuery(specifier)
    const diskHit = firstExistingFile(diskCandidates(fromDirAbs, cleaned))
    if (!diskHit) {
      tier1Dangling.push({
        kind: 'DISK_DANGLING',
        file: importerRel,
        specifier,
        detail: '相对导入在磁盘上解析不到任何文件'
      })
    } else {
      edgeCount += 1
    }
  }

  /** Tier 1：判定一条 @mojing/* 说明符在磁盘上是否可解析 */
  const inspectDiskWorkspaceSpecifier = (importerRel, specifier) => {
    const mapped = mapPackageSpecifier(specifier, packages)
    if (!mapped) {
      tier1Dangling.push({
        kind: 'UNKNOWN_WORKSPACE_PACKAGE',
        file: importerRel,
        specifier,
        detail: '未找到对应的 workspace 包'
      })
      return
    }
    if (!mapped.target) {
      tier1Dangling.push({
        kind: 'PACKAGE_EXPORT_UNMAPPED',
        file: importerRel,
        specifier,
        detail: `${mapped.pkg.name} 的 exports 未声明子路径 ${mapped.subpath}`
      })
    }
  }

  /** Tier 2：判定相对导入在提交树中是否可解析 */
  const inspectTreeRelative = (importerRel, specifier) => {
    const cleaned = stripQuery(specifier)
    if (firstInTree(treeCandidates(importerRel, cleaned), tracked)) return
    const fromDirAbs = dirname(join(repoRoot, importerRel))
    const diskHit = firstExistingFile(diskCandidates(fromDirAbs, cleaned))
    const diskRel = diskHit ? toPosix(relative(repoRoot, diskHit)) : null
    const entry = { file: importerRel, specifier, target: diskRel }
    if (diskRel) {
      treeDanglingAddable.push({
        ...entry,
        kind: 'TREE_DANGLING_ADDABLE',
        detail: '目标磁盘存在但未在提交树中；git add 后即可闭合'
      })
    } else {
      treeDanglingBroken.push({
        ...entry,
        kind: 'TREE_DANGLING_BROKEN',
        detail: '目标在磁盘与提交树中都不存在；必须修正该导入'
      })
    }
  }

  /** Tier 2：判定 @mojing/* 说明符在提交树中是否可解析 */
  const inspectTreeWorkspaceSpecifier = (importerRel, specifier) => {
    const mapped = mapPackageSpecifier(specifier, packages)
    if (!mapped || !mapped.target) {
      treeDanglingBroken.push({
        kind: 'PACKAGE_EXPORT_BROKEN',
        file: importerRel,
        specifier,
        detail: mapped
          ? `${mapped.pkg.name} 的 exports 未声明子路径 ${mapped.subpath}`
          : '未找到对应的 workspace 包'
      })
      return
    }
    const targetRel = toPosix(join(mapped.pkg.dir, mapped.target))
    if (!tracked.has(targetRel)) {
      treeDanglingAddable.push({
        kind: 'PACKAGE_EXPORT_NOT_IN_TREE',
        file: importerRel,
        specifier,
        target: targetRel,
        detail: `${mapped.pkg.name} 的 exports 目标不在提交树中`
      })
    }
  }

  for (const relPosix of diskScanTargets) {
    // ---- Tier 1：基于磁盘内容扫描 ----
    const fromDirAbs = dirname(join(repoRoot, relPosix))
    for (const specifier of extractSpecifiers(readFileSync(join(repoRoot, relPosix), 'utf8'))) {
      const cleaned = stripQuery(specifier)
      if (cleaned.startsWith('.')) inspectDiskRelative(relPosix, specifier, fromDirAbs)
      else if (cleaned.startsWith('@mojing/')) inspectDiskWorkspaceSpecifier(relPosix, specifier)
    }

    // ---- 未跟踪的正式源码 ----
    if (!tracked.has(relPosix)) {
      untrackedSources.push({
        kind: 'UNTRACKED_SOURCE',
        file: relPosix,
        detail: '磁盘存在但未被 git 跟踪；若属正式源码必须在本次落地中纳入'
      })
    }
  }

  // ---- Tier 2：基于提交树内容重新解析导入 ----
  for (const relPosix of treeScanTargets) {
    const text = treeContents.get(relPosix)
    if (typeof text !== 'string') continue
    for (const specifier of extractSpecifiers(text)) {
      const cleaned = stripQuery(specifier)
      if (cleaned.startsWith('.')) inspectTreeRelative(relPosix, specifier)
      else if (cleaned.startsWith('@mojing/')) inspectTreeWorkspaceSpecifier(relPosix, specifier)
    }
  }

  // ---- package.json exports / main 自检 ----
  for (const pkg of packages) {
    for (const entry of exportEntries(pkg.json)) {
      const targetRel = toPosix(join(pkg.dir, entry.target))
      const abs = join(repoRoot, targetRel)
      const label = `${entry.subpath} -> ${entry.target}`
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        packageTargetMissing.push({
          kind: 'PACKAGE_TARGET_MISSING',
          file: pkg.manifestRel,
          specifier: label,
          detail: 'package.json exports/main 目标在磁盘上不存在'
        })
        treeDanglingBroken.push({
          kind: 'PACKAGE_TARGET_MISSING',
          file: pkg.manifestRel,
          specifier: label,
          detail: 'package.json exports/main 目标在磁盘与提交树中都不存在'
        })
        continue
      }
      if (!tracked.has(targetRel)) {
        packageTargetUntracked.push({
          kind: 'PACKAGE_TARGET_UNTRACKED',
          file: pkg.manifestRel,
          specifier: label,
          target: targetRel,
          detail: 'package.json exports/main 目标存在但未在提交树中'
        })
      }
    }
  }

  // ---- 已跟踪文件在磁盘上缺失 ----
  for (const relPosix of tracked) {
    if (isExcluded(relPosix)) continue
    if (!isSourceFile(relPosix) && !relPosix.endsWith('.css')) continue
    if (!existsSync(join(repoRoot, relPosix))) worktreeMissing.push(relPosix)
  }

  const byKey = (a, b) =>
    a.file.localeCompare(b.file) || String(a.specifier ?? '').localeCompare(String(b.specifier ?? ''))
  const dedupe = (list) => {
    const seen = new Set()
    const result = []
    for (const item of [...list].sort(byKey)) {
      const key = `${item.kind}|${item.file}|${item.specifier ?? ''}|${item.target ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
    return result
  }

  const addable = dedupe(treeDanglingAddable)
  const broken = dedupe(treeDanglingBroken)
  const untracked = dedupe(untrackedSources)

  /** 待落地清单：磁盘已存在、必须进入提交树才能闭合的文件 */
  const landingWorklist = [
    ...new Set([
      ...addable.map((item) => item.target).filter(Boolean),
      ...packageTargetUntracked.map((item) => item.target).filter(Boolean),
      ...untracked.map((item) => item.file)
    ])
  ]
    .filter((relPosix) => !isExcluded(relPosix))
    .sort()

  return {
    repoRoot,
    trackedCount: tracked.size,
    scannedCount: diskScanTargets.length,
    treeScannedCount: treeScanTargets.length,
    edgeCount,
    tier1: {
      /** 工作树是否可被 typecheck / vite / vitest 解析 */
      ok: tier1Dangling.length === 0 && packageTargetMissing.length === 0,
      dangling: dedupe(tier1Dangling),
      packageTargetMissing
    },
    tier2: {
      /** 提交树里是否存在「解析不了」的正式导入 / package exports 目标 */
      closureOk:
        addable.length === 0 && broken.length === 0 && packageTargetUntracked.length === 0,
      /** 正式源码根下是否还有未纳入版本控制的源码 */
      hygieneOk: untracked.length === 0,
      danglingAddable: addable,
      danglingBroken: broken,
      packageTargetUntracked,
      untrackedSources: untracked
    },
    worktreeMissing: worktreeMissing.sort(),
    landingWorklist
  }
}

// --------------------------------------------------------------------------
// 报告与 CLI
// --------------------------------------------------------------------------

function formatViolation(violation) {
  const target = violation.target ? ` -> ${violation.target}` : ''
  return `  [${violation.kind}] ${violation.file}  «${violation.specifier ?? ''}»${target}\n      ${violation.detail}`
}

export function formatReport(report, strict = false) {
  const lines = []
  lines.push('墨境 · 仓库闭包守卫（阶段 0.5C）')
  lines.push(`仓库根：${report.repoRoot}`)
  lines.push(
    `提交树已跟踪文件：${report.trackedCount}　磁盘扫描：${report.scannedCount}　树内扫描：${report.treeScannedCount}　解析边：${report.edgeCount}`
  )
  lines.push('')

  lines.push(`Tier 1 · 磁盘闭包违规：${report.tier1.dangling.length}`)
  for (const violation of report.tier1.dangling) lines.push(formatViolation(violation))
  lines.push(`Tier 1 · package exports/main 目标缺失：${report.tier1.packageTargetMissing.length}`)
  for (const violation of report.tier1.packageTargetMissing) lines.push(formatViolation(violation))
  lines.push('')

  lines.push(`Tier 2 · 提交树闭包 — 可补加目标：${report.tier2.danglingAddable.length}`)
  for (const violation of report.tier2.danglingAddable) lines.push(formatViolation(violation))
  lines.push(`Tier 2 · 提交树闭包 — 真正断裂：${report.tier2.danglingBroken.length}`)
  for (const violation of report.tier2.danglingBroken) lines.push(formatViolation(violation))
  lines.push(`Tier 2 · package exports 目标未在树中：${report.tier2.packageTargetUntracked.length}`)
  for (const violation of report.tier2.packageTargetUntracked) lines.push(formatViolation(violation))
  lines.push(`Tier 2 · 正式源码根中未跟踪源码：${report.tier2.untrackedSources.length}`)
  for (const violation of report.tier2.untrackedSources) lines.push(formatViolation(violation))
  lines.push('')

  lines.push(`已跟踪但磁盘缺失：${report.worktreeMissing.length}`)
  for (const file of report.worktreeMissing) lines.push(`  [WORKTREE_MISSING] ${file}`)
  lines.push('')

  lines.push(`待落地清单（landingWorklist，共 ${report.landingWorklist.length} 项）：`)
  for (const file of report.landingWorklist) lines.push(`  ${file}`)
  lines.push('')

  lines.push(`结论 Tier 1（现在可构建）：${report.tier1.ok ? 'PASS' : 'FAIL'}`)
  lines.push(
    `结论 Tier 2 闭包（提交树无断裂导入/exports）：${report.tier2.closureOk ? 'PASS' : 'PENDING_LANDING'}`
  )
  lines.push(
    `结论 Tier 2 洁净（正式源码根无未跟踪源码）：${report.tier2.hygieneOk ? 'PASS' : 'PENDING_LANDING'}`
  )
  if (!report.tier1.ok) {
    lines.push('提示：默认门禁由 Tier 1 决定，当前 FAIL，需先修复磁盘悬空导入。')
  } else if (!report.tier2.closureOk && !strict) {
    lines.push('提示：Tier 2 闭包未完成；使用 --strict 时会作为门禁失败。')
  }
  return lines.join('\n')
}

function main(argv) {
  const strict = argv.includes('--strict') || argv.includes('--strict-all')
  const strictAll = argv.includes('--strict-all')
  const json = argv.includes('--json')
  const writeIndex = argv.indexOf('--write-landing')
  const report = auditRepoClosure({ repoRoot: process.cwd() })

  if (writeIndex !== -1 && argv[writeIndex + 1]) {
    writeFileSync(
      resolve(process.cwd(), argv[writeIndex + 1]),
      JSON.stringify({ generatedFrom: 'tools/check-repo-closure.mjs', files: report.landingWorklist }, null, 2) + '\n',
      'utf8'
    )
  }

  process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : formatReport(report, strict) + '\n')

  if (!report.tier1.ok) return 1
  if (strict && !report.tier2.closureOk) return 1
  if (strictAll && !report.tier2.hygieneOk) return 1
  return 0
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2))
}
