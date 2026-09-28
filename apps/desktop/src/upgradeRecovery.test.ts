import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { finishVerifiedUpgrade } from './upgradeRecovery'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { userData: string; install: string; work: string; recovery: string } {
  const root = mkdtempSync(join(tmpdir(), 'mojing-upgrade-recovery-'))
  roots.push(root)
  const userData = join(root, '墨境')
  const install = join(root, 'program')
  const work = join(root, 'works')
  const recovery = join(root, 'mojing-upgrade-recovery')
  mkdirSync(join(recovery, 'latest', 'program'), { recursive: true })
  mkdirSync(join(recovery, 'latest', 'works'), { recursive: true })
  mkdirSync(userData)
  mkdirSync(install)
  mkdirSync(work)
  writeFileSync(join(install, '墨境.exe'), 'new')
  writeFileSync(join(recovery, 'latest', 'program', '墨境.exe'), 'old')
  writeFileSync(join(recovery, '恢复上一版本.exe'), 'setup')
  writeFileSync(join(recovery, 'latest', 'manifest.json'), JSON.stringify({ installDir: install, userDataDir: userData, workDir: work, files: ['mojing.db'] }))
  for (const path of [join(work, 'mojing.db'), join(recovery, 'latest', 'works', 'mojing.db')]) {
    const db = new Database(path)
    db.exec('CREATE TABLE novel_projects (id TEXT PRIMARY KEY); INSERT INTO novel_projects VALUES (\'one\')')
    db.close()
  }
  return { userData, install, work, recovery }
}

describe('verified installer upgrade', () => {
  it('removes staged old program only after the new database matches', () => {
    const { userData, install, work, recovery } = fixture()
    expect(finishVerifiedUpgrade({ userData, installDir: install, workDir: work, recoveryRoot: recovery })).toBe(true)
    expect(existsSync(join(recovery, 'latest', 'program'))).toBe(false)
    expect(existsSync(join(recovery, '恢复上一版本.exe'))).toBe(false)
    expect(existsSync(join(recovery, 'latest', 'works', 'mojing.db'))).toBe(true)
  })

  it('retains rollback if the new database has lost a project', () => {
    const { userData, install, work, recovery } = fixture()
    const db = new Database(join(work, 'mojing.db'))
    db.exec('DELETE FROM novel_projects')
    db.close()
    expect(finishVerifiedUpgrade({ userData, installDir: install, workDir: work, recoveryRoot: recovery })).toBe(false)
    expect(readFileSync(join(recovery, 'latest', 'program', '墨境.exe'), 'utf8')).toBe('old')
    expect(existsSync(join(recovery, '恢复上一版本.exe'))).toBe(true)
  })

  it('accepts an old installation that had no works database', () => {
    const { userData, install, work, recovery } = fixture()
    rmSync(join(recovery, 'latest', 'works', 'mojing.db'))
    writeFileSync(join(recovery, 'latest', 'manifest.json'), JSON.stringify({ installDir: install, userDataDir: userData, workDir: work, files: [] }))
    const db = new Database(join(work, 'mojing.db'))
    db.exec('DELETE FROM novel_projects')
    db.close()
    expect(finishVerifiedUpgrade({ userData, installDir: install, workDir: work, recoveryRoot: recovery })).toBe(true)
    expect(existsSync(join(recovery, 'latest', 'program'))).toBe(false)
  })
})
