import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { ArrowUp, Square, ChevronDown, Cpu, Paperclip, X, FileText, Loader2, Globe, FolderGit2, Telescope, Mic } from 'lucide-react'
import { AUTO_ENTRY, KIMI_MODELS, PREMIUM_CHAT_MODELS, modelLabel } from '@/lib/models'
import { ACCEPTED_FILE_TYPES, formatSize, isImageMime } from '@/lib/files'

export interface PendingFile {
  file: File
  preview?: string
}

export function Composer({
  model,
  onModelChange,
  onSend,
  onStop,
  streaming,
  disabled,
  webSearch,
  onToggleWebSearch,
  onOpenWorkspace,
  workspaceSummary,
  onClearWorkspace,
  deepResearch,
  onToggleDeepResearch,
  voice,
}: {
  model: string
  onModelChange: (m: string) => void
  onSend: (text: string, files: File[]) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  webSearch: boolean
  onToggleWebSearch: () => void
  onOpenWorkspace: () => void
  workspaceSummary: { label: string; count: number } | null
  onClearWorkspace: () => void
  deepResearch: boolean
  onToggleDeepResearch: () => void
  /** Voice input (Whisper). Null = not configured. */
  voice: { transcribe: (blob: Blob) => Promise<string> } | null
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [modelOpen, setModelOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const toggleRecording = async () => {
    if (!voice) return
    setVoiceError('')
    if (recording) {
      recRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 1000) return // too short — ignore
        setTranscribing(true)
        try {
          const spoken = await voice.transcribe(blob)
          setText((t) => (t ? `${t.trimEnd()} ${spoken}` : spoken))
        } catch (e) {
          setVoiceError((e as Error).message)
          setTimeout(() => setVoiceError(''), 5000)
        } finally {
          setTranscribing(false)
        }
      }
      recRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      setVoiceError('Microphone access denied')
      setTimeout(() => setVoiceError(''), 5000)
    }
  }
  const taRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [text])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setModelOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    const incoming = Array.from(list).slice(0, 8 - files.length)
    incoming.forEach((file) => {
      const pending: PendingFile = { file }
      if (isImageMime(file.type)) {
        const reader = new FileReader()
        reader.onload = () =>
          setFiles((prev) =>
            prev.map((p) => (p.file === file ? { ...p, preview: reader.result as string } : p)),
          )
        reader.readAsDataURL(file)
      }
      setFiles((prev) => [...prev, pending])
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  /** Clipboard paste: intercept only when the clipboard carries files
   *  (screenshots, copied images/files); plain-text paste keeps default behavior. */
  const handlePaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData?.files ?? [])
    if (pasted.length === 0) return
    e.preventDefault()
    const renamed = pasted.map((f, i) => {
      // Pasted images often get a generic "image.png" name — make it unique.
      if (f.name && f.name !== 'image.png') return f
      const ext = f.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      return new File([f], `pasted-${Date.now()}-${i}.${ext}`, { type: f.type })
    })
    addFiles(renamed)
  }

  const submit = () => {
    const value = text.trim()
    if ((!value && files.length === 0) || streaming) return
    onSend(value, files.map((f) => f.file))
    setText('')
    setFiles([])
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto'
    })
  }

  return (
    <div className="px-4 pb-4 pt-2 md:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div
          className={`rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40 ${
            dragging ? 'border-primary ring-2 ring-primary/40' : 'border-border'
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer?.files ?? null)
          }}
        >
          {/* Attachment chips */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3.5 pt-3">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="group relative flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1.5"
                >
                  {f.preview ? (
                    <img src={f.preview} alt="" className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <FileText size={16} className="shrink-0 text-primary" />
                  )}
                  <span className="max-w-[140px]">
                    <span className="block truncate text-xs font-medium">{f.file.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {formatSize(f.file.size)}
                    </span>
                  </span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={handlePaste}
            placeholder={
              disabled
                ? 'Add your Kimi API key in Settings to start…'
                : 'Message Sanjeev AI — paste, drop, or attach docs & images…'
            }
            rows={1}
            className="max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-7 outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1">
              {/* Attach */}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={disabled || streaming}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                title="Attach documents or images"
              >
                <Paperclip size={16} />
              </button>

              {/* Web search toggle */}
              <button
                onClick={onToggleWebSearch}
                disabled={disabled || deepResearch}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                  webSearch || deepResearch
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                title={
                  webSearch
                    ? 'Web search ON — Kimi searches the internet when needed (per-search fee applies)'
                    : 'Web search OFF — turn on to let Kimi look things up online'
                }
              >
                <Globe size={15} />
                {webSearch && <span className="hidden sm:inline">Search</span>}
              </button>

              {/* Deep research toggle */}
              <button
                onClick={onToggleDeepResearch}
                disabled={disabled}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                  deepResearch
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                title={
                  deepResearch
                    ? 'Deep research ON — searches multiple sources and writes a cited report'
                    : 'Deep research — multi-source search + structured cited report'
                }
              >
                <Telescope size={15} />
                {deepResearch && <span className="hidden sm:inline">Research</span>}
              </button>

              {/* Code workspace */}
              <button
                onClick={onOpenWorkspace}
                disabled={disabled}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                  workspaceSummary
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                title="Attach files from a local folder or git repo as context"
              >
                <FolderGit2 size={15} />
                {workspaceSummary && (
                  <span className="hidden sm:inline">
                    {workspaceSummary.label} · {workspaceSummary.count}
                  </span>
                )}
              </button>
              {workspaceSummary && (
                <button
                  onClick={onClearWorkspace}
                  className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                  title="Detach workspace"
                >
                  <X size={13} />
                </button>
              )}

              {/* Model switcher */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setModelOpen(!modelOpen)}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Cpu size={14} />
                  {modelLabel(model)}
                  <ChevronDown
                    size={13}
                    className={modelOpen ? 'rotate-180 transition-transform' : 'transition-transform'}
                  />
                </button>
                {modelOpen && (
                  <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                    <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Model
                    </div>
                    {(
                      [
                        { heading: null, items: [AUTO_ENTRY] },
                        { heading: 'Kimi', items: KIMI_MODELS },
                        { heading: 'Premium · via OpenRouter', items: PREMIUM_CHAT_MODELS },
                      ] as const
                    ).map((section, si) => (
                      <div key={si}>
                        {section.heading && (
                          <div className="border-t border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {section.heading}
                          </div>
                        )}
                        {section.items.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              onModelChange(m.id)
                              setModelOpen(false)
                            }}
                            className={`flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                              m.id === model ? 'bg-accent/60' : ''
                            }`}
                          >
                            <span>
                              <span className="block text-sm font-medium">{m.label}</span>
                              <span className="block text-xs text-muted-foreground">
                                {m.description}
                              </span>
                            </span>
                            {m.badge && (
                              <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                {m.badge}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div className="border-t border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                      Auto routes every message to the strongest model for the task — the
                      conversation continues seamlessly. Images always go to Kimi K3 (vision).
                    </div>
                  </div>
                )}
              </div>

              {/* Voice input */}
              {voice && (
                <button
                  onClick={toggleRecording}
                  disabled={disabled || transcribing}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                    recording
                      ? 'animate-pulse bg-destructive/15 text-destructive'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                  title={
                    recording
                      ? 'Stop recording & transcribe'
                      : transcribing
                        ? 'Transcribing…'
                        : 'Voice input (speak, then click again to transcribe)'
                  }
                >
                  {transcribing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
                  {recording && <span className="hidden sm:inline">Stop</span>}
                </button>
              )}
            </div>

            {/* Send / Stop */}
            {streaming ? (
              <button
                onClick={onStop}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85"
                title="Stop generating"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={(!text.trim() && files.length === 0 && !workspaceSummary) || disabled}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                title="Send"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground/70">
          Enter to send · Shift + Enter for a new line · paste or drop files · PDF, Word, Excel,
          PPT, text & images
          {streaming && <Loader2 size={11} className="animate-spin" />}
        </p>
      </div>
    </div>
  )
}
