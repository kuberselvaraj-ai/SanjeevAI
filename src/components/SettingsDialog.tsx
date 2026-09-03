import { useState } from 'react'
import { X, Eye, EyeOff, ExternalLink } from 'lucide-react'
import type { Settings } from '@/lib/types'
import { KIMI_MODELS } from '@/lib/models'

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  helpUrl,
  helpText,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  helpUrl: string
  helpText: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 font-mono-code text-[13px] outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      <a
        href={helpUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {helpText}
        <ExternalLink size={11} />
      </a>
    </div>
  )
}

export function SettingsDialog({
  settings,
  hosted = false,
  onSave,
  onClose,
}: {
  settings: Settings
  /** Hosted web mode: keys live on the server, so hide the key fields. */
  hosted?: boolean
  onSave: (s: Settings) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Settings>({ ...settings })
  const [memories, setMemories] = useState<string[]>(() => loadMemories())
  const [newMemory, setNewMemory] = useState('')
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))
  const updateMemories = (list: string[]) => {
    setMemories(list)
    saveMemories(list)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="rise-in relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-popover px-5 py-4">
          <h2 className="font-display text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {hosted ? (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-[12px] leading-6 text-muted-foreground">
              You're signed in to hosted Sanjeev AI — API keys are managed on the server,
              and your monthly limits follow your plan. Nothing to configure here.
            </p>
          ) : (
            <>
              <SecretField
                label="Kimi API key (Moonshot AI)"
                value={draft.moonshotKey}
                onChange={(v) => set('moonshotKey', v)}
                placeholder="sk-..."
                helpUrl="https://platform.moonshot.ai/console/api-keys"
                helpText="Get a key at platform.moonshot.ai"
              />

              <SecretField
                label="MiniMax API key (for video generation)"
                value={draft.minimaxKey}
                onChange={(v) => set('minimaxKey', v)}
                placeholder="MiniMax API key"
                helpUrl="https://platform.minimax.io/"
                helpText="Get a key at platform.minimax.io"
              />

              <SecretField
                label="OpenAI API key (GPT Image 2 — image studio)"
                value={draft.openaiKey}
                onChange={(v) => set('openaiKey', v)}
                placeholder="sk-..."
                helpUrl="https://platform.openai.com/api-keys"
                helpText="Get a key at platform.openai.com"
              />

              <SecretField
                label="Google AI Studio key (Nano Banana 2 — image studio)"
                value={draft.geminiKey}
                onChange={(v) => set('geminiKey', v)}
                placeholder="AIza..."
                helpUrl="https://aistudio.google.com/apikey"
                helpText="Get a key at aistudio.google.com"
              />

              <SecretField
                label="E2B API key (run Python from chat)"
                value={draft.e2bKey}
                onChange={(v) => set('e2bKey', v)}
                placeholder="e2b_..."
                helpUrl="https://e2b.dev/dashboard"
                helpText="Get a key at e2b.dev (free tier)"
              />

              <SecretField
                label="Alibaba Bailian key (Qwen Image + voice)"
                value={draft.dashscopeKey}
                onChange={(v) => set('dashscopeKey', v)}
                placeholder="sk-..."
                helpUrl="https://bailian.console.aliyun.com/"
                helpText="bailian.console.aliyun.com → API-KEY管理"
              />

              <SecretField
                label="Volcano Engine Ark key (Seedream images)"
                value={draft.arkKey}
                onChange={(v) => set('arkKey', v)}
                placeholder="ARK API key"
                helpUrl="https://console.volcengine.com/ark"
                helpText="console.volcengine.com → Ark → API keys"
              />

              <SecretField
                label="fal.ai key (FLUX.2, Nano Banana Pro, Ideogram 4, Kling/Veo video)"
                value={draft.falKey}
                onChange={(v) => set('falKey', v)}
                placeholder="fal key"
                helpUrl="https://fal.ai/dashboard/keys"
                helpText="fal.ai → Dashboard → Keys (pay-per-use, Stripe card)"
              />

              <SecretField
                label="ElevenLabs key (premium voices — mic & read aloud)"
                value={draft.elevenlabsKey}
                onChange={(v) => set('elevenlabsKey', v)}
                placeholder="sk_..."
                helpUrl="https://elevenlabs.io/"
                helpText="elevenlabs.io → Profile → API key (free tier works)"
              />
            </>
          )}

          <div>
            <label className="mb-1.5 block text-[13px] font-medium">Default model</label>
            <select
              value={draft.defaultModel}
              onChange={(e) => set('defaultModel', e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              {KIMI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
              {!KIMI_MODELS.some((m) => m.id === draft.defaultModel) && (
                <option value={draft.defaultModel}>{draft.defaultModel}</option>
              )}
            </select>
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between text-[13px] font-medium">
              Temperature
              <span className="font-mono-code text-xs text-muted-foreground">
                {draft.temperature.toFixed(1)}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={draft.temperature}
              onChange={(e) => set('temperature', parseFloat(e.target.value))}
              className="w-full accent-[hsl(var(--primary))]"
            />
          </div>

          {/* Memory — works in both desktop and hosted mode */}
          <div className="rounded-lg border border-border">
            <div className="flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium">
              <Brain size={14} className="text-primary" />
              Memory
              <span className="text-xs font-normal text-muted-foreground">
                — remembered across all chats
              </span>
            </div>
            <div className="space-y-2 border-t border-border px-3 py-3">
              {memories.length === 0 && (
                <p className="text-[12px] leading-5 text-muted-foreground">
                  Nothing saved yet. Hover any reply and hit “Remember”, or add a fact below
                  (e.g. “I'm vegetarian”, “My project uses Postgres”).
                </p>
              )}
              {memories.map((m, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2">
                  <p className="flex-1 text-[12.5px] leading-5">{m}</p>
                  <button
                    onClick={() => updateMemories(memories.filter((_, j) => j !== i))}
                    className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Forget this"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newMemory.trim()) {
                      updateMemories([newMemory.trim(), ...memories])
                      setNewMemory('')
                    }
                  }}
                  placeholder="Add something to remember…"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => {
                    if (!newMemory.trim()) return
                    updateMemories([newMemory.trim(), ...memories])
                    setNewMemory('')
                  }}
                  className="rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {!hosted && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2.5 text-[13px] font-medium text-muted-foreground">
              Advanced — API endpoints
            </summary>
            <div className="space-y-3 border-t border-border px-3 py-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Kimi base URL</label>
                <input
                  value={draft.moonshotBaseUrl}
                  onChange={(e) => set('moonshotBaseUrl', e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono-code text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">MiniMax base URL</label>
                <input
                  value={draft.minimaxBaseUrl}
                  onChange={(e) => set('minimaxBaseUrl', e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono-code text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Use https://api.moonshot.cn/v1 if your key is from the China platform.
              </p>
            </div>
          </details>
          )}

          {!hosted && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
              Keys are stored only in this app's local storage on your machine and are sent
              directly to the respective APIs — nowhere else.
            </p>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-popover px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft)
              onClose()
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
