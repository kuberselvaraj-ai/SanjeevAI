import type { Settings } from './types'

/**
 * Voice mode: mic → text and read-aloud.
 * Hosted mode goes through the server. Desktop mode calls the provider
 * directly: ElevenLabs (best, elevenlabsKey) → OpenAI (openaiKey) →
 * Alibaba Bailian (dashscopeKey).
 */

const DASHSCOPE_MM =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

export function voiceAvailable(settings: Settings, hosted: boolean): boolean {
  return hosted || Boolean(settings.elevenlabsKey || settings.openaiKey || settings.dashscopeKey)
}

/** Desktop ASR via ElevenLabs Scribe v2. */
async function transcribeElevenlabs(settings: Settings, blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('model_id', 'scribe_v2')
  form.append('file', blob, `audio.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`)
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': settings.elevenlabsKey },
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as {
    text?: string
    detail?: { message?: string } | string
  }
  if (!res.ok || data.text === undefined) {
    const detail = typeof data.detail === 'string' ? data.detail : data.detail?.message
    throw new Error(detail || `ElevenLabs API error ${res.status}`)
  }
  return data.text
}

/** Desktop TTS via ElevenLabs Flash v2.5 (Rachel). Returns an audio blob. */
async function speakElevenlabs(settings: Settings, text: string): Promise<Blob> {
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': settings.elevenlabsKey },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      detail?: { message?: string } | string
    }
    const detail = typeof data.detail === 'string' ? data.detail : data.detail?.message
    throw new Error(detail || `ElevenLabs API error ${res.status}`)
  }
  return res.blob()
}

async function blobToB64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** Desktop ASR via Alibaba Bailian qwen3-asr-flash. */
async function transcribeDashscope(settings: Settings, blob: Blob): Promise<string> {
  const b64 = await blobToB64(blob)
  const res = await fetch(DASHSCOPE_MM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.dashscopeKey}`,
    },
    body: JSON.stringify({
      model: 'qwen3-asr-flash',
      input: {
        messages: [
          { role: 'system', content: [{ text: '' }] },
          { role: 'user', content: [{ audio: `data:${blob.type || 'audio/webm'};base64,${b64}` }] },
        ],
      },
      parameters: { asr_options: { enable_itn: true } },
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    output?: { choices?: { message?: { content?: { text?: string }[] | string } }[] }
    message?: string
  }
  const content = data.output?.choices?.[0]?.message?.content
  const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : (content ?? '')
  if (!res.ok) throw new Error(data.message || `DashScope API error ${res.status}`)
  return text.trim()
}

/** Transcribe an audio blob (webm/ogg from MediaRecorder) to text. */
export async function transcribeAudio(
  settings: Settings,
  blob: Blob,
  hosted: boolean,
): Promise<string> {
  const form = new FormData()
  form.append('file', blob, `audio.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`)
  let res: Response
  if (hosted) {
    res = await fetch('/api/hosted/transcribe', {
      method: 'POST',
      credentials: 'include',
      body: form,
    })
  } else if (settings.elevenlabsKey) {
    return transcribeElevenlabs(settings, blob)
  } else if (settings.openaiKey) {
    form.append('model', 'whisper-1')
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.openaiKey}` },
      body: form,
    })
  } else {
    return transcribeDashscope(settings, blob)
  }
  const data = (await res.json().catch(() => ({}))) as {
    text?: string
    error?: string | { message?: string }
  }
  if (!res.ok || data.text === undefined) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message
    throw new Error(msg || `Transcription failed (${res.status})`)
  }
  return data.text
}

/** Desktop TTS via Alibaba Bailian qwen3-tts-flash. Returns an audio blob. */
async function speakDashscope(settings: Settings, text: string): Promise<Blob> {
  const res = await fetch(DASHSCOPE_MM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.dashscopeKey}`,
    },
    body: JSON.stringify({
      model: 'qwen3-tts-flash',
      input: { text, voice: 'Cherry', language_type: 'Auto' },
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    output?: { audio?: { url?: string; data?: string } }
    message?: string
  }
  const audio = data.output?.audio
  if (!res.ok || (!audio?.url && !audio?.data)) {
    throw new Error(data.message || `DashScope API error ${res.status}`)
  }
  if (audio.data) {
    const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0))
    return new Blob([bytes], { type: 'audio/mpeg' })
  }
  const audioRes = await fetch(audio.url!)
  if (!audioRes.ok) throw new Error(`Failed to download speech audio (${audioRes.status})`)
  return audioRes.blob()
}

/** Speak text aloud; returns when playback starts. Stops any previous playback. */
let currentAudio: HTMLAudioElement | null = null

export async function speakText(
  settings: Settings,
  text: string,
  hosted: boolean,
): Promise<void> {
  currentAudio?.pause()
  currentAudio = null
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/[#*`_>\[\]]/g, '')
    .slice(0, 4000)
  let audioBlob: Blob
  if (hosted) {
    const res = await fetch('/api/hosted/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
      const msg = typeof j.error === 'string' ? j.error : j.error?.message
      throw new Error(msg || `TTS failed (${res.status})`)
    }
    audioBlob = await res.blob()
  } else if (settings.elevenlabsKey) {
    audioBlob = await speakElevenlabs(settings, cleaned)
  } else if (settings.openaiKey) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiKey}`,
      },
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: cleaned }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
      const msg = typeof j.error === 'string' ? j.error : j.error?.message
      throw new Error(msg || `TTS failed (${res.status})`)
    }
    audioBlob = await res.blob()
  } else {
    audioBlob = await speakDashscope(settings, cleaned)
  }
  const url = URL.createObjectURL(audioBlob)
  const audio = new Audio(url)
  currentAudio = audio
  audio.onended = () => URL.revokeObjectURL(url)
  await audio.play()
}

export function stopSpeaking() {
  currentAudio?.pause()
  currentAudio = null
}
