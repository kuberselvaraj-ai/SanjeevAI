import { useRef, useState } from 'react'
import { ImageIcon, Download, Loader2, Trash2, AlertCircle, Sparkles, X } from 'lucide-react'
import type { ImageJob, Settings } from '@/lib/types'
import { trpc } from '@/providers/trpc'
import {
  IMAGE_MODELS,
  OPENAI_SIZES,
  OPENAI_QUALITIES,
  GEMINI_RATIOS,
  GEMINI_SIZES,
  QWEN_SIZES,
  SEEDREAM_SIZES,
  FAL_RATIOS,
  isOpenAiImage,
  isQwenImage,
  isSeedreamImage,
  isFalImage,
  generateImageDirect,
  fileToDataUrl,
} from '@/lib/image'
import { uid } from '@/lib/storage'

export function ImageView({
  settings,
  hosted = false,
  jobs,
  onCreateJob,
  onUpdateJob,
  onDeleteJob,
  onOpenSettings,
  onOpenSidebar,
}: {
  settings: Settings
  /** Hosted mode: generate via the server (it holds the provider keys). */
  hosted?: boolean
  jobs: ImageJob[]
  onCreateJob: (job: ImageJob) => void
  onUpdateJob: (id: string, patch: Partial<ImageJob>) => void
  onDeleteJob: (id: string) => void
  onOpenSettings: () => void
  onOpenSidebar: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].id)
  const [size, setSize] = useState<string>('1024x1024')
  const [quality, setQuality] = useState<string>('medium')
  const [aspectRatio, setAspectRatio] = useState<string>('1:1')
  const [imageSize, setImageSize] = useState<string>('1K')
  const [reference, setReference] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const openai = isOpenAiImage(model)
  const qwen = isQwenImage(model)
  const seedream = isSeedreamImage(model)
  const fal = isFalImage(model)
  const providerName = openai
    ? 'OpenAI'
    : qwen
      ? 'Alibaba Bailian'
      : seedream
        ? 'Volcano Engine Ark'
        : fal
          ? 'fal.ai'
          : 'Google AI Studio'
  const keyMissing = openai
    ? !settings.openaiKey
    : qwen
      ? !settings.dashscopeKey
      : seedream
        ? !settings.arkKey
        : fal
          ? !settings.falKey
          : !settings.geminiKey
  const noKey = !hosted && keyMissing
  const generateMutation = trpc.image.generate.useMutation()
  const trpcUtils = trpc.useUtils()

  const pickModel = (m: string) => {
    setModel(m)
    // each provider has its own size vocabulary — reset to its default
    if (isQwenImage(m)) setSize(QWEN_SIZES[0])
    else if (isSeedreamImage(m)) setSize(SEEDREAM_SIZES[0])
    else if (isOpenAiImage(m)) setSize(OPENAI_SIZES[0])
    else if (isFalImage(m)) setAspectRatio('1:1')
  }

  const detail = openai
    ? `${size.replace('x', '×')} · ${quality}`
    : qwen || seedream
      ? size.replace(/[x*]/, '×')
      : fal
        ? aspectRatio
        : `${aspectRatio} · ${imageSize}`

  const submit = async () => {
    if (!prompt.trim() || noKey) return
    setError('')
    const jobId = uid()
    const opts = {
      prompt: prompt.trim(),
      model,
      size,
      quality,
      aspectRatio,
      imageSize,
      referenceImage: reference ?? undefined,
    }
    onCreateJob({
      id: jobId,
      prompt: opts.prompt,
      model,
      detail,
      status: 'generating',
      createdAt: Date.now(),
    })
    setPrompt('')
    try {
      const img = hosted
        ? await generateMutation.mutateAsync(opts)
        : await generateImageDirect(settings, opts)
      onUpdateJob(jobId, {
        status: 'done',
        imageUrl: `data:${img.mimeType};base64,${img.b64}`,
      })
      if (hosted) trpcUtils.usage.mine.invalidate()
    } catch (e) {
      onUpdateJob(jobId, { status: 'failed', error: (e as Error).message })
    }
  }

  const pickReference = async (f: File | undefined) => {
    if (!f) return
    try {
      setReference(await fileToDataUrl(f))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
        >
          <ImageIcon size={17} />
        </button>
        <h2 className="flex-1 text-sm font-medium text-muted-foreground">
          Image studio · FLUX.2, Nano Banana Pro, Ideogram 4, Seedream & more
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Create an image</h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Generate from text, or attach a photo and describe the edit
            {hosted ? ' — included with your plan.' : ' with your own API keys.'}
          </p>

          {noKey && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Add your {providerName} API key to use{' '}
                {IMAGE_MODELS.find((m) => m.id === model)?.label}.{' '}
                <button
                  onClick={onOpenSettings}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Open Settings
                </button>
              </span>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={
                reference
                  ? 'Describe the edit… e.g. Put this person on a beach at sunset, keep the face identical.'
                  : 'Describe the image… e.g. A minimalist poster of a tiger made of flowing ink, warm cream background.'
              }
              className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-[15px] leading-7 outline-none focus:ring-1 focus:ring-ring"
            />

            {/* reference image for editing */}
            <div className="mt-2.5 flex items-center gap-2.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  pickReference(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              {reference ? (
                <span className="relative inline-block">
                  <img
                    src={reference}
                    alt="Reference"
                    className="h-16 w-16 rounded-lg border border-border object-cover"
                  />
                  <button
                    onClick={() => setReference(null)}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-popover p-0.5 text-muted-foreground shadow hover:text-destructive"
                    title="Remove reference"
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-dashed border-input px-3 py-2 text-[12.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  + Reference image (optional — for editing)
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <select
                value={model}
                onChange={(e) => pickModel(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
              >
                {IMAGE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.provider}
                  </option>
                ))}
              </select>
              {fal ? (
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                >
                  {FAL_RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : qwen || seedream ? (
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                >
                  {(qwen ? QWEN_SIZES : SEEDREAM_SIZES).map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/[x*]/, '×')}
                    </option>
                  ))}
                </select>
              ) : openai ? (
                <>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                  >
                    {OPENAI_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('x', '×')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                  >
                    {OPENAI_QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q[0].toUpperCase() + q.slice(1)} quality
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                  >
                    {GEMINI_RATIOS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <select
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                  >
                    {GEMINI_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <div className="flex-1" />
              <button
                onClick={submit}
                disabled={!prompt.trim() || noKey || jobs.some((j) => j.status === 'generating')}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Sparkles size={15} />
                Generate
              </button>
            </div>
            <p className="mt-2.5 text-[11px] leading-5 text-muted-foreground/80">
              {openai
                ? 'GPT Image 2 — OpenAI’s flagship image model. ~$0.006–0.21 per image depending on size & quality.'
                : qwen
                  ? 'Qwen Image 2 Pro — Alibaba Bailian. Excellent at Chinese text, posters and typography. Pay-as-you-go via Alipay.'
                  : seedream
                    ? 'Seedream 4.5 — ByteDance’s flagship on Volcano Engine Ark. 4K output, strong text rendering, ~$0.035/image.'
                    : fal
                      ? `${IMAGE_MODELS.find((m) => m.id === model)?.description ?? ''} — pay-per-use via fal.ai, one key for all fal models.`
                      : 'Nano Banana 2 (Gemini 3.1 Flash Image) — fast, ~$0.045/image at 1K, and the best at editing a reference photo while keeping the subject consistent.'}
            </p>
            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </div>

          {/* Gallery */}
          <div className="mt-8 pb-10">
            {jobs.length > 0 && (
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Your images
              </h3>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  {job.status === 'done' && job.imageUrl ? (
                    <img src={job.imageUrl} alt={job.prompt} className="w-full object-contain" />
                  ) : job.status === 'generating' ? (
                    <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 size={16} className="animate-spin" />
                      Generating…
                    </div>
                  ) : (
                    <div className="flex h-24 items-center px-4 text-[13px] text-destructive">
                      {job.error || 'Generation failed'}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3 border-t border-border px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[12.5px] leading-5">{job.prompt}</p>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                        {IMAGE_MODELS.find((m) => m.id === job.model)?.label ?? job.model} ·{' '}
                        {job.detail}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {job.status === 'done' && job.imageUrl && (
                        <a
                          href={job.imageUrl}
                          download={`sanjeev-${job.id}.png`}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Download"
                        >
                          <Download size={14} />
                        </a>
                      )}
                      <button
                        onClick={() => onDeleteJob(job.id)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
