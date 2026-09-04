import type { Settings } from './types'
import type { ApiMessage, StreamCallbacks } from './kimi'

/**
 * Desktop mode: call the Anthropic Messages API directly with the user's
 * own key. Model id is exactly "claude-fable-5-1"; adaptive thinking is
 * always on, so no temperature is sent. SSE events differ from OpenAI's
 * shape — parsed here and fed into the same callbacks.
 */
const ANTHROPIC_MODEL = 'claude-fable-5-1'

function toAnthropic(messages: ApiMessage[]) {
  const systemParts: string[] = []
  const out: Array<{ role: string; content: unknown }> = []
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemParts.push(m.content)
      continue
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (typeof m.content === 'string') {
      if (m.content) out.push({ role: m.role, content: m.content })
      continue
    }
    if (Array.isArray(m.content)) {
      out.push({
        role: m.role,
        content: m.content.map((p) => {
          if (p.type === 'text') return { type: 'text', text: p.text }
          const match = p.image_url.url.match(/^data:([^;]+);base64,(.+)$/)
          return match
            ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
            : { type: 'text', text: '[image omitted]' }
        }),
      })
    }
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return { system: systemParts.join('\n\n') || undefined, messages: out }
}

export async function streamAnthropic(
  settings: Settings,
  messages: ApiMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
  model?: string,
): Promise<void> {
  // "anthropic/claude-fable-5.1" → "claude-fable-5-1" (API id uses dashes)
  const modelName = model?.replace(/^anthropic\//, '').replace(/\./g, '-') || ANTHROPIC_MODEL
  try {
    const { system, messages: msgs } = toAnthropic(messages)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 16000,
        ...(system ? { system } : {}),
        messages: msgs,
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
      throw new Error(`Anthropic error ${res.status}: ${detail || res.statusText}`)
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
        let event: any
        try {
          event = JSON.parse(trimmed.slice(5).trim())
        } catch {
          continue
        }
        if (event.type === 'content_block_delta') {
          const d = event.delta
          if (d?.type === 'text_delta' && d.text) cb.onToken(d.text)
          else if (d?.type === 'thinking_delta' && d.thinking) cb.onReasoning?.(d.thinking)
        } else if (event.type === 'error') {
          throw new Error(event.error?.message ?? 'Anthropic stream error')
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
