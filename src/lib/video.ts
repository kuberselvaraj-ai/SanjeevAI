import type { Settings } from './types'

/**
 * MiniMax video generation API.
 * Legacy models (Hailuo 2.3 / 02): v1 flow — create task → poll → retrieve file URL.
 * MiniMax H3: v2 flow — POST /v2/video_generation with multimodal content[],
 * poll /v2/query/video_generation/{task_id}, result URL in task.content.url.
 * H3 generates native 32kHz stereo audio (dialogue/SFX/ambience) with the video.
 * Docs: platform.minimax.io/docs/guides/video-generation
 */

export const VIDEO_MODELS = [
  {
    id: 'MiniMax-H3',
    label: 'Hailuo 3 (H3)',
    description: 'Native sound & dialogue · up to 2K · 4–15s',
    badge: 'Audio',
  },
  { id: 'MiniMax-Hailuo-2.3', label: 'Hailuo 2.3', description: 'Silent · 6/10s · up to 1080P' },
  { id: 'MiniMax-Hailuo-02', label: 'Hailuo 02', description: 'Silent · previous generation' },
]

export const H3_DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const
export const H3_RESOLUTIONS = ['768P', '2K'] as const
export const H3_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const

export const VIDEO_DURATIONS = [6, 10] as const
export const VIDEO_RESOLUTIONS = ['768P', '1080P'] as const

export const isH3 = (model: string) => model === 'MiniMax-H3'

interface CreateTaskResponse {
  task_id?: string
  base_resp?: { status_code: number; status_msg: string }
}

interface QueryTaskResponse {
  task_id?: string
  status?: 'Preparing' | 'Queueing' | 'Processing' | 'Success' | 'Fail'
  file_id?: string
  base_resp?: { status_code: number; status_msg: string }
}

interface QueryTaskV2Response {
  task?: {
    task_id?: string
    status?: string // 'processing' | 'succeeded' | 'failed' | 'cancelled' | ...
    content?: { url?: string }
    error?: string | { message?: string }
  }
  base_resp?: { status_code: number; status_msg: string }
}

interface RetrieveFileResponse {
  file?: { file_id: string; download_url?: string }
  base_resp?: { status_code: number; status_msg: string }
}

function headers(settings: Settings) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.minimaxKey}`,
  }
}

/** Base URL with any trailing /v1 or /v2 stripped, e.g. https://api.minimax.io */
function root(settings: Settings) {
  return settings.minimaxBaseUrl.replace(/\/+$/, '').replace(/\/v[12]$/, '')
}

function v1(settings: Settings) {
  return `${root(settings)}/v1`
}

function v2(settings: Settings) {
  return `${root(settings)}/v2`
}

export async function createVideoTask(
  settings: Settings,
  opts: {
    prompt: string
    model: string
    duration: number
    resolution: string
    ratio?: string
    firstFrameImage?: string
  },
): Promise<string> {
  if (isH3(opts.model)) {
    type ContentItem =
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string }; role: 'first_frame' }
    const content: ContentItem[] = [{ type: 'text', text: opts.prompt }]
    if (opts.firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: opts.firstFrameImage },
        role: 'first_frame',
      })
    }
    const res = await fetch(`${v2(settings)}/video_generation`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({
        model: opts.model,
        content,
        duration: opts.duration,
        resolution: opts.resolution,
        // Text-to-video requires a concrete ratio; image-to-video is always adaptive.
        ratio: opts.firstFrameImage ? 'adaptive' : opts.ratio || '16:9',
      }),
    })
    const data = (await res.json()) as CreateTaskResponse
    if (!res.ok || !data.task_id) {
      throw new Error(data.base_resp?.status_msg || `MiniMax API error ${res.status}`)
    }
    return data.task_id
  }

  const res = await fetch(`${v1(settings)}/video_generation`, {
    method: 'POST',
    headers: headers(settings),
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      duration: opts.duration,
      resolution: opts.resolution,
      prompt_optimizer: true,
      ...(opts.firstFrameImage ? { first_frame_image: opts.firstFrameImage } : {}),
    }),
  })
  const data = (await res.json()) as CreateTaskResponse
  if (!res.ok || !data.task_id) {
    throw new Error(data.base_resp?.status_msg || `MiniMax API error ${res.status}`)
  }
  return data.task_id
}

export type PollResult =
  | { state: 'pending' }
  | { state: 'success'; videoUrl: string }
  | { state: 'failed'; error: string }

export async function pollVideoTask(
  settings: Settings,
  taskId: string,
  model: string,
): Promise<PollResult> {
  if (isH3(model)) {
    const res = await fetch(`${v2(settings)}/query/video_generation/${encodeURIComponent(taskId)}`, {
      headers: headers(settings),
    })
    const data = (await res.json()) as QueryTaskV2Response
    if (!res.ok) {
      return { state: 'failed', error: data.base_resp?.status_msg || `API error ${res.status}` }
    }
    const status = data.task?.status
    if (status === 'failed' || status === 'cancelled') {
      const err = data.task?.error
      return {
        state: 'failed',
        error:
          (typeof err === 'string' ? err : err?.message) ||
          data.base_resp?.status_msg ||
          'Generation failed',
      }
    }
    if (status === 'succeeded') {
      const url = data.task?.content?.url
      if (url) return { state: 'success', videoUrl: url }
      return { state: 'failed', error: 'Could not retrieve the video file URL' }
    }
    return { state: 'pending' }
  }

  const res = await fetch(
    `${v1(settings)}/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
    { headers: headers(settings) },
  )
  const data = (await res.json()) as QueryTaskResponse
  if (!res.ok) {
    return { state: 'failed', error: data.base_resp?.status_msg || `API error ${res.status}` }
  }
  if (data.status === 'Fail') {
    return { state: 'failed', error: data.base_resp?.status_msg || 'Generation failed' }
  }
  if (data.status === 'Success' && data.file_id) {
    const fileRes = await fetch(
      `${v1(settings)}/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`,
      { headers: headers(settings) },
    )
    const fileData = (await fileRes.json()) as RetrieveFileResponse
    const url = fileData.file?.download_url
    if (url) return { state: 'success', videoUrl: url }
    return { state: 'failed', error: 'Could not retrieve the video file URL' }
  }
  return { state: 'pending' }
}
