import type { Settings } from './types'
import type { ApiMessage, StreamCallbacks } from './kimi'

/**
 * Desktop mode: call OpenAI directly with the user's own key (the same key
 * also powers GPT Image 2 in the Image Studio). OpenAI-compatible SSE —
 * single round, no tool loop. Reasoning-style models can reject an explicit
 * temperature, so we retry without it on a 400.
 */
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol'

export async function streamOpenAi(
  settings: Settings,
  messages: ApiMessage[],
  cb: StreamCallbacks,
  signal?: AbortSignal,
  model?: string,
): Promise<void> {
  const modelName = model?.replace(/^openai\//, '') || DEFAULT_OPENAI_MODEL
  try {
    const call = (withTemperature: boolean) =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.openaiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          ...(withTemperature ? { temperature: settings.temperature } : {}),
          stream: true,
        }),
        signal,
      })

    let res = await call(true)
    if (res.status === 400) {
      const body = await res.text().catch(() => '')
      if (body.includes('temperature')) {
        res = await call(false)
      } else {
        throw new Error(`OpenAI error 400: ${body || 'Bad request'}`)
      }
    }
    if (!res.ok) {
      let detail = ''
      try {
        const body = await res.json()
        detail = body?.error?.message ?? JSON.stringify(body)
      } catch {
        detail = await res.text().catch(() => '')
      }
      throw new Error(`OpenAI error ${res.status}: ${detail || res.statusText}`)
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
