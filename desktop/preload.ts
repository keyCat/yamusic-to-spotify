import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'

const desktopApi: DesktopApi = {
  readSettings: () => ipcRenderer.invoke('desktop:read-settings'),
  updateSettings: settings => ipcRenderer.invoke('desktop:update-settings', settings),
  connectSpotify: () => ipcRenderer.invoke('desktop:connect-spotify'),
}
contextBridge.exposeInMainWorld('desktopApi', desktopApi)
