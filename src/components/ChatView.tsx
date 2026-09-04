import { useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'
import type { Conversation } from '@/lib/types'
import type { CodeRunResult } from '@/lib/code'
import { STYLE_PRESETS } from '@/lib/styles'
import { MessageItem } from './MessageItem'

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
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [shared, setShared] = useState(false)
  const styleRef = useRef<HTMLDivElement>(null)
  const messages = conversation?.messages ?? []

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

      {/* Messages / welcome */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-6 pb-16">
            <span className="font-display flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-md">
              S
            </span>
            <h2 className="font-display mt-6 text-center text-3xl font-semibold tracking-tight md:text-4xl">
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
                onRegenerate={onRegenerate}
                onEdit={onEditMessage}
                onSpeak={onSpeak}
                onRunCode={onRunCode}
                onPreview={onPreview}
              />
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>
    </div>
  )
}
