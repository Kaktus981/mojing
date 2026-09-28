import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronPackagePath = require.resolve('electron/package.json', { paths: [projectRoot] })
const electronVersion = JSON.parse(await readFile(electronPackagePath, 'utf8')).version
const electronDistPath = process.env.MOJING_ELECTRON_DIST_PATH
  ? resolve(projectRoot, process.env.MOJING_ELECTRON_DIST_PATH)
  : join(dirname(electronPackagePath), 'dist')
const electronExecutable = join(electronDistPath, 'electron.exe')
const electronBuilderCli = require.resolve('electron-builder/cli.js', { paths: [projectRoot] })
const betterSqliteRoot = await realpath(join(projectRoot, 'node_modules', 'better-sqlite3'))
const prebuildInstallCli = require.resolve('prebuild-install/bin.js', { paths: [betterSqliteRoot] })
const nativeBinaryOverride = process.env.MOJING_ELECTRON_NATIVE_BINARY
  ? resolve(projectRoot, process.env.MOJING_ELECTRON_NATIVE_BINARY)
  : undefined
const stagingRoot = await mkdtemp(join(tmpdir(), 'mojing-electron-native-'))
const stagedModuleRoot = join(stagingRoot, 'better-sqlite3')
const stagedBinary = join(stagedModuleRoot, 'build', 'Release', 'better_sqlite3.node')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败，退出码 ${String(result.status)}`)
  }
  return result
}

function excludeInstalledDependencies(sourcePath) {
  const pathWithinModule = relative(betterSqliteRoot, sourcePath)
  if (!pathWithinModule) return true
  const segments = pathWithinModule.split(sep)
  return !segments.includes('node_modules') && segments[0] !== 'build'
}

try {
  console.log(`准备 Electron ${electronVersion} 专用数据库模块……`)
  await mkdir(stagedModuleRoot, { recursive: true })
  await cp(betterSqliteRoot, stagedModuleRoot, {
    recursive: true,
    dereference: true,
    filter: excludeInstalledDependencies
  })

  if (nativeBinaryOverride) {
    const overrideStat = await stat(nativeBinaryOverride)
    if (overrideStat.size === 0) throw new Error('指定的 Electron 专用数据库模块为空。')
    await cp(nativeBinaryOverride, stagedBinary)
    console.log(`使用本地 Electron 数据库模块  bytes=${overrideStat.size}`)
  } else {
    run(process.execPath, [
      prebuildInstallCli,
      '--runtime=electron',
      `--target=${electronVersion}`,
      '--platform=win32',
      '--arch=x64',
      '--force'
    ], { cwd: stagedModuleRoot })
  }

  const nativeStat = await stat(stagedBinary)
  if (nativeStat.size === 0) throw new Error('Electron 专用数据库模块为空。')
  const electronStat = await stat(electronExecutable).catch(() => undefined)
  if (!electronStat || electronStat.size === 0) {
    throw new Error(`缺少 Electron 可执行文件：${electronExecutable}。可设置 MOJING_ELECTRON_DIST_PATH 指向包含 electron.exe 的本地发行目录。`)
  }

  const verifyCode = [
    "const addon = require(process.argv[1])",
    "if (!addon.Database) throw new Error('缺少 Database 导出')",
    "console.log('MOJING_ELECTRON_NATIVE_OK:' + process.versions.modules)"
  ].join(';')
  const verification = spawnSync(electronExecutable, ['-e', verifyCode, stagedBinary], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true
  })
  const verificationOutput = `${verification.stdout ?? ''}\n${verification.stderr ?? ''}`
  if (!verificationOutput.includes('MOJING_ELECTRON_NATIVE_OK:136')) {
    throw new Error(`Electron 数据库模块验证失败：${verificationOutput.trim()}`)
  }

  const builderArgs = [electronBuilderCli, '--win', 'nsis', '--x64']
  if (process.env.MOJING_ELECTRON_DIST_PATH) builderArgs.push(`-c.electronDist=${electronDistPath}`)
  run(process.execPath, builderArgs, {
    env: { ...process.env, MOJING_ELECTRON_NATIVE_BINARY: stagedBinary }
  })

  const packagedBinary = join(
    projectRoot,
    'release',
    'mojing',
    'win-unpacked',
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )
  const packagedStat = await stat(packagedBinary)
  if (packagedStat.size !== nativeStat.size) {
    throw new Error('安装包内的数据库模块与已验证模块大小不一致。')
  }

  console.log('墨境 Windows 安装包已生成，并通过 Electron 原生模块校验。')
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
}
