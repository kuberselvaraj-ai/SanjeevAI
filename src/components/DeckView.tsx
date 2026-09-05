import { useEffect, useState } from 'react'
import {
  Archive,
  Calendar,
  ChevronRight,
  Cloud,
  Database,
  LayoutGrid,
  Link2,
  Loader2,
  Mail,
  Menu,
  MessageSquare,
  RefreshCw,
  Slack,
} from 'lucide-react'
import type { VaultFile } from '@/lib/types'
import { formatSize } from '@/lib/files'

/**
 * Mission Deck — the executive single screen. Every connected surface
 * (mail, calendar, Slack, Salesforce, vault) on one wall; any tile can
 * hand off to chat or voice for action.
 */

interface DeckSections {
  gmail?: { from?: string; subject?: string; date?: string; snippet?: string }[] | { error: string }
  calendar?: { summary?: string; start?: string; end?: string; location?: string }[] | { error: string }
  slack?: { id?: string; name?: string; members?: number }[] | { error: string }
  salesforce?: { totalSize?: number; records?: Record<string, unknown>[] } | { error: string }
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

function Tile({
  icon: Icon,
  title,
  accent,
  connected,
  onConnect,
  onAsk,
  askLabel,
  children,
}: {
  icon: typeof Mail
  title: string
  accent: string
  connected: boolean
  onConnect?: () => void
  onAsk?: (prompt: string) => void
  askLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-h-44 flex-col overflow-hidden rounded-2xl border border-border bg-card/60">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${accent}`}>
          <Icon size={14} />
        </span>
        <h2 className="text-[13px] font-semibold tracking-wide">{title}</h2>
        <span className="flex-1" />
        {connected && onAsk && askLabel && (
          <button
            onClick={() => onAsk(askLabel)}
            className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
            title="Continue in chat — the assistant can act on this"
          >
            Act on it
            <ChevronRight size={12} />
          </button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {!connected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Link2 size={16} className="text-muted-foreground/40" />
            <p className="text-[11.5px] text-muted-foreground">Not connected</p>
            {onConnect && (
              <button
                onClick={onConnect}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                Connect in Settings
              </button>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

export function DeckView({
  hosted,
  userName,
  connections,
  vault,
  onOpenVault,
  onAsk,
  onOpenSettings,
  onOpenSidebar,
}: {
  hosted: boolean
  userName?: string | null
  connections: { provider: string; label?: string | null }[]
  vault: VaultFile[]
  onOpenVault: () => void
  onAsk: (prompt: string) => void
  onOpenSettings: () => void
  onOpenSidebar: () => void
}) {
  const [sections, setSections] = useState<DeckSections>({})
  const [loading, setLoading] = useState(false)

  const has = (p: string) => connections.some((c) => c.provider === p)

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
  const recentVault = vault.slice(0, 6)

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-5 md:px-6">
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
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {today} — your operations on one screen.
            </p>
          </div>
          <button
            onClick={refresh}
            className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Refresh all tiles"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>

        {/* Quick voice/chat prompts */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            'Summarize my unread email',
            "What's on my calendar today?",
            'Review my sales pipeline',
            'Catch me up on Slack',
          ].map((p) => (
            <button
              key={p}
              onClick={() => onAsk(p)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Tile
            icon={Mail}
            title="Inbox"
            accent="bg-orange-500/10 text-orange-400"
            connected={has('google')}
            onConnect={onOpenSettings}
            onAsk={onAsk}
            askLabel="Summarize my unread email — sender, subject, and what each needs from me."
          >
            {loading && !gmail ? (
              <TileLoading />
            ) : isErr(gmail) ? (
              <TileError msg={gmail.error} />
            ) : Array.isArray(gmail) && gmail.length > 0 ? (
              <ul className="space-y-2">
                {gmail.map((m, i) => (
                  <li key={i} className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                    <p className="truncate text-[12.5px] font-medium">{m.subject || '(no subject)'}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {m.from} · {m.snippet?.slice(0, 80)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <TileEmpty msg="Inbox zero. Nothing unread." />
            )}
          </Tile>

          <Tile
            icon={Calendar}
            title="Schedule"
            accent="bg-cyan-500/10 text-cyan-400"
            connected={has('google')}
            onConnect={onOpenSettings}
            onAsk={onAsk}
            askLabel="Walk me through my schedule for today and tomorrow — what needs preparation?"
          >
            {loading && !calendar ? (
              <TileLoading />
            ) : isErr(calendar) ? (
              <TileError msg={calendar.error} />
            ) : Array.isArray(calendar) && calendar.length > 0 ? (
              <ul className="space-y-2">
                {calendar.map((ev, i) => (
                  <li key={i} className="flex items-baseline gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                    <span className="shrink-0 font-mono-code text-[10.5px] text-cyan-400">
                      {ev.start
                        ? new Date(ev.start).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : '—'}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{ev.summary}</span>
                      {ev.location && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {ev.location}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <TileEmpty msg="Clear runway — no events in the next two days." />
            )}
          </Tile>

          <Tile
            icon={Slack}
            title="Slack"
            accent="bg-emerald-500/10 text-emerald-400"
            connected={has('slack')}
            onConnect={onOpenSettings}
            onAsk={onAsk}
            askLabel="Catch me up on my Slack channels — anything that needs a reply?"
          >
            {loading && !slack ? (
              <TileLoading />
            ) : isErr(slack) ? (
              <TileError msg={slack.error} />
            ) : Array.isArray(slack) && slack.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {slack.slice(0, 14).map((ch) => (
                  <li
                    key={ch.id}
                    className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
                  >
                    <span className="text-foreground">#{ch.name}</span>
                    {typeof ch.members === 'number' && (
                      <span className="ml-1.5 text-[10px]">{ch.members}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <TileEmpty msg="No channels found." />
            )}
          </Tile>

          <Tile
            icon={Database}
            title="Pipeline — Salesforce"
            accent="bg-sky-500/10 text-sky-400"
            connected={has('salesforce')}
            onConnect={onOpenSettings}
            onAsk={onAsk}
            askLabel="Review my open Salesforce opportunities — which deals need attention this week?"
          >
            {loading && !sf ? (
              <TileLoading />
            ) : isErr(sf) ? (
              <TileError msg={sf.error} />
            ) : sf && Array.isArray(sf.records) && sf.records.length > 0 ? (
              <ul className="space-y-1.5">
                <li className="px-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  {sf.totalSize} open opportunities
                </li>
                {sf.records.slice(0, 6).map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {String(r.Name ?? '—')}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {String(r.StageName ?? '')}
                        {r.CloseDate ? ` · closes ${String(r.CloseDate)}` : ''}
                      </span>
                    </span>
                    {typeof r.Amount === 'number' && (
                      <span className="shrink-0 font-mono-code text-[11.5px] text-sky-400">
                        ${Math.round(r.Amount).toLocaleString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <TileEmpty msg="No open opportunities." />
            )}
          </Tile>

          <Tile
            icon={Archive}
            title="Mission Vault"
            accent="bg-amber-500/10 text-amber-400"
            connected={true}
            onAsk={onAsk}
            askLabel="What's in my vault? Summarize my most recent files."
          >
            {recentVault.length > 0 ? (
              <ul className="space-y-1.5">
                {recentVault.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">{f.name}</span>
                      <span className="block text-[10.5px] text-muted-foreground">
                        {formatSize(f.size)} · {f.tags.slice(0, 3).join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <TileEmpty msg="Vault is empty — upload from any chat or the vault dialog." />
            )}
            <button
              onClick={onOpenVault}
              className="mt-2 w-full rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              Open vault
            </button>
          </Tile>

          <Tile
            icon={Cloud}
            title="Talk to Sanjeev"
            accent="bg-primary/10 text-primary"
            connected={true}
            onAsk={onAsk}
            askLabel="Give me my morning briefing: unread email, today's schedule, and anything urgent."
          >
            <p className="px-1 text-[12px] leading-5 text-muted-foreground">
              Everything on this deck is voice-ready. Open voice mode in chat and say what you
              need — <span className="text-foreground">“open my email”</span>,{' '}
              <span className="text-foreground">“draft a reply to the board”</span>,{' '}
              <span className="text-foreground">“move the Acme deal to Closed Won”</span> — and it
              happens here, with your approval before anything goes out.
            </p>
            <div className="mt-2 flex items-center gap-1.5 px-1 text-[10.5px] text-muted-foreground/70">
              <LayoutGrid size={11} />
              {connections.length === 0
                ? 'Connect Google, Slack, or Salesforce in Settings to light up the deck.'
                : `${connections.length} account${connections.length === 1 ? '' : 's'} connected.`}
            </div>
            {connections.length === 0 && (
              <button
                onClick={onOpenSettings}
                className="mt-2 w-full rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
              >
                Connect an account
              </button>
            )}
          </Tile>
        </div>
      </div>
    </div>
  )
}

function TileLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[11.5px] text-muted-foreground">
      <Loader2 size={13} className="animate-spin" />
      Loading…
    </div>
  )
}

function TileError({ msg }: { msg: string }) {
  return (
    <p className="px-1 py-2 text-[11.5px] leading-4 text-muted-foreground">
      <MessageSquare size={11} className="mr-1 inline" />
      {msg}
    </p>
  )
}

function TileEmpty({ msg }: { msg: string }) {
  return <p className="px-1 py-2 text-[11.5px] text-muted-foreground/70">{msg}</p>
}
