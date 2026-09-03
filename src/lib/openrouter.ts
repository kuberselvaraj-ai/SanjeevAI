import type { Settings } from './types'
import type { ApiMessage, StreamCallbacks } from './kimi'

/**
 * Desktop mode: call OpenRouter directly with the user's own key
 * (OpenAI-compatible, CORS-enabled). Hosted mode relays via the server
 * instead — see api/services/openrouter.ts.
 *
 * No $web_search builtin here (that's Moonshot-only), so a single round
 * with no tool loop is enough.
 */
export async function streamOpenRouter(
  settings: Settings,
  model: string,
  messages: ApiMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openrouterKey}`,
        'X-Title': 'Sanjeev AI',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: settings.temperature,
        stream: true,
      }),
      signal,
    })

    if (!res.ok) {
      let detail = ''
      try {
        const body = await res.json()
        detail = body?.error?.message ?? JSON.stringify(body)
      } catch {
        detail = await res.text().catch(() => '')
      }
      throw new Error(`OpenRouter error ${res.status}: ${detail || res.statusText}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response stream')

    const decoder = new TextDecoder()
    let buffer = ''
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
          const delta = json.choices?.[0]?.delta
          // OpenRouter normalizes reasoning as `reasoning` on some models.
          const reasoning = delta?.reasoning_content ?? delta?.reasoning
          if (reasoning) cb.onReasoning?.(reasoning)
          if (delta?.content) cb.onToken(delta.content)
        } catch {
          // partial JSON chunk — skip
        }
      }
    }
    cb.onStatus?.(null)
    cb.onDone()
  } catch (e) {
    cb.onStatus?.(null)
    if ((e as Error).name === 'AbortError') return cb.onDone()
    cb.onError((e as Error).message)
  }
}
