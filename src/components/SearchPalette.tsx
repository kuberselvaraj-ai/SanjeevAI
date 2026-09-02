import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MessageSquare, CornerDownLeft } from 'lucide-react'
import type { Conversation } from '@/lib/types'

interface Hit {
  conv: Conversation
  /** matching message snippet, if the match was in message content */
  snippet?: string
}

/**
 * ⌘K / Ctrl-K full-text search across all conversations
 * (titles + message content) — ChatGPT-style chat search.
 */
export function SearchPalette({
  conversations,
  onSelect,
  onClose,
}: {
  conversations: Conversation[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted.slice(0, 12).map((conv) => ({ conv }))
    const out: Hit[] = []
    for (const conv of sorted) {
      if (conv.title.toLowerCase().includes(q)) {
        out.push({ conv })
        continue
      }
      const m = conv.messages.find((msg) => msg.content.toLowerCase().includes(q))
      if (m) {
        const i = m.content.toLowerCase().indexOf(q)
        const start = Math.max(0, i - 40)
        const snippet =
          (start > 0 ? '…' : '') +
          m.content.slice(start, i + q.length + 80).replace(/\n+/g, ' ')
        out.push({ conv, snippet })
      }
      if (out.length >= 12) break
    }
    return out
  }, [conversations, query])

  useEffect(() => setIndex(0), [query])

  const pick = (i: number) => {
    const hit = hits[i]
    if (hit) onSelect(hit.conv.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="rise-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(i + 1, hits.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              }
              if (e.key === 'Enter') pick(index)
            }}
            placeholder="Search chats…"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {hits.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No chats match “{query}”.
            </p>
          )}
          {hits.map((hit, i) => (
            <button
              key={hit.conv.id}
              onClick={() => pick(i)}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
                i === index ? 'bg-accent' : ''
              }`}
            >
              <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {hit.conv.title || 'Untitled'}
                </span>
                {hit.snippet && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {hit.snippet}
                  </span>
                )}
              </span>
              {i === index && (
                <CornerDownLeft size={13} className="shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
