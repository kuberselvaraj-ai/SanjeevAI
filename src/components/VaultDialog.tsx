import { useMemo, useRef, useState } from 'react'
import {
  Archive,
  Check,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Paperclip,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { VaultFile, VaultFolder } from '@/lib/types'
import { formatSize } from '@/lib/files'

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

type FolderSel = 'all' | 'unfiled' | number

export function VaultDialog({
  files,
  folders = [],
  onAttach,
  onDelete,
  onClose,
  onUpload,
  onCreateFolder,
  onDeleteFolder,
  onMove,
  onDownload,
  onLoadText,
  onSaveText,
}: {
  files: VaultFile[]
  folders?: VaultFolder[]
  /** attach to the chat's composer — undefined when no chat is active */
  onAttach?: (file: VaultFile) => void
  onDelete: (id: string) => void
  onClose: () => void
  /** cloud vault: upload files straight into the current folder */
  onUpload?: (files: File[], folderId: number | null) => void
  onCreateFolder?: (name: string) => void
  onDeleteFolder?: (id: number) => void
  onMove?: (id: string, folderId: number | null) => void
  onDownload?: (file: VaultFile) => void
  /** load a document's text for editing (cloud vault fetches on demand) */
  onLoadText?: (file: VaultFile) => Promise<string>
  onSaveText?: (file: VaultFile, text: string) => void
}) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [folderSel, setFolderSel] = useState<FolderSel>('all')
  const [newFolder, setNewFolder] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [loadingText, setLoadingText] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  const cloud = Boolean(onCreateFolder)

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of files) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [files])

  const folderDepth = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]))
    const depth = new Map<number, number>()
    for (const f of folders) {
      let d = 0
      let p = f.parentId
      let guard = 0
      while (p != null && byId.has(p) && guard++ < 10) {
        d++
        p = byId.get(p)!.parentId
      }
      depth.set(f.id, d)
    }
    return depth
  }, [folders])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (folderSel === 'unfiled' && f.folderId != null) return false
      if (typeof folderSel === 'number' && f.folderId !== folderSel) return false
      if (tag && !f.tags.includes(tag)) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.tags.some((t) => t.includes(q)) ||
        (f.extractedText ?? '').slice(0, 4000).toLowerCase().includes(q)
      )
    })
  }, [files, query, tag, folderSel])

  const countFor = (sel: FolderSel) =>
    sel === 'all'
      ? files.length
      : sel === 'unfiled'
        ? files.filter((f) => f.folderId == null).length
        : files.filter((f) => f.folderId === sel).length

  const startEdit = async (f: VaultFile) => {
    if (!onLoadText) return
    setEditingId(f.id)
    setEditText('')
    setLoadingText(true)
    try {
      setEditText(await onLoadText(f))
    } catch {
      setEditingId(null)
    } finally {
      setLoadingText(false)
    }
  }

  const folderBtn = (sel: FolderSel, label: string, depth = 0, deletable = false) => (
    <div key={String(sel)} className="group/f relative">
      <button
        onClick={() => setFolderSel(sel)}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        className={`flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-7 text-left text-[12px] transition-colors ${
          folderSel === sel
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        <Folder size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] opacity-60">{countFor(sel)}</span>
      </button>
      {deletable && onDeleteFolder && typeof sel === 'number' && (
        <button
          onClick={() => {
            onDeleteFolder(sel)
            if (folderSel === sel) setFolderSel('all')
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover/f:opacity-100"
          title="Delete folder (files move back to All files)"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[min(620px,88vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Archive size={16} className="text-primary" />
          <span className="text-sm font-semibold">Mission Vault</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {files.length}
          </span>
          {cloud && (
            <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-500">
              cloud
            </span>
          )}
          <span className="flex-1" />
          {onUpload && (
            <>
              <input
                ref={uploadRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const fs = [...(e.target.files ?? [])]
                  if (fs.length > 0)
                    onUpload(fs, typeof folderSel === 'number' ? folderSel : null)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => uploadRef.current?.click()}
                className="flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                title="Upload into the cloud vault — available on every device"
              >
                <Upload size={12} />
                Upload
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>

        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5">
            <Search size={14} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names, tags, and document text…"
              className="w-full bg-transparent py-2 text-[13px] outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />
          </div>
          {allTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
                    tag === t
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {cloud && (
            <div className="flex w-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 md:w-44">
              {folderBtn('all', 'All files')}
              {folderBtn('unfiled', 'Unfiled')}
              {folders.map((f) => folderBtn(f.id, f.name, folderDepth.get(f.id) ?? 0, true))}
              {onCreateFolder && (
                <form
                  className="mt-1 flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const name = newFolder.trim()
                    if (!name) return
                    onCreateFolder(name)
                    setNewFolder('')
                  }}
                >
                  <FolderPlus size={12} className="shrink-0 text-muted-foreground" />
                  <input
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    placeholder="New folder…"
                    className="w-full min-w-0 rounded-md border border-border bg-background/60 px-1.5 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50 focus:border-primary/40"
                  />
                </form>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3">
            {shown.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <Archive size={22} className="text-muted-foreground/40" />
                <p className="mt-3 text-[13px] font-medium">
                  {files.length === 0 ? 'The vault is empty' : 'Nothing matches'}
                </p>
                <p className="mt-1 max-w-xs text-[11.5px] leading-5 text-muted-foreground">
                  {files.length === 0
                    ? cloud
                      ? 'Upload files here or attach them to any chat — they live in the cloud, sync to every device, and never pay extraction twice.'
                      : 'Files you attach to any chat land here automatically — upload once, reuse anywhere, never pay extraction twice.'
                    : 'Try a different search, folder, or clear the tag filter.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {shown.map((f) => (
                  <div key={f.id}>
                    <div className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                      {f.kind === 'image' && f.dataUrl ? (
                        <img
                          src={f.dataUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-lg border border-border object-cover"
                        />
                      ) : (
                        <FileText size={18} className="shrink-0 text-primary" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{f.name}</span>
                        <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                          {formatSize(f.size)} · {f.tags.slice(0, 3).join(' · ')}
                          {f.usedIn.length > 0 &&
                            ` · used in ${f.usedIn.length} ${f.usedIn.length === 1 ? 'chat' : 'chats'}`}
                          {' · '}
                          {timeAgo(f.createdAt)}
                        </span>
                      </span>
                      {onMove && folders.length > 0 && (
                        <select
                          value={f.folderId ?? ''}
                          onChange={(e) =>
                            onMove(f.id, e.target.value === '' ? null : Number(e.target.value))
                          }
                          className="w-20 shrink-0 rounded-md border border-border bg-background px-1 py-1 text-[10.5px] text-muted-foreground outline-none"
                          title="Move to folder"
                        >
                          <option value="">Unfiled</option>
                          {folders.map((fo) => (
                            <option key={fo.id} value={fo.id}>
                              {'—'.repeat(folderDepth.get(fo.id) ?? 0)} {fo.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {f.kind === 'doc' && onLoadText && onSaveText && (f.hasText || f.extractedText) && (
                        <button
                          onClick={() => (editingId === f.id ? setEditingId(null) : startEdit(f))}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="View / edit the extracted text"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {onDownload && (f.hasPayload || f.dataUrl) && (
                        <button
                          onClick={() => onDownload(f)}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Download a copy to this device"
                        >
                          <Download size={13} />
                        </button>
                      )}
                      {onAttach && (
                        <button
                          onClick={() => onAttach(f)}
                          className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                          title="Attach to the current chat — no re-upload, no re-extraction"
                        >
                          <Paperclip size={12} />
                          Attach
                        </button>
                      )}
                      <button
                        onClick={() => onDelete(f.id)}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        title="Remove from vault (chat history keeps its own copy)"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {editingId === f.id && (
                      <div className="mt-1 rounded-xl border border-primary/25 bg-card p-2.5">
                        {loadingText ? (
                          <div className="flex items-center gap-2 px-1 py-3 text-[11.5px] text-muted-foreground">
                            <Loader2 size={13} className="animate-spin" />
                            Loading document text…
                          </div>
                        ) : (
                          <>
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={8}
                              className="w-full resize-y rounded-lg border border-border bg-background/60 p-2 font-mono text-[11.5px] leading-5 outline-none focus:border-primary/40"
                            />
                            <div className="mt-1.5 flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  onSaveText!(f, editText)
                                  setEditingId(null)
                                }}
                                className="flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                              >
                                <Check size={12} />
                                Save to cloud
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="border-t border-border px-4 py-2 text-center text-[10.5px] text-muted-foreground/70">
          {cloud
            ? 'Stored in the cloud — same library on your phone, TV, and desktop. Deduped by content hash; re-attaching costs zero extraction.'
            : 'Deduped by content hash — re-attaching a vaulted file costs zero extraction.'}
        </p>
      </div>
    </div>
  )
}
