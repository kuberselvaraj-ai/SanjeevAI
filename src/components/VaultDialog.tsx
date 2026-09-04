import { useMemo, useState } from 'react'
import {
  Archive,
  FileText,
  Paperclip,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { VaultFile } from '@/lib/types'
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

export function VaultDialog({
  files,
  onAttach,
  onDelete,
  onClose,
}: {
  files: VaultFile[]
  /** attach to the chat's composer — undefined when no chat is active */
  onAttach?: (file: VaultFile) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of files) for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  }, [files])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((f) => {
      if (tag && !f.tags.includes(tag)) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.tags.some((t) => t.includes(q)) ||
        (f.extractedText ?? '').slice(0, 4000).toLowerCase().includes(q)
      )
    })
  }, [files, query, tag])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[min(560px,85vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Archive size={16} className="text-primary" />
          <span className="text-sm font-semibold">Mission Vault</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {files.length}
          </span>
          <span className="flex-1" />
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

        <div className="flex-1 overflow-y-auto p-3">
          {shown.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <Archive size={22} className="text-muted-foreground/40" />
              <p className="mt-3 text-[13px] font-medium">
                {files.length === 0 ? 'The vault is empty' : 'Nothing matches'}
              </p>
              <p className="mt-1 max-w-xs text-[11.5px] leading-5 text-muted-foreground">
                {files.length === 0
                  ? 'Files you attach to any chat land here automatically — upload once, reuse anywhere, never pay extraction twice.'
                  : 'Try a different search or clear the tag filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {shown.map((f) => (
                <div
                  key={f.id}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                >
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
              ))}
            </div>
          )}
        </div>

        <p className="border-t border-border px-4 py-2 text-center text-[10.5px] text-muted-foreground/70">
          Deduped by content hash — re-attaching a vaulted file costs zero extraction.
        </p>
      </div>
    </div>
  )
}
