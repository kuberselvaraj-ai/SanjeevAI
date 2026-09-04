export interface KimiModel {
  id: string
  label: string
  description: string
  badge?: string
}

/**
 * Auto mode: each message is routed to the strongest model for its task
 * (see lib/route.ts). This is the default — "the best AI for your task".
 */
export const AUTO_MODEL = 'auto'

/**
 * Current Kimi (Moonshot AI) model lineup — see platform.moonshot.ai model list.
 * You can also type any custom model id in Settings.
 */
export const KIMI_MODELS: KimiModel[] = [
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    description: 'Flagship · #1 frontend coding & deep research · 1M context',
    badge: 'Latest',
  },
  {
    id: 'kimi-k2.7-code',
    label: 'Kimi Code',
    description: 'K2.7 tuned for coding & agents',
  },
  {
    id: 'kimi-k2.7-code-highspeed',
    label: 'Kimi Code · Highspeed',
    description: 'Same coding ability, much faster',
    badge: 'Fast',
  },
  {
    id: 'kimi-k2.6',
    label: 'Kimi K2.6',
    description: 'Previous generation, balanced',
  },
]

/**
 * Premium Western models. First-party keys (ANTHROPIC_API_KEY /
 * OPENAI_API_KEY) are preferred; OpenRouter covers whichever is missing.
 * The id doubles as the OpenRouter slug; first-party calls map it to
 * claude-fable-5 / gpt-6-astra / gpt-5.6-sol (overridable via env on the server).
 */
export const PREMIUM_CHAT_MODELS: KimiModel[] = [
  {
    id: 'anthropic/claude-fable-5',
    label: 'Claude Fable 5',
    description: 'Best writing & conversation · #1 overall quality',
    badge: 'Premium',
  },
  {
    id: 'openai/gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    description: 'General-purpose GPT · best value',
    badge: 'Premium',
  },
  {
    id: 'openai/gpt-6-astra',
    label: 'GPT-6 Astra',
    description: 'OpenAI flagship · best math, science & agentic work',
    badge: 'Premium',
  },
]

export const AUTO_ENTRY: KimiModel = {
  id: AUTO_MODEL,
  label: 'Auto · Best for the task',
  description: 'Coding & research → Kimi K3 · writing → Claude · math → GPT-6',
  badge: 'Default',
}

export const CHAT_MODELS: KimiModel[] = [AUTO_ENTRY, ...KIMI_MODELS, ...PREMIUM_CHAT_MODELS]

export const DEFAULT_MODEL = AUTO_MODEL

/** Premium models carry the OpenRouter "vendor/model" slug shape. */
export const isPremiumModel = (id: string) => id.includes('/')

export function modelLabel(id: string): string {
  return CHAT_MODELS.find((m) => m.id === id)?.label ?? id
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are Kimi, a helpful, thoughtful AI assistant. Answer clearly and directly. Use Markdown formatting when it helps readability, and fenced code blocks with language tags for code.'

/** Neutral identity used when the reply comes from a non-Kimi model. */
export const PREMIUM_SYSTEM_PROMPT =
  'You are Sanjeev AI, a helpful, thoughtful AI assistant. Answer clearly and directly. Use Markdown formatting when it helps readability, and fenced code blocks with language tags for code.'
