import { useEffect, useRef } from 'react'
import { Menu, Sparkles, Code2, PenLine, Compass } from 'lucide-react'
import type { Conversation } from '@/lib/types'
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
}: {
  conversation: Conversation | null
  dark: boolean
  onSuggestion: (prompt: string) => void
  onOpenSidebar: () => void
  headerExtra?: React.ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const messages = conversation?.messages ?? []

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.content])

  const empty = messages.length === 0

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
        >
          <Menu size={17} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
          {empty ? 'New conversation' : conversation?.title}
        </h2>
        {headerExtra}
      </header>

      {/* Messages / welcome */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-6 pb-16">
            <span className="font-display flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-semibold text-primary-foreground shadow-md">
              K
            </span>
            <h2 className="font-display mt-6 text-center text-3xl font-semibold tracking-tight md:text-4xl">
              How can I help you today?
            </h2>
            <p className="mt-3 max-w-md text-center text-sm leading-6 text-muted-foreground">
              Chat with Kimi K3, Kimi Code and more — switch models any time from the
              composer below.
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
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl py-4">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} dark={dark} />
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>
    </div>
  )
}
