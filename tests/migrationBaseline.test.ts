import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const compiledRoots = [
  'apps/api/src',
  'apps/desktop/src',
  'apps/web/src',
  'packages/contracts/src',
  'packages/core/src'
]

const specifierPatterns = [
  /\bfrom\s*['"](\.[^'"]*)['"]/g,
  /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g,
  /\bimport\s+['"](\.[^'"]*)['"]/g
]

const resolutionSuffixes = ['', '.ts', '.tsx', '.mts', '.cts', '.json', '.css', '.svg', '.png', '.scss']

const collectSourceFiles = (root: string): string[] => {
  const absoluteRoot = join(repositoryRoot, root)
  if (!existsSync(absoluteRoot)) return []
  const collected: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (entry.isFile() && (absolute.endsWith('.ts') || absolute.endsWith('.tsx'))) collected.push(absolute)
    }
  }
  walk(absoluteRoot)
  return collected
}

const collectRelativeSpecifiers = (content: string): string[] => {
  const found: string[] = []
  for (const pattern of specifierPatterns) {
    pattern.lastIndex = 0
    let match = pattern.exec(content)
    while (match !== null) {
      const specifier = match[1]
      if (specifier) found.push(specifier)
      match = pattern.exec(content)
    }
  }
  return found
}

const resolveRelativeModule = (importer: string, specifier: string): string | undefined => {
  const base = resolve(dirname(importer), specifier)
  for (const suffix of resolutionSuffixes) {
    const candidate = `${base}${suffix}`
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  for (const indexSuffix of ['.ts', '.tsx']) {
    const candidate = join(base, `index${indexSuffix}`)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

const approvedDeletions = [
  'packages/contracts/src/glossary.ts',
  'packages/contracts/src/import-utils.ts',
  'packages/contracts/src/analysis-revision.test.ts',
  'packages/contracts/src/api.ts',
  'packages/contracts/src/editor.ts',
  'packages/core/src/ai/context.ts',
  'packages/core/src/ai/context.test.ts',
  'packages/core/src/ai/prompts.ts',
  'packages/core/src/ai/referenceText.ts',
  'packages/core/src/ai/referenceText.test.ts',
  'packages/core/src/ai/editor.ts',
  'packages/core/src/ai/editor.test.ts',
  'packages/core/src/ai/estimate.ts',
  'packages/core/src/ai/estimate.test.ts',
  'packages/core/src/ai/generation.ts',
  'packages/core/src/ai/generation.test.ts',
  'packages/core/src/continuity.ts',
  'packages/core/src/continuity.test.ts',
  'packages/core/src/db/database.ts',
  'packages/core/src/db/schema.ts',
  'packages/core/src/exporter.ts',
  'packages/core/src/importer.ts',
  'packages/core/src/media.ts',
  'packages/core/src/media.test.ts',
  'packages/core/src/memory.ts',
  'packages/core/src/memory.test.ts',
  'packages/core/src/production.ts',
  'packages/core/src/revisionOperations.ts',
  'packages/core/src/revisionOperations.test.ts'
]

describe('迁移基线：编译范围内的相对模块引用必须全部可达', () => {
  it('不存在指向已删除模块的悬空相对导入', () => {
    const unresolved: string[] = []
    for (const root of compiledRoots) {
      for (const file of collectSourceFiles(root)) {
        const content = readFileSync(file, 'utf8')
        for (const specifier of collectRelativeSpecifiers(content)) {
          if (!resolveRelativeModule(file, specifier)) {
            unresolved.push(`${relative(repositoryRoot, file).replace(/\\/g, '/')} → ${specifier}`)
          }
        }
      }
    }
    expect(unresolved).toEqual([])
  })

  it('apps/api 正式入口只暴露 mojingServer', () => {
    const entry = readFileSync(join(repositoryRoot, 'apps/api/src/index.ts'), 'utf8')
    const specifiers = [...entry.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
    expect(specifiers).toEqual(['./mojingServer'])
  })

  it('@mojing/contracts 的 exports 映射不存在悬空路径', () => {
    const manifestPath = join(repositoryRoot, 'packages/contracts/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: Record<string, string> }
    const dangling: string[] = []
    for (const [key, target] of Object.entries(manifest.exports ?? {})) {
      if (!existsSync(resolve(dirname(manifestPath), target))) dangling.push(`${key} → ${target}`)
    }
    expect(dangling).toEqual([])
  })

  it('已批准的旧模块删除未被意外恢复', () => {
    const resurrected = approvedDeletions.filter((path) => existsSync(join(repositoryRoot, path)))
    expect(resurrected).toEqual([])
  })
})
