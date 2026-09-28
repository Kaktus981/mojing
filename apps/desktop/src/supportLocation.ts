import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

type SupportLocationConfig = { current?: string; pending?: string }
type DefaultPaths = { session: string; logs: string }
export type SupportLocation = { directory: string; sessionDirectory: string; logsDirectory: string; custom: boolean; error?: string }

const CONFIG_FILE = 'support-location.json'
const PERSISTENT_SESSION_DIRS = ['Local Storage', 'IndexedDB', 'Session Storage', 'Cookies', 'Network', 'File System', 'WebStorage', 'SharedStorage'] as const

function configPath(userData: string): string { return join(userData, CONFIG_FILE) }

function readConfig(userData: string): SupportLocationConfig {
  const path = configPath(userData)
  if (!existsSync(path)) return {}
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('缓存与日志目录配置损坏。')
  const config = parsed as SupportLocationConfig
  if ((config.current !== undefined && (typeof config.current !== 'string' || !isAbsolute(config.current))) || (config.pending !== undefined && (typeof config.pending !== 'string' || !isAbsolute(config.pending)))) {
    throw new Error('缓存与日志目录不是有效的绝对路径。')
  }
  return config
}

function writeConfig(userData: string, config: SupportLocationConfig): void {
  const path = configPath(userData)
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(config), 'utf8')
  renameSync(temporary, path)
}

function directory(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error('所选目录不存在。')
  return realpathSync(path)
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase()
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return !path.startsWith('..') && !isAbsolute(path)
}

function current(userData: string, defaults: DefaultPaths, config = readConfig(userData)): SupportLocation {
  if (!config.current) return { directory: directory(userData), sessionDirectory: defaults.session, logsDirectory: defaults.logs, custom: false }
  const root = directory(config.current)
  return { directory: root, sessionDirectory: directory(join(root, 'session')), logsDirectory: directory(join(root, 'logs')), custom: true }
}

function ensureEmptyTarget(target: string, source: SupportLocation): void {
  if (within(source.directory, target) || within(source.sessionDirectory, target) || within(source.logsDirectory, target)) {
    throw new Error('请选择与当前目录分开的空目录。')
  }
  if (readdirSync(target).length > 0) throw new Error('目标目录已有文件，请选择空目录，避免覆盖。')
}

function copyEntry(source: string, target: string): void {
  const info = lstatSync(source)
  if (info.isSymbolicLink()) throw new Error('原目录包含链接，已取消迁移。')
  if (info.isDirectory()) {
    mkdirSync(target)
    for (const name of readdirSync(source)) copyEntry(join(source, name), join(target, name))
  } else {
    copyFileSync(source, target, constants.COPYFILE_EXCL)
  }
}

function copyContents(source: string, target: string): void {
  if (!existsSync(source)) return
  if (!statSync(source).isDirectory()) throw new Error('原目录不是文件夹。')
  for (const name of readdirSync(source)) copyEntry(join(source, name), join(target, name))
}

function verifyCopy(source: string, target: string): void {
  if (lstatSync(source).isSymbolicLink()) throw new Error('原目录包含链接，已取消迁移。')
  if (lstatSync(source).isDirectory()) {
    const names = readdirSync(source).sort()
    if (names.join('\0') !== readdirSync(target).sort().join('\0')) throw new Error('目录内容核对失败。')
    for (const name of names) verifyCopy(join(source, name), join(target, name))
  } else if (statSync(source).size !== statSync(target).size || createHash('sha256').update(readFileSync(source)).digest('hex') !== createHash('sha256').update(readFileSync(target)).digest('hex')) {
    throw new Error('文件内容核对失败。')
  }
}

export function currentSupportDirectory(userData: string): string {
  return directory(readConfig(userData).current ?? userData)
}

/** 只记录选择；会话存储必须等到下次进程启动、Electron ready 之前迁移。 */
export function scheduleSupportDirectoryMove(userData: string, targetPath: string, defaults?: DefaultPaths): void {
  const target = directory(targetPath)
  const source = current(userData, defaults ?? { session: userData, logs: join(userData, 'logs') })
  ensureEmptyTarget(target, source)
  writeConfig(userData, { current: source.custom ? source.directory : undefined, pending: target })
}

/** 保留会话中的持久数据与日志；HTTP/GPU 等可重建缓存不复制。 */
export function applyPendingSupportDirectory(userData: string, defaults: DefaultPaths): SupportLocation {
  const config = readConfig(userData)
  const source = current(userData, defaults, config)
  if (!config.pending) return source

  let target: string | undefined
  let createdSession = false
  let createdLogs = false
  try {
    target = directory(config.pending)
    ensureEmptyTarget(target, source)
    const sessionDirectory = join(target, 'session')
    const logsDirectory = join(target, 'logs')
    mkdirSync(sessionDirectory)
    createdSession = true
    mkdirSync(logsDirectory)
    createdLogs = true
    for (const name of PERSISTENT_SESSION_DIRS) {
      const from = join(source.sessionDirectory, name)
      if (!existsSync(from)) continue
      const to = join(sessionDirectory, name)
      copyEntry(from, to)
      verifyCopy(from, to)
    }
    if (existsSync(source.logsDirectory) && !samePath(source.logsDirectory, source.sessionDirectory)) {
      copyContents(source.logsDirectory, logsDirectory)
      verifyCopy(source.logsDirectory, logsDirectory)
    } else if (existsSync(source.logsDirectory)) {
      for (const name of readdirSync(source.logsDirectory).filter((item) => item.endsWith('.log'))) {
        const from = join(source.logsDirectory, name)
        copyEntry(from, join(logsDirectory, name))
        verifyCopy(from, join(logsDirectory, name))
      }
    }
    writeConfig(userData, { current: target })
    return { directory: target, sessionDirectory, logsDirectory, custom: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '目录迁移未完成。'
    let cleanupError = ''
    if (target) {
      const sessionDirectory = join(target, 'session')
      const logsDirectory = join(target, 'logs')
      try {
        if (createdSession && within(target, sessionDirectory)) rmSync(sessionDirectory, { recursive: true, force: true })
        if (createdLogs && within(target, logsDirectory)) rmSync(logsDirectory, { recursive: true, force: true })
      } catch {
        cleanupError = '目标目录可能留下未完成的副本，请手动检查。'
      }
    }
    try { writeConfig(userData, { current: source.custom ? source.directory : undefined }) }
    catch { cleanupError += ' 无法更新迁移记录，下次启动前请检查本机目录。' }
    return { ...source, error: `${reason}${cleanupError ? ` ${cleanupError.trim()}` : ''}` }
  }
}
