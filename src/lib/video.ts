import type { Settings } from './types'

/**
 * MiniMax Hailuo video generation API.
 * Flow: create task → poll task status → retrieve file download URL.
 * Docs: platform.minimax.io/docs/guides/video-generation
 */

export const VIDEO_MODELS = [
  { id: 'MiniMax-Hailuo-2.3', label: 'Hailuo 2.3', description: 'Text & image to video' },
  { id: 'MiniMax-Hailuo-02', label: 'Hailuo 02', description: 'Previous generation' },
]

export const VIDEO_DURATIONS = [6, 10] as const
export const VIDEO_RESOLUTIONS = ['768P', '1080P'] as const

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

function base(settings: Settings) {
  return settings.minimaxBaseUrl.replace(/\/+$/, '')
}

export async function createVideoTask(
  settings: Settings,
  opts: { prompt: string; model: string; duration: number; resolution: string; firstFrameImage?: string },
): Promise<string> {
  const res = await fetch(`${base(settings)}/video_generation`, {
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

export async function pollVideoTask(settings: Settings, taskId: string): Promise<PollResult> {
  const res = await fetch(
    `${base(settings)}/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
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
      `${base(settings)}/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`,
      { headers: headers(settings) },
    )
    const fileData = (await fileRes.json()) as RetrieveFileResponse
    const url = fileData.file?.download_url
    if (url) return { state: 'success', videoUrl: url }
    return { state: 'failed', error: 'Could not retrieve the video file URL' }
  }
  return { state: 'pending' }
}
