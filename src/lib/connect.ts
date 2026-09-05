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
  {
    type: 'function',
    function: {
      name: 'slack_channels',
      description: "List the user's Slack channels (id, name, member count). Use this first for anything Slack-related.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'slack_read',
      description: 'Read recent messages from a Slack channel by its id (from slack_channels).',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel id from slack_channels' },
          limit: { type: 'number', description: 'Max messages (1-50, default 15)' },
        },
        required: ['channel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'slack_send',
      description:
        'Post a message to a Slack channel. ONLY call with confirm=true after the user has explicitly approved the exact channel and text in their latest message. Without confirm=true the server refuses and returns a reminder.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel id from slack_channels' },
          text: { type: 'string', description: 'Message text to post' },
          confirm: { type: 'boolean', description: 'Must be true — set only after explicit user approval' },
        },
        required: ['channel', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salesforce_query',
      description: "Run a read-only SOQL SELECT against the user's Salesforce org. Example: SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE IsClosed = false LIMIT 10",
      parameters: {
        type: 'object',
        properties: {
          soql: { type: 'string', description: 'A SOQL SELECT statement (read-only)' },
        },
        required: ['soql'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salesforce_opportunities',
      description: "List the user's open Salesforce opportunities (name, stage, amount, close date, account) — the sales pipeline at a glance.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'salesforce_update',
      description:
        'Update fields on a Salesforce record. ONLY call with confirm=true after the user has explicitly approved the exact record and field changes in their latest message. Without confirm=true the server refuses.',
      parameters: {
        type: 'object',
        properties: {
          objectType: { type: 'string', description: 'Salesforce object, e.g. Opportunity, Lead, Account' },
          id: { type: 'string', description: 'Record id (15/18-char Salesforce id)' },
          fields: { type: 'object', description: 'Field API names to new values, e.g. {"StageName":"Closed Won"}' },
          confirm: { type: 'boolean', description: 'Must be true — set only after explicit user approval' },
        },
        required: ['objectType', 'id', 'fields'],
      },
    },
  },
]

export const CONNECTOR_TOOL_NAMES = new Set(CONNECTOR_TOOLS.map((t) => t.function.name))

export const CONNECTOR_SYSTEM_HINT = `You also have connector tools for the user's linked accounts: Gmail + Calendar (gmail_list, gmail_read, gmail_draft, gmail_send, calendar_upcoming), Slack (slack_channels, slack_read, slack_send), and Salesforce (salesforce_query, salesforce_opportunities, salesforce_update). Use them when the user asks about email, schedule, Slack, or their sales pipeline. If a tool says the account is not connected, tell the user to connect it in Settings → Connections. Rules: summarize concisely; quote bodies only when asked; ALWAYS create an email draft with gmail_draft before sending and call gmail_send ONLY after explicit approval; call slack_send or salesforce_update with confirm=true ONLY after the user explicitly approves the exact action in a later message. Never send, post, delete, or modify anything on your own initiative.`

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
