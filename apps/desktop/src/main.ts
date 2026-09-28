import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MojingServer } from '../../api/src/mojingServer'
import { createMojingServer } from '../../api/src/mojingServer'
import { ElectronSecretStore } from './secrets'
import { applyPendingDataDirectory, currentDataDirectory, scheduleDataDirectoryMove } from './dataLocation'
import { applyPendingSupportDirectory, currentSupportDirectory, scheduleSupportDirectoryMove, type SupportLocation } from './supportLocation'
import { loadWindowState, placeWindow, saveWindowState } from './windowState'
import { finishVerifiedUpgrade } from './upgradeRecovery'

let server: MojingServer | undefined
let apiBaseUrl = ''
let sessionToken = ''

// Chromium 会话目录必须在 ready 前切换；其中的偏好与待恢复草稿先离线复制。
const supportUserData = app.getPath('userData')
const supportDefaults = { session: app.getPath('sessionData'), logs: app.getPath('logs') }
let supportMigration: SupportLocation
try {
  supportMigration = applyPendingSupportDirectory(supportUserData, supportDefaults)
  if (supportMigration.custom) {
    app.setPath('sessionData', supportMigration.sessionDirectory)
    app.setAppLogsPath(supportMigration.logsDirectory)
  }
} catch (error) {
  supportMigration = { directory: supportUserData, sessionDirectory: supportDefaults.session, logsDirectory: supportDefaults.logs, custom: false, error: error instanceof Error ? error.message : '缓存与日志目录配置不可用。' }
}

async function startBackend(dataDirectory: string): Promise<void> {
  sessionToken = randomBytes(32).toString('hex')
  server = await createMojingServer({
    databasePath: join(dataDirectory, 'mojing.db'),
    secretStore: new ElectronSecretStore(join(dataDirectory, 'provider-secrets-v2.json')),
    sessionToken,
    allowedOrigin: process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : 'null'
  })
  const address = await server.app.listen({ host: '127.0.0.1', port: 0 })
  apiBaseUrl = address.replace('0.0.0.0', '127.0.0.1')
}

async function createWindow(): Promise<void> {
  const currentWorkArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const savedState = loadWindowState(supportUserData)
  const placement = placeWindow(savedState, screen.getAllDisplays().map((display) => display.workArea), currentWorkArea)
  const displayWorkArea = screen.getDisplayMatching(placement.bounds).workArea
  const window = new BrowserWindow({
    ...placement.bounds,
    minWidth: Math.min(1120, displayWorkArea.width),
    minHeight: Math.min(720, displayWorkArea.height),
    backgroundColor: '#0f0d18',
    title: '墨境',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js')
    }
  })
  if (savedState) {
    window.setBounds(placement.bounds)
    const actual = window.getBounds()
    const difference = {
      x: placement.bounds.x - actual.x,
      y: placement.bounds.y - actual.y,
      width: placement.bounds.width - actual.width,
      height: placement.bounds.height - actual.height
    }
    if (Object.values(difference).some((value) => value !== 0) && Object.values(difference).every((value) => Math.abs(value) <= 10)) {
      window.setBounds({
        x: placement.bounds.x + difference.x,
        y: placement.bounds.y + difference.y,
        width: placement.bounds.width + difference.width,
        height: placement.bounds.height + difference.height
      })
    }
  }
  if (placement.maximized) window.maximize()

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    try {
      saveWindowState(supportUserData, { bounds: window.getNormalBounds(), maximized: window.isMaximized() })
    } catch {
      // 窗口状态不可写时仍允许正常关闭；下次启动会按可用的旧状态或首次规则打开。
    }
  }
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 250)
  }
  window.on('move', scheduleSave)
  window.on('resize', scheduleSave)
  window.on('maximize', scheduleSave)
  window.on('unmaximize', scheduleSave)
  window.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    save()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (current && new URL(url).origin !== new URL(current).origin) event.preventDefault()
  })

  const hash = new URLSearchParams({ mojingApi: apiBaseUrl, mojingToken: sessionToken }).toString()
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

function configureDownloads(): void {
  session.defaultSession.on('will-download', (_event, item, webContents) => {
    item.pause()
    const owner = BrowserWindow.fromWebContents(webContents) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const options = {
      title: '导出小说',
      defaultPath: item.getFilename()
    }
    const selection = owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    void selection.then((result) => {
      if (result.canceled || !result.filePath) {
        item.cancel()
        return
      }
      item.setSavePath(result.filePath)
      item.resume()
    })
  })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  if (supportMigration.error) dialog.showErrorBox('缓存与日志目录迁移未完成', `${supportMigration.error}\n原目录的数据仍在，墨境将继续使用原目录。`)
  ipcMain.handle('mojing:zoom:set', (event, factor: unknown) => {
    if (factor !== 1 && factor !== 1.25 && factor !== 1.5) throw new Error('不支持该缩放比例。')
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('无法找到墨境窗口。')
    owner.webContents.setZoomFactor(factor)
  })
  ipcMain.handle('mojing:app:version', () => app.getVersion())
  ipcMain.handle('mojing:data:current', () => currentDataDirectory(app.getPath('userData')))
  ipcMain.handle('mojing:support:current', () => currentSupportDirectory(supportUserData))
  ipcMain.handle('mojing:support:choose', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('无法找到墨境窗口。')
    const choice = await dialog.showOpenDialog(owner, {
      title: '选择新的缓存与日志目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (choice.canceled || !choice.filePaths[0]) return 'cancelled'
    scheduleSupportDirectoryMove(supportUserData, choice.filePaths[0], {
      session: app.getPath('sessionData'), logs: app.getPath('logs')
    })
    setTimeout(() => { app.relaunch(); app.quit() }, 750)
    return 'restarting'
  })
  ipcMain.handle('mojing:data:choose', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('无法找到墨境窗口。')
    const choice = await dialog.showOpenDialog(owner, {
      title: '选择新的墨境项目数据目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (choice.canceled || !choice.filePaths[0]) return 'cancelled'
    scheduleDataDirectoryMove(app.getPath('userData'), choice.filePaths[0])
    setTimeout(() => {
      void (async () => {
        if (server) {
          await server.app.close()
          server = undefined
        }
        app.relaunch()
        app.quit()
      })().catch((error: unknown) => {
        dialog.showErrorBox('重启未完成', error instanceof Error ? error.message : '请手动重启墨境。')
      })
    }, 750)
    return 'restarting'
  })
  ipcMain.handle('mojing:diagnostics:export', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw new Error('无法找到墨境窗口。')
    const choice = await dialog.showSaveDialog(owner, {
      title: '导出墨境诊断信息',
      defaultPath: `mojing-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (choice.canceled || !choice.filePath) return 'cancelled'
    const report = {
      generatedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      localService: server ? 'running' : 'stopped',
      projectCount: server?.database.listProjects().length ?? null
    }
    await writeFile(choice.filePath, JSON.stringify(report, null, 2), 'utf8')
    return 'saved'
  })
  ipcMain.handle('mojing:cache:clear', async () => {
    await session.defaultSession.clearCache()
  })
  const migration = await applyPendingDataDirectory(app.getPath('userData'))
  if (migration.error) dialog.showErrorBox('数据目录迁移未完成', `${migration.error}\n原目录的数据仍在，墨境将继续使用原目录。`)
  await startBackend(migration.directory)
  configureDownloads()
  await createWindow()
  if (app.isPackaged && process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const recoveryRoot = join(process.env.LOCALAPPDATA, '墨境', 'mojing-upgrade-recovery')
    if (existsSync(join(recoveryRoot, 'latest', 'program')) && !finishVerifiedUpgrade({
      userData: app.getPath('userData'), installDir: dirname(process.execPath), workDir: migration.directory, recoveryRoot
    })) {
      dialog.showErrorBox('升级后作品核对未完成', '旧版程序和升级前作品备份仍已保留。请查看作品；如需回退，可从开始菜单打开“恢复上一版本的墨境”。')
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}).catch((error: unknown) => {
  dialog.showErrorBox('墨境启动失败', error instanceof Error ? error.message : '请检查本机数据目录。')
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (server) void server.app.close()
})
