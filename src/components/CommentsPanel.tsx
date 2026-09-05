import { useEffect, useRef, useState } from 'react'
import {
  CheckCheck,
  MessageSquareQuote,
  MessagesSquare,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import type { AnchorComment } from '@/lib/types'

export interface DraftAnchor {
  messageId: string
  quote: string
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

function ReplyBox({
  placeholder,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string
  autoFocus?: boolean
  onSubmit: (text: string) => void
  onCancel?: () => void
}) {
  const [text, setText] = useState('')
  const submit = () => {
    const v = text.trim()
    if (!v) return
    onSubmit(v)
    setText('')
  }
  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') onCancel?.()
        }}
        rows={2}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full resize-none rounded-lg border border-border bg-background/60 px-2.5 py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        )}
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Send size={11} />
          Post
        </button>
      </div>
    </div>
  )
}

function Thread({
  comment,
  onReply,
  onResolve,
  onDelete,
  onAsk,
}: {
  comment: AnchorComment
  onReply: (id: string, text: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
  onAsk: (comment: AnchorComment) => void
}) {
  const [replying, setReplying] = useState(false)
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 transition-colors ${
        comment.resolved
          ? 'border-border/60 bg-card/40 opacity-60'
          : 'border-border bg-card'
      }`}
    >
      <blockquote className="border-l-2 pl-2.5 text-[12px] leading-5 text-muted-foreground" style={{ borderColor: 'hsl(188 86% 53% / 0.6)' }}>
        <span className="line-clamp-3">“{comment.quote}”</span>
      </blockquote>
      <div className="mt-2 space-y-2">
        {comment.entries.map((e) => (
          <div key={e.id} className="text-[13px] leading-5">
            <p className="whitespace-pre-wrap">{e.text}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/60">{timeAgo(e.createdAt)}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-0.5 border-t border-border/60 pt-1.5">
        <button
          onClick={() => setReplying(!replying)}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Reply
        </button>
        <button
          onClick={() => onAsk(comment)}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
          title="Send this quote + comment into the chat as a follow-up"
        >
          Ask in chat
        </button>
        <span className="flex-1" />
        <button
          onClick={() => onResolve(comment.id)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={comment.resolved ? 'Reopen thread' : 'Mark resolved'}
        >
          {comment.resolved ? <RotateCcw size={13} /> : <CheckCheck size={13} />}
        </button>
        <button
          onClick={() => onDelete(comment.id)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Delete thread"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {replying && (
        <ReplyBox
          placeholder="Reply in this thread…"
          autoFocus
          onSubmit={(t) => {
            onReply(comment.id, t)
            setReplying(false)
          }}
          onCancel={() => setReplying(false)}
        />
      )}
    </div>
  )
}

export function CommentsPanel({
  comments,
  draftAnchor,
  onSubmitDraft,
  onCancelDraft,
  onReply,
  onResolve,
  onDelete,
  onAsk,
  onClose,
}: {
  comments: AnchorComment[]
  /** set when the user just selected text and hit "Comment" — shows the new-thread draft */
  draftAnchor: DraftAnchor | null
  onSubmitDraft: (text: string) => void
  onCancelDraft: () => void
  onReply: (id: string, text: string) => void
  onResolve: (id: string) => void
  onDelete: (id: string) => void
  onAsk: (comment: AnchorComment) => void
  onClose: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const open = comments.filter((c) => !c.resolved)
  const resolved = comments.filter((c) => c.resolved)

  // New draft → scroll to top where the draft card lives.
  useEffect(() => {
    if (draftAnchor) listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [draftAnchor])

  return (
    <aside className="fixed inset-0 z-40 flex w-full shrink-0 flex-col border-l border-border bg-background md:static md:z-auto md:w-80 md:bg-card/30">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
        <MessagesSquare size={15} className="text-primary" />
        <span className="font-telemetry text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          Comms log
        </span>
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          {open.length}
        </span>
        <span className="flex-1" />
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Close comments"
        >
          <X size={14} />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {draftAnchor && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
            <blockquote className="border-l-2 border-primary/60 pl-2.5 text-[12px] leading-5 text-muted-foreground">
              <span className="line-clamp-3">“{draftAnchor.quote}”</span>
            </blockquote>
            <ReplyBox
              placeholder="Comment on this passage…"
              autoFocus
              onSubmit={onSubmitDraft}
              onCancel={onCancelDraft}
            />
          </div>
        )}

        {comments.length === 0 && !draftAnchor && (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <MessageSquareQuote size={22} className="text-muted-foreground/40" />
            <p className="mt-3 text-[13px] font-medium">No comments yet</p>
            <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
              Select any text in a reply and hit <span className="text-primary">Comment</span> —
              the thread stays pinned to that exact spot.
            </p>
          </div>
        )}

        {open.map((c) => (
          <Thread
            key={c.id}
            comment={c}
            onReply={onReply}
            onResolve={onResolve}
            onDelete={onDelete}
            onAsk={onAsk}
          />
        ))}

        {resolved.length > 0 && (
          <>
            <p className="pt-1 font-telemetry text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
              Resolved · {resolved.length}
            </p>
            {resolved.map((c) => (
              <Thread
                key={c.id}
                comment={c}
                onReply={onReply}
                onResolve={onResolve}
                onDelete={onDelete}
                onAsk={onAsk}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
