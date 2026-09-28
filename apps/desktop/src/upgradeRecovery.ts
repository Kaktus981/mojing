import Database from 'better-sqlite3'
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

type UpgradePaths = { userData: string; installDir: string; workDir: string; recoveryRoot: string }
type Manifest = { userDataDir: string; installDir: string; workDir: string; files: string[] }

function samePath(left: string, right: string): boolean {
  return isAbsolute(left) && isAbsolute(right) && resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase()
}

function projectCount(path: string): number {
  const database = new Database(path, { readonly: true })
  try {
    if (database.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('作品数据库校验失败。')
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'novel_projects'").get()
    return table ? (database.prepare('SELECT COUNT(*) AS count FROM novel_projects').get() as { count: number }).count : 0
  } finally {
    database.close()
  }
}

/** 仅在新版已启动且作品校验通过后，丢弃暂存的旧程序；作品备份保留供手动恢复。 */
export function finishVerifiedUpgrade(paths: UpgradePaths): boolean {
  if (basename(paths.recoveryRoot) !== 'mojing-upgrade-recovery') return false
  const latest = join(paths.recoveryRoot, 'latest')
  const program = join(latest, 'program')
  const snapshot = join(latest, 'works', 'mojing.db')
  const current = join(paths.workDir, 'mojing.db')
  const manifestPath = join(latest, 'manifest.json')
  if (![program, current, manifestPath].every(existsSync)) return false
  try {
    if (lstatSync(program).isSymbolicLink() || lstatSync(latest).isSymbolicLink()) return false
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
    if (!samePath(manifest.userDataDir, paths.userData) || !samePath(manifest.installDir, paths.installDir) || !samePath(manifest.workDir, paths.workDir)) return false
    if (!Array.isArray(manifest.files) || (manifest.files.includes('mojing.db') && !existsSync(snapshot))) return false
    const oldCount = manifest.files.includes('mojing.db') ? projectCount(snapshot) : 0
    if (oldCount !== projectCount(current)) return false
    rmSync(program, { recursive: true })
    rmSync(join(paths.recoveryRoot, '恢复上一版本.exe'), { force: true })
    const startMenu = process.env.APPDATA && join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', '恢复上一版本的墨境.lnk')
    if (startMenu) rmSync(startMenu, { force: true })
    return true
  } catch {
    return false
  }
}
