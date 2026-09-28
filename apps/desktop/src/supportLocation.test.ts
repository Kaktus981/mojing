import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPendingSupportDirectory, currentSupportDirectory, scheduleSupportDirectoryMove } from './supportLocation'

const roots: string[] = []

function fixture(): { userData: string; target: string; defaults: { session: string; logs: string } } {
  const root = mkdtempSync(join(tmpdir(), 'mojing-support-location-'))
  roots.push(root)
  const userData = join(root, 'original')
  const target = join(root, 'new')
  mkdirSync(userData)
  mkdirSync(target)
  mkdirSync(join(userData, 'Local Storage'))
  mkdirSync(join(userData, 'IndexedDB'))
  mkdirSync(join(userData, 'Network'))
  mkdirSync(join(userData, 'Cache'))
  mkdirSync(join(userData, 'logs'))
  writeFileSync(join(userData, 'Local Storage', 'preferences'), 'theme=night')
  writeFileSync(join(userData, 'IndexedDB', 'drafts'), 'unsaved writing')
  writeFileSync(join(userData, 'Network', 'Cookies'), 'session state')
  writeFileSync(join(userData, 'Cache', 'cache-data'), 'discardable')
  writeFileSync(join(userData, 'logs', 'mojing.log'), 'previous log')
  return { userData, target, defaults: { session: userData, logs: join(userData, 'logs') } }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (root.startsWith(join(tmpdir(), 'mojing-support-location-'))) rmSync(root, { recursive: true, force: true })
  }
})

describe('缓存与日志目录迁移', () => {
  it('重启时保留偏好、待恢复草稿和日志副本，仅重建可丢弃缓存', () => {
    const { userData, target, defaults } = fixture()
    scheduleSupportDirectoryMove(userData, target)
    expect(currentSupportDirectory(userData)).toBe(userData)

    const result = applyPendingSupportDirectory(userData, defaults)
    expect(result.error).toBeUndefined()
    expect(result.directory).toBe(target)
    expect(result.sessionDirectory).toBe(join(target, 'session'))
    expect(result.logsDirectory).toBe(join(target, 'logs'))
    expect(readFileSync(join(target, 'session', 'Local Storage', 'preferences'), 'utf8')).toBe('theme=night')
    expect(readFileSync(join(target, 'session', 'IndexedDB', 'drafts'), 'utf8')).toBe('unsaved writing')
    expect(readFileSync(join(target, 'session', 'Network', 'Cookies'), 'utf8')).toBe('session state')
    expect(readFileSync(join(target, 'logs', 'mojing.log'), 'utf8')).toBe('previous log')
    expect(existsSync(join(target, 'session', 'Cache'))).toBe(false)
    expect(readFileSync(join(userData, 'IndexedDB', 'drafts'), 'utf8')).toBe('unsaved writing')
    expect(currentSupportDirectory(userData)).toBe(target)
  })

  it('目标目录被占用时不覆盖，继续使用原目录', () => {
    const { userData, target, defaults } = fixture()
    scheduleSupportDirectoryMove(userData, target)
    mkdirSync(join(target, 'session'))
    writeFileSync(join(target, 'session', 'keep-me'), 'original')

    const result = applyPendingSupportDirectory(userData, defaults)
    expect(result.directory).toBe(userData)
    expect(result.error).toContain('已有文件')
    expect(readFileSync(join(target, 'session', 'keep-me'), 'utf8')).toBe('original')
    expect(currentSupportDirectory(userData)).toBe(userData)
  })

  it('再次迁移时从当前目录复制，保留上一次迁移的日志副本', () => {
    const { userData, target, defaults } = fixture()
    scheduleSupportDirectoryMove(userData, target)
    const first = applyPendingSupportDirectory(userData, defaults)
    expect(first.error).toBeUndefined()

    const next = join(target, '..', 'next')
    mkdirSync(next)
    writeFileSync(join(target, 'session', 'Local Storage', 'preferences'), 'theme=paper')
    scheduleSupportDirectoryMove(userData, next, { session: first.sessionDirectory, logs: first.logsDirectory })
    const second = applyPendingSupportDirectory(userData, { session: first.sessionDirectory, logs: first.logsDirectory })

    expect(second.error).toBeUndefined()
    expect(readFileSync(join(next, 'session', 'Local Storage', 'preferences'), 'utf8')).toBe('theme=paper')
    expect(readFileSync(join(next, 'logs', 'mojing.log'), 'utf8')).toBe('previous log')
    expect(readFileSync(join(target, 'logs', 'mojing.log'), 'utf8')).toBe('previous log')
  })
})
