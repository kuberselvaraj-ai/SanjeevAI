import { MessageSquare, Plus, Settings, Trash2, Clapperboard, ImageIcon, Moon, Sun, X, LogOut, ShieldCheck, Search, Pin, PinOff, Pencil, Ghost, CalendarClock, Archive, LayoutGrid } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import type { Conversation } from '@/lib/types'
import { modelLabel } from '@/lib/models'

export type View = 'deck' | 'chat' | 'video' | 'image' | 'briefs'

export interface SidebarUser {
  name?: string | null
  email?: string | null
  role: string
}

export function Sidebar({
  view,
  onViewChange,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onOpenSearch,
  onOpenSettings,
  theme,
  onToggleTheme,
  open,
  onClose,
  hosted = false,
  user = null,
  usageSummary = null,
  briefsUnread = 0,
  onLogout,
  vaultCount,
  onOpenVault,
}: {
  view: View
  onViewChange: (v: View) => void
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string) => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  open: boolean
  onClose: () => void
  hosted?: boolean
  user?: SidebarUser | null
  usageSummary?: string | null
  /** unread scheduled-brief runs — red bubble on the Briefs tab */
  briefsUnread?: number
  onLogout?: () => void
  /** Mission Vault entry point */
  vaultCount?: number
  onOpenVault?: () => void
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const sorted = [...conversations].sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt,
  )
  const commitRename = () => {
    const v = renameDraft.trim()
    if (renamingId && v) onRename(renamingId, v)
    setRenamingId(null)
  }
  return (
    <>
      {/* mobile scrim */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand — mission control mark */}
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <div className="flex items-center gap-2.5">
            <div className="relative h-7 w-7 shrink-0">
              <div className="absolute inset-0 rounded-full border border-sidebar-border" />
              <div className="absolute inset-[3px] rounded-full border border-sidebar-border/60" />
              <div className="radar-sweep absolute inset-0 rounded-full" />
              <div
                className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: '#22d3ee', boxShadow: '0 0 6px #22d3ee' }}
              />
            </div>
            <div>
              <h1 className="font-telemetry text-[13px] font-semibold leading-none tracking-[0.22em]">
                Sanjeev AI
              </h1>
              <p className="mt-1.5 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="led" style={{ color: '#34d399' }} />
                All systems nominal
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent md:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {/* New chat */}
        <div className="px-4 pt-2">
          <button
            onClick={() => {
              onNew()
              onViewChange('chat')
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-sidebar-primary px-4 py-2.5 text-sm font-medium text-sidebar-primary-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus size={16} strokeWidth={2.5} />
            New chat
          </button>
          <div className="mt-2 flex gap-2">
            <button
              onClick={onOpenSearch}
              className="flex flex-1 items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <Search size={14} />
              <span className="flex-1 text-left">Search chats</span>
              <kbd className="rounded border border-sidebar-border px-1 py-0.5 text-[9.5px]">⌘K</kbd>
            </button>
            {onOpenVault && (
              <button
                onClick={onOpenVault}
                className="relative flex items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                title="Mission Vault — your file library"
              >
                <Archive size={15} />
                {vaultCount !== undefined && vaultCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(188_86%_53%)] px-1 text-[9px] font-bold text-[hsl(222_47%_6%)]">
                    {vaultCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* View switcher */}
        <div className="mx-4 mt-4 flex rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-1">
          {(
            [
              ...(hosted ? [{ id: 'deck', label: 'Deck', icon: LayoutGrid } as const] : []),
              { id: 'chat', label: 'Chat', icon: MessageSquare },
              ...(hosted ? [{ id: 'briefs', label: 'Briefs', icon: CalendarClock } as const] : []),
              { id: 'image', label: 'Images', icon: ImageIcon },
              { id: 'video', label: 'Video', icon: Clapperboard },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors ${
                view === tab.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon size={15} className="shrink-0" />
              <span className="truncate">{tab.label}</span>
              {tab.id === 'briefs' && briefsUnread > 0 && (
                <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9.5px] font-semibold text-white">
                  {briefsUnread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Conversation list */}
        <div className="mt-4 flex-1 overflow-y-auto px-3">
          {view === 'chat' && (
            <>
              <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Recent
              </p>
              {conversations.length === 0 && (
                <p className="px-2 py-4 text-[13px] leading-6 text-muted-foreground">
                  No conversations yet.
                  <br />
                  Start a new chat above.
                </p>
              )}
              <div className="space-y-0.5 pb-4">
                {sorted.map((c) => (
                  <div
                    key={c.id}
                    className={`group relative flex cursor-pointer items-center rounded-lg transition-colors ${
                      c.id === activeId
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60'
                    }`}
                    onClick={() => {
                      onSelect(c.id)
                      onClose()
                    }}
                  >
                    <div className="min-w-0 flex-1 px-3 py-2.5">
                      {renamingId === c.id ? (
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRename}
                          autoFocus
                          className="w-full rounded-md border border-primary/40 bg-background px-1.5 py-0.5 text-[13px] outline-none"
                        />
                      ) : (
                        <>
                          <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
                            {c.pinned && <Pin size={11} className="shrink-0 text-primary" />}
                            {c.temp && <Ghost size={11} className="shrink-0 text-primary" />}
                            <span className="truncate">{c.title || 'Untitled'}</span>
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {modelLabel(c.model)} · {new Date(c.updatedAt).toLocaleDateString()}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="mr-2 hidden shrink-0 items-center group-hover:flex">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onTogglePin(c.id)
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        title={c.pinned ? 'Unpin' : 'Pin to top'}
                      >
                        {c.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId(c.id)
                          setRenameDraft(c.title)
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(c.id)
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-destructive"
                        title="Delete chat"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Account (hosted mode) */}
        {hosted && user && (
          <div className="border-t border-sidebar-border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {user.name || user.email || 'Account'}
                </p>
                {usageSummary && (
                  <p className="truncate text-[10.5px] text-muted-foreground">{usageSummary}</p>
                )}
              </div>
              {user.role === 'admin' && (
                <Link
                  to="/admin"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  title="Admin dashboard"
                >
                  <ShieldCheck size={15} />
                </Link>
              )}
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  title="Log out"
                >
                  <LogOut size={15} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-3">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings size={15} />
            Settings
          </button>
          <button
            onClick={onToggleTheme}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        </div>
      </aside>
    </>
  )
}
