import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  Calendar,
  ChevronRight,
  Link2,
  Loader2,
  Mail,
  Maximize2,
  Menu,
  MessageSquare,
  Newspaper,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type { VaultFile } from '@/lib/types'
import { formatSize } from '@/lib/files'
import { Markdown } from '@/components/MessageItem'

/**
 * Mission Deck v4 — an executive desktop, not a chat app. The dashboard owns
 * the screen; the AI works in the background. A question asked from the
 * command bar streams its answer into a compact strip just above it, and the
 * AI's proposed next moves land on the dashboard as one-tap action cards.
 * No message list, no "thinking" chrome — the reasoning stays backstage.
 */

/** The live Q&A docked above the command bar. */
export interface DeckExchange {
  question: string
  answer: string
  streaming: boolean
  error?: string
}

interface DeckAction {
  title: string
  prompt: string
}

interface DeckSections {
  gmail?: { from?: string; subject?: string; date?: string; snippet?: string }[] | { error: string }
  calendar?: { summary?: string; start?: string; end?: string; location?: string }[] | { error: string }
  slack?: { id?: string; name?: string; members?: number }[] | { error: string }
  salesforce?: { totalSize?: number; records?: Record<string, unknown>[] } | { error: string }
}

interface LayoutSection {
  id: string
  headline: string
  note?: string
}

const LAYOUT_KEY = 'sanjeev:deck-layout'

const DEFAULT_LAYOUT: LayoutSection[] = [
  { id: 'needs_response', headline: 'Needs your response' },
  { id: 'needs_attention', headline: 'Needs attention' },
  { id: 'in_motion', headline: 'In motion' },
  { id: 'briefs', headline: 'Briefs' },
  { id: 'vault', headline: 'From your vault' },
]

function loadLayout(): LayoutSection[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as LayoutSection[]
    if (!Array.isArray(parsed) || parsed.length < 2) return DEFAULT_LAYOUT
    return parsed
  } catch {
    return DEFAULT_LAYOUT
  }
}

function isErr(v: unknown): v is { error: string } {
  return Boolean(v && typeof v === 'object' && 'error' in (v as object))
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Small source chip so the executive always knows where an item came from. */
function Source({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  )
}

function Section({
  icon: Icon,
  headline,
  note,
  count,
  children,
}: {
  icon: typeof Mail
  headline: string
  note?: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card/60">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon size={14} />
        </span>
        <h2 className="text-[14px] font-semibold">{headline}</h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
            {count}
          </span>
        )}
        {note && (
          <span className="hidden truncate text-[11.5px] text-muted-foreground sm:inline">
            — {note}
          </span>
        )}
      </header>
      <div className="p-2.5">{children}</div>
    </section>
  )
}

function ActionRow({
  source,
  title,
  detail,
  action,
  onAction,
  onOpen,
}: {
  source?: React.ReactNode
  title: string
  detail?: string
  action?: string
  onAction?: () => void
  onOpen?: () => void
}) {
  return (
    <div className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-accent/50">
      {source}
      <button onClick={onOpen ?? onAction} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        {detail && (
          <span className="block truncate text-[11.5px] text-muted-foreground">{detail}</span>
        )}
      </button>
      {action && onAction && (
        <button
          onClick={onAction}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary opacity-90 hover:bg-primary/20 sm:opacity-0 sm:group-hover:opacity-100"
        >
          {action}
          <ChevronRight size={11} />
        </button>
      )}
    </div>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-2 text-[12px] text-muted-foreground/70">{children}</p>
}

function ConnectLine({ provider, onOpenSettings }: { provider: string; onOpenSettings: () => void }) {
  return (
    <button
      onClick={onOpenSettings}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-[12px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    >
      <Link2 size={13} className="shrink-0" />
      Connect {provider} in Settings to light this up
    </button>
  )
}

export function DeckView({
  hosted,
  userName,
  connections,
  vault,
  conversations,
  briefsUnread,
  memories,
  exchange,
  onOpenVault,
  onAsk,
  onOpenSettings,
  onOpenSidebar,
  onContinueChat,
  onOpenBriefs,
  onOpenThread,
  onDismissExchange,
}: {
  hosted: boolean
  userName?: string | null
  connections: { provider: string; label?: string | null }[]
  vault: VaultFile[]
  conversations: { id: string; title: string; updatedAt: number }[]
  briefsUnread: number
  memories: string[]
  exchange: DeckExchange | null
  onOpenVault: () => void
  onAsk: (prompt: string) => void
  onOpenSettings: () => void
  onOpenSidebar: () => void
  onContinueChat: (id: string) => void
  onOpenBriefs: () => void
  onOpenThread: () => void
  onDismissExchange: () => void
}) {
  const [sections, setSections] = useState<DeckSections>({})
  const [loading, setLoading] = useState(false)
  const [layout, setLayout] = useState<LayoutSection[]>(loadLayout)
  const [designing, setDesigning] = useState(false)
  /** AI-proposed next moves for the current exchange, shown on the dash. */
  const [moves, setMoves] = useState<DeckAction[]>([])
  const movesFor = useRef<string | null>(null)
  const prevStreaming = useRef(false)
  const exchangeRef = useRef<DeckExchange | null>(null)
  exchangeRef.current = exchange

  const has = (p: string) => connections.some((c) => c.provider === p)

  // New question → clear last round's moves.
  useEffect(() => {
    setMoves([])
    movesFor.current = null
  }, [exchange?.question])

  // When the answer finishes streaming, ask the AI what the next moves are.
  useEffect(() => {
    const was = prevStreaming.current
    const now = Boolean(exchange?.streaming)
    prevStreaming.current = now
    if (!was || now) return
    const ex = exchangeRef.current
    if (!ex || !ex.answer.trim() || ex.error || movesFor.current === ex.question) return
    movesFor.current = ex.question
    fetch('/api/hosted/deck-actions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ex.question,
        answer: ex.answer,
        connections: connections.map((c) => c.provider),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j?.actions)) setMoves(j.actions as DeckAction[])
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange?.streaming])

  const refresh = () => {
    if (!hosted || connections.length === 0) return
    setLoading(true)
    fetch('/api/connect/deck', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.sections && setSections(j.sections))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [hosted, connections.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const gmail = sections.gmail
  const calendar = sections.calendar
  const slack = sections.slack
  const sf = sections.salesforce

  const unread = Array.isArray(gmail) ? gmail.length : 0
  const events = Array.isArray(calendar) ? calendar.length : 0
  const dealsClosingSoon =
    sf && !isErr(sf) && Array.isArray(sf.records)
      ? sf.records.filter((r) => {
          const d = typeof r.CloseDate === 'string' ? new Date(r.CloseDate).getTime() : NaN
          return Number.isFinite(d) && d - Date.now() < 7 * 86_400_000
        })
      : []
  const dealsOpen = sf && !isErr(sf) && Array.isArray(sf.records) ? sf.records : []

  const designMyDeck = async () => {
    setDesigning(true)
    try {
      const res = await fetch('/api/hosted/deck-design', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memories,
          recentChats: conversations.map((c) => c.title).filter(Boolean),
          connections: connections.map((c) => c.provider),
          counts: {
            unreadEmail: unread,
            upcomingEvents: events,
            openDeals: dealsOpen.length,
            dealsClosingSoon: dealsClosingSoon.length,
            vaultFiles: vault.length,
            unreadBriefs: briefsUnread,
          },
          hour: new Date().getHours(),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        sections?: LayoutSection[]
        error?: string
      }
      if (!res.ok || !j.sections) throw new Error(j.error ?? `failed (${res.status})`)
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(j.sections))
      setLayout(j.sections)
      toast.success('Deck redesigned around your world.')
    } catch (e) {
      toast.error(`Could not design the deck: ${(e as Error).message}`)
    } finally {
      setDesigning(false)
    }
  }

  const resetLayout = () => {
    localStorage.removeItem(LAYOUT_KEY)
    setLayout(DEFAULT_LAYOUT)
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const renderSection = (s: LayoutSection) => {
    switch (s.id) {
      case 'needs_response':
        return (
          <Section key={s.id} icon={Mail} headline={s.headline} note={s.note} count={unread}>
            {loading && !gmail ? (
              <EmptyLine>Checking your inbox…</EmptyLine>
            ) : Array.isArray(gmail) && gmail.length > 0 ? (
              gmail.slice(0, 5).map((m, i) => (
                <ActionRow
                  key={i}
                  source={<Source label="Gmail" tone="bg-orange-500/10 text-orange-400" />}
                  title={m.subject || '(no subject)'}
                  detail={`${m.from ?? ''}${m.snippet ? ` — ${m.snippet.slice(0, 60)}` : ''}`}
                  action="Draft reply"
                  onAction={() =>
                    onAsk(
                      `Draft a reply to the email from ${m.from ?? 'unknown'} with subject "${m.subject ?? ''}". Show me the draft first.`,
                    )
                  }
                />
              ))
            ) : has('google') ? (
              <EmptyLine>Nothing waiting on you — inbox is clear.</EmptyLine>
            ) : (
              <ConnectLine provider="Google" onOpenSettings={onOpenSettings} />
            )}
            {has('slack') && (
              <ActionRow
                source={<Source label="Slack" tone="bg-emerald-500/10 text-emerald-400" />}
                title="Scan Slack for anything awaiting you"
                detail={
                  Array.isArray(slack) ? `${slack.length} channels in your workspace` : undefined
                }
                action="Catch up"
                onAction={() =>
                  onAsk('Catch me up on my Slack channels — anything that needs a reply or a decision?')
                }
              />
            )}
            {unread > 0 && (
              <ActionRow
                title="Triage everything at once"
                detail="Summarize all unread mail, ranked by urgency"
                action="Summarize"
                onAction={() =>
                  onAsk(
                    'Summarize my unread email — sender, subject, and what each needs from me. Flag anything urgent.',
                  )
                }
              />
            )}
          </Section>
        )

      case 'needs_attention':
        return (
          <Section
            key={s.id}
            icon={Calendar}
            headline={s.headline}
            note={s.note}
            count={dealsClosingSoon.length + (events > 0 ? 1 : 0)}
          >
            {Array.isArray(calendar) && calendar.length > 0 ? (
              calendar.slice(0, 3).map((ev, i) => (
                <ActionRow
                  key={i}
                  source={<Source label="Cal" tone="bg-cyan-500/10 text-cyan-400" />}
                  title={ev.summary ?? 'Event'}
                  detail={
                    ev.start
                      ? new Date(ev.start).toLocaleString(undefined, {
                          weekday: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : undefined
                  }
                  action="Prep me"
                  onAction={() =>
                    onAsk(
                      `Prep me for "${ev.summary ?? 'my next meeting'}" — context, talking points, and any related email.`,
                    )
                  }
                />
              ))
            ) : has('google') ? (
              <EmptyLine>No meetings on the horizon.</EmptyLine>
            ) : (
              <ConnectLine provider="Google Calendar" onOpenSettings={onOpenSettings} />
            )}
            {has('salesforce') ? (
              dealsClosingSoon.length > 0 ? (
                dealsClosingSoon.slice(0, 3).map((r, i) => (
                  <ActionRow
                    key={`sf-${i}`}
                    source={<Source label="Deal" tone="bg-sky-500/10 text-sky-400" />}
                    title={String(r.Name ?? 'Opportunity')}
                    detail={`${String(r.StageName ?? '')} · closes ${String(r.CloseDate ?? '')}${
                      typeof r.Amount === 'number' ? ` · $${Math.round(r.Amount).toLocaleString()}` : ''
                    }`}
                    action="Review"
                    onAction={() =>
                      onAsk(
                        `Review the Salesforce opportunity "${String(r.Name ?? '')}" — what will it take to close, and what should I do this week?`,
                      )
                    }
                  />
                ))
              ) : (
                <EmptyLine>No deals closing this week.</EmptyLine>
              )
            ) : (
              <ConnectLine provider="Salesforce" onOpenSettings={onOpenSettings} />
            )}
          </Section>
        )

      case 'in_motion':
        return (
          <Section
            key={s.id}
            icon={MessageSquare}
            headline={s.headline}
            note={s.note}
            count={conversations.length}
          >
            {conversations.length > 0 ? (
              conversations.slice(0, 4).map((c) => (
                <ActionRow
                  key={c.id}
                  source={<Source label="Chat" tone="bg-primary/10 text-primary" />}
                  title={c.title || 'Untitled conversation'}
                  detail={`last active ${timeAgo(c.updatedAt)}`}
                  action="Continue"
                  onAction={() => onContinueChat(c.id)}
                />
              ))
            ) : (
              <EmptyLine>
                No threads in flight — start one from the box below and it shows up here.
              </EmptyLine>
            )}
          </Section>
        )

      case 'briefs':
        return (
          <Section key={s.id} icon={Newspaper} headline={s.headline} note={s.note} count={briefsUnread}>
            {briefsUnread > 0 ? (
              <ActionRow
                source={<Source label="Brief" tone="bg-amber-500/10 text-amber-400" />}
                title={`${briefsUnread} unread briefing${briefsUnread === 1 ? '' : 's'}`}
                detail="Scheduled research landed while you were away"
                action="Read now"
                onAction={onOpenBriefs}
              />
            ) : (
              <EmptyLine>
                No unread briefs. Schedule one in Briefs — the AI works while you sleep.
              </EmptyLine>
            )}
          </Section>
        )

      case 'vault':
        return (
          <Section key={s.id} icon={Archive} headline={s.headline} note={s.note} count={vault.length}>
            {vault.length > 0 ? (
              vault.slice(0, 4).map((f) => (
                <ActionRow
                  key={f.id}
                  source={<Source label="File" tone="bg-amber-500/10 text-amber-400" />}
                  title={f.name}
                  detail={`${formatSize(f.size)} · ${f.tags.slice(0, 2).join(' · ')}`}
                  action="Open vault"
                  onAction={onOpenVault}
                />
              ))
            ) : (
              <EmptyLine>
                Vault is empty — drop files into any chat or upload straight into the vault.
              </EmptyLine>
            )}
          </Section>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 pb-6 pt-5 md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenSidebar}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
            >
              <Menu size={18} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-semibold md:text-2xl">
                {greeting()}
                {userName ? `, ${userName.split(' ')[0]}` : ''}.
              </h1>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{today}</p>
            </div>
            <button
              onClick={resetLayout}
              className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Reset to the default layout"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={designMyDeck}
              disabled={designing}
              className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-[12px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              title="Let the AI arrange this deck around your world"
            >
              {designing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Design my deck
            </button>
            <button
              onClick={refresh}
              className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Refresh all sections"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            </button>
          </div>

          {moves.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Zap size={12} className="text-primary" />
                Your moves
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {moves.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => onAsk(m.prompt)}
                    className="group flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/10"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Zap size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {m.title}
                    </span>
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 space-y-4">{layout.map(renderSection)}</div>
        </div>
      </div>

      {exchange && (
        <AnswerStrip
          exchange={exchange}
          onOpenThread={onOpenThread}
          onDismiss={onDismissExchange}
        />
      )}
      <DeckComposer onAsk={onAsk} compact={Boolean(exchange)} />
    </div>
  )
}

/**
 * The answer dock — a compact strip above the command bar. The AI works in
 * the background: no "thinking" labels, no status chrome, just a hairline
 * pulse until the first words land. The full thread is one tap away.
 */
function AnswerStrip({
  exchange,
  onOpenThread,
  onDismiss,
}: {
  exchange: DeckExchange
  onOpenThread: () => void
  onDismiss: () => void
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // Keep the newest tokens in view while the answer streams in.
  useEffect(() => {
    const el = bodyRef.current
    if (el && exchange.streaming) el.scrollTop = el.scrollHeight
  }, [exchange.answer, exchange.streaming])

  return (
    <div className="border-t border-border bg-card/40 px-4 pt-2.5 md:px-6">
      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        {exchange.streaming && !exchange.answer && !exchange.error && (
          <div className="h-0.5 w-full animate-pulse bg-primary/60" />
        )}
        <div className="flex items-center gap-2 px-4 pt-2.5">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground/70">You · </span>
            {exchange.question}
          </span>
          <button
            onClick={onOpenThread}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open the full thread"
          >
            <Maximize2 size={11} />
            Thread
          </button>
          <button
            onClick={onDismiss}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="max-h-[28vh] overflow-y-auto px-4 pb-3 pt-1 text-[13px] leading-relaxed [&_p]:my-1.5 [&_li]:my-0.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:text-[11.5px]"
        >
          {exchange.error ? (
            <p className="py-1 text-[12.5px] text-destructive">{exchange.error}</p>
          ) : exchange.answer ? (
            <Markdown text={exchange.answer} dark />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** The command bar docked at the bottom — small, single-line, always there. */
function DeckComposer({ onAsk, compact }: { onAsk: (prompt: string) => void; compact: boolean }) {
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.trim()
    if (!t) return
    setText('')
    onAsk(t)
  }
  return (
    <div className={`bg-background/80 backdrop-blur ${compact ? '' : 'border-t border-border'}`}>
      <div className="mx-auto w-full max-w-4xl px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-4 pr-1 shadow-lg focus-within:border-primary/50">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Direct your day — ask, delegate, decide…"
            className="h-8 w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/60"
          />
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
            title="Send — the answer docks right above"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
