import { useParams, Link } from 'react-router'
import { trpc } from '@/providers/trpc'
import { Markdown } from '@/components/MessageItem'
import { modelLabel } from '@/lib/models'
import { store } from '@/lib/storage'

/** Public read-only view of a shared conversation — no login required. */
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>()
  const theme = store.loadSettings().theme
  const query = trpc.share.get.useQuery(
    { slug: slug ?? '' },
    { enabled: Boolean(slug), retry: false },
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-display flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              S
            </span>
            <span className="font-display text-base font-semibold">Sanjeev AI</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              Shared chat
            </span>
          </div>
          <Link
            to="/"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Try Sanjeev AI
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {query.isLoading && (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading shared chat…</p>
        )}
        {query.isError && (
          <div className="py-16 text-center">
            <p className="font-display text-lg font-semibold">Shared chat not found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This link may have been removed or never existed.
            </p>
          </div>
        )}
        {query.data && (
          <>
            <h1 className="font-display mb-1 text-2xl font-semibold">{query.data.title}</h1>
            <p className="mb-8 text-xs text-muted-foreground">
              Shared {new Date(query.data.createdAt).toLocaleDateString()} · read-only snapshot
            </p>
            <div className="space-y-6">
              {query.data.messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5">
                      <p className="whitespace-pre-wrap leading-7">{m.content}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="font-display flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        S
                      </span>
                      {m.model && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {modelLabel(m.model)}
                        </span>
                      )}
                    </div>
                    <Markdown text={m.content} dark={theme === 'dark'} />
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
