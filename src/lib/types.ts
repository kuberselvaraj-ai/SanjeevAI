export type Role = 'user' | 'assistant' | 'system'

export interface Attachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'doc'
  /** base64 data URL (images — sent inline to the vision model) */
  dataUrl?: string
  /** text extracted via the Kimi Files API (documents) */
  extractedText?: string
  status: 'ready' | 'error'
  error?: string
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  reasoning?: string
  model?: string
  attachments?: Attachment[]
  createdAt: number
  /** true while the assistant reply is still streaming in */
  streaming?: boolean
  /** true while attachments are being uploaded/extracted */
  preparing?: boolean
  /** transient status shown while working, e.g. "Searching the web…" */
  statusText?: string
  /** council pass: name of the premium model that refined this reply */
  refinedBy?: string
  error?: string
}

export interface Conversation {
  id: string
  title: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  /** pinned conversations float to the top of the sidebar */
  pinned?: boolean
  /** temporary chats are never persisted (ChatGPT-style temporary chat) */
  temp?: boolean
  /** response style preset id (see lib/styles.ts) */
  style?: string
  /**
   * Internal AI labeling — a rolling digest of the conversation's older
   * messages, generated in the background. Powers context compression
   * (old turns collapse into this summary) and cross-chat recall. Not a
   * user-facing organization system; labels surface only as subtle chips.
   */
  digest?: string
  digestLabels?: string[]
  /** unresolved questions / next steps the AI still owes the user */
  openLoops?: string[]
  /** compression watermark: id of the last message folded into the digest */
  digestThrough?: string
}

/** One entry inside an anchored comment thread (the first entry is the comment itself). */
export interface CommentEntry {
  id: string
  text: string
  createdAt: number
}

/**
 * A comment thread anchored to an exact quote inside a chat message —
 * Google-Docs-style side threads for AI conversations.
 */
export interface AnchorComment {
  id: string
  conversationId: string
  messageId: string
  /** exact selected text this thread is anchored to */
  quote: string
  entries: CommentEntry[]
  resolved?: boolean
  createdAt: number
}

/** A user-added model (any OpenRouter slug, e.g. "google/gemini-4-pro"). */
export interface CustomModel {
  id: string
  label: string
  description?: string
}

export interface Settings {
  moonshotKey: string
  minimaxKey: string
  /** OpenAI key — GPT Image 2 (Image Studio, desktop mode) */
  openaiKey: string
  /** Google AI Studio key — Nano Banana 2 (Image Studio, desktop mode) */
  geminiKey: string
  /** E2B key — run Python code from chat (desktop mode) */
  e2bKey: string
  /** Alibaba Bailian key — Qwen Image + voice (desktop mode) */
  dashscopeKey: string
  /** Volcano Engine Ark key — Seedream images (desktop mode) */
  arkKey: string
  /** fal.ai key — FLUX.2, Nano Banana Pro, Ideogram 4, Kling/Veo video (desktop mode) */
  falKey: string
  /** ElevenLabs key — premium voices (desktop mode) */
  elevenlabsKey: string
  /** OpenRouter key — Claude Fable 5.1 & GPT chat fallback (desktop mode) */
  openrouterKey: string
  /** Anthropic key — Claude Fable 5.1 chat, first-party (desktop mode) */
  anthropicKey: string
  /** defaults to https://api.moonshot.ai/v1 */
  moonshotBaseUrl: string
  /** defaults to https://api.minimax.io/v1 */
  minimaxBaseUrl: string
  temperature: number
  theme: 'light' | 'dark'
  defaultModel: string
  /** enable Kimi's built-in $web_search tool (billed per search call) */
  webSearch: boolean
  /** deep research mode — forces web search + cited report structure */
  deepResearch: boolean
  /** premium council: Claude/GPT reviews & refines deliverables before you see them */
  council: boolean
  /** user-added models — appear in the picker, routed via first-party key or OpenRouter */
  customModels: CustomModel[]
  /** TV / ten-foot mode — large type, voice-first, deck-forward */
  tvMode?: boolean
}

/**
 * A file in the Mission Vault — upload once, reuse in any chat.
 * Payloads live in IndexedDB (localStorage is too small); chats hold
 * their own attachment copies, so deleting a vault entry never breaks history.
 */
export interface VaultFile {
  id: string
  /** sha-256 of the original file bytes — dedupe key */
  hash: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'doc'
  dataUrl?: string
  extractedText?: string
  /** auto-derived + user tags for filtering */
  tags: string[]
  /** folder this file lives in (cloud vault; null = root) */
  folderId?: number | null
  /** cloud meta flags — payload/text exist server-side but aren't in the tree listing */
  hasPayload?: boolean
  hasText?: boolean
  /** chats that have used this file */
  usedIn: { conversationId: string; title: string; at: number }[]
  createdAt: number
}

/** A folder in the cloud vault. */
export interface VaultFolder {
  id: number
  name: string
  parentId: number | null
}

export type VideoStatus = 'queued' | 'processing' | 'success' | 'failed'

export interface VideoJob {
  id: string
  taskId: string
  prompt: string
  model: string
  duration: number
  resolution: string
  ratio?: string
  status: VideoStatus
  videoUrl?: string
  error?: string
  createdAt: number
}

export type ImageStatus = 'generating' | 'done' | 'failed'

export interface ImageJob {
  id: string
  prompt: string
  model: string
  /** human label, e.g. "1024×1024 · high" or "16:9 · 1K" */
  detail: string
  status: ImageStatus
  /** data URL of the finished image */
  imageUrl?: string
  error?: string
  createdAt: number
}
