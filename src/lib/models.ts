export interface KimiModel {
  id: string
  label: string
  description: string
  badge?: string
}

/**
 * Current Kimi (Moonshot AI) model lineup — see platform.moonshot.ai model list.
 * You can also type any custom model id in Settings.
 */
export const KIMI_MODELS: KimiModel[] = [
  {
    id: 'kimi-k3',
    label: 'Kimi K3',
    description: 'Flagship general model · 1M context',
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

export const DEFAULT_MODEL = 'kimi-k3'

export function modelLabel(id: string): string {
  return KIMI_MODELS.find((m) => m.id === id)?.label ?? id
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are Kimi, a helpful, thoughtful AI assistant. Answer clearly and directly. Use Markdown formatting when it helps readability, and fenced code blocks with language tags for code.'
