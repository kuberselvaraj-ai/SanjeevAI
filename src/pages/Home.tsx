import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { Attachment, Conversation, Settings, VideoJob } from '@/lib/types'
import { store, uid } from '@/lib/storage'
import { streamChat, type ApiMessage, type MessagePart } from '@/lib/kimi'
import { pollVideoTask } from '@/lib/video'
import { processFile } from '@/lib/files'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/models'
import { Sidebar, type View } from '@/components/Sidebar'
import { ChatView } from '@/components/ChatView'
import { Composer } from '@/components/Composer'
import { SettingsDialog } from '@/components/SettingsDialog'
import { VideoView } from '@/components/VideoView'
import { WorkspaceDialog, type WorkspaceSelection } from '@/components/WorkspaceDialog'

export default function Home() {
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
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // ----- persistence -----
  useEffect(() => store.saveSettings(settings), [settings])
  useEffect(() => store.saveConversations(conversations), [conversations])
  useEffect(() => store.saveVideos(videos), [videos])

  // ----- theme -----
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  }, [settings.theme])

  const active = conversations.find((c) => c.id === activeId) ?? null

  const updateConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  // ----- chat actions -----
  const newChat = useCallback(() => {
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
    }
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
    setView('chat')
  }, [settings.defaultModel])

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

  /** Convert stored messages into the API payload: document extracts become
   *  system context, images become vision parts on their user message. */
  const buildApiMessages = useCallback(
    (systemPrompt: string, messages: Conversation['messages']): ApiMessage[] => {
      const now = new Date()
      const timeLine = `Current date and time: ${now.toLocaleString()} (timezone: ${
        Intl.DateTimeFormat().resolvedOptions().timeZone
      }). Use this when the user asks about "today", "now", deadlines, or recency.`
      const out: ApiMessage[] = [
        { role: 'system', content: `${systemPrompt}\n\n${timeLine}` },
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
    [],
  )

  const send = useCallback(
    async (text: string, files: File[] = []) => {
      if (!settings.moonshotKey) {
        setSettingsOpen(true)
        return
      }
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

      const userMsg = {
        id: uid(),
        role: 'user' as const,
        content: text || (workspace ? `Let's work on the ${workspace.rootLabel} codebase.` : ''),
        attachments: [] as Attachment[],
        createdAt: Date.now(),
      }
      const assistantMsg = {
        id: uid(),
        role: 'assistant' as const,
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
        attachments = [...workspaceAttachments, ...(await Promise.all(files.map((f) => processFile(settings, f))))]
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

      setStreaming(true)
      setWorkspace(null)
      const controller = new AbortController()
      abortRef.current = controller

      // Build payload: stored history + the new message with its attachments.
      // (`conversations` here is the pre-send snapshot, so append userMsg explicitly.)
      const conv = conversations.find((c) => c.id === id)
      const prior = (conv?.messages ?? []).filter((m) => !m.error)
      const apiMessages: ApiMessage[] = buildApiMessages(
        conv?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        [...prior, { ...userMsg, attachments }],
      )

      streamChat(
        settings,
        model,
        apiMessages,
        {
          onToken: (t) =>
            updateConversation(id, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: m.content + t } : m,
              ),
            })),
          onReasoning: (t) =>
            updateConversation(id, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, reasoning: (m.reasoning ?? '') + t }
                  : m,
              ),
            })),
          onStatus: (s) =>
            updateConversation(id, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsg.id ? { ...m, statusText: s ?? undefined } : m,
              ),
            })),
          onDone: () => {
            updateConversation(id, (c) => ({
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map((m) =>
                m.id === assistantMsg.id ? { ...m, streaming: false } : m,
              ),
            }))
            setStreaming(false)
          },
          onError: (err) => {
            updateConversation(id, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsg.id ? { ...m, streaming: false, error: err } : m,
              ),
            }))
            setStreaming(false)
          },
        },
        controller.signal,
      )
    },
    [activeId, conversations, settings, updateConversation, buildApiMessages, workspace],
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

  // ----- video polling -----
  useEffect(() => {
    const pending = videos.some((v) => v.status === 'queued' || v.status === 'processing')
    if (!pending || !settings.minimaxKey) return
    const timer = setInterval(async () => {
      for (const job of videos) {
        if (job.status !== 'queued' && job.status !== 'processing') continue
        try {
          const result = await pollVideoTask(settings, job.taskId)
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
  }, [videos, settings])

  const currentModel = active?.model ?? settings.defaultModel
  const noKey = !settings.moonshotKey

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar
        view={view}
        onViewChange={setView}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newChat}
        onDelete={deleteChat}
        onOpenSettings={() => setSettingsOpen(true)}
        theme={settings.theme}
        onToggleTheme={() =>
          setSettings((s) => ({ ...s, theme: s.theme === 'light' ? 'dark' : 'light' }))
        }
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {view === 'chat' ? (
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <ChatView
            conversation={active}
            dark={settings.theme === 'dark'}
            onSuggestion={(p) => send(p)}
            onOpenSidebar={() => setSidebarOpen(true)}
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
          />
        </div>
      ) : (
        <VideoView
          settings={settings}
          jobs={videos}
          onCreateJob={(job) => setVideos((prev) => [job, ...prev])}
          onDeleteJob={(id) => setVideos((prev) => prev.filter((v) => v.id !== id))}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSidebar={() => setSidebarOpen(true)}
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
          onSave={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
