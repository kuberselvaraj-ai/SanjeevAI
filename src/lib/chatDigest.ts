import type { ChatMessage, Conversation, Settings } from '@/lib/types'

/**
 * Chat digests — internal labeling + token-flat memory.
 *
 * Two jobs:
 *  1. Rolling compression: once a conversation grows past a few turns, the
 *     older messages are folded into a compact digest in the BACKGROUND
 *     (never blocking a reply). Future turns replay the digest instead of
 *     the raw history, so a 40-turn thread costs about the same context as
 *     a 4-turn one. The watermark (digestCount) makes each refresh
 *     incremental — only the newly-aged messages are ever re-summarized.
 *  2. Cross-chat recall: digests are scored against the new query LOCALLY
 *     (term overlap — zero tokens) and only the top couple of relevant ones
 *     are injected. The AI "remembers" other threads without anyone paying
 *     to re-send them.
 *
 * Labels are internal metadata — they power search, recall, and the deck's
 * sense of your world; the UI shows them only as subtle header chips.
 */

export interface ChatDigest {
  summary: string
  labels: string[]
  openLoops: string[]
}

/** How many trailing messages always stay raw (never compressed away). */
const KEEP_RECENT = 6
/** Refresh the digest once this many messages have aged past the watermark. */
const REFRESH_EVERY = 4
/** Don't bother digesting threads shorter than this. */
const MIN_MESSAGES = KEEP_RECENT + 2

async function requestDigest(
  window: { role: string; content: string }[],
  priorDigest: string | undefined,
  settings: Settings,
  hosted: boolean,
): Promise<ChatDigest | null> {
  try {
    if (hosted) {
      const res = await fetch('/api/hosted/chat-digest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: window, priorDigest }),
      })
      const j = (await res.json().catch(() => null)) as { digest?: ChatDigest } | null
      return res.ok && j?.digest ? j.digest : null
    }
    // Desktop: the user's own Moonshot key, same JSON contract.
    if (!settings.moonshotKey) return null
    const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.moonshotKey}`,
      },
      body: JSON.stringify({
        model: 'kimi-k3',
        temperature: 1, // kimi-k3 only accepts 1
        max_tokens: 3000, // reasoning burns budget before content lands
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'Compress the conversation window into ONLY JSON: {"summary":"…≤90 words…","labels":["3-6 lowercase topic tags"],"openLoops":["0-3 unresolved items"]}. Dense, factual, written so a future AI can use it INSTEAD of the raw messages. Fold in any prior digest provided.',
          },
          {
            role: 'user',
            content: JSON.stringify({ priorDigest: priorDigest || undefined, window }),
          },
        ],
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = data.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as Partial<ChatDigest>
    return {
      summary: String(parsed.summary ?? '').slice(0, 700),
      labels: (parsed.labels ?? []).map((l) => String(l).toLowerCase().slice(0, 30)).slice(0, 6),
      openLoops: (parsed.openLoops ?? []).map((l) => String(l).slice(0, 140)).slice(0, 3),
    }
  } catch {
    return null
  }
}

/**
 * Refresh a conversation's digest if enough messages have aged past the
 * watermark. Returns the patch to merge into the conversation, or null when
 * nothing needs doing. Fire-and-forget — never on the critical path.
 */
export async function digestPatchFor(
  conv: Conversation,
  settings: Settings,
  hosted: boolean,
): Promise<Pick<Conversation, 'digest' | 'digestLabels' | 'openLoops' | 'digestThrough'> | null> {
  const usable = conv.messages.filter((m) => !m.error && !m.streaming && m.content.trim())
  if (usable.length < MIN_MESSAGES) return null
  const throughIdx = conv.digestThrough
    ? usable.findIndex((m) => m.id === conv.digestThrough)
    : -1
  const cut = usable.length - KEEP_RECENT // messages[0..cut) are eligible to fold
  const start = throughIdx + 1
  if (cut - start < (throughIdx >= 0 ? REFRESH_EVERY : 1) || cut - start <= 0) return null
  const aging = usable.slice(Math.max(0, start), cut)
  if (aging.length === 0) return null
  const digest = await requestDigest(
    aging.map((m) => ({ role: m.role, content: m.content })),
    conv.digest,
    settings,
    hosted,
  )
  if (!digest || !digest.summary) return null
  return {
    digest: digest.summary,
    digestLabels: digest.labels,
    openLoops: digest.openLoops,
    digestThrough: usable[cut - 1].id,
  }
}

/** System block that stands in for the compressed older turns. */
export function compressionBlock(conv: Conversation): string {
  if (!conv.digest) return ''
  const loops = (conv.openLoops ?? []).filter(Boolean)
  return (
    `Earlier in this conversation (compressed to save context — trust it as the record of those turns):\n${conv.digest}` +
    (loops.length ? `\nStill open: ${loops.map((l) => `- ${l}`).join('\n')}` : '')
  )
}

// ── Cross-chat recall ────────────────────────────────────────────────────

const STOP = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about',
  'should', 'would', 'could', 'can', 'will', 'shall', 'may', 'might',
  'your', 'yours', 'you', 'our', 'ours', 'their', 'theirs', 'them', 'they',
  'have', 'has', 'had', 'been', 'being', 'are', 'was', 'were', 'does', 'do',
  'did', 'not', 'but', 'all', 'any', 'some', 'more', 'most', 'much', 'many',
  'give', 'make', 'tell', 'show', 'need', 'want', 'please', 'help', 'me',
])

function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
  return new Set(words)
}

/** Zero-token relevance of a conversation's digest to a query. */
export function digestRelevance(query: string, conv: Conversation): number {
  if (!conv.digest) return 0
  const q = contentWords(query)
  if (q.size === 0) return 0
  let score = 0
  const labels = conv.digestLabels ?? []
  for (const label of labels) {
    const lw = contentWords(label)
    for (const w of lw) if (q.has(w)) score += 2 // labels are high-signal
  }
  const body = contentWords(`${conv.digest} ${(conv.openLoops ?? []).join(' ')} ${conv.title}`)
  for (const w of q) if (body.has(w)) score += 1
  return score
}

/**
 * Build the recall block for a new turn: the top digests from OTHER
 * conversations, capped small so recall never becomes its own token problem.
 */
export function recallBlock(
  query: string,
  conversations: Conversation[],
  activeId: string | null,
): string {
  const scored = conversations
    .filter((c) => c.id !== activeId && c.digest && !c.temp)
    .map((c) => ({ c, s: digestRelevance(query, c) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s || b.c.updatedAt - a.c.updatedAt)
    .slice(0, 2)
  if (scored.length === 0) return ''
  const lines = scored.map(
    ({ c }) =>
      `- [${(c.digestLabels ?? []).slice(0, 3).join(', ') || c.title}] ${c.digest!.slice(0, 280)}`,
  )
  return `Related earlier threads (digests — answer from these when relevant, don't mention them unprompted):\n${lines.join('\n')}`
}

/** Messages that still need to go out raw: everything past the watermark. */
export function uncompressedMessages(conv: Conversation, messages: ChatMessage[]): ChatMessage[] {
  if (!conv.digest || !conv.digestThrough) return messages
  const idx = messages.findIndex((m) => m.id === conv.digestThrough)
  if (idx < 0) return messages // watermark lost (edited history) — send all once
  return messages.slice(idx + 1)
}
