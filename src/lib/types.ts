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
  /** OpenRouter key — Claude Fable 5 & GPT-5.6 Sol chat fallback (desktop mode) */
  openrouterKey: string
  /** Anthropic key — Claude Fable 5 chat, first-party (desktop mode) */
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
