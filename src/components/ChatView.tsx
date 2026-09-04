import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Menu,
  Sparkles,
  Code2,
  PenLine,
  Compass,
  Search,
  Download,
  Ghost,
  ChevronDown,
  Wand2,
  Share2,
  Check,
  MessagesSquare,
} from 'lucide-react'
import type { AnchorComment, Conversation } from '@/lib/types'
import type { CodeRunResult } from '@/lib/code'
import { STYLE_PRESETS } from '@/lib/styles'
import { MessageItem } from './MessageItem'
import { CommentsPanel, type DraftAnchor } from './CommentsPanel'

const SUGGESTIONS = [
  {
    icon: Sparkles,
    title: 'Brainstorm ideas',
    prompt: 'Help me brainstorm 10 creative ideas for a weekend side project.',
  },
  {
    icon: Code2,
    title: 'Write code',
    prompt: 'Write a Python function that finds duplicate files in a folder by content hash.',
  },
  {
    icon: PenLine,
    title: 'Draft writing',
    prompt: 'Draft a short, friendly email asking my landlord to fix a leaking kitchen tap.',
  },
  {
    icon: Compass,
    title: 'Explain a concept',
    prompt: 'Explain how transformer attention works, like I am a curious high-schooler.',
  },
]

export function ChatView({
  conversation,
  dark,
  onSuggestion,
  onOpenSidebar,
  headerExtra,
  onRegenerate,
  onEditMessage,
  onSpeak,
  onRunCode,
  onPreview,
  onOpenSearch,
  onExport,
  onShare,
  onToggleTemp,
  onStyleChange,
  comments = [],
  onAddComment,
  onReplyComment,
  onResolveComment,
  onDeleteComment,
  onAskInChat,
}: {
  conversation: Conversation | null
  dark: boolean
  onSuggestion: (prompt: string) => void
  onOpenSidebar: () => void
  headerExtra?: React.ReactNode
  onRegenerate: () => void
  onEditMessage: (id: string, text: string) => void
  onSpeak?: (text: string) => void
  onRunCode?: (code: string) => Promise<CodeRunResult>
  onPreview: (code: string, language: string) => void
  onOpenSearch: () => void
  onExport: () => void
  /** Hosted mode only — publishes a read-only snapshot and copies the link. */
  onShare?: () => Promise<void>
  onToggleTemp: () => void
  onStyleChange: (styleId: string) => void
  /** anchored comment threads for this conversation */
  comments?: AnchorComment[]
  onAddComment?: (messageId: string, quote: string, text: string) => void
  onReplyComment?: (id: string, text: string) => void
  onResolveComment?: (id: string) => void
  onDeleteComment?: (id: string) => void
  onAskInChat?: (comment: AnchorComment) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [shared, setShared] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [draftAnchor, setDraftAnchor] = useState<DraftAnchor | null>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const messages = conversation?.messages ?? []

  // Stable per-message lookups so MessageItem memoization survives streaming.
  const { quotesByMsg, countByMsg } = useMemo(() => {
    const q = new Map<string, string[]>()
    const n = new Map<string, number>()
    for (const c of comments) {
      if (c.resolved) continue
      q.set(c.messageId, [...(q.get(c.messageId) ?? []), c.quote])
      n.set(c.messageId, (n.get(c.messageId) ?? 0) + 1)
    }
    return { quotesByMsg: q, countByMsg: n }
  }, [comments])

  const startComment = (messageId: string, quote: string) => {
    setDraftAnchor({ messageId, quote })
    setCommentsOpen(true)
  }

  // Conversation switch → close any stale draft.
  useEffect(() => {
    setDraftAnchor(null)
  }, [conversation?.id])

  const share = async () => {
    if (!onShare) return
    await onShare()
    setShared(true)
    setTimeout(() => setShared(false), 2000)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.content])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (styleRef.current && !styleRef.current.contains(e.target as Node)) setStyleOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const empty = messages.length === 0
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id
  const style = STYLE_PRESETS.find((s) => s.id === (conversation?.style ?? 'normal'))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-1 border-b border-border px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
        >
          <Menu size={17} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
          {empty ? 'New conversation' : conversation?.title}
        </h2>
        {conversation?.temp && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-primary/50 px-2 py-0.5 text-[10.5px] font-medium text-primary">
            <Ghost size={11} />
            Temporary — not saved
          </span>
        )}
        {headerExtra}

        {/* Style picker */}
        {conversation && (
          <div className="relative shrink-0" ref={styleRef}>
            <button
              onClick={() => setStyleOpen(!styleOpen)}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Response style"
            >
              <Wand2 size={14} />
              <span className="hidden lg:inline">{style?.label ?? 'Normal'}</span>
              <ChevronDown size={12} />
            </button>
            {styleOpen && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Response style
                </div>
                {STYLE_PRESETS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onStyleChange(s.id)
                      setStyleOpen(false)
                    }}
                    className={`block w-full px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                      s.id === style?.id ? 'bg-accent/60' : ''
                    }`}
                  >
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-muted-foreground">{s.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onToggleTemp}
          className={`shrink-0 rounded-lg p-2 transition-colors ${
            conversation?.temp
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title={conversation?.temp ? 'Exit temporary chat' : 'Temporary chat (not saved)'}
        >
          <Ghost size={15} />
        </button>
        {conversation && !empty && onAddComment && (
          <button
            onClick={() => setCommentsOpen(!commentsOpen)}
            className={`relative shrink-0 rounded-lg p-2 transition-colors ${
              commentsOpen
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title="Comms log — anchored comments"
          >
            <MessagesSquare size={15} />
            {comments.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {comments.length}
              </span>
            )}
          </button>
        )}
        {conversation && !empty && (
          <button
            onClick={onExport}
            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Export chat as Markdown"
          >
            <Download size={15} />
          </button>
        )}
        {conversation && !empty && onShare && (
          <button
            onClick={share}
            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Create a public share link"
          >
            {shared ? <Check size={15} className="text-primary" /> : <Share2 size={15} />}
          </button>
        )}
        <button
          onClick={onOpenSearch}
          className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Search chats (⌘K)"
        >
          <Search size={15} />
        </button>
      </header>

      {/* Messages + comms log */}
      <div className="flex min-h-0 flex-1">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-6 pb-16">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 rounded-full border border-border" />
              <div className="absolute inset-[5px] rounded-full border border-border/60" />
              <div className="radar-sweep absolute inset-0 rounded-full" />
              <div
                className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: '#f95e2c', boxShadow: '0 0 14px #f95e2c' }}
              />
            </div>
            <p className="font-telemetry mt-6 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="led" style={{ color: '#34d399' }} />
              Mission ready
            </p>
            <h2 className="font-display mt-3 text-center text-3xl font-semibold tracking-tight md:text-4xl">
              How can I help you today?
            </h2>
            <p className="mt-3 max-w-md text-center text-sm leading-6 text-muted-foreground">
              Chat with Kimi K3, Claude Fable 5.1, GPT-6 Astra and more — Auto mode picks
              the best model for each task, and the conversation continues seamlessly when
              it switches. Attach PDFs, Word docs, spreadsheets or images with the paperclip.
            </p>
            <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => onSuggestion(s.prompt)}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <s.icon size={17} className="mt-0.5 shrink-0 text-primary" />
                  <span>
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground line-clamp-2">
                      {s.prompt}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-8 text-center text-[11px] text-muted-foreground/60">
              ⌘K search chats · ⌘⇧O new chat · hover any message for copy / edit / regenerate
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl py-4">
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                dark={dark}
                isLast={m.id === lastAssistantId}
                quotes={quotesByMsg.get(m.id)}
                commentCount={countByMsg.get(m.id) ?? 0}
                onRegenerate={onRegenerate}
                onEdit={onEditMessage}
                onSpeak={onSpeak}
                onRunCode={onRunCode}
                onPreview={onPreview}
                onStartComment={onAddComment ? startComment : undefined}
                onShowComments={onAddComment ? () => setCommentsOpen(true) : undefined}
              />
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>
      {commentsOpen && onAddComment && (
        <CommentsPanel
          comments={comments}
          draftAnchor={draftAnchor}
          onSubmitDraft={(text) => {
            if (draftAnchor) onAddComment(draftAnchor.messageId, draftAnchor.quote, text)
            setDraftAnchor(null)
          }}
          onCancelDraft={() => setDraftAnchor(null)}
          onReply={(id, text) => onReplyComment?.(id, text)}
          onResolve={(id) => onResolveComment?.(id)}
          onDelete={(id) => onDeleteComment?.(id)}
          onAsk={(c) => onAskInChat?.(c)}
          onClose={() => {
            setCommentsOpen(false)
            setDraftAnchor(null)
          }}
        />
      )}
      </div>
    </div>
  )
}
