import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, ChevronDown, Cpu, Paperclip, X, FileText, Loader2 } from 'lucide-react'
import { KIMI_MODELS, modelLabel } from '@/lib/models'
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
}: {
  model: string
  onModelChange: (m: string) => void
  onSend: (text: string, files: File[]) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [modelOpen, setModelOpen] = useState(false)
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

  const addFiles = (list: FileList | null) => {
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
        <div className="rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
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
            placeholder={
              disabled
                ? 'Add your Kimi API key in Settings to start…'
                : 'Message Sanjeev AI — attach docs or images with the paperclip…'
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
                    {KIMI_MODELS.map((m) => (
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
                          <span className="block text-xs text-muted-foreground">{m.description}</span>
                        </span>
                        {m.badge && (
                          <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            {m.badge}
                          </span>
                        )}
                      </button>
                    ))}
                    <div className="border-t border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                      Images are understood by Kimi K3. Documents work with every model.
                    </div>
                  </div>
                )}
              </div>
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
                disabled={(!text.trim() && files.length === 0) || disabled}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                title="Send"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground/70">
          Enter to send · Shift + Enter for a new line · PDF, Word, Excel, PPT, text & images
          {streaming && <Loader2 size={11} className="animate-spin" />}
        </p>
      </div>
    </div>
  )
}
