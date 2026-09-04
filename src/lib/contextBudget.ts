import type { ApiMessage } from './kimi'

/**
 * Context budget — keep the payload lean without the user thinking about it.
 *
 * Two ideas:
 *  1. slimHistory() trims stale weight before anything is sent: full document
 *     text is only re-sent for the most recent document upload; older docs
 *     degrade to head+tail excerpts, and ancient mega-replies get capped.
 *  2. estimateTokens() powers the live CTX meter so users can see what a
 *     turn costs before they send it.
 */

/** ~4 chars per token — good enough for a meter and for savings estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function messageChars(m: ApiMessage): number {
  return typeof m.content === 'string'
    ? m.content.length
    : JSON.stringify(m.content ?? '').length
}

export function estimateMessagesTokens(messages: ApiMessage[]): number {
  return Math.ceil(messages.reduce((n, m) => n + messageChars(m), 0) / 4)
}

/** Docs older than the newest upload are trimmed to head+tail. */
const DOC_FULL_MIN = 12_000 // docs smaller than this always ride in full
const DOC_HEAD = 6_000
const DOC_TAIL = 2_000
/** Ancient assistant walls-of-text get capped (recent turns stay intact). */
const OLD_REPLY_MAX = 10_000
const RECENT_TURNS_SAFE = 4

export interface SlimResult {
  messages: ApiMessage[]
  /** characters trimmed away by the diet */
  savedChars: number
  /** number of messages that were trimmed */
  trimmed: number
}

export function slimHistory(messages: ApiMessage[]): SlimResult {
  let savedChars = 0
  let trimmed = 0
  const out = messages.map((m, i) => {
    if (typeof m.content !== 'string') return m

    // A document rides in full on the turn it was attached (it sits just
    // ahead of its user message); once the conversation has moved on,
    // it degrades to a head+tail excerpt.
    const isFreshDoc = i >= messages.length - 3
    if (m.role === 'system' && m.content.startsWith('Document "') && !isFreshDoc) {
      if (m.content.length <= DOC_FULL_MIN) return m
      const head = m.content.slice(0, DOC_HEAD)
      const tail = m.content.slice(-DOC_TAIL)
      const omitted = m.content.length - DOC_HEAD - DOC_TAIL
      savedChars += omitted
      trimmed++
      return {
        ...m,
        content: `${head}\n\n[…${Math.round(omitted / 1000)}K characters of this document omitted — it was shared in full earlier in this conversation. Ask to re-attach it if you need the complete text…]\n\n${tail}`,
      }
    }

    // Ancient long replies → head excerpt
    const fromEnd = messages.length - 1 - i
    if (m.role === 'assistant' && fromEnd > RECENT_TURNS_SAFE && m.content.length > OLD_REPLY_MAX) {
      const head = m.content.slice(0, OLD_REPLY_MAX)
      const omitted = m.content.length - OLD_REPLY_MAX
      savedChars += omitted
      trimmed++
      return {
        ...m,
        content: `${head}\n\n[…earlier part of this reply trimmed from context — ${Math.round(omitted / 1000)}K characters omitted…]`,
      }
    }

    return m
  })

  return { messages: out, savedChars, trimmed }
}

/** Format a token count for the meter: 12300 → "12.3K" */
export function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
}
