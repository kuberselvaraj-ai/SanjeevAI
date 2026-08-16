const { app, BrowserWindow, shell, Menu } = require('electron')
const path = require('path')

const isDev = !!process.env.VITE_DEV_SERVER_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Sanjeev AI',
    backgroundColor: '#f5f0e1',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Open external links (API console, docs) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Diagnostics: surface load failures instead of a silent white screen
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[Sanjeev AI] page failed to load (${code}): ${desc}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Sanjeev AI] renderer crashed:', details.reason)
  })
  // Run with SANJEEV_DEBUG=1 to open DevTools and inspect errors
  if (process.env.SANJEEV_DEBUG === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    )
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
