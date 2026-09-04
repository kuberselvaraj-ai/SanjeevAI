import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, X } from 'lucide-react'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

const SILENCE_MS = 1600
const RMS_THRESHOLD = 0.02
const MAX_RECORD_MS = 60_000

/**
 * Hands-free voice loop: tap once → listening (auto-stops on silence) →
 * transcribed → sent → reply streams → spoken aloud. Tap the orb while
 * recording to send immediately; tap X to leave voice mode.
 */
export function VoiceModeBar({
  streaming,
  speaking,
  transcribe,
  onSend,
  onStop,
  onBargeIn,
  onExit,
}: {
  streaming: boolean
  /** the reply is currently being read aloud */
  speaking: boolean
  transcribe: (blob: Blob) => Promise<string>
  onSend: (text: string) => void
  onStop: () => void
  /** user started talking — stop any playback */
  onBargeIn: () => void
  onExit: () => void
}) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState('')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cleanupRef = useRef<() => void>(() => {})
  const stateRef = useRef<VoiceState>('idle')
  stateRef.current = state

  const stopRecording = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop()
  }

  const startRecording = async () => {
    if (stateRef.current === 'recording' || stateRef.current === 'transcribing') return
    onBargeIn()
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        cleanupRef.current()
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 1000) {
          setState('idle')
          return
        }
        setState('transcribing')
        try {
          const text = (await transcribe(blob)).trim()
          if (text) {
            setState('thinking')
            onSend(text)
          } else {
            setError('Didn’t catch that — tap to try again')
            setState('idle')
          }
        } catch (e) {
          setError((e as Error).message)
          setState('idle')
        }
      }

      // Silence detection — stop 1.6s after the user finishes speaking.
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      let heardSpeech = false
      let silentFor = 0
      const iv = setInterval(() => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        if (rms > RMS_THRESHOLD) {
          heardSpeech = true
          silentFor = 0
        } else if (heardSpeech) {
          silentFor += 100
          if (silentFor >= SILENCE_MS) stopRecording()
        }
      }, 100)
      const maxTimer = setTimeout(stopRecording, MAX_RECORD_MS)
      cleanupRef.current = () => {
        clearInterval(iv)
        clearTimeout(maxTimer)
        ctx.close().catch(() => {})
      }

      recRef.current = rec
      rec.start()
      setState('recording')
    } catch {
      setError('Microphone access denied')
      setState('idle')
    }
  }

  // Enter voice mode → start listening immediately.
  useEffect(() => {
    startRecording()
    return () => cleanupRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reply done streaming → spoken by Home → back to idle when speech ends.
  useEffect(() => {
    if (state === 'thinking' && !streaming) setState(speaking ? 'speaking' : 'idle')
    else if (state === 'speaking' && !speaking) setState('idle')
  }, [streaming, speaking, state])

  const statusText =
    state === 'recording'
      ? 'Listening…'
      : state === 'transcribing'
        ? 'Transcribing…'
        : state === 'thinking'
          ? 'Responding…'
          : state === 'speaking'
            ? 'Speaking…'
            : (error ?? 'Tap to talk')

  return (
    <div className="px-4 pb-4 pt-2 md:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          {/* Orb */}
          {streaming ? (
            <button
              onClick={onStop}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
              title="Stop generating"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => (state === 'recording' ? stopRecording() : startRecording())}
              disabled={state === 'transcribing' || state === 'speaking'}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-60 ${
                state === 'recording'
                  ? 'bg-destructive/90 text-white'
                  : 'bg-primary text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.45)] hover:opacity-90'
              }`}
              title={state === 'recording' ? 'Send now' : 'Talk'}
            >
              {state === 'recording' && (
                <span className="absolute inset-0 animate-ping rounded-full bg-destructive/50" />
              )}
              {state === 'transcribing' ? (
                <Loader2 size={17} className="animate-spin" />
              ) : state === 'recording' ? (
                <Square size={14} fill="currentColor" />
              ) : (
                <Mic size={17} />
              )}
            </button>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-telemetry text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
              Voice mode
            </p>
            <p
              className={`mt-0.5 truncate text-[13px] font-medium ${
                error && state === 'idle' ? 'text-destructive' : ''
              }`}
            >
              {statusText}
              {state === 'recording' && (
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  auto-sends when you pause
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => {
              stopRecording()
              onExit()
            }}
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Exit voice mode"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
          Speak — pausing sends it · the reply is read aloud · tap the orb to talk again
        </p>
      </div>
    </div>
  )
}
