import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPendingDataDirectory, currentDataDirectory, scheduleDataDirectoryMove } from './dataLocation'

const roots: string[] = []

function fixture(): { userData: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), 'mojing-data-location-'))
  roots.push(root)
  const userData = join(root, 'original')
  const target = join(root, 'new')
  mkdirSync(userData)
  mkdirSync(target)
  const db = new Database(join(userData, 'mojing.db'))
  db.exec('CREATE TABLE novel_projects (id TEXT PRIMARY KEY); INSERT INTO novel_projects VALUES (\'book-1\')')
  db.close()
  writeFileSync(join(userData, 'provider-secrets-v2.json'), '{"key":"example"}')
  return { userData, target }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (root.startsWith(join(tmpdir(), 'mojing-data-location-'))) rmSync(root, { recursive: true, force: true })
  }
})

describe('项目数据目录迁移', () => {
  it('重启时复制并核对数据库与密钥，旧目录仍可回退', async () => {
    const { userData, target } = fixture()
    scheduleDataDirectoryMove(userData, target)
    expect(currentDataDirectory(userData)).toBe(userData)
    expect(await applyPendingDataDirectory(userData)).toEqual({ directory: target })
    expect(currentDataDirectory(userData)).toBe(target)
    expect(existsSync(join(userData, 'mojing.db'))).toBe(true)
    expect(readFileSync(join(target, 'provider-secrets-v2.json'), 'utf8')).toBe('{"key":"example"}')
    const copied = new Database(join(target, 'mojing.db'), { readonly: true })
    expect(copied.prepare('SELECT COUNT(*) AS count FROM novel_projects').get()).toEqual({ count: 1 })
    copied.close()
  })

  it('目标目录已有数据库时不覆盖，仍使用原目录', async () => {
    const { userData, target } = fixture()
    scheduleDataDirectoryMove(userData, target)
    writeFileSync(join(target, 'mojing.db'), 'keep-me')
    const result = await applyPendingDataDirectory(userData)
    expect(result.directory).toBe(userData)
    expect(result.error).toContain('已有墨境数据')
    expect(readFileSync(join(target, 'mojing.db'), 'utf8')).toBe('keep-me')
  })
})
