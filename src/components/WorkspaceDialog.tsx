import { useState } from 'react'
import {
  X, FolderOpen, GitBranch, Loader2, Search, FileCode2, MonitorSmartphone,
} from 'lucide-react'
import { getWorkspaceBridge, type WorkspaceFileEntry } from '@/lib/desktop'
import { formatSize } from '@/lib/files'

export interface WorkspaceSelection {
  rootLabel: string
  files: { path: string; content: string }[]
}

export function WorkspaceDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: (sel: WorkspaceSelection) => void
  onClose: () => void
}) {
  const bridge = getWorkspaceBridge()
  const [folder, setFolder] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [files, setFiles] = useState<WorkspaceFileEntry[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const loadFolder = async (dir: string) => {
    setBusy('Scanning folder…')
    setError('')
    const res = await bridge!.listFiles(dir)
    setBusy(null)
    if (res.error || !res.files) return setError(res.error || 'Could not read folder')
    if (res.files.length === 0) return setError('No readable source files found in that folder')
    setFolder(dir)
    setFiles(res.files)
    setSelected(new Set(res.files.slice(0, 40).map((f) => f.path)))
  }

  const pick = async () => {
    const dir = await bridge!.pickFolder()
    if (dir) await loadFolder(dir)
  }

  const clone = async () => {
    if (!repoUrl.trim()) return
    setBusy('Cloning repository (this can take a minute)…')
    setError('')
    const res = await bridge!.cloneRepo(repoUrl.trim())
    if (res.error || !res.path) {
      setBusy(null)
      return setError(res.error || 'Clone failed — is git installed?')
    }
    await loadFolder(res.path)
  }

  const confirm = async () => {
    if (!files) return
    const paths = files.filter((f) => selected.has(f.path)).map((f) => f.path)
    if (paths.length === 0) return
    setBusy('Reading files…')
    const contents = await bridge!.readFiles(folder, paths)
    setBusy(null)
    const ok = contents.filter((c) => c.content) as { path: string; content: string }[]
    if (ok.length === 0) return setError('Could not read the selected files')
    onConfirm({ rootLabel: folder.split(/[\\/]/).pop() || folder, files: ok })
  }

  const visible = (files ?? []).filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="rise-in relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Add code workspace</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <X size={16} />
          </button>
        </div>

        {!bridge ? (
          <div className="px-5 py-8 text-center">
            <MonitorSmartphone size={28} className="mx-auto text-muted-foreground" />
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Code workspaces read files from your computer, so they're available in the
              <strong> desktop app</strong> (Mac / Windows) — not in the browser version.
            </p>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Folder picker */}
            <button
              onClick={pick}
              disabled={!!busy}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <FolderOpen size={18} className="shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-medium">Open a local project folder</span>
                <span className="block text-xs text-muted-foreground">
                  {folder || 'e.g. your XYeed clone — pick any repository on this computer'}
                </span>
              </span>
            </button>

            {/* Clone from git */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <GitBranch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="…or paste a git URL to clone (https://github.com/you/xyeed.git)"
                  className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-3 text-[13px] outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <button
                onClick={clone}
                disabled={!!busy || !repoUrl.trim()}
                className="rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                Clone
              </button>
            </div>

            {busy && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                {busy}
              </p>
            )}
            {error && <p className="text-[13px] text-destructive">{error}</p>}

            {/* File list */}
            {files && (
              <>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter files…"
                      className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-3 text-[13px] outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <button
                    onClick={() =>
                      setSelected(
                        selected.size === files.length
                          ? new Set()
                          : new Set(files.map((f) => f.path)),
                      )
                    }
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
                  >
                    {selected.size === files.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selected.size} of {files.length} files selected — they become context for
                  Kimi (best with the Kimi Code models)
                </p>
                <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                  {visible.map((f) => (
                    <label
                      key={f.path}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(f.path)}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(f.path)
                          else next.delete(f.path)
                          setSelected(next)
                        }}
                        className="accent-[hsl(var(--primary))]"
                      />
                      <FileCode2 size={13} className="shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate font-mono-code text-xs">{f.path}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatSize(f.size)}
                      </span>
                    </label>
                  ))}
                  {visible.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      No files match "{filter}"
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {bridge && files && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={selected.size === 0 || !!busy}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              Attach {selected.size} file{selected.size === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
