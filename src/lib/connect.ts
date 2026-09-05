import type { ToolCall } from './kimi'

/**
 * Connectors — the agent reaches into linked accounts (Google first:
 * Gmail + Calendar) through server-side tools. Tokens never leave the
 * server; the model only sees tool results.
 *
 * Send gate: gmail_send only accepts a draftId created via gmail_draft,
 * and the model is instructed (CONNECTOR_SYSTEM_HINT) to send only after
 * the user explicitly approves — draft first, confirm, then send.
 */

// Intent detection — casual chat stays clear of connector tools.
const CONNECTOR_RE =
  /\b(e-?mails?|inbox|gmail|unread|reply to|draft (an? )?(e-?mail|reply)|send (an? )?(e-?mail|mail|message to)|calendar|meetings?|schedule|agenda|appointments?|my day|events? today|events? this week)\b/i

export function needsConnectorTools(text: string): boolean {
  const t = text.trim()
  if (t.length < 3) return false
  return CONNECTOR_RE.test(t)
}

export const CONNECTOR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'gmail_list',
      description:
        "List the user's Gmail messages (defaults to unread). Returns id, from, subject, date, snippet for each. Use this first for anything email-related.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Gmail search query, e.g. "is:unread", "from:board@acme.com", "subject:invoice". Default is:unread',
          },
          max: { type: 'number', description: 'Max messages (1-20, default 8)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_read',
      description: 'Read one Gmail message in full by its id (from gmail_list).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message id from gmail_list' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_draft',
      description:
        'Create a Gmail draft. ALWAYS draft first — never send without showing the draft to the user and getting explicit approval.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Plain-text email body' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gmail_send',
      description:
        'Send a previously created Gmail draft by draftId. ONLY call this after the user has explicitly approved sending in their latest message (e.g. "send it", "yes, send").',
      parameters: {
        type: 'object',
        properties: {
          draftId: { type: 'string', description: 'Draft id returned by gmail_draft' },
        },
        required: ['draftId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_upcoming',
      description: "List upcoming events from the user's primary Google Calendar.",
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Days ahead to look (1-14, default 2)' },
          max: { type: 'number', description: 'Max events (1-25, default 10)' },
        },
      },
    },
  },
]

export const CONNECTOR_TOOL_NAMES = new Set(CONNECTOR_TOOLS.map((t) => t.function.name))

export const CONNECTOR_SYSTEM_HINT = `You also have connector tools for the user's linked Google account: gmail_list, gmail_read, gmail_draft, gmail_send, calendar_upcoming. Use them when the user asks about email or their schedule. Rules: summarize emails concisely with sender and subject; quote message bodies only when asked; ALWAYS create a draft with gmail_draft before sending, show the user the draft (to, subject, body), and call gmail_send ONLY after the user explicitly approves in a later message. Never send, delete, or modify anything on your own initiative.`

/** Execute one connector call against the hosted server. */
export async function executeConnectorTool(call: ToolCall): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return 'Tool call had invalid arguments — continue without it.'
  }
  try {
    const res = await fetch('/api/connect/tool', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: call.function.name, args }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      result?: unknown
      error?: string
    }
    if (!res.ok || !body.ok) {
      return `Connector error: ${body.error ?? `request failed (${res.status})`}`
    }
    return JSON.stringify(body.result, null, 2).slice(0, 6000)
  } catch (e) {
    return `Connector unavailable (${(e as Error).message}). Tell the user the connection dropped and to try again.`
  }
}
