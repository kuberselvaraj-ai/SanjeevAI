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
}

export interface Settings {
  moonshotKey: string
  minimaxKey: string
  /** defaults to https://api.moonshot.ai/v1 */
  moonshotBaseUrl: string
  /** defaults to https://api.minimax.io/v1 */
  minimaxBaseUrl: string
  temperature: number
  theme: 'light' | 'dark'
  defaultModel: string
  /** enable Kimi's built-in $web_search tool (billed per search call) */
  webSearch: boolean
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
