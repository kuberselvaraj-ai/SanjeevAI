import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import type { AnchorComment, Attachment, ChatMessage, Conversation, ImageJob, Settings, VaultFile, VaultFolder, VideoJob } from '@/lib/types'
import { runCodeDirect, type CodeRunResult } from '@/lib/code'
import { store, uid } from '@/lib/storage'
import { streamChat, type ApiMessage, type MessagePart, type ToolCall } from '@/lib/kimi'
import {
  AGENT_SYSTEM_HINT,
  AGENT_TOOLS,
  COUNCIL_SYSTEM_PROMPT,
  councilUserMessage,
  executeAgentTool,
  needsAgentTools,
  restoreImagesAfterReview,
  stripImagesForReview,
} from '@/lib/agent'
import { pollVideoTask } from '@/lib/video'
import { processFile } from '@/lib/files'
import { autoTags, findVaultByHash, hashFile, listVaultFiles, putVaultFile, deleteVaultFile, vaultEntryFrom } from '@/lib/vault'
import {
  cloudVaultCheckHash,
  cloudVaultCreateFolder,
  cloudVaultDelete,
  cloudVaultDeleteFolder,
  cloudVaultPatch,
  cloudVaultPayload,
  cloudVaultTree,
  cloudVaultUpload,
} from '@/lib/vaultCloud'
import { VaultDialog } from '@/components/VaultDialog'
import { hostedStreamChat, processFileHosted } from '@/lib/hosted'
import { isDesktop } from '@/lib/desktop'
import { AUTO_MODEL, DEFAULT_SYSTEM_PROMPT, isPremiumModel, toKimiModels } from '@/lib/models'
import {
  fitMessagesToContext,
  resolveChatModel,
  systemPromptFor,
  type PremiumAvailability,
} from '@/lib/route'
import {
  CONNECTOR_SYSTEM_HINT,
  CONNECTOR_TOOL_NAMES,
  CONNECTOR_TOOLS,
  executeConnectorTool,
  needsConnectorTools,
} from '@/lib/connect'
import { streamOpenRouter } from '@/lib/openrouter'
import { streamAnthropic } from '@/lib/anthropic'
import { streamOpenAi } from '@/lib/openai'
import { styleInstruction } from '@/lib/styles'
import { RESEARCH_PROMPT } from '@/lib/research'
import { memoryContext } from '@/lib/memory'
import { estimateMessagesTokens, slimHistory } from '@/lib/contextBudget'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { Sidebar, type View } from '@/components/Sidebar'
import { ChatView } from '@/components/ChatView'
import { Composer } from '@/components/Composer'
import { speakText, stopSpeaking, transcribeAudio, voiceAvailable } from '@/lib/voice'
import { SettingsDialog } from '@/components/SettingsDialog'
import { DeckView } from '@/components/DeckView'
import { BriefsView } from '@/components/BriefsView'
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
  // Hosted leads with the Mission Deck (the executive home); the offline
  // desktop bundle leads with chat.
  const [view, setView] = useState<View>(() => (isDesktop() ? 'chat' : 'deck'))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [videos, setVideos] = useState<VideoJob[]>(() => store.loadVideos())
  const [images, setImages] = useState<ImageJob[]>(() => store.loadImages())
  const [comments, setComments] = useState<AnchorComment[]>(() => store.loadComments())
  const [vault, setVault] = useState<VaultFile[]>([])
  const [vaultFolders, setVaultFolders] = useState<VaultFolder[]>([])
  const [vaultOpen, setVaultOpen] = useState(false)
  const [pendingVault, setPendingVault] = useState<VaultFile[]>([])
  /** last turn's context-meter reading (estimated tokens) */
  const [ctxStats, setCtxStats] = useState<{ sent: number; saved: number } | null>(null)
  /** hands-free voice loop: talk → transcribe → send → spoken reply */
  const [voiceMode, setVoiceMode] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  /** linked third-party accounts (Google, …) — enables connector tools */
  const [connections, setConnections] = useState<{ provider: string; label?: string | null }[]>([])
  const refreshConnections = useCallback(async () => {
    if (!hosted) return
    try {
      const r = await fetch('/api/connect/status', { credentials: 'include' })
      const j = r.ok ? await r.json() : null
      if (j) setConnections(j.connections ?? [])
    } catch {
      /* offline / unconfigured — connectors stay off */
    }
  }, [hosted])
  useEffect(() => {
    if (user) refreshConnections()
  }, [user, refreshConnections])

  // OAuth return: /#/?connect=google → toast + status refresh.
  useEffect(() => {
    const m = window.location.hash.match(/[?&]connect=(\w+)/)
    if (!m) return
    if (m[1] === 'error') toast.error('Connection failed — try again from Settings.')
    else {
      toast.success(`Connected ${m[1] === 'google' ? 'Google (Gmail + Calendar)' : m[1]}.`)
      refreshConnections()
    }
    window.location.hash = window.location.hash.replace(/[?&]connect=\w+/, '')
  }, [refreshConnections])
  const toggleVoiceMode = useCallback(() => {
    setVoiceMode((v) => {
      if (v) {
        stopSpeaking()
        setSpeaking(false)
      }
      return !v
    })
  }, [])
  const bargeIn = useCallback(() => {
    stopSpeaking()
    setSpeaking(false)
  }, [])

  // Hosted: the vault lives in the cloud (same library on every device).
  // Desktop: local IndexedDB vault.
  const refreshVault = useCallback(async () => {
    if (hosted) {
      try {
        const t = await cloudVaultTree()
        setVault(t.files)
        setVaultFolders(t.folders)
      } catch {
        /* unauthenticated / offline — vault stays empty */
      }
    } else {
      setVault(await listVaultFiles())
    }
  }, [hosted])
  useEffect(() => {
    if (!hosted || user) refreshVault()
  }, [refreshVault, hosted, user])

  // Upload a file straight into the cloud vault (from the vault dialog).
  const vaultUploadDirect = useCallback(
    async (f: File, folderId: number | null) => {
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`"${f.name}" is over the 8 MB cloud vault limit.`)
        return
      }
      try {
        const hash = await hashFile(f)
        const kind = (f.type.startsWith('image/') ? 'image' : 'doc') as 'image' | 'doc'
        const bytes = new Uint8Array(await f.arrayBuffer())
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000)
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        const textLike =
          /^(text\/|application\/(json|xml))/.test(f.type) ||
          /\.(md|txt|csv|json|log)$/i.test(f.name)
        const extractedText = textLike ? (await f.text()).slice(0, 200_000) : undefined
        await cloudVaultUpload({
          name: f.name,
          mimeType: f.type || 'application/octet-stream',
          size: f.size,
          hash,
          kind,
          folderId,
          tags: autoTags(f.name, f.type, extractedText ?? ''),
          payloadB64: btoa(bin),
          extractedText,
        })
        toast.success(`"${f.name}" is in the cloud vault.`)
        refreshVault()
      } catch {
        toast.error(`Could not upload "${f.name}".`)
      }
    },
    [refreshVault],
  )

  // Pull a copy of a vault file down to this device.
  const vaultDownload = useCallback(
    async (f: VaultFile) => {
      try {
        let url: string
        let name = f.name
        let revoke = false
        let payloadB64: string | null | undefined
        let text: string | null | undefined
        let mime = f.mimeType
        if (hosted) {
          const p = await cloudVaultPayload(f.id)
          payloadB64 = p.payloadB64
          text = p.extractedText
          mime = p.mimeType || mime
        } else {
          payloadB64 = f.dataUrl?.split(',')[1]
          text = f.extractedText
        }
        if (payloadB64) {
          const bin = atob(payloadB64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          url = URL.createObjectURL(new Blob([bytes], { type: mime }))
          revoke = true
        } else if (text) {
          url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
          name = f.name.replace(/\.[^.]+$/, '') + '.txt'
          revoke = true
        } else {
          toast.error('No downloadable copy is stored for this file.')
          return
        }
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        if (revoke) setTimeout(() => URL.revokeObjectURL(url), 5000)
      } catch {
        toast.error('Download failed.')
      }
    },
    [hosted],
  )
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  /** Which providers the hosted server has keys for — drives Auto routing. */
  const [caps, setCaps] = useState<{
    claude?: boolean
    gpt?: boolean
    extraModels?: { id: string; label: string; description?: string }[]
  } | null>(null)

  useEffect(() => {
    if (!hosted) return
    fetch('/api/hosted/capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCaps(j))
      .catch(() => {})
  }, [hosted])

  const abortRef = useRef<AbortController | null>(null)

  // ----- persistence (temporary chats are never saved) -----
  useEffect(() => store.saveSettings(settings), [settings])
  useEffect(
    () => store.saveConversations(conversations.filter((c) => !c.temp)),
    [conversations],
  )
  useEffect(() => store.saveVideos(videos), [videos])
  useEffect(() => store.saveImages(images), [images])
  // Comments of temporary chats are never persisted (same rule as the chats).
  useEffect(() => {
    const tempIds = new Set(conversations.filter((c) => c.temp).map((c) => c.id))
    store.saveComments(comments.filter((c) => !tempIds.has(c.conversationId)))
  }, [comments, conversations])

  // ----- theme -----
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  }, [settings.theme])

  // ----- TV mode: ten-foot interface, deck-forward -----
  useEffect(() => {
    document.documentElement.classList.toggle('tv-mode', Boolean(settings.tvMode))
    if (settings.tvMode && hosted) setView((v) => (v === 'chat' ? 'deck' : v))
  }, [settings.tvMode, hosted])

  const active = conversations.find((c) => c.id === activeId) ?? null

  const updateConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  // ----- chat actions -----
  // Unread scheduled-brief runs — red bubble on the Briefs tab (hosted only).
  const briefsUnreadQuery = trpc.schedules.unreadCount.useQuery(undefined, {
    enabled: hosted,
    refetchInterval: 30_000,
  })

  // A finished brief becomes a real conversation: the schedule's prompt as
  // the user message, the deliverable as the reply — full context continues.
  const openBriefInChat = useCallback(
    ({ title, prompt, content }: { title: string; prompt: string; content: string }) => {
      const now = Date.now()
      const conv: Conversation = {
        id: uid(),
        title: title || 'Scheduled brief',
        model: AUTO_MODEL,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        messages: [
          { id: uid(), role: 'user', content: prompt, createdAt: now },
          { id: uid(), role: 'assistant', content, model: 'kimi-k3', createdAt: now + 1 },
        ],
        createdAt: now,
        updatedAt: now,
      }
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      setView('chat')
    },
    [],
  )

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
      setComments((prev) => prev.filter((c) => c.conversationId !== id))
    },
    [activeId],
  )

  // ----- anchored comments (Comms log) -----
  const addComment = useCallback(
    (messageId: string, quote: string, text: string) => {
      if (!activeId) return
      setComments((prev) => [
        ...prev,
        {
          id: uid(),
          conversationId: activeId,
          messageId,
          quote,
          entries: [{ id: uid(), text, createdAt: Date.now() }],
          createdAt: Date.now(),
        },
      ])
    },
    [activeId],
  )
  const replyComment = useCallback((id: string, text: string) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, entries: [...c.entries, { id: uid(), text, createdAt: Date.now() }] }
          : c,
      ),
    )
  }, [])
  const resolveComment = useCallback((id: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)),
    )
  }, [])
  const deleteComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }, [])

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
    (conv: Conversation, messages: ChatMessage[], model: string, agentTools = false, connectorTools = false): ApiMessage[] => {
      const now = new Date()
      const timeLine = `Current date and time: ${now.toLocaleString()} (timezone: ${
        Intl.DateTimeFormat().resolvedOptions().timeZone
      }). Use this when the user asks about "today", "now", deadlines, or recency.`
      const style = styleInstruction(conv.style)
      const memory = memoryContext()
      const research = settings.deepResearch ? `\n\n${RESEARCH_PROMPT}` : ''
      const agent = agentTools ? `\n\n${AGENT_SYSTEM_HINT}` : ''
      const connector = connectorTools ? `\n\n${CONNECTOR_SYSTEM_HINT}` : ''
      const out: ApiMessage[] = [
        {
          role: 'system',
          content: `${systemPromptFor(model, conv.systemPrompt)}${style ? `\n\n${style}` : ''}${memory ? `\n\n${memory}` : ''}${research}${agent}${connector}\n\n${timeLine}`,
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

      // ── Best-for-task routing ─────────────────────────────────────────
      // The transcript lives in our DB; models are stateless, so switching
      // providers mid-chat just replays the same history to the new brain.
      const lastUser = [...baseMessages].reverse().find((m) => m.role === 'user')
      const hasImages = baseMessages.some((m) =>
        (m.attachments ?? []).some((a) => a.kind === 'image' && a.status === 'ready'),
      )
      // Hosted: server capabilities. Desktop: user's own keys — first-party
      // keys preferred, one OpenRouter key covers whichever is missing.
      const premium: PremiumAvailability = hosted
        ? { claude: Boolean(caps?.claude), gpt: Boolean(caps?.gpt) }
        : {
            claude: Boolean(settings.anthropicKey || settings.openrouterKey),
            gpt: Boolean(settings.openaiKey || settings.openrouterKey),
          }
      // Deliverable work (reports, plans, analyses, visuals) gets the
      // specialist toolbox — and in Auto mode always goes to the
      // orchestrator brain (Kimi K3, our strongest agent model).
      const wantsPipeline = needsAgentTools(lastUser?.content ?? '')
      // Connector intents (email / calendar / Slack / Salesforce) also go to
      // the orchestrator brain — tool calling runs on Kimi models.
      const wantsConnectors =
        hosted && connections.length > 0 && needsConnectorTools(lastUser?.content ?? '')
      const route = resolveChatModel(conv.model, lastUser?.content ?? '', hasImages, premium)
      let resolved = route.model
      if ((wantsPipeline || wantsConnectors) && conv.model === AUTO_MODEL) resolved = 'kimi-k3'
      const agentRequested = wantsPipeline && !isPremiumModel(resolved)
      const connectorActive = wantsConnectors && !isPremiumModel(resolved)
      const resolvedAvailable = resolved.startsWith('anthropic/')
        ? premium.claude
        : resolved.startsWith('openai/')
          ? premium.gpt
          : true

      if (isPremiumModel(resolved) && !resolvedAvailable) {
        // Manual premium pick without any key — explain instead of failing oddly.
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  error: hosted
                    ? 'Premium models (Claude / GPT) are not enabled on this server yet. Switch to Auto or a Kimi model — K3 handles everything meanwhile.'
                    : 'Add an Anthropic / OpenAI key (or an OpenRouter key) in Settings to chat with Claude / GPT, or switch back to Auto or a Kimi model.',
                }
              : m,
          ),
        }))
        setStreaming(false)
        return
      }

      // Label the reply with the model that actually answers (matters in Auto).
      if (resolved !== conv.model) {
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === assistantId ? { ...m, model: resolved } : m)),
        }))
      }

      const apiMessages = buildApiMessages(conv, baseMessages, resolved, agentRequested, connectorActive)
      // Context diet: stale documents and ancient mega-replies are trimmed
      // before anything is sent — for every model, not just premium ones.
      const slim = slimHistory(apiMessages)
      // Premium models: smaller context, higher price — slide the window.
      const finalMessages = isPremiumModel(resolved)
        ? fitMessagesToContext(slim.messages)
        : slim.messages
      const rawTokens = estimateMessagesTokens(apiMessages)
      setCtxStats({
        sent: estimateMessagesTokens(finalMessages),
        saved: Math.max(0, rawTokens - estimateMessagesTokens(finalMessages)),
      })
      // $web_search is a Moonshot builtin — not available through OpenRouter.
      const useWebSearch = (settings.webSearch || settings.deepResearch) && !isPremiumModel(resolved)

      // Mirror of the reply as it streams (tokens + embedded artifacts), so
      // the council pass can review the full draft without re-reading state.
      let contentMirror = ''

      const finalize = () => {
        updateConversation(convId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === assistantId ? { ...m, streaming: false, statusText: undefined } : m,
          ),
        }))
        setStreaming(false)
        if (hosted) trpcUtils.usage.mine.invalidate()
        // Voice mode: the finished reply is read aloud automatically.
        if (voiceMode && contentMirror.trim() && voiceAvailable(settings, hosted)) {
          setSpeaking(true)
          speakText(settings, contentMirror, hosted, () => setSpeaking(false)).catch(() =>
            setSpeaking(false),
          )
        }
      }

      // ── Council: a second vendor's model refines the deliverable ───────
      // Premium-only: needs Claude or GPT available. The critic is always
      // cross-vendor (the draft always comes from the Kimi orchestrator).
      const councilModelId = premium.claude
        ? 'anthropic/claude-fable-5.1'
        : premium.gpt
          ? 'openai/gpt-5.6-sol'
          : null
      const councilOn = agentRequested && settings.council && councilModelId !== null

      const runCouncil = () => {
        const criticLabel = councilModelId === 'anthropic/claude-fable-5.1' ? 'Claude Fable 5.1' : 'GPT-5.6 Sol'
        const { text: draftText, images } = stripImagesForReview(contentMirror)
        const councilMessages: ApiMessage[] = [
          { role: 'system', content: COUNCIL_SYSTEM_PROMPT },
          { role: 'user', content: councilUserMessage(lastUser?.content ?? '', draftText) },
        ]
        let refined = ''
        const councilCb = {
          onToken: (t: string) => {
            refined += t
            // Swap the draft for the refined version as it streams in.
            const shown = restoreImagesAfterReview(refined, images)
            updateConversation(convId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId ? { ...m, content: shown } : m,
              ),
            }))
          },
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
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                      statusText: undefined,
                      refinedBy: criticLabel,
                      content: restoreImagesAfterReview(refined, images),
                    }
                  : m,
              ),
            }))
            setStreaming(false)
            if (hosted) trpcUtils.usage.mine.invalidate()
          },
          onError: () => {
            // Keep the draft — it is already a complete, valid answer.
            updateConversation(convId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId ? { ...m, content: contentMirror } : m,
              ),
            }))
            finalize()
          },
        }
        councilCb.onStatus(`Refining with ${criticLabel}…`)
        if (hosted) {
          hostedStreamChat(
            { model: councilModelId!, messages: councilMessages, temperature: settings.temperature, webSearch: false },
            councilCb,
            controller.signal,
          )
        } else if (councilModelId!.startsWith('anthropic/')) {
          if (settings.anthropicKey) streamAnthropic(settings, councilMessages, councilCb, controller.signal)
          else streamOpenRouter(settings, councilModelId!, councilMessages, councilCb, controller.signal)
        } else {
          if (settings.openaiKey) streamOpenAi(settings, councilMessages, councilCb, controller.signal, councilModelId!)
          else streamOpenRouter(settings, councilModelId!, councilMessages, councilCb, controller.signal)
        }
      }

      const callbacks = {
        onToken: (t: string) => {
          contentMirror += t
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + t } : m,
            ),
          }))
        },
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
          if (councilOn && !controller.signal.aborted && contentMirror.trim()) {
            return runCouncil()
          }
          finalize()
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

      // Specialist toolbox: model calls run_python / generate_image mid-stream,
      // we execute them and feed results back; artifacts embed into the reply.
      // Connector tools (Gmail / Calendar) join the box when linked + asked.
      const agent =
        agentRequested || connectorActive
        ? {
            tools: [
              ...(agentRequested ? AGENT_TOOLS : []),
              ...(connectorActive ? CONNECTOR_TOOLS : []),
            ],
            execute: async (call: ToolCall) => {
              if (CONNECTOR_TOOL_NAMES.has(call.function.name)) {
                callbacks.onStatus?.('Working with Google…')
                const result = await executeConnectorTool(call)
                callbacks.onStatus?.(null)
                return result
              }
              const { result, artifact } = await executeAgentTool(call, {
                settings,
                hosted,
                onStatus: callbacks.onStatus,
              })
              if (artifact) {
                const embed = `\n\n![${artifact.label}](${artifact.dataUrl})\n\n`
                contentMirror += embed
                updateConversation(convId, (c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + embed } : m,
                  ),
                }))
              }
              return result
            },
          }
        : undefined

      if (hosted) {
        hostedStreamChat(
          {
            model: resolved,
            messages: finalMessages,
            temperature: settings.temperature,
            webSearch: useWebSearch,
          },
          callbacks,
          controller.signal,
          agent,
        )
      } else if (resolved.startsWith('anthropic/')) {
        if (settings.anthropicKey) {
          streamAnthropic(settings, finalMessages, callbacks, controller.signal, resolved)
        } else {
          streamOpenRouter(settings, resolved, finalMessages, callbacks, controller.signal)
        }
      } else if (resolved.startsWith('openai/')) {
        if (settings.openaiKey) {
          streamOpenAi(settings, finalMessages, callbacks, controller.signal, resolved)
        } else {
          streamOpenRouter(settings, resolved, finalMessages, callbacks, controller.signal)
        }
      } else if (resolved.includes('/')) {
        // Custom / future models — any OpenRouter-compatible slug.
        if (hosted) {
          hostedStreamChat(
            { model: resolved, messages: finalMessages, temperature: settings.temperature, webSearch: false },
            callbacks,
            controller.signal,
          )
        } else if (settings.openrouterKey) {
          streamOpenRouter(settings, resolved, finalMessages, callbacks, controller.signal)
        } else {
          callbacks.onError(
            'This model needs an OpenRouter API key — add one in Settings → API keys, then try again.',
          )
        }
      } else {
        streamChat(
          { ...settings, webSearch: useWebSearch },
          resolved,
          finalMessages,
          callbacks,
          controller.signal,
          agent,
        )
      }
    },
    [buildApiMessages, caps, hosted, settings, trpcUtils, updateConversation, voiceMode, connections],
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
        content:
          text ||
          (workspace
            ? `Let's work on the ${workspace.rootLabel} codebase.`
            : pendingVault.length > 0
              ? `Sharing from the vault: ${pendingVault.map((v) => v.name).join(', ')}`
              : ''),
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

      // Upload / extract attachments first.
      // Vault picks ride along as ready-made attachments — zero re-processing.
      const vaultAttachments: Attachment[] = pendingVault.map((v) => ({
        id: uid(),
        name: v.name,
        mimeType: v.mimeType,
        size: v.size,
        kind: v.kind,
        dataUrl: v.dataUrl,
        extractedText: v.extractedText,
        status: 'ready' as const,
      }))
      let attachments: Attachment[] = [...workspaceAttachments, ...vaultAttachments]
      const usedVaultIds = new Set<string>(pendingVault.map((v) => v.id))
      if (files.length > 0) {
        setStreaming(true)
        const processed = await Promise.all(
          files.map(async (f) => {
            // Dedupe: a file already in the vault skips upload + extraction entirely.
            const hash = await hashFile(f).catch(() => '')
            if (hosted && hash) {
              const meta = await cloudVaultCheckHash(hash).catch(() => null)
              if (meta) {
                const p = await cloudVaultPayload(meta.id).catch(() => null)
                if (p && (p.payloadB64 || p.extractedText)) {
                  return {
                    hash,
                    vaultId: meta.id,
                    attachment: {
                      id: uid(),
                      name: p.name,
                      mimeType: p.mimeType,
                      size: meta.size,
                      kind: meta.kind,
                      dataUrl:
                        meta.kind === 'image' && p.payloadB64
                          ? `data:${p.mimeType};base64,${p.payloadB64}`
                          : undefined,
                      extractedText: p.extractedText ?? undefined,
                      status: 'ready',
                    } as Attachment,
                  }
                }
              }
            }
            const hit = !hosted && hash ? await findVaultByHash(hash).catch(() => null) : null
            if (hit && (hit.dataUrl || hit.extractedText)) {
              usedVaultIds.add(hit.id)
              return {
                hash,
                vaultId: hit.id,
                attachment: {
                  id: uid(),
                  name: hit.name,
                  mimeType: hit.mimeType,
                  size: hit.size,
                  kind: hit.kind,
                  dataUrl: hit.dataUrl,
                  extractedText: hit.extractedText,
                  status: 'ready',
                } as Attachment,
              }
            }
            const attachment = hosted ? await processFileHosted(f) : await processFile(settings, f)
            return { hash, vaultId: null as string | null, attachment, file: f }
          }),
        )
        attachments = [...attachments, ...processed.map((p) => p.attachment)]
        // Register new files in the vault (non-blocking).
        for (const p of processed) {
          if (!p.vaultId && p.hash && p.attachment.status === 'ready') {
            if (hosted) {
              // Cloud vault: raw bytes (≤8 MB) + extracted text, deduped server-side.
              const a = p.attachment
              const payloadB64 =
                a.kind === 'image'
                  ? a.dataUrl?.split(',')[1]
                  : p.file && p.file.size <= 8 * 1024 * 1024
                    ? await p.file.arrayBuffer().then((buf) => {
                        const bytes = new Uint8Array(buf)
                        let bin = ''
                        for (let i = 0; i < bytes.length; i += 0x8000)
                          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
                        return btoa(bin)
                      })
                    : undefined
              cloudVaultUpload({
                name: a.name,
                mimeType: a.mimeType,
                size: a.size,
                hash: p.hash,
                kind: a.kind,
                tags: vaultEntryFrom(p.hash, a).tags,
                payloadB64,
                extractedText: a.extractedText,
              })
                .then(refreshVault)
                .catch(() => {})
            } else {
              const entry = vaultEntryFrom(p.hash, p.attachment)
              usedVaultIds.add(entry.id)
              putVaultFile(entry)
                .then(refreshVault)
                .catch(() => {})
            }
          }
        }
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

      // Record vault usage (non-blocking, local vault only) and clear picks.
      if (usedVaultIds.size > 0 && !hosted) {
        const useTitle = text.slice(0, 42) || attachments[0]?.name || 'Chat'
        const useAt = Date.now()
        setVault((prev) =>
          prev.map((v) =>
            usedVaultIds.has(v.id)
              ? {
                  ...v,
                  usedIn: [
                    ...v.usedIn.filter((u) => u.conversationId !== id),
                    { conversationId: id, title: useTitle, at: useAt },
                  ],
                }
              : v,
          ),
        )
        // persist the usedIn update into IndexedDB on the next tick, once state settled
        setTimeout(() => {
          setVault((prev) => {
            prev.forEach((v) => {
              if (usedVaultIds.has(v.id)) putVaultFile(v).catch(() => {})
            })
            return prev
          })
        }, 50)
      }
      setPendingVault([])

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
      pendingVault,
      refreshVault,
    ],
  )

  // "Ask in chat" — the anchored quote + comment becomes a follow-up message,
  // so the side-thread and the model stay in the same context.
  const askInChat = useCallback(
    (c: AnchorComment) => {
      const q = c.quote.length > 220 ? `${c.quote.slice(0, 220)}…` : c.quote
      const note = c.entries[0]?.text ?? ''
      send(`Regarding “${q}”${note ? ` — ${note}` : ''}`)
    },
    [send],
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
        briefsUnread={briefsUnreadQuery.data ?? 0}
        onLogout={logout}
        vaultCount={vault.length}
        onOpenVault={() => setVaultOpen(true)}
      />

      {view === 'deck' ? (
        <DeckView
          hosted={hosted}
          userName={user?.name}
          connections={connections}
          vault={vault}
          onOpenVault={() => setVaultOpen(true)}
          onAsk={(p) => {
            setView('chat')
            send(p)
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      ) : view === 'briefs' ? (
        <BriefsView
          dark={settings.theme === 'dark'}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenInChat={openBriefInChat}
        />
      ) : view === 'image' ? (
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
              comments={comments.filter((c) => c.conversationId === active?.id)}
              onAddComment={addComment}
              onReplyComment={replyComment}
              onResolveComment={resolveComment}
              onDeleteComment={deleteComment}
              onAskInChat={askInChat}
              ctxStats={ctxStats}
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
              customModels={toKimiModels([
                ...(caps?.extraModels ?? []),
                ...settings.customModels,
              ]).filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)}
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
              onOpenVault={() => setVaultOpen(true)}
              vaultCount={vault.length}
              pendingVault={pendingVault}
              onRemovePendingVault={(id) =>
                setPendingVault((prev) => prev.filter((v) => v.id !== id))
              }
              voiceMode={voiceMode}
              speaking={speaking}
              onToggleVoiceMode={toggleVoiceMode}
              onVoiceBargeIn={bargeIn}
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

      {vaultOpen && (
        <VaultDialog
          files={vault}
          folders={hosted ? vaultFolders : []}
          onAttach={
            view === 'chat'
              ? (f) => {
                  if (!hosted) {
                    setPendingVault((prev) =>
                      prev.some((p) => p.id === f.id) ? prev : [...prev, f],
                    )
                    setVaultOpen(false)
                    return
                  }
                  // Cloud vault: pull payload/text on demand, then attach —
                  // the send path reuses them without re-upload or re-extraction.
                  cloudVaultPayload(f.id)
                    .then((p) => {
                      setPendingVault((prev) =>
                        prev.some((x) => x.id === f.id)
                          ? prev
                          : [
                              ...prev,
                              {
                                ...f,
                                dataUrl:
                                  f.kind === 'image' && p.payloadB64
                                    ? `data:${p.mimeType};base64,${p.payloadB64}`
                                    : undefined,
                                extractedText: p.extractedText ?? undefined,
                              },
                            ],
                      )
                      setVaultOpen(false)
                    })
                    .catch(() => toast.error('Could not load that file from the cloud vault.'))
                }
              : undefined
          }
          onDelete={(id) => {
            if (hosted) cloudVaultDelete(id).catch(() => toast.error('Delete failed'))
            else deleteVaultFile(id).catch(() => {})
            setVault((prev) => prev.filter((v) => v.id !== id))
            setPendingVault((prev) => prev.filter((v) => v.id !== id))
          }}
          onUpload={
            hosted
              ? (fs, folderId) => {
                  for (const f of fs) void vaultUploadDirect(f, folderId)
                }
              : undefined
          }
          onCreateFolder={
            hosted
              ? (name) => {
                  cloudVaultCreateFolder(name, null)
                    .then(refreshVault)
                    .catch(() => toast.error('Could not create the folder.'))
                }
              : undefined
          }
          onDeleteFolder={
            hosted
              ? (id) => {
                  cloudVaultDeleteFolder(id)
                    .then(refreshVault)
                    .catch(() => toast.error('Could not delete the folder.'))
                }
              : undefined
          }
          onMove={
            hosted
              ? (id, folderId) => {
                  setVault((prev) =>
                    prev.map((v) => (v.id === id ? { ...v, folderId } : v)),
                  )
                  cloudVaultPatch(id, { folderId })
                    .then(refreshVault)
                    .catch(() => toast.error('Move failed.'))
                }
              : undefined
          }
          onDownload={(f) => void vaultDownload(f)}
          onLoadText={
            hosted
              ? async (f) => (await cloudVaultPayload(f.id)).extractedText ?? ''
              : async (f) => f.extractedText ?? ''
          }
          onSaveText={(f, text) => {
            if (hosted) {
              setVault((prev) =>
                prev.map((v) => (v.id === f.id ? { ...v, hasText: Boolean(text) } : v)),
              )
              cloudVaultPatch(f.id, { extractedText: text })
                .then(() => toast.success('Saved to the cloud vault.'))
                .catch(() => toast.error('Save failed.'))
            } else {
              putVaultFile({ ...f, extractedText: text })
                .then(refreshVault)
                .catch(() => {})
            }
          }}
          onClose={() => setVaultOpen(false)}
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
