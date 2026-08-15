const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('kimiStudio', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
})
