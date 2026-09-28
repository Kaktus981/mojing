const { copyFile, mkdir, stat } = require('node:fs/promises')
const { dirname, join } = require('node:path')

module.exports = async function injectElectronNativeModule(context) {
  const source = process.env.MOJING_ELECTRON_NATIVE_BINARY
  if (!source) {
    throw new Error('缺少 Electron 专用 better-sqlite3 暂存文件，已停止生成不可启动的安装包。')
  }

  const destination = join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )

  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)

  const [sourceStat, destinationStat] = await Promise.all([stat(source), stat(destination)])
  if (sourceStat.size !== destinationStat.size) {
    throw new Error('Electron 专用 better-sqlite3 注入后大小不一致，已停止打包。')
  }

  console.log(`  • 已注入 Electron 专用数据库模块  bytes=${destinationStat.size}`)
}
