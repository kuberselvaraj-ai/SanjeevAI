const { app, BrowserWindow, shell, Menu, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

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

// ── Code workspace (local folders & git repos) ──────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'release', 'out', '.next',
  'coverage', '.turbo', '.cache', '.vscode', '.idea', '__pycache__',
])
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css',
  '.html', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sql',
  '.yaml', '.yml', '.toml', '.sh', '.txt', '.vue', '.svelte', '.prisma',
])
const MAX_FILES = 800
const MAX_FILE_BYTES = 200 * 1024

function walk(dir, base, out) {
  if (out.length >= MAX_FILES) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, base, out)
    } else {
      if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue
      try {
        const st = fs.statSync(full)
        if (st.size <= MAX_FILE_BYTES) {
          out.push({ path: path.relative(base, full), size: st.size })
        }
      } catch {
        // unreadable — skip
      }
    }
  }
}

ipcMain.handle('workspace:pickFolder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('workspace:listFiles', (_e, dir) => {
  if (typeof dir !== 'string' || !fs.existsSync(dir)) return { error: 'Folder not found' }
  const out = []
  walk(dir, dir, out)
  return { files: out }
})

ipcMain.handle('workspace:readFiles', (_e, dir, relPaths) => {
  if (!Array.isArray(relPaths)) return []
  return relPaths.slice(0, 60).map((p) => {
    try {
      const full = path.resolve(dir, p)
      if (!full.startsWith(path.resolve(dir) + path.sep)) {
        return { path: p, error: 'Invalid path' }
      }
      return { path: p, content: fs.readFileSync(full, 'utf8') }
    } catch (err) {
      return { path: p, error: String(err) }
    }
  })
})

ipcMain.handle('workspace:cloneRepo', (_e, url) => {
  return new Promise((resolve) => {
    if (typeof url !== 'string' || !/^https:\/\/[\w.-]+\/[\w./-]+$/i.test(url)) {
      return resolve({ error: 'Only https:// git URLs are allowed' })
    }
    const parent = path.join(app.getPath('userData'), 'repos')
    fs.mkdirSync(parent, { recursive: true })
    const name = url.split('/').pop().replace(/\.git$/i, '') || 'repo'
    const dest = path.join(parent, name)
    if (fs.existsSync(path.join(dest, '.git'))) {
      return resolve({ path: dest, existed: true })
    }
    execFile(
      'git',
      ['clone', '--depth', '1', url, dest],
      { timeout: 300000 },
      (err, _stdout, stderr) => {
        if (err) return resolve({ error: (stderr || String(err)).slice(0, 500) })
        resolve({ path: dest })
      },
    )
  })
})

// ── App lifecycle ───────────────────────────────────────────────────────────

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
