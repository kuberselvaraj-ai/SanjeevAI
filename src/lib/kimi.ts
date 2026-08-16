import type { Settings } from './types'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ApiMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | MessagePart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface StreamCallbacks {
  onToken: (text: string) => void
  onReasoning?: (text: string) => void
  /** transient working status, e.g. "Searching the web…" (null to clear) */
  onStatus?: (status: string | null) => void
  onDone: () => void
  onError: (err: string) => void
}

const WEB_SEARCH_TOOL = {
  type: 'builtin_function',
  function: { name: '$web_search' },
}

/** Accumulate streamed tool_call deltas (they arrive fragmented by index). */
function mergeToolCallDelta(acc: ToolCall[], deltas: unknown[]): ToolCall[] {
  const next = [...acc]
  for (const raw of deltas as Array<{
    index: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>) {
    const i = raw.index ?? 0
    if (!next[i]) {
      next[i] = { id: '', type: 'function', function: { name: '', arguments: '' } }
    }
    if (raw.id) next[i].id = raw.id
    if (raw.function?.name) next[i].function.name = raw.function.name
    if (raw.function?.arguments) next[i].function.arguments += raw.function.arguments
  }
  return next
}

/** One streaming request round. Returns finish reason and any tool calls. */
async function streamRound(
  settings: Settings,
  model: string,
  messages: ApiMessage[],
  webSearch: boolean,
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ finishReason: string | null; toolCalls: ToolCall[] }> {
  const base = settings.moonshotBaseUrl.replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.moonshotKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: settings.temperature,
        stream: true,
        ...(webSearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
      }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { finishReason: 'stop', toolCalls: [] }
    throw new Error(`Network error: ${(e as Error).message}`)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.error?.message ?? JSON.stringify(body)
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(`Kimi API error ${res.status}: ${detail || res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response stream')

  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | null = null
  let toolCalls: ToolCall[] = []

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const choice = json.choices?.[0]
          const delta = choice?.delta
          if (delta?.reasoning_content) cb.onReasoning?.(delta.reasoning_content)
          if (delta?.content) cb.onToken(delta.content)
          if (delta?.tool_calls) toolCalls = mergeToolCallDelta(toolCalls, delta.tool_calls)
          if (choice?.finish_reason) finishReason = choice.finish_reason
        } catch {
          // partial JSON chunk — skip
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { finishReason: 'stop', toolCalls: [] }
    throw new Error(`Stream interrupted: ${(e as Error).message}`)
  }

  return { finishReason, toolCalls }
}

/**
 * Streams a chat completion from the Kimi (Moonshot) API, handling the
 * built-in $web_search tool-call loop when web search is enabled.
 * The API is OpenAI-compatible and CORS-enabled, so it runs directly
 * from the browser / Electron renderer.
 */
export async function streamChat(
  settings: Settings,
  model: string,
  messages: ApiMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const webSearch = settings.webSearch
  const history = [...messages]

  try {
    for (let round = 0; round < 4; round++) {
      const { finishReason, toolCalls } = await streamRound(
        settings,
        model,
        history,
        webSearch,
        cb,
        signal,
      )

      if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
        cb.onStatus?.(null)
        return cb.onDone()
      }

      // The model asked to search: echo the call back so Moonshot executes it.
      cb.onStatus?.('Searching the web…')
      history.push({
        role: 'assistant',
        content: null,
        tool_calls: toolCalls,
      })
      for (const call of toolCalls) {
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: call.function.arguments,
        })
      }
    }
    cb.onStatus?.(null)
    cb.onDone()
  } catch (e) {
    cb.onStatus?.(null)
    cb.onError((e as Error).message)
  }
}
