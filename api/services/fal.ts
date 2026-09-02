/**
 * fal.ai — one key unlocks FLUX.2, Nano Banana Pro, Ideogram 4 and more.
 * Key lives in server env (FAL_KEY) — never sent to browsers.
 *
 * Synchronous endpoint: POST https://fal.run/{modelId}
 * Auth header: `Key ${FAL_KEY}`. Response: { images: [{ url, content_type }] }.
 */

export const FAL_DEFAULT_MODEL = "fal-ai/flux-2-flex";

export function falConfigured(): boolean {
  return Boolean(process.env.FAL_KEY);
}

/** Shared UI aspect ratios → each fal model's size vocabulary. */
function fluxSize(aspectRatio?: string): string {
  switch (aspectRatio) {
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    case "4:3":
      return "landscape_4_3";
    case "3:4":
      return "portrait_4_3";
    default:
      return "square_hd";
  }
}

function requestBody(
  model: string,
  opts: { prompt: string; aspectRatio?: string; referenceImage?: string },
): Record<string, unknown> {
  const ratio = opts.aspectRatio || "1:1";
  if (model.includes("nano-banana")) {
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: ratio,
      resolution: "2K",
      output_format: "png",
    };
    if (opts.referenceImage) body.image_urls = [opts.referenceImage];
    return body;
  }
  if (model.includes("ideogram")) {
    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      aspect_ratio: ratio,
    };
    if (opts.referenceImage) body.image_urls = [opts.referenceImage];
    return body;
  }
  // FLUX.2 (flex/pro/dev)
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    image_size: fluxSize(ratio),
    output_format: "png",
  };
  if (opts.referenceImage) body.image_urls = [opts.referenceImage];
  return body;
}

export async function falGenerateImage(opts: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  referenceImage?: string;
}): Promise<{ b64: string; mimeType: string }> {
  const model = opts.model || FAL_DEFAULT_MODEL;
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${process.env.FAL_KEY ?? ""}`,
    },
    body: JSON.stringify(requestBody(model, opts)),
  });
  const data = (await res.json().catch(() => ({}))) as {
    images?: { url?: string; content_type?: string }[];
    detail?: string | { msg?: string }[];
    message?: string;
  };
  if (!res.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d.msg).join("; ")
      : data.detail;
    throw new Error(detail || data.message || `fal.ai API error ${res.status}`);
  }
  const img = data.images?.[0];
  if (!img?.url) throw new Error("fal.ai returned no image");
  const imgRes = await fetch(img.url);
  if (!imgRes.ok) throw new Error(`Failed to download generated image (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return {
    b64: buf.toString("base64"),
    mimeType: img.content_type || imgRes.headers.get("content-type") || "image/png",
  };
}
