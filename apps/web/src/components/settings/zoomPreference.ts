export type ZoomLevel = '100' | '125' | '150'

declare global {
  interface Window {
    mojingDesktop?: {
      getAppVersion: () => Promise<string>
      setZoomFactor: (factor: number) => Promise<void>
      getDataDirectory: () => Promise<string>
      chooseDataDirectory: () => Promise<'cancelled' | 'restarting'>
      getSupportDirectory: () => Promise<string>
      chooseSupportDirectory: () => Promise<'cancelled' | 'restarting'>
      exportDiagnostics: () => Promise<'cancelled' | 'saved'>
      clearCache: () => Promise<void>
    }
  }
}

const ZOOM_KEY = 'mojing.zoom'

export function parseZoomLevel(value: string | null): ZoomLevel {
  return value === '125' || value === '150' ? value : '100'
}

export function zoomFactor(level: ZoomLevel): number {
  return Number(level) / 100
}

export function readZoomLevel(): ZoomLevel {
  try { return parseZoomLevel(localStorage.getItem(ZOOM_KEY)) } catch { return '100' }
}

export async function setZoomLevel(level: ZoomLevel): Promise<void> {
  if (!window.mojingDesktop) throw new Error('界面缩放仅在墨境桌面版可用。')
  await window.mojingDesktop.setZoomFactor(zoomFactor(level))
  try { localStorage.setItem(ZOOM_KEY, level) } catch { /* 当前会话仍已生效 */ }
}

export async function restoreZoomLevel(): Promise<void> {
  await window.mojingDesktop?.setZoomFactor(zoomFactor(readZoomLevel()))
}
