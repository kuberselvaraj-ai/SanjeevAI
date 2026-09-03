import {
  AUTO_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  PREMIUM_SYSTEM_PROMPT,
  isPremiumModel,
} from './models'
import type { ApiMessage } from './kimi'

/**
 * Task routing — the "best AI for your task" engine.
 *
 * The conversation transcript lives in OUR database; models are stateless.
 * Every turn we replay the full history to whichever model wins the route,
 * so switching models mid-chat loses nothing. This module decides the winner.
 */

export type ChatTask = 'coding' | 'writing' | 'math' | 'research' | 'chat'

const CODING_RE =
  /\b(code|coding|program|function|debug|compile|typescript|javascript|python|rust|golang|java\b|c\+\+|sql|regex|api\b|sdk|github|git\b|bug|error|stack trace|refactor|algorithm|leetcode|docker|kubernetes|react|vue|css|html|node\.?js|npm|deploy|server|database|query|script|terminal|bash|shell|json|yaml|excel formula)\b|```/i
const MATH_RE =
  /\b(math|calculate|equation|integral|derivative|algebra|geometry|probability|statistics|proof|theorem|solve for|derivative|matrix|logarithm|trigonometry|calculus|puzzle|riddle|logic)\b|\d+\s*[-+*/^]\s*\d+/i
const RESEARCH_RE =
  /\b(research|latest|news|today|current|recent|summarize (this|the) (article|paper|doc)|analy[sz]e (this|the) (document|file|paper)|literature review|compare .+ (vs|versus|and) .+|deep dive|sources?|cite|citations?)\b/i
const WRITING_RE =
  /\b(write|draft|rewrite|edit|polish|proofread|email|letter|essay|blog|post|story|poem|cover letter|resume|cv|speech|script|caption|tagline|copywriting|translate|paraphrase|tone|grammar)\b/i

/** Cheap, instant, transparent heuristic — no extra API call, no latency. */
export function classifyTask(text: string): ChatTask {
  const t = text.trim()
  if (!t) return 'chat'
  if (CODING_RE.test(t)) return 'coding'
  if (MATH_RE.test(t)) return 'math'
  if (RESEARCH_RE.test(t)) return 'research'
  if (WRITING_RE.test(t)) return 'writing'
  return 'chat'
}

export interface RouteDecision {
  model: string
  task: ChatTask
  /** true when the user's pick (or a missing key) pinned the model */
  pinned: boolean
}

/**
 * Resolve which model answers this turn.
 *
 * @param requested   conversation model ('auto' or an explicit id)
 * @param text        the latest user message
 * @param hasImages   image attachments force Kimi K3 (vision)
 * @param premiumOpen whether an OpenRouter key is configured (server-side or desktop)
 */
export function resolveChatModel(
  requested: string,
  text: string,
  hasImages: boolean,
  premiumOpen: boolean,
): RouteDecision {
  if (requested !== AUTO_MODEL) return { model: requested, task: 'chat', pinned: true }
  if (hasImages) return { model: 'kimi-k3', task: 'chat', pinned: true }

  const task = classifyTask(text)
  switch (task) {
    case 'coding':
      // Kimi K3 — world #1 on the frontend coding arena, and the cheapest.
      return { model: 'kimi-k3', task, pinned: false }
    case 'research':
      // Kimi K3 — SOTA on BrowseComp deep research, 1M-token context.
      return { model: 'kimi-k3', task, pinned: false }
    case 'math':
      // GPT-5.6 Sol — strongest step-by-step reasoning.
      return {
        model: premiumOpen ? 'openai/gpt-5.6-sol' : 'kimi-k3',
        task,
        pinned: !premiumOpen,
      }
    case 'writing':
    case 'chat':
    default:
      // Claude Fable 5 — best writing quality & conversation.
      return {
        model: premiumOpen ? 'anthropic/claude-fable-5' : 'kimi-k3',
        task,
        pinned: !premiumOpen,
      }
  }
}

/**
 * Premium models have smaller contexts than Kimi's 1M and cost ~3x more per
 * token — cap the replayed history. System prompt is always kept; oldest
 * turns drop off first (sliding window, like Claude's own app).
 */
export const PREMIUM_CONTEXT_CHARS = 240_000

export function fitMessagesToContext(
  messages: ApiMessage[],
  maxChars = PREMIUM_CONTEXT_CHARS,
): ApiMessage[] {
  const size = (m: ApiMessage) =>
    typeof m.content === 'string'
      ? m.content.length
      : JSON.stringify(m.content ?? '').length
  const total = messages.reduce((n, m) => n + size(m), 0)
  if (total <= maxChars) return messages

  const head: ApiMessage[] = []
  const rest = [...messages]
  // Preserve the leading system prompt
  if (rest[0]?.role === 'system') head.push(rest.shift()!)
  const headChars = head.reduce((n, m) => n + size(m), 0)

  const kept: ApiMessage[] = []
  let budget = maxChars - headChars
  for (let i = rest.length - 1; i >= 0; i--) {
    const s = size(rest[i])
    if (s > budget) break
    kept.unshift(rest[i])
    budget -= s
  }
  const dropped = rest.length - kept.length
  if (dropped > 0) {
    head.push({
      role: 'system',
      content: `[${dropped} earlier message(s) omitted to fit this model's context window. The conversation continues from the most recent turns.]`,
    })
  }
  return [...head, ...kept]
}

/** Swap the Kimi identity for a neutral one when a premium model answers. */
export function systemPromptFor(model: string, base: string): string {
  if (isPremiumModel(model) && base === DEFAULT_SYSTEM_PROMPT) return PREMIUM_SYSTEM_PROMPT
  return base
}
