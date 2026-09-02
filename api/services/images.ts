/**
 * Server-side image generation: OpenAI GPT Image 2 + Google Nano Banana 2.
 * Keys live in server env — never sent to browsers.
 *
 * OpenAI:  POST /v1/images/generations (and /v1/images/edits for reference-image
 *          edits, multipart). gpt-image models always return b64_json.
 * Gemini:  POST generativelanguage v1beta generateContent with imageConfig;
 *          reference images are passed as inlineData parts for editing.
 */

import { dashscopeConfigured, qwenGenerateImage } from "./dashscope";
import { arkConfigured, seedreamGenerateImage } from "./seedream";
import { falConfigured, falGenerateImage } from "./fal";

export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export function isOpenAiImage(model: string): boolean {
  return model.startsWith("gpt-image");
}

export function isGeminiImage(model: string): boolean {
  return model.startsWith("gemini");
}

export function isQwenImage(model: string): boolean {
  return model.startsWith("qwen-image");
}

export function isSeedreamImage(model: string): boolean {
  return model.startsWith("doubao-seedream");
}

export function isFalImage(model: string): boolean {
  return model.startsWith("fal-ai/");
}

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Is the provider for this model configured on the server? */
export function providerConfigured(model: string): boolean {
  if (isOpenAiImage(model)) return openaiConfigured();
  if (isGeminiImage(model)) return geminiConfigured();
  if (isQwenImage(model)) return dashscopeConfigured();
  if (isSeedreamImage(model)) return arkConfigured();
  if (isFalImage(model)) return falConfigured();
  return false;
}

export interface GenerateImageOpts {
  prompt: string;
  model: string;
  /** "1024x1024" | "1536x1024" | "1024x1536" (OpenAI) */
  size?: string;
  /** OpenAI quality: "low" | "medium" | "high" */
  quality?: string;
  /** Gemini aspect ratio, e.g. "16:9" */
  aspectRatio?: string;
  /** Gemini resolution: "1K" | "2K" | "4K" */
  imageSize?: string;
  /** Reference image as a data URL — switches to edit mode. */
  referenceImage?: string;
}

export interface GeneratedImage {
  b64: string;
  mimeType: string;
}

function parseDataUrl(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("Invalid reference image format");
  return { mime: m[1], b64: m[2] };
}

async function generateOpenAi(opts: GenerateImageOpts): Promise<GeneratedImage> {
  const key = process.env.OPENAI_API_KEY ?? "";
  const size = opts.size || "1024x1024";
  const quality = opts.quality || "medium";

  if (opts.referenceImage) {
    // Edits endpoint is multipart/form-data.
    const { mime, b64 } = parseDataUrl(opts.referenceImage);
    const ext = mime.split("/")[1] || "png";
    const form = new FormData();
    form.append("model", OPENAI_IMAGE_MODEL);
    form.append("prompt", opts.prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append(
      "image",
      new Blob([Buffer.from(b64, "base64")], { type: mime }),
      `reference.${ext}`,
    );
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[];
      error?: { message?: string };
    };
    const out = data.data?.[0]?.b64_json;
    if (!res.ok || !out) {
      throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
    }
    return { b64: out, mimeType: "image/png" };
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: opts.prompt,
      size,
      quality,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[];
    error?: { message?: string };
  };
  const out = data.data?.[0]?.b64_json;
  if (!res.ok || !out) {
    throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
  }
  return { b64: out, mimeType: "image/png" };
}

async function generateGemini(opts: GenerateImageOpts): Promise<GeneratedImage> {
  const key = process.env.GEMINI_API_KEY ?? "";
  type Part =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };
  const parts: Part[] = [{ text: opts.prompt }];
  if (opts.referenceImage) {
    const { mime, b64 } = parseDataUrl(opts.referenceImage);
    parts.push({ inlineData: { mimeType: mime, data: b64 } });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: opts.aspectRatio || "1:1",
            imageSize: opts.imageSize || "1K",
          },
        },
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    candidates?: {
      content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] };
    }[];
    error?: { message?: string };
  };
  const img = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!res.ok || !img) {
    throw new Error(data.error?.message || `Gemini API error ${res.status}`);
  }
  return { b64: img.data, mimeType: img.mimeType || "image/png" };
}

export async function generateImage(opts: GenerateImageOpts): Promise<GeneratedImage> {
  if (isOpenAiImage(opts.model)) return generateOpenAi(opts);
  if (isQwenImage(opts.model)) {
    return qwenGenerateImage({
      prompt: opts.prompt,
      model: opts.model,
      size: opts.size,
      referenceImage: opts.referenceImage,
    });
  }
  if (isSeedreamImage(opts.model)) {
    return seedreamGenerateImage({
      prompt: opts.prompt,
      model: opts.model,
      size: opts.size,
      referenceImage: opts.referenceImage,
    });
  }
  if (isFalImage(opts.model)) {
    return falGenerateImage({
      prompt: opts.prompt,
      model: opts.model,
      aspectRatio: opts.aspectRatio,
      referenceImage: opts.referenceImage,
    });
  }
  return generateGemini(opts);
}
