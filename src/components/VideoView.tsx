import { useState } from 'react'
import { Clapperboard, Download, Loader2, Trash2, AlertCircle, Film } from 'lucide-react'
import type { Settings, VideoJob } from '@/lib/types'
import { trpc } from '@/providers/trpc'
import {
  VIDEO_MODELS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
  H3_DURATIONS,
  H3_RESOLUTIONS,
  H3_RATIOS,
  KLING_DURATIONS,
  VEO_DURATIONS,
  FAL_VIDEO_RATIOS,
  isH3,
  isFalVideo,
  isKling,
  createVideoTask,
} from '@/lib/video'
import { uid } from '@/lib/storage'

export function VideoView({
  settings,
  hosted = false,
  jobs,
  onCreateJob,
  onDeleteJob,
  onOpenSettings,
  onOpenSidebar,
}: {
  settings: Settings
  /** Hosted mode: create/poll via the server (it holds the MiniMax key). */
  hosted?: boolean
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
  const [ratio, setRatio] = useState<string>('16:9')
  const [imageUrl, setImageUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const noKey = !hosted && (isFalVideo(model) ? !settings.falKey : !settings.minimaxKey)
  const h3 = isH3(model)
  const falVideo = isFalVideo(model)
  const kling = isKling(model)
  const durations: readonly number[] = h3
    ? H3_DURATIONS
    : falVideo
      ? kling
        ? KLING_DURATIONS
        : VEO_DURATIONS
      : VIDEO_DURATIONS
  const resolutions: readonly string[] = h3
    ? H3_RESOLUTIONS
    : falVideo
      ? ['720p', '1080p']
      : VIDEO_RESOLUTIONS
  const createMutation = trpc.video.create.useMutation()
  const trpcUtils = trpc.useUtils()

  const changeModel = (m: string) => {
    setModel(m)
    if (isH3(m)) {
      if (!(H3_DURATIONS as readonly number[]).includes(duration)) setDuration(6)
      if (!(H3_RESOLUTIONS as readonly string[]).includes(resolution)) setResolution('768P')
    } else if (isFalVideo(m)) {
      const ds: readonly number[] = isKling(m) ? KLING_DURATIONS : VEO_DURATIONS
      if (!ds.includes(duration)) setDuration(ds[0])
      setResolution('1080p')
      if (!(FAL_VIDEO_RATIOS as readonly string[]).includes(ratio)) setRatio('16:9')
    } else {
      if (!(VIDEO_DURATIONS as readonly number[]).includes(duration)) setDuration(6)
      if (!(VIDEO_RESOLUTIONS as readonly string[]).includes(resolution)) setResolution('768P')
    }
  }

  const submit = async () => {
    if (!prompt.trim() || submitting || noKey) return
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        prompt: prompt.trim(),
        model,
        duration,
        resolution,
        ratio,
        firstFrameImage: imageUrl.trim() || undefined,
      }
      const taskId = hosted
        ? (await createMutation.mutateAsync(payload)).taskId
        : await createVideoTask(settings, payload)
      if (hosted) trpcUtils.usage.mine.invalidate()
      onCreateJob({
        id: uid(),
        taskId,
        prompt: prompt.trim(),
        model,
        duration,
        resolution,
        ratio,
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent md:hidden"
        >
          <Clapperboard size={17} />
        </button>
        <h2 className="flex-1 text-sm font-medium text-muted-foreground">
          Video generation · Hailuo 3, Kling 3.0 & Veo 3.1
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Generate a video
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            The Kimi API doesn't expose video generation, so this panel uses MiniMax
            Hailuo{hosted ? ' — included with your plan.' : ' with your own API key.'}
          </p>

          {noKey && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-primary" />
              <span>
                Add your {isFalVideo(model) ? 'fal.ai' : 'MiniMax'} API key to use{' '}
                {VIDEO_MODELS.find((m) => m.id === model)?.label}.{' '}
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
              placeholder={
                h3 || falVideo
                  ? 'Describe the video AND its sound… e.g. A barista slides a coffee across the counter and says "One flat white!" — cafe ambience, cup clinks, soft jazz.'
                  : 'Describe the video… e.g. A golden retriever running through tall grass at sunset, slow cinematic tracking shot.'
              }
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
                onChange={(e) => changeModel(e.target.value)}
                className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
              >
                {VIDEO_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.badge ? ` · ${m.badge}` : ''}
                  </option>
                ))}
              </select>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
              >
                {durations.map((d) => (
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
                {resolutions.map((r) => (
                  <option key={r} value={r} disabled={r === '1080P' && duration === 10 && !falVideo}>
                    {r}
                    {r === '1080P' && duration === 10 && !falVideo ? ' (6s only)' : ''}
                  </option>
                ))}
              </select>
              {(h3 || falVideo) && !imageUrl.trim() && (
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                  className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
                  title="Aspect ratio"
                >
                  {(falVideo ? FAL_VIDEO_RATIOS : H3_RATIOS).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
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
            <p className="mt-2.5 text-[11px] leading-5 text-muted-foreground/80">
              {h3
                ? 'Hailuo 3 generates synchronized stereo sound — dialogue (11 languages, lip-synced), sound effects and ambience. Describe the audio in your prompt. Billed per second (~$0.08/s at 768P, ~$0.13/s at 2K).'
                : kling
                  ? 'Kling 3.0 Pro — top of the accessible arena. 15s multi-shot clips, native audio with multilingual lip-sync. ~$0.17/s with audio via fal.ai.'
                  : falVideo
                    ? 'Veo 3.1 Fast — Google’s flagship. Synced audio, true-to-life physics. ~$0.15/s with audio via fal.ai. Outputs carry an invisible SynthID watermark.'
                    : 'Hailuo 2.3 / 02 generate silent video. Switch to Hailuo 3 (H3) for native sound.'}
            </p>
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
