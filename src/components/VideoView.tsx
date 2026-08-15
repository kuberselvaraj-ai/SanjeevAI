import { useState } from 'react'
import { Clapperboard, Download, Loader2, Trash2, AlertCircle, Film } from 'lucide-react'
import type { Settings, VideoJob } from '@/lib/types'
import { VIDEO_MODELS, VIDEO_DURATIONS, VIDEO_RESOLUTIONS, createVideoTask } from '@/lib/video'
import { uid } from '@/lib/storage'

export function VideoView({
  settings,
  jobs,
  onCreateJob,
  onDeleteJob,
  onOpenSettings,
  onOpenSidebar,
}: {
  settings: Settings
  jobs: VideoJob[]
  onCreateJob: (job: VideoJob) => void
  onDeleteJob: (id: string) => void
  onOpenSettings: () => void
  onOpenSidebar: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(VIDEO_MODELS[0].id)
  const [duration, setDuration] = useState<number>(6)
  const [resolution, setResolution] = useState<string>('768P')
  const [imageUrl, setImageUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const noKey = !settings.minimaxKey

  const submit = async () => {
    if (!prompt.trim() || submitting || noKey) return
    setSubmitting(true)
    setError('')
    try {
      const taskId = await createVideoTask(settings, {
        prompt: prompt.trim(),
        model,
        duration,
        resolution,
        firstFrameImage: imageUrl.trim() || undefined,
      })
      onCreateJob({
        id: uid(),
        taskId,
        prompt: prompt.trim(),
        model,
        duration,
        resolution,
        status: 'queued',
        createdAt: Date.now(),
      })
      setPrompt('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
        >
          <Clapperboard size={17} />
        </button>
        <h2 className="flex-1 text-sm font-medium text-muted-foreground">
          Video generation · MiniMax Hailuo
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Generate a video
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            The Kimi API doesn't expose video generation, so this panel uses MiniMax
            Hailuo with your own API key.
          </p>

          {noKey && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Add your MiniMax API key to enable video generation.{' '}
                <button onClick={onOpenSettings} className="font-medium text-primary underline underline-offset-2">
                  Open Settings
                </button>
              </span>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe the video… e.g. A golden retriever running through tall grass at sunset, slow cinematic tracking shot."
              className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-[15px] leading-7 outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="Optional: first-frame image URL (image-to-video)"
              className="mt-2.5 w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-[13px] outline-none focus:ring-1 focus:ring-ring"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
              >
                {VIDEO_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
              >
                {VIDEO_DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
              >
                {VIDEO_RESOLUTIONS.map((r) => (
                  <option key={r} value={r} disabled={r === '1080P' && duration === 10}>
                    {r}
                    {r === '1080P' && duration === 10 ? ' (6s only)' : ''}
                  </option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                onClick={submit}
                disabled={!prompt.trim() || submitting || noKey}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
                {submitting ? 'Submitting…' : 'Generate'}
              </button>
            </div>
            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
          </div>

          {/* Job list */}
          <div className="mt-8 space-y-4 pb-10">
            {jobs.length > 0 && (
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Your videos
              </h3>
            )}
            {jobs.map((job) => (
              <div
                key={job.id}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm leading-6">{job.prompt}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {job.model} · {job.duration}s · {job.resolution} ·{' '}
                      {new Date(job.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={job.status} />
                    <button
                      onClick={() => onDeleteJob(job.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {job.status === 'success' && job.videoUrl && (
                  <div className="border-t border-border bg-black/90">
                    <video src={job.videoUrl} controls className="mx-auto max-h-[420px] w-full" />
                    <div className="flex justify-end border-t border-white/10 px-4 py-2.5">
                      <a
                        href={job.videoUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                      >
                        <Download size={13} />
                        Download MP4
                      </a>
                    </div>
                  </div>
                )}
                {job.status === 'failed' && (
                  <p className="border-t border-border bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
                    {job.error || 'Generation failed'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: VideoJob['status'] }) {
  if (status === 'success')
    return (
      <span className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
        Ready
      </span>
    )
  if (status === 'failed')
    return (
      <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-[11px] font-semibold text-destructive">
        Failed
      </span>
    )
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
      <Loader2 size={11} className="animate-spin" />
      {status === 'queued' ? 'Queued' : 'Generating'}
    </span>
  )
}
