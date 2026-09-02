import type { Settings } from './types'

/**
 * Voice mode: Whisper transcription (mic → text) and OpenAI TTS (read aloud).
 * Hosted mode goes through the server; desktop calls OpenAI with the local key.
 */

export function voiceAvailable(settings: Settings, hosted: boolean): boolean {
  return hosted || Boolean(settings.openaiKey)
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
  } else {
    form.append('model', 'whisper-1')
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.openaiKey}` },
      body: form,
    })
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
  let res: Response
  if (hosted) {
    res = await fetch('/api/hosted/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned }),
    })
  } else {
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiKey}`,
      },
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: cleaned }),
    })
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } }
    const msg = typeof j.error === 'string' ? j.error : j.error?.message
    throw new Error(msg || `TTS failed (${res.status})`)
  }
  const url = URL.createObjectURL(await res.blob())
  const audio = new Audio(url)
  currentAudio = audio
  audio.onended = () => URL.revokeObjectURL(url)
  await audio.play()
}

export function stopSpeaking() {
  currentAudio?.pause()
  currentAudio = null
}
