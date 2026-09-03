/**
 * fal.ai video generation — Kling 3.0 Pro and Veo 3.1 Fast via fal's
 * queue REST API. Key lives in server env (FAL_KEY) — never sent to browsers.
 *
 * Flow: POST queue.fal.run/{model} → request_id
 *       GET  queue.fal.run/{model}/requests/{id}/status
 *       GET  queue.fal.run/{model}/requests/{id}        → { video: { url } }
 */

export const KLING_MODEL = "fal-ai/kling-video/v3/pro/text-to-video";
export const VEO_MODEL = "fal-ai/veo3.1/fast";

export function falVideoConfigured(): boolean {
  return Boolean(process.env.FAL_KEY);
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Key ${process.env.FAL_KEY ?? ""}`,
  };
}

export interface CreateFalVideoOpts {
  prompt: string;
  model: string;
  duration: number;
  resolution: string;
  ratio?: string;
}

function klingDuration(seconds: number): string {
  // Kling v3 accepts 3–15s as a string enum.
  return String(Math.min(15, Math.max(3, Math.round(seconds))));
}

function veoDuration(seconds: number): string {
  if (seconds >= 8) return "8s";
  if (seconds >= 6) return "6s";
  return "4s";
}

function requestBody(opts: CreateFalVideoOpts): Record<string, unknown> {
  if (opts.model.includes("kling")) {
    return {
      prompt: opts.prompt,
      duration: klingDuration(opts.duration),
      aspect_ratio: opts.ratio || "16:9",
      generate_audio: true,
    };
  }
  // Veo 3.1 (fast)
  return {
    prompt: opts.prompt,
    aspect_ratio: opts.ratio === "9:16" ? "9:16" : "16:9",
    duration: veoDuration(opts.duration),
    resolution: opts.resolution === "1080p" || opts.resolution === "1080P" ? "1080p" : "720p",
    generate_audio: true,
  };
}

export async function createFalVideo(opts: CreateFalVideoOpts): Promise<string> {
  const res = await fetch(`https://queue.fal.run/${opts.model}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(requestBody(opts)),
  });
  const data = (await res.json().catch(() => ({}))) as {
    request_id?: string;
    detail?: string | { msg?: string }[];
    message?: string;
  };
  if (!res.ok || !data.request_id) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join("; ")
      : data.detail;
    throw new Error(detail || data.message || `fal.ai API error ${res.status}`);
  }
  return data.request_id;
}

export type FalPollResult =
  | { state: "pending" }
  | { state: "success"; videoUrl: string }
  | { state: "failed"; error: string };

export async function pollFalVideo(
  requestId: string,
  model: string,
): Promise<FalPollResult> {
  const statusRes = await fetch(
    `https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}/status`,
    { headers: headers() },
  );
  const status = (await statusRes.json().catch(() => ({}))) as {
    status?: string;
    detail?: string;
  };
  if (!statusRes.ok) {
    return { state: "failed", error: status.detail || `fal.ai status error ${statusRes.status}` };
  }
  if (status.status !== "COMPLETED") return { state: "pending" };

  const res = await fetch(
    `https://queue.fal.run/${model}/requests/${encodeURIComponent(requestId)}`,
    { headers: headers() },
  );
  const data = (await res.json().catch(() => ({}))) as {
    video?: { url?: string };
    detail?: string;
  };
  const url = data.video?.url;
  if (!res.ok || !url) {
    return { state: "failed", error: data.detail || `fal.ai result error ${res.status}` };
  }
  return { state: "success", videoUrl: url };
}
