import { useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Menu,
  MessageSquare,
  Play,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { trpc } from '@/providers/trpc'
import { Markdown } from './MessageItem'
import { Switch } from '@/components/ui/switch'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type ScheduleRow = {
  id: string
  title: string
  prompt: string
  frequency: 'daily' | 'weekly'
  weekday: number | null
  hour: number
  minute: number
  timezone: string
  active: boolean
  nextRunAt: string | Date | null
  lastRunAt: string | Date | null
  unread: number
}

function cadenceLabel(s: Pick<ScheduleRow, 'frequency' | 'weekday' | 'hour' | 'minute'>): string {
  const h12 = s.hour % 12 === 0 ? 12 : s.hour % 12
  const ampm = s.hour < 12 ? 'AM' : 'PM'
  const time = `${h12}:${String(s.minute).padStart(2, '0')} ${ampm}`
  return s.frequency === 'daily' ? `Every day · ${time}` : `${WEEKDAYS[s.weekday ?? 1]}s · ${time}`
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function BriefsView({
  dark,
  onOpenSidebar,
  onOpenInChat,
}: {
  dark: boolean
  onOpenSidebar: () => void
  onOpenInChat: (chat: { title: string; prompt: string; content: string }) => void
}) {
  const utils = trpc.useUtils()
  const schedulesQuery = trpc.schedules.list.useQuery(undefined, { refetchInterval: 15_000 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const schedules = (schedulesQuery.data ?? []) as ScheduleRow[]
  const selected = schedules.find((s) => s.id === selectedId) ?? schedules[0] ?? null

  const runsQuery = trpc.schedules.runs.useQuery(
    { scheduleId: selected?.id ?? '' },
    { enabled: Boolean(selected), refetchInterval: 10_000 },
  )
  const contentQuery = trpc.schedules.runContent.useQuery(
    { runId: selectedRunId ?? 0 },
    { enabled: selectedRunId !== null },
  )

  const invalidate = () => {
    void utils.schedules.list.invalidate()
    void utils.schedules.unreadCount.invalidate()
    if (selected) void utils.schedules.runs.invalidate({ scheduleId: selected.id })
  }

  const createMutation = trpc.schedules.create.useMutation({
    onSuccess: () => {
      setCreating(false)
      invalidate()
    },
  })
  const toggleMutation = trpc.schedules.setActive.useMutation({ onSuccess: invalidate })
  const removeMutation = trpc.schedules.remove.useMutation({
    onSuccess: () => {
      setSelectedId(null)
      setSelectedRunId(null)
      invalidate()
    },
  })
  const runNowMutation = trpc.schedules.runNow.useMutation({ onSuccess: invalidate })
  const feedbackMutation = trpc.schedules.setFeedback.useMutation({
    onSuccess: () => {
      if (selectedRunId !== null)
        void utils.schedules.runContent.invalidate({ runId: selectedRunId })
    },
  })

  // Create-form state
  const [prompt, setPrompt] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly')
  const [weekday, setWeekday] = useState(1)
  const [time, setTime] = useState('09:00')

  const submitCreate = () => {
    const [hour, minute] = time.split(':').map(Number)
    createMutation.mutate({
      prompt: prompt.trim(),
      frequency,
      weekday: frequency === 'weekly' ? weekday : undefined,
      hour,
      minute,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  }

  const openRun = (runId: number) => {
    setSelectedRunId(runId)
    // Marking read happens server-side; refresh badges shortly after.
    setTimeout(invalidate, 800)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent md:hidden"
        >
          <Menu size={18} />
        </button>
        <CalendarClock size={17} className="text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[15px] font-semibold">Scheduled briefs</h1>
          <p className="text-[12px] text-muted-foreground">
            Sanjeev works on these while you sleep — fresh editions land here.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus size={14} />
          New brief
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Schedules list */}
        <div className="w-full max-w-xs shrink-0 overflow-y-auto border-r border-border p-3">
          {schedules.length === 0 && !schedulesQuery.isLoading && (
            <div className="px-3 py-10 text-center">
              <CalendarClock size={28} className="mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-[13px] leading-6 text-muted-foreground">
                No scheduled briefs yet.
                <br />
                Put Sanjeev to work on a recurring
                <br />
                report, tracker, or analysis.
              </p>
            </div>
          )}
          <div className="space-y-1">
            {schedules.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedId(s.id)
                  setSelectedRunId(null)
                }}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selected?.id === s.id ? 'bg-accent' : 'hover:bg-accent/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.title}</span>
                  {s.unread > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {s.unread}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {cadenceLabel(s)}
                  {!s.active && ' · paused'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail pane */}
        <div className="hidden min-w-0 flex-1 flex-col md:flex">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{selected.title}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {cadenceLabel(selected)} · next {fmtDate(selected.nextRunAt)} · last{' '}
                    {fmtDate(selected.lastRunAt)}
                  </div>
                </div>
                <button
                  onClick={() => runNowMutation.mutate({ id: selected.id })}
                  disabled={runNowMutation.isPending}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
                >
                  <Play size={12} />
                  Run now
                </button>
                <Switch
                  checked={selected.active}
                  onCheckedChange={(v) => toggleMutation.mutate({ id: selected.id, active: v })}
                />
                <button
                  onClick={() => {
                    if (confirm('Delete this brief and its history?'))
                      removeMutation.mutate({ id: selected.id })
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="flex min-h-0 flex-1">
                {/* Runs */}
                <div className="w-52 shrink-0 overflow-y-auto border-r border-border p-2.5">
                  {(runsQuery.data ?? []).length === 0 && (
                    <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                      No runs yet — hit “Run now” to see it work.
                    </p>
                  )}
                  {(runsQuery.data ?? []).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => r.status === 'done' && openRun(r.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${
                        selectedRunId === r.id ? 'bg-accent' : 'hover:bg-accent/60'
                      }`}
                    >
                      {r.status === 'running' ? (
                        <Loader2 size={13} className="shrink-0 animate-spin text-primary" />
                      ) : r.status === 'done' ? (
                        <CheckCircle2 size={13} className="shrink-0 text-green-500" />
                      ) : (
                        <span title={r.error ?? ''}>
                          <XCircle size={13} className="shrink-0 text-destructive" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block">{fmtDate(r.createdAt)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {r.status === 'failed' ? (r.error ?? 'failed') : (r.excerpt ?? '')}
                        </span>
                      </span>
                      {r.status === 'done' && !r.readAt && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
                  {selectedRunId === null ? (
                    <p className="py-10 text-center text-[13px] text-muted-foreground">
                      Pick a run to read the brief.
                    </p>
                  ) : contentQuery.isLoading ? (
                    <p className="py-10 text-center text-[13px] text-muted-foreground">Loading…</p>
                  ) : contentQuery.data ? (
                    <div className="mx-auto max-w-2xl">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <span className="text-[12px] text-muted-foreground">
                            {fmtDate(contentQuery.data.createdAt)}
                          </span>
                          {contentQuery.data.refinedBy && (
                            <span className="ml-2 text-[11px] text-muted-foreground/70">
                              · Refined with {contentQuery.data.refinedBy}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {contentQuery.data.status === 'done' && (
                            <>
                              {(['up', 'down'] as const).map((v) => (
                                <button
                                  key={v}
                                  title={v === 'up' ? 'This hit the mark' : 'This missed'}
                                  onClick={() =>
                                    feedbackMutation.mutate({
                                      runId: contentQuery.data.id,
                                      feedback: contentQuery.data.feedback === v ? null : v,
                                    })
                                  }
                                  className={`rounded-lg p-1.5 transition-colors ${
                                    contentQuery.data.feedback === v
                                      ? 'bg-primary/10 text-primary'
                                      : 'text-muted-foreground hover:bg-accent'
                                  }`}
                                >
                                  {v === 'up' ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}
                                </button>
                              ))}
                            </>
                          )}
                          {contentQuery.data.status === 'done' && contentQuery.data.content && (
                            <button
                              onClick={() =>
                                onOpenInChat({
                                  title: selected.title,
                                  prompt: selected.prompt,
                                  content: contentQuery.data.content ?? '',
                                })
                              }
                              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium hover:bg-accent"
                            >
                              <MessageSquare size={12} />
                              Continue in chat
                            </button>
                          )}
                        </div>
                      </div>
                      {contentQuery.data.status === 'failed' ? (
                        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                          {contentQuery.data.error ?? 'This run failed.'}
                        </p>
                      ) : (
                        <Markdown text={contentQuery.data.content ?? ''} dark={dark} />
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
              Select a brief — or create your first one.
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/45" onClick={() => setCreating(false)} />
          <div className="rise-in relative w-full max-w-md rounded-2xl border border-border bg-popover shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-display text-lg font-semibold">New scheduled brief</h2>
              <button
                onClick={() => setCreating(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1.5 block text-[13px] font-medium">
                  What should Sanjeev deliver?
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="e.g. Every week, research the top developments in solid-state batteries and write a one-page brief with a chart of notable funding rounds."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[13px] font-medium">How often</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly')}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily</option>
                  </select>
                </div>
                {frequency === 'weekly' && (
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-medium">On</label>
                    <select
                      value={weekday}
                      onChange={(e) => setWeekday(Number(e.target.value))}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none"
                    >
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex-1">
                  <label className="mb-1.5 block text-[13px] font-medium">At</label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none"
                  />
                </div>
              </div>
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                Runs in your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Each run
                uses the full pipeline — fresh research, computed charts, generated visuals — and
                counts toward your plan usage.
              </p>
              <button
                onClick={submitCreate}
                disabled={prompt.trim().length < 12 || createMutation.isPending}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Schedule it'}
              </button>
              {createMutation.error && (
                <p className="text-[12px] text-destructive">{createMutation.error.message}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
