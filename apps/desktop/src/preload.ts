import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mojingDesktop', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('mojing:app:version'),
  setZoomFactor: (factor: number): Promise<void> => ipcRenderer.invoke('mojing:zoom:set', factor),
  getDataDirectory: (): Promise<string> => ipcRenderer.invoke('mojing:data:current'),
  chooseDataDirectory: (): Promise<'cancelled' | 'restarting'> => ipcRenderer.invoke('mojing:data:choose'),
  getSupportDirectory: (): Promise<string> => ipcRenderer.invoke('mojing:support:current'),
  chooseSupportDirectory: (): Promise<'cancelled' | 'restarting'> => ipcRenderer.invoke('mojing:support:choose'),
  exportDiagnostics: (): Promise<'cancelled' | 'saved'> => ipcRenderer.invoke('mojing:diagnostics:export'),
  clearCache: (): Promise<void> => ipcRenderer.invoke('mojing:cache:clear')
})
