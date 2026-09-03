import type { Conversation, ImageJob, Settings, VideoJob } from './types'
import { DEFAULT_MODEL } from './models'
import { BUNDLED_MOONSHOT_KEY } from './bundled-config'

const KEYS = {
  settings: 'kimi-studio:settings',
  conversations: 'kimi-studio:conversations',
  videos: 'kimi-studio:videos',
  images: 'kimi-studio:images',
}

export const DEFAULT_SETTINGS: Settings = {
  moonshotKey: '',
  minimaxKey: '',
  openaiKey: '',
  geminiKey: '',
  e2bKey: '',
  dashscopeKey: '',
  arkKey: '',
  falKey: '',
  elevenlabsKey: '',
  openrouterKey: '',
  anthropicKey: '',
  moonshotBaseUrl: 'https://api.moonshot.ai/v1',
  minimaxBaseUrl: 'https://api.minimax.io/v1',
  temperature: 0.6,
  theme: 'light',
  defaultModel: DEFAULT_MODEL,
  webSearch: false,
  deepResearch: false,
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
  loadConversations: (): Conversation[] =>
    readArray<Conversation>(KEYS.conversations).map((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        // A message stuck in "streaming" means the tab was closed/reloaded
        // mid-generation. Keep any partial content; only flag an error (with
        // a Retry button) when nothing arrived at all.
        !m.streaming
          ? m
          : m.content
            ? { ...m, streaming: false }
            : { ...m, streaming: false, error: m.error ?? 'Generation interrupted — hit Retry.' },
      ),
    })),
  saveConversations: (c: Conversation[]) => write(KEYS.conversations, c),
  loadVideos: (): VideoJob[] => readArray<VideoJob>(KEYS.videos),
  saveVideos: (v: VideoJob[]) => write(KEYS.videos, v),
  // Images are data URLs (~1–3 MB each) — keep only the newest few so
  // localStorage doesn't overflow.
  loadImages: (): ImageJob[] => readArray<ImageJob>(KEYS.images),
  saveImages: (v: ImageJob[]) => write(KEYS.images, v.slice(0, 8)),
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}
