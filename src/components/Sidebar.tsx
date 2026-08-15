import { MessageSquare, Plus, Settings, Trash2, Clapperboard, Moon, Sun, X } from 'lucide-react'
import type { Conversation } from '@/lib/types'
import { modelLabel } from '@/lib/models'

export type View = 'chat' | 'video'

export function Sidebar({
  view,
  onViewChange,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
  theme,
  onToggleTheme,
  open,
  onClose,
}: {
  view: View
  onViewChange: (v: View) => void
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  open: boolean
  onClose: () => void
}) {
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
        {/* Brand */}
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <div>
            <h1 className="font-display text-[22px] font-semibold leading-none tracking-tight">
              Kimi Studio
            </h1>
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Moonshot AI client
            </p>
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
        </div>

        {/* View switcher */}
        <div className="mx-4 mt-4 flex rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-1">
          {(
            [
              { id: 'chat', label: 'Chat', icon: MessageSquare },
              { id: 'video', label: 'Video', icon: Clapperboard },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                view === tab.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
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
                {conversations.map((c) => (
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
                      <p className="truncate text-[13.5px] font-medium">{c.title || 'Untitled'}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {modelLabel(c.model)} · {new Date(c.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(c.id)
                      }}
                      className="mr-2 hidden rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-destructive group-hover:block"
                      title="Delete chat"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

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
