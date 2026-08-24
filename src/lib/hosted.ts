import type { Attachment } from './types'
import type { ApiMessage, StreamCallbacks, ToolCall } from './kimi'
import { WEB_SEARCH_TOOL, mergeToolCallDelta } from './kimi'
import { fileToDataUrl, isImageMime, MAX_DOC_SIZE, MAX_IMAGE_SIZE } from './files'
import { uid } from './storage'

/**
 * Hosted mode (browser on sanjeevai web): the server holds the API keys,
 * meters usage per account, and relays Moonshot SSE verbatim — so the
 * stream parsing below mirrors the direct path in lib/kimi.ts.
 */

async function hostedRound(
  model: string,
  messages: ApiMessage[],
  temperature: number,
  webSearch: boolean,
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ finishReason: string | null; toolCalls: ToolCall[] }> {
  let res: Response
  try {
    res = await fetch('/api/hosted/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        model,
        messages,
        temperature,
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
      detail = body?.error ?? JSON.stringify(body)
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(detail || `Server error ${res.status}`)
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

/** Hosted streaming chat with the $web_search tool-call loop (max 4 rounds). */
export async function hostedStreamChat(
  req: { model: string; messages: ApiMessage[]; temperature: number; webSearch: boolean },
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const history = [...req.messages]
  try {
    for (let round = 0; round < 4; round++) {
      const { finishReason, toolCalls } = await hostedRound(
        req.model,
        history,
        req.temperature,
        req.webSearch,
        cb,
        signal,
      )
      if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
        cb.onStatus?.(null)
        return cb.onDone()
      }
      cb.onStatus?.('Searching the web…')
      history.push({ role: 'assistant', content: null, tool_calls: toolCalls })
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

/** Upload a document for server-side text extraction. */
export async function hostedExtract(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch('/api/hosted/extract', {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `Extraction failed (${res.status})`)
  return data.text as string
}

/** Hosted counterpart of processFile: images stay local (base64), docs go
 *  through the server-side extractor. */
export async function processFileHosted(file: File): Promise<Attachment> {
  const base: Attachment = {
    id: uid(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: isImageMime(file.type) ? 'image' : 'doc',
    status: 'ready',
  }
  try {
    if (base.kind === 'image') {
      if (file.size > MAX_IMAGE_SIZE) throw new Error('Image exceeds the 20 MB limit')
      base.dataUrl = await fileToDataUrl(file)
    } else {
      if (file.size > MAX_DOC_SIZE) throw new Error('File exceeds the 100 MB limit')
      base.extractedText = await hostedExtract(file)
    }
  } catch (e) {
    base.status = 'error'
    base.error = (e as Error).message
  }
  return base
}
