/**
 * Server-side MiniMax video generation proxy. Mirrors the client-side
 * lib/video.ts logic (H3 v2 flow + legacy v1 flow) but holds the API key
 * in server env.
 */

const ROOT = "https://api.minimax.io";

export function minimaxConfigured(): boolean {
  return Boolean(process.env.MINIMAX_API_KEY);
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.MINIMAX_API_KEY ?? ""}`,
  };
}

const isH3 = (model: string) => model === "MiniMax-H3";

export interface CreateVideoOpts {
  prompt: string;
  model: string;
  duration: number;
  resolution: string;
  ratio?: string;
  firstFrameImage?: string;
}

export async function createVideo(opts: CreateVideoOpts): Promise<string> {
  let res: Response;
  if (isH3(opts.model)) {
    type ContentItem =
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string }; role: "first_frame" };
    const content: ContentItem[] = [{ type: "text", text: opts.prompt }];
    if (opts.firstFrameImage) {
      content.push({
        type: "image_url",
        image_url: { url: opts.firstFrameImage },
        role: "first_frame",
      });
    }
    res = await fetch(`${ROOT}/v2/video_generation`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: opts.model,
        content,
        duration: opts.duration,
        resolution: opts.resolution,
        ratio: opts.firstFrameImage ? "adaptive" : opts.ratio || "16:9",
      }),
    });
  } else {
    res = await fetch(`${ROOT}/v1/video_generation`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        duration: opts.duration,
        resolution: opts.resolution,
        prompt_optimizer: true,
        ...(opts.firstFrameImage ? { first_frame_image: opts.firstFrameImage } : {}),
      }),
    });
  }
  const data = (await res.json().catch(() => ({}))) as {
    task_id?: string;
    base_resp?: { status_code: number; status_msg: string };
  };
  if (!res.ok || !data.task_id) {
    throw new Error(data.base_resp?.status_msg || `MiniMax API error ${res.status}`);
  }
  return data.task_id;
}

export type PollResult =
  | { state: "pending" }
  | { state: "success"; videoUrl: string }
  | { state: "failed"; error: string };

export async function pollVideo(taskId: string, model: string): Promise<PollResult> {
  if (isH3(model)) {
    const res = await fetch(
      `${ROOT}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
      { headers: headers() },
    );
    const data = (await res.json().catch(() => ({}))) as {
      task?: {
        status?: string;
        content?: { url?: string };
        error?: string | { message?: string };
      };
      base_resp?: { status_code: number; status_msg: string };
    };
    if (!res.ok) {
      return { state: "failed", error: data.base_resp?.status_msg || `API error ${res.status}` };
    }
    const status = data.task?.status;
    if (status === "failed" || status === "cancelled") {
      const err = data.task?.error;
      return {
        state: "failed",
        error:
          (typeof err === "string" ? err : err?.message) ||
          data.base_resp?.status_msg ||
          "Generation failed",
      };
    }
    if (status === "succeeded") {
      const url = data.task?.content?.url;
      if (url) return { state: "success", videoUrl: url };
      return { state: "failed", error: "Could not retrieve the video file URL" };
    }
    return { state: "pending" };
  }

  const res = await fetch(
    `${ROOT}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
    { headers: headers() },
  );
  const data = (await res.json().catch(() => ({}))) as {
    status?: "Preparing" | "Queueing" | "Processing" | "Success" | "Fail";
    file_id?: string;
    base_resp?: { status_code: number; status_msg: string };
  };
  if (!res.ok) {
    return { state: "failed", error: data.base_resp?.status_msg || `API error ${res.status}` };
  }
  if (data.status === "Fail") {
    return { state: "failed", error: data.base_resp?.status_msg || "Generation failed" };
  }
  if (data.status === "Success" && data.file_id) {
    const fileRes = await fetch(
      `${ROOT}/v1/files/retrieve?file_id=${encodeURIComponent(data.file_id)}`,
      { headers: headers() },
    );
    const fileData = (await fileRes.json().catch(() => ({}))) as {
      file?: { download_url?: string };
      base_resp?: { status_code: number; status_msg: string };
    };
    const url = fileData.file?.download_url;
    if (url) return { state: "success", videoUrl: url };
    return { state: "failed", error: "Could not retrieve the video file URL" };
  }
  return { state: "pending" };
}
