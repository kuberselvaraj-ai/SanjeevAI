/**
 * Cross-chat memory — ChatGPT-style "remember this".
 * Stored in localStorage (same place as conversations); injected into the
 * system prompt of every chat. Users manage entries in Settings.
 */

const KEY = 'kimi-studio:memory'
const MAX_ENTRIES = 100

export function loadMemories(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function saveMemories(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)))
  } catch {
    // storage full — ignore
  }
}

export function addMemory(fact: string): string[] {
  const trimmed = fact.trim().slice(0, 500)
  if (!trimmed) return loadMemories()
  const list = loadMemories().filter((m) => m.toLowerCase() !== trimmed.toLowerCase())
  const next = [trimmed, ...list]
  saveMemories(next)
  return next
}

export function removeMemory(index: number): string[] {
  const next = loadMemories().filter((_, i) => i !== index)
  saveMemories(next)
  return next
}

/** System-prompt block injected into every conversation. */
export function memoryContext(): string {
  const list = loadMemories()
  if (list.length === 0) return ''
  return `Things the user asked you to remember across chats:\n${list
    .map((m) => `- ${m}`)
    .join('\n')}\nUse these when relevant; don't repeat them back unprompted.`
}
