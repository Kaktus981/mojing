import Database from 'better-sqlite3'
import { constants, copyFileSync, existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

type DataLocationConfig = { current?: string; pending?: string }

const CONFIG_FILE = 'data-location.json'
const DATABASE_FILE = 'mojing.db'
const SECRETS_FILE = 'provider-secrets-v2.json'

function configPath(userData: string): string { return join(userData, CONFIG_FILE) }

function readConfig(userData: string): DataLocationConfig {
  const file = configPath(userData)
  if (!existsSync(file)) return {}
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('数据目录配置损坏。')
  const config = parsed as DataLocationConfig
  if ((config.current && !isAbsolute(config.current)) || (config.pending && !isAbsolute(config.pending))) {
    throw new Error('数据目录配置不是有效的绝对路径。')
  }
  return config
}

function writeConfig(userData: string, config: DataLocationConfig): void {
  const file = configPath(userData)
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(config), 'utf8')
  renameSync(temporary, file)
}

function directory(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error('所选数据目录不存在。')
  return realpathSync(path)
}

function isSameDirectory(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

function ensureDestinationEmpty(target: string): void {
  if (existsSync(join(target, DATABASE_FILE)) || existsSync(join(target, SECRETS_FILE))) {
    throw new Error('目标目录已有墨境数据，请选择其他空目录，避免覆盖。')
  }
}

export function currentDataDirectory(userData: string): string {
  return directory(readConfig(userData).current ?? userData)
}

/** 只记录意向；真正复制发生在下次进程启动、数据库尚未打开时。 */
export function scheduleDataDirectoryMove(userData: string, targetPath: string): void {
  const source = currentDataDirectory(userData)
  const target = directory(targetPath)
  if (isSameDirectory(source, target)) throw new Error('已经在使用这个目录。')
  ensureDestinationEmpty(target)
  writeConfig(userData, { current: source, pending: target })
}

function projectCount(db: Database.Database): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'novel_projects'").get()
  return table ? (db.prepare('SELECT COUNT(*) AS count FROM novel_projects').get() as { count: number }).count : 0
}

/** 离线复制、核对并切换；失败保留原目录，下次正常从原目录启动。 */
export async function applyPendingDataDirectory(userData: string): Promise<{ directory: string; error?: string }> {
  const config = readConfig(userData)
  const source = directory(config.current ?? userData)
  if (!config.pending) return { directory: source }

  let target: string | undefined
  let wroteDatabase = false
  let wroteSecrets = false
  try {
    target = directory(config.pending)
    if (isSameDirectory(source, target)) throw new Error('新旧目录相同。')
    ensureDestinationEmpty(target)

    const sourceDatabase = join(source, DATABASE_FILE)
    const targetDatabase = join(target, DATABASE_FILE)
    if (existsSync(sourceDatabase)) {
      const original = new Database(sourceDatabase, { readonly: true })
      try {
        wroteDatabase = true
        await original.backup(targetDatabase)
        const copied = new Database(targetDatabase, { readonly: true })
        try {
          if (copied.pragma('integrity_check', { simple: true }) !== 'ok' || projectCount(original) !== projectCount(copied)) {
            throw new Error('新目录数据库校验失败。')
          }
        } finally { copied.close() }
      } finally { original.close() }
    }

    const sourceSecrets = join(source, SECRETS_FILE)
    const targetSecrets = join(target, SECRETS_FILE)
    if (existsSync(sourceSecrets)) {
      copyFileSync(sourceSecrets, targetSecrets, constants.COPYFILE_EXCL)
      wroteSecrets = true
      if (statSync(sourceSecrets).size !== statSync(targetSecrets).size) throw new Error('模型密钥备份校验失败。')
    }

    writeConfig(userData, { current: target })
    return { directory: target }
  } catch (error) {
    if (target) {
      if (wroteDatabase) rmSync(join(target, DATABASE_FILE), { force: true })
      if (wroteSecrets) rmSync(join(target, SECRETS_FILE), { force: true })
    }
    writeConfig(userData, { current: source })
    return { directory: source, error: error instanceof Error ? error.message : '复制失败。' }
  }
}
