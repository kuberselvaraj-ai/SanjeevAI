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

export const isDesktop = (): boolean => getWorkspaceBridge() !== null
