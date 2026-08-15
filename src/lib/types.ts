export type Role = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  reasoning?: string
  model?: string
  createdAt: number
  /** true while the assistant reply is still streaming in */
  streaming?: boolean
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
}

export type VideoStatus = 'queued' | 'processing' | 'success' | 'failed'

export interface VideoJob {
  id: string
  taskId: string
  prompt: string
  model: string
  duration: number
  resolution: string
  status: VideoStatus
  videoUrl?: string
  error?: string
  createdAt: number
}
