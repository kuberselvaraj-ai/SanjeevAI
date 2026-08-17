const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kimiStudio', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  workspace: {
    pickFolder: () => ipcRenderer.invoke('workspace:pickFolder'),
    listFiles: (dir) => ipcRenderer.invoke('workspace:listFiles', dir),
    readFiles: (dir, paths) => ipcRenderer.invoke('workspace:readFiles', dir, paths),
    cloneRepo: (url) => ipcRenderer.invoke('workspace:cloneRepo', url),
  },
})
