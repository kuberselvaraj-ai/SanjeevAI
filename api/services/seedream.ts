/**
 * Volcano Engine Ark (ByteDance) — Seedream image generation.
 * Key lives in server env (ARK_API_KEY) — never sent to browsers.
 *
 * Speaks the OpenAI-compatible /images/generations API. Default region is
 * Beijing (ark.cn-beijing.volces.com); set ARK_BASE_URL for other regions.
 */

export const SEEDREAM_DEFAULT_MODEL = "doubao-seedream-4-5-251128";

export function arkConfigured(): boolean {
  return Boolean(process.env.ARK_API_KEY);
}

function baseUrl(): string {
  return (
    process.env.ARK_BASE_URL?.replace(/\/+$/, "") ||
    "https://ark.cn-beijing.volces.com/api/v3"
  );
}

/** Seedream text-to-image / image edit. Returns base64. */
export async function seedreamGenerateImage(opts: {
  prompt: string;
  model?: string;
  /** e.g. "2048x2048" or "2K" */
  size?: string;
  /** Reference image as a data URL — switches to edit mode. */
  referenceImage?: string;
}): Promise<{ b64: string; mimeType: string }> {
  const body: Record<string, unknown> = {
    model: opts.model || SEEDREAM_DEFAULT_MODEL,
    prompt: opts.prompt,
    size: opts.size || "2048x2048",
    response_format: "b64_json",
    watermark: false,
  };
  if (opts.referenceImage) body.image = opts.referenceImage;

  const res = await fetch(`${baseUrl()}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ARK_API_KEY ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string; url?: string }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message || `Ark API error ${res.status}`);
  }
  const first = data.data?.[0];
  if (first?.b64_json) return { b64: first.b64_json, mimeType: "image/png" };
  if (first?.url) {
    const img = await fetch(first.url);
    if (!img.ok) throw new Error(`Failed to download generated image (${img.status})`);
    const buf = Buffer.from(await img.arrayBuffer());
    return {
      b64: buf.toString("base64"),
      mimeType: img.headers.get("content-type") || "image/png",
    };
  }
  throw new Error("Seedream returned no image");
}
