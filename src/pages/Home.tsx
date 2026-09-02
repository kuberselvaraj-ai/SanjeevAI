import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import type { Attachment, ChatMessage, Conversation, ImageJob, Settings, VideoJob } from '@/lib/types'
import { store, uid } from '@/lib/storage'
import { streamChat, type ApiMessage, type MessagePart } from '@/lib/kimi'
import { pollVideoTask } from '@/lib/video'
import { processFile } from '@/lib/files'
import { hostedStreamChat, processFileHosted } from '@/lib/hosted'
import { isDesktop } from '@/lib/desktop'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/models'
import { styleInstruction } from '@/lib/styles'
import { RESEARCH_PROMPT } from '@/lib/research'
import { memoryContext } from '@/lib/memory'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { Sidebar, type View } from '@/components/Sidebar'
import { ChatView } from '@/components/ChatView'
import { Composer } from '@/components/Composer'
import { speakText, transcribeAudio, voiceAvailable } from '@/lib/voice'
import { SettingsDialog } from '@/components/SettingsDialog'
import { VideoView } from '@/components/VideoView'
import { ImageView } from '@/components/ImageView'
import { SearchPalette } from '@/components/SearchPalette'
import { ArtifactPanel, type Artifact } from '@/components/ArtifactPanel'
import { WorkspaceDialog, type WorkspaceSelection } from '@/components/WorkspaceDialog'

export default function Home() {
  // Desktop (Electron) = user-supplied keys, direct API calls.
  // Hosted (browser) = login required, server holds keys, usage is metered.
  const desktop = isDesktop()
  const hosted = !desktop
  const {
    user,
    isLoading: authLoading,
    logout,
  } = useAuth({ redirectOnUnauthenticated: hosted, enabled: hosted })
  const trpcUtils = trpc.useUtils()
  const usageQuery = trpc.usage.mine.useQuery(undefined, {
    enabled: hosted && !!user,
    retry: false,
  })
  const runCodeMutation = trpc.code.run.useMutation()

  // Hosted runs code on the server; desktop runs it with the user's own E2B key.
  const runCode = async (code: string): Promise<CodeRunResult> => {
    if (hosted) {
      return await runCodeMutation.mutateAsync({ code, language: 'python' })
    }
    return runCodeDirect(settings, code)
  }

  const [settings, setSettings] = useState<Settings>(() => store.loadSettings())
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    store.loadConversations(),
  )
  const [activeId, setActiveId] = useState<string | null>(conversations[0]?.id ?? null)
  const [view, setView] = useState<View>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [videos, setVideos] = useState<VideoJob[]>(() => store.loadVideos())
  const [images, setImages] = useState<ImageJob[]>(() => store.loadImages())
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [artifact, setArtifact] = useState<Artifact | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // ----- persistence (temporary chats are never saved) -----
  useEffect(() => store.saveSettings(settings), [settings])
  useEffect(
    () => store.saveConversations(conversations.filter((c) => !c.temp)),
    [conversations],
  )
  useEffect(() => store.saveVideos(videos), [videos])
  useEffect(() => store.saveImages(images), [images])

  // ----- theme -----
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  }, [settings.theme])

  const active = conversations.find((c) => c.id === activeId) ?? null

  const updateConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  // ----- chat actions -----
  const newChat = useCallback(
    (temp = false) => {
      abortRef.current?.abort()
      setStreaming(false)
      const conv: Conversation = {
        id: uid(),
        title: '',
        model: settings.defaultModel,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        temp: temp || undefined,
      }
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      setView('chat')
    },
    [settings.defaultModel],
  )

  const deleteChat = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id)
        if (activeId === id) setActiveId(next[0]?.id ?? null)
        return next
      })
    },
    [activeId],
  )

  const renameChat = useCallback(
    (id: string, title: string) => updateConversation(id, (c) => ({ ...c, title })),
    [updateConversation],
  )

  const togglePin = useCallback(
    (id: string) => updateConversation(id, (c) => ({ ...c, pinned: !c.pinned })),
    [updateConversation],
  )

  const toggleTemp = useCallback(() => {
    if (active?.temp) {
      // Leaving temp mode discards the temporary conversation.
      deleteChat(active.id)
    } else {
      newChat(true)
    }
  }, [active, deleteChat, newChat])

  const setStyle = useCallback(
    (styleId: string) => {
      if (activeId) updateConversation(activeId, (c) => ({ ...c, style: styleId }))
    },
    [activeId, updateConversation],
  )

  /** Convert stored messages into the API payload: document extracts become
   *  system context, images become vision parts on their user message. */
  const buildApiMessages = useCallback(
    (conv: Conversation, messages: ChatMessage[]): ApiMessage[] => {
      const now = new Date()
      const timeLine = `Current date and time: ${now.toLocaleString()} (timezone: ${
        Intl.DateTimeFormat().resolvedOptions().timeZone
      }). Use this when the user asks about "today", "now", deadlines, or recency.`
      const style = styleInstruction(conv.style)
      const memory = memoryContext()
      const research = settings.deepResearch ? `\n\n${RESEARCH_PROMPT}` : ''
      const out: ApiMessage[] = [
        {
          role: 'system',
          content: `${conv.systemPrompt}${style ? `\n\n${style}` : ''}${memory ? `\n\n${memory}` : ''}${research}\n\n${timeLine}`,
        },
      ]
      for (const m of messages) {
        if (m.error) continue
        const docs = (m.attachments ?? []).filter(
          (a) => a.kind === 'doc' && a.status === 'ready' && a.extractedText,
        )
        for (const d of docs) {
          out.push({
            role: 'system',
            content: `Document "${d.name}":\n\n${d.extractedText}`,
          })
        }
        const images = (m.attachments ?? []).filter(
          (a) => a.kind === 'image' && a.status === 'ready' && a.dataUrl,
        )
        if (m.role === 'user' && images.length > 0) {
          const parts: MessagePart[] = images.map((img) => ({
            type: 'image_url',
            image_url: { url: img.dataUrl! },
          }))
          if (m.content) parts.push({ type: 'text', text: m.content })
          out.push({ role: 'user', content: parts })
        } else {
          out.push({ role: m.role, content: m.content })
        }
      }
      return out
    },
    [settings.deepResearch],
  )

  /** Stream an assistant reply into an existing placeholder message. */
  const streamReply = useCallback(
    (convId: string, assistantId: string, conv: Conversation, baseMessages: ChatMessage[]) => {
      setStreaming(true)
      setWorkspace(null)
      const controller = new AbortController()
      abortRef.current = controller
      const apiMessages = buildApiMessages(conv, baseMessages)

      const callbacks = {
        onToken: (t: string) =>
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + t } : m,
            ),
          })),
        onReasoning: (t: string) =>
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId ? { ...m, reasoning: (m.reasoning ?? '') + t } : m,
            ),
          })),
        onStatus: (s: string | null) =>
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId ? { ...m, statusText: s ?? undefined } : m,
            ),
          })),
        onDone: () => {
          updateConversation(convId, (c) => ({
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m,
            ),
          }))
          setStreaming(false)
          if (hosted) trpcUtils.usage.mine.invalidate()
        },
        onError: (err: string) => {
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId ? { ...m, streaming: false, error: err } : m,
            ),
          }))
          setStreaming(false)
          if (hosted) trpcUtils.usage.mine.invalidate()
        },
      }

      if (hosted) {
        hostedStreamChat(
          {
            model: conv.model,
            messages: apiMessages,
            temperature: settings.temperature,
            webSearch: settings.webSearch || settings.deepResearch,
          },
          callbacks,
          controller.signal,
        )
      } else {
        streamChat(
          { ...settings, webSearch: settings.webSearch || settings.deepResearch },
          conv.model,
          apiMessages,
          callbacks,
          controller.signal,
        )
      }
    },
    [buildApiMessages, hosted, settings, trpcUtils, updateConversation],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  const setActiveModel = useCallback(
    (model: string) => {
      if (activeId) {
        updateConversation(activeId, (c) => ({ ...c, model }))
      }
      setSettings((s) => ({ ...s, defaultModel: model }))
    },
    [activeId, updateConversation],
  )

  const send = useCallback(
    async (text: string, files: File[] = []) => {
      if (desktop && !settings.moonshotKey) {
        setSettingsOpen(true)
        return
      }
      if (hosted && !user) return // auth hook redirects to /login
      let convId = activeId
      if (!convId || !conversations.some((c) => c.id === convId)) {
        const conv: Conversation = {
          id: uid(),
          title: '',
          model: settings.defaultModel,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        setConversations((prev) => [conv, ...prev])
        convId = conv.id
        setActiveId(conv.id)
      }
      const id = convId
      const model = conversations.find((c) => c.id === id)?.model ?? settings.defaultModel

      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text || (workspace ? `Let's work on the ${workspace.rootLabel} codebase.` : ''),
        attachments: [],
        createdAt: Date.now(),
      }
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: '',
        reasoning: '',
        model,
        createdAt: Date.now(),
        streaming: true,
        preparing: files.length > 0,
      }

      updateConversation(id, (c) => ({
        ...c,
        title: c.title || text.slice(0, 42) || workspace?.rootLabel || files[0]?.name || 'Attachments',
        messages: [...c.messages, userMsg, assistantMsg],
        updatedAt: Date.now(),
      }))

      // Workspace files ride along as ready-made document context
      const workspaceAttachments: Attachment[] = (workspace?.files ?? []).map((f) => ({
        id: uid(),
        name: `${workspace!.rootLabel}/${f.path}`,
        mimeType: 'text/plain',
        size: f.content.length,
        kind: 'doc' as const,
        extractedText: f.content,
        status: 'ready' as const,
      }))

      // Upload / extract attachments first
      let attachments: Attachment[] = [...workspaceAttachments]
      if (files.length > 0) {
        setStreaming(true)
        attachments = [
          ...workspaceAttachments,
          ...(await Promise.all(
            files.map((f) => (hosted ? processFileHosted(f) : processFile(settings, f))),
          )),
        ]
        updateConversation(id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === userMsg.id
              ? { ...m, attachments }
              : m.id === assistantMsg.id
                ? { ...m, preparing: false }
                : m,
          ),
        }))
        const failures = attachments.filter((a) => a.status === 'error')
        if (failures.length > 0 && failures.length === attachments.length) {
          updateConversation(id, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsg.id
                ? {
                    ...m,
                    streaming: false,
                    error: `Could not process the attachment(s): ${failures
                      .map((f) => `${f.name} — ${f.error}`)
                      .join('; ')}`,
                  }
                : m,
            ),
          }))
          setStreaming(false)
          return
        }
      }

      // NB: `conversations` is the pre-send snapshot — a conversation created
      // during this send() isn't in it yet, so fall back to a fresh descriptor.
      const existing = conversations.find((c) => c.id === id)
      const conv: Conversation =
        existing ?? {
          id,
          title: '',
          model,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      const prior = conv.messages.filter((m) => !m.error)
      streamReply(id, assistantMsg.id, conv, [...prior, { ...userMsg, attachments }])
    },
    [
      activeId,
      conversations,
      settings,
      updateConversation,
      streamReply,
      workspace,
      desktop,
      hosted,
      user,
    ],
  )

  /** Regenerate the last assistant reply (same prompt, fresh response). */
  const regenerate = useCallback(() => {
    const conv = conversations.find((c) => c.id === activeId)
    if (!conv || streaming) return
    const msgs = conv.messages
    const lastIdx = msgs.length - 1
    if (lastIdx < 0 || msgs[lastIdx].role !== 'assistant') return
    const base = msgs.slice(0, lastIdx)
    if (base.length === 0 || base[base.length - 1].role !== 'user') return

    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      reasoning: '',
      model: conv.model,
      createdAt: Date.now(),
      streaming: true,
    }
    updateConversation(conv.id, (c) => ({
      ...c,
      messages: [...base, assistantMsg],
      updatedAt: Date.now(),
    }))
    streamReply(conv.id, assistantMsg.id, conv, base.filter((m) => !m.error))
  }, [activeId, conversations, streaming, streamReply, updateConversation])

  /** Edit a user message and branch the conversation from that point. */
  const editMessage = useCallback(
    (msgId: string, newText: string) => {
      const conv = conversations.find((c) => c.id === activeId)
      if (!conv || streaming) return
      const idx = conv.messages.findIndex((m) => m.id === msgId)
      if (idx < 0 || conv.messages[idx].role !== 'user') return
      const edited: ChatMessage = { ...conv.messages[idx], content: newText }
      const base = [...conv.messages.slice(0, idx), edited]

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: '',
        reasoning: '',
        model: conv.model,
        createdAt: Date.now(),
        streaming: true,
      }
      updateConversation(conv.id, (c) => ({
        ...c,
        messages: [...base, assistantMsg],
        updatedAt: Date.now(),
      }))
      streamReply(conv.id, assistantMsg.id, conv, base.filter((m) => !m.error))
    },
    [activeId, conversations, streaming, streamReply, updateConversation],
  )

  /** Export the active conversation as a Markdown file. */
  const exportChat = useCallback(() => {
    if (!active || active.messages.length === 0) return
    const lines: string[] = [
      `# ${active.title || 'Sanjeev AI conversation'}`,
      ``,
      `_Exported ${new Date().toLocaleString()} · model: ${active.model}_`,
      ``,
    ]
    for (const m of active.messages) {
      if (m.error) continue
      lines.push(m.role === 'user' ? `## You` : `## Sanjeev AI`)
      lines.push(``)
      lines.push(m.content || '_(empty)_')
      lines.push(``)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(active.title || 'chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 50) || 'chat'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [active])

  // ----- share link (hosted only — needs the server DB) -----
  const shareMutation = trpc.share.create.useMutation()
  const shareChat = useCallback(async () => {
    if (!active || active.messages.length === 0) return
    const messages = active.messages
      .filter(
        (m): m is ChatMessage & { role: 'user' | 'assistant' } =>
          (m.role === 'user' || m.role === 'assistant') &&
          !m.error &&
          !m.streaming &&
          Boolean(m.content),
      )
      .map((m) => ({ role: m.role, content: m.content, model: m.model }))
    if (messages.length === 0) return
    const { slug } = await shareMutation.mutateAsync({
      title: active.title || 'Sanjeev AI conversation',
      messages,
    })
    const url = `${window.location.origin}${window.location.pathname}#/share/${slug}`
    await navigator.clipboard.writeText(url)
    toast.success('Share link copied to clipboard', { description: url })
  }, [active, shareMutation.mutateAsync])

  // ----- keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        newChat()
      }
      if (e.key === 'Escape') setArtifact(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newChat])

  // ----- video polling -----
  useEffect(() => {
    const pending = videos.some((v) => v.status === 'queued' || v.status === 'processing')
    if (!pending || (desktop && !settings.minimaxKey) || (hosted && !user)) return
    const timer = setInterval(async () => {
      for (const job of videos) {
        if (job.status !== 'queued' && job.status !== 'processing') continue
        try {
          const result = hosted
            ? await trpcUtils.client.video.poll.mutate({
                taskId: job.taskId,
                model: job.model,
              })
            : await pollVideoTask(settings, job.taskId, job.model)
          if (result.state === 'pending') {
            setVideos((prev) =>
              prev.map((v) => (v.id === job.id ? { ...v, status: 'processing' } : v)),
            )
          } else if (result.state === 'success') {
            setVideos((prev) =>
              prev.map((v) =>
                v.id === job.id ? { ...v, status: 'success', videoUrl: result.videoUrl } : v,
              ),
            )
          } else {
            setVideos((prev) =>
              prev.map((v) =>
                v.id === job.id ? { ...v, status: 'failed', error: result.error } : v,
              ),
            )
          }
        } catch {
          // transient network error — retry on next tick
        }
      }
    }, 8000)
    return () => clearInterval(timer)
  }, [videos, settings, desktop, hosted, user, trpcUtils])

  const currentModel = active?.model ?? settings.defaultModel
  const noKey = desktop && !settings.moonshotKey

  // Hosted mode: don't render the app while the session check is in flight
  // (the auth hook redirects to /login when unauthenticated).
  if (hosted && authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading Sanjeev AI…</p>
      </div>
    )
  }
  if (hosted && !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    )
  }

  const usage = usageQuery.data
  const usageSummary = usage
    ? usage.unlimited || !usage.limits
      ? `${usage.planLabel} · unlimited (admin)`
      : `${usage.planLabel} · ${Math.round(usage.used.tokens / 1000)}K / ${Math.round(
          usage.limits.monthlyTokens / 1000,
        )}K tokens · ${usage.used.videos}/${usage.limits.monthlyVideos} vids · ${usage.used.images}/${usage.limits.monthlyImages} imgs`
    : null

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        view={view}
        onViewChange={setView}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => newChat()}
        onDelete={deleteChat}
        onRename={renameChat}
        onTogglePin={togglePin}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        theme={settings.theme}
        onToggleTheme={() =>
          setSettings((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))
        }
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        hosted={hosted}
        user={user ? { name: user.name, email: user.email, role: user.role } : null}
        usageSummary={usageSummary}
        onLogout={logout}
      />

      {view === 'image' ? (
        <ImageView
          settings={settings}
          hosted={hosted}
          jobs={images}
          onCreateJob={(job) => setImages((prev) => [job, ...prev])}
          onUpdateJob={(id, patch) =>
            setImages((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
          }
          onDeleteJob={(id) => setImages((prev) => prev.filter((j) => j.id !== id))}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      ) : view === 'chat' ? (
        <div className="flex h-full min-w-0 flex-1">
          <div className="flex h-full min-w-0 flex-1 flex-col">
            <ChatView
              conversation={active}
              dark={settings.theme === 'dark'}
              onSuggestion={(p) => send(p)}
              onOpenSidebar={() => setSidebarOpen(true)}
              onRegenerate={regenerate}
              onEditMessage={editMessage}
              onSpeak={
                voiceAvailable(settings, hosted)
                  ? (text) => speakText(settings, text, hosted).catch(() => {})
                  : undefined
              }
              onRunCode={runCode}
              onPreview={(code, language) => setArtifact({ code, language })}
              onOpenSearch={() => setSearchOpen(true)}
              onExport={exportChat}
              onShare={hosted ? shareChat : undefined}
              onToggleTemp={toggleTemp}
              onStyleChange={setStyle}
              headerExtra={
                noKey ? (
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    <KeyRound size={13} />
                    Add API key
                  </button>
                ) : undefined
              }
            />
            <Composer
              model={currentModel}
              onModelChange={setActiveModel}
              onSend={send}
              onStop={stop}
              streaming={streaming}
              disabled={noKey}
              webSearch={settings.webSearch}
              onToggleWebSearch={() =>
                setSettings((s) => ({ ...s, webSearch: !s.webSearch }))
              }
              onOpenWorkspace={() => setWorkspaceOpen(true)}
              workspaceSummary={
                workspace ? { label: workspace.rootLabel, count: workspace.files.length } : null
              }
              onClearWorkspace={() => setWorkspace(null)}
              deepResearch={settings.deepResearch}
              onToggleDeepResearch={() =>
                setSettings((s) => ({ ...s, deepResearch: !s.deepResearch }))
              }
              voice={
                voiceAvailable(settings, hosted)
                  ? { transcribe: (blob: Blob) => transcribeAudio(settings, blob, hosted) }
                  : null
              }
            />
          </div>
          {artifact && (
            <div className="fixed inset-0 z-40 md:static md:z-auto md:w-[45%] md:shrink-0">
              <ArtifactPanel artifact={artifact} onClose={() => setArtifact(null)} />
            </div>
          )}
        </div>
      ) : (
        <VideoView
          settings={settings}
          hosted={hosted}
          jobs={videos}
          onCreateJob={(job) => setVideos((prev) => [job, ...prev])}
          onDeleteJob={(id) => setVideos((prev) => prev.filter((v) => v.id !== id))}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      )}

      {searchOpen && (
        <SearchPalette
          conversations={conversations}
          onSelect={(id) => {
            setActiveId(id)
            setView('chat')
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {workspaceOpen && (
        <WorkspaceDialog
          onConfirm={(sel) => {
            setWorkspace(sel)
            setWorkspaceOpen(false)
          }}
          onClose={() => setWorkspaceOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          hosted={hosted}
          onSave={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
