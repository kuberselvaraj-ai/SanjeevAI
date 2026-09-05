/** Bridge to Electron main-process capabilities (undefined in a plain browser). */

export interface WorkspaceFileEntry {
  path: string
  size: number
}

export interface WorkspaceFileContent {
  path: string
  content?: string
  error?: string
}

interface WorkspaceBridge {
  pickFolder: () => Promise<string | null>
  listFiles: (dir: string) => Promise<{ files?: WorkspaceFileEntry[]; error?: string }>
  readFiles: (dir: string, paths: string[]) => Promise<WorkspaceFileContent[]>
  cloneRepo: (url: string) => Promise<{ path?: string; existed?: boolean; error?: string }>
}

declare global {
  interface Window {
    kimiStudio?: {
      platform: string
      versions: { electron: string; chrome: string }
      workspace?: WorkspaceBridge
    }
  }
}

export function getWorkspaceBridge(): WorkspaceBridge | null {
  return typeof window !== 'undefined' ? window.kimiStudio?.workspace ?? null : null
}

/** Inside the Electron shell (online or offline) — native extras available. */
export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.kimiStudio

/**
 * Offline/BYOK desktop mode: the Electron shell loaded the LOCAL bundle
 * (file://), so there's no server account — keys live on the device.
 * When the shell loads the hosted app over https, the bridge exists but the
 * app is fully hosted: sign-in, cloud vault, connectors, usage all sync.
 */
export const isDesktop = (): boolean =>
  isElectron() && typeof window !== 'undefined' && window.location.protocol === 'file:'
