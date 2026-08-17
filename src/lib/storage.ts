import type { Conversation, Settings, VideoJob } from './types'
import { DEFAULT_MODEL } from './models'
import { BUNDLED_MOONSHOT_KEY } from './bundled-config'

const KEYS = {
  settings: 'kimi-studio:settings',
  conversations: 'kimi-studio:conversations',
  videos: 'kimi-studio:videos',
}

export const DEFAULT_SETTINGS: Settings = {
  moonshotKey: '',
  minimaxKey: '',
  moonshotBaseUrl: 'https://api.moonshot.ai/v1',
  minimaxBaseUrl: 'https://api.minimax.io/v1',
  temperature: 0.6,
  theme: 'light',
  defaultModel: DEFAULT_MODEL,
  webSearch: false,
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) } as T
  } catch {
    return fallback
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full / unavailable — ignore
  }
}

export const store = {
  loadSettings: (): Settings => {
    const s = read(KEYS.settings, DEFAULT_SETTINGS)
    // A key bundled into this build acts as the default when none is saved
    if (!s.moonshotKey && BUNDLED_MOONSHOT_KEY) s.moonshotKey = BUNDLED_MOONSHOT_KEY
    return s
  },
  saveSettings: (s: Settings) => write(KEYS.settings, s),
  loadConversations: (): Conversation[] => readArray<Conversation>(KEYS.conversations),
  saveConversations: (c: Conversation[]) => write(KEYS.conversations, c),
  loadVideos: (): VideoJob[] => readArray<VideoJob>(KEYS.videos),
  saveVideos: (v: VideoJob[]) => write(KEYS.videos, v),
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}
