import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, ChevronDown, Cpu } from 'lucide-react'
import { KIMI_MODELS, modelLabel } from '@/lib/models'

export function Composer({
  model,
  onModelChange,
  onSend,
  onStop,
  streaming,
  disabled,
  centered,
}: {
  model: string
  onModelChange: (m: string) => void
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  centered?: boolean
}) {
  const [text, setText] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const submit = () => {
    const value = text.trim()
    if (!value || streaming) return
    onSend(value)
    setText('')
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto'
    })
  }

  return (
    <div className={centered ? 'w-full' : 'px-4 pb-4 pt-2 md:px-8'}>
      <div className={centered ? 'w-full' : 'mx-auto w-full max-w-3xl'}>
        <div className="rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-1 focus-within:ring-ring/40">
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
            placeholder={disabled ? 'Add your Kimi API key in Settings to start…' : 'Message Kimi…'}
            rows={1}
            className="max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-7 outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            {/* Model switcher */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setModelOpen(!modelOpen)}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Cpu size={14} />
                {modelLabel(model)}
                <ChevronDown size={13} className={modelOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
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
                  <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    Custom model id can be set in Settings
                  </div>
                </div>
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
                disabled={!text.trim() || disabled}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                title="Send"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  )
}
