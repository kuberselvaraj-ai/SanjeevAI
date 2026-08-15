import type { ChatMessage, Settings } from './types'

export interface StreamCallbacks {
  onToken: (text: string) => void
  onReasoning?: (text: string) => void
  onDone: () => void
  onError: (err: string) => void
}

/**
 * Streams a chat completion from the Kimi (Moonshot) API.
 * The API is OpenAI-compatible and sends CORS headers, so it can be
 * called directly from the browser / Electron renderer.
 */
export async function streamChat(
  settings: Settings,
  model: string,
  messages: ChatMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
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
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: settings.temperature,
        stream: true,
      }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return cb.onDone()
    return cb.onError(`Network error: ${(e as Error).message}`)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.error?.message ?? JSON.stringify(body)
    } catch {
      detail = await res.text().catch(() => '')
    }
    return cb.onError(`Kimi API error ${res.status}: ${detail || res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) return cb.onError('No response stream')

  const decoder = new TextDecoder()
  let buffer = ''

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
          const delta = json.choices?.[0]?.delta
          if (delta?.reasoning_content) cb.onReasoning?.(delta.reasoning_content)
          if (delta?.content) cb.onToken(delta.content)
        } catch {
          // partial JSON chunk — skip
        }
      }
    }
    cb.onDone()
  } catch (e) {
    if ((e as Error).name === 'AbortError') return cb.onDone()
    cb.onError(`Stream interrupted: ${(e as Error).message}`)
  }
}
