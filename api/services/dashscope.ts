/**
 * Alibaba Cloud Model Studio (Bailian / DashScope) — images, ASR, TTS.
 * Key lives in server env (DASHSCOPE_API_KEY) — never sent to browsers.
 *
 * All three use the same synchronous multimodal-generation endpoint.
 * Default region is Beijing; set DASHSCOPE_BASE_URL to
 * https://dashscope-intl.aliyuncs.com/api/v1 for the Singapore region
 * (note: Beijing and Singapore use DIFFERENT API keys).
 */

export const QWEN_IMAGE_DEFAULT_MODEL = "qwen-image-2.0-pro";
const ASR_MODEL = "qwen3-asr-flash";
const TTS_MODEL = "qwen3-tts-flash";
const TTS_VOICE = "Cherry";

export function dashscopeConfigured(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

function baseUrl(): string {
  return (
    process.env.DASHSCOPE_BASE_URL?.replace(/\/+$/, "") ||
    "https://dashscope.aliyuncs.com/api/v1"
  );
}

function endpoint(): string {
  return `${baseUrl()}/services/aigc/multimodal-generation/generation`;
}

async function post(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    code?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.message || `DashScope API error ${res.status}`);
  }
  return data;
}

type MessageContent = ({ text: string } | { image: string } | { audio: string })[];

/** Download a 24h-expiring result URL and return base64. */
async function urlToB64(
  url: string,
): Promise<{ b64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated file (${res.status})`);
  const mimeType = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { b64: buf.toString("base64"), mimeType };
}

/** Qwen-Image text-to-image / image edit. Returns base64. */
export async function qwenGenerateImage(opts: {
  prompt: string;
  model?: string;
  /** e.g. "2048*2048" — width*height */
  size?: string;
  /** Reference image as a data URL — switches to edit mode. */
  referenceImage?: string;
}): Promise<{ b64: string; mimeType: string }> {
  const content: MessageContent = [];
  if (opts.referenceImage) content.push({ image: opts.referenceImage });
  content.push({ text: opts.prompt });

  const data = await post({
    model: opts.model || QWEN_IMAGE_DEFAULT_MODEL,
    input: { messages: [{ role: "user", content }] },
    parameters: {
      size: opts.size || "2048*2048",
      negative_prompt:
        "Low resolution, low quality, distorted limbs, malformed fingers, oversaturated colors, blurry or warped text.",
      prompt_extend: true,
      watermark: false,
    },
  });

  const output = data.output as {
    choices?: { message?: { content?: { image?: string }[] } }[];
  };
  const imgUrl = output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image;
  if (!imgUrl) throw new Error("Qwen-Image returned no image");
  return urlToB64(imgUrl);
}

/** Qwen3-ASR-Flash: transcribe a short audio clip (base64). */
export async function qwenTranscribe(b64: string, mimeType: string): Promise<string> {
  const data = await post({
    model: ASR_MODEL,
    input: {
      messages: [
        { role: "system", content: [{ text: "" }] },
        {
          role: "user",
          content: [{ audio: `data:${mimeType};base64,${b64}` }],
        },
      ],
    },
    parameters: { asr_options: { enable_itn: true } },
  });
  const output = data.output as {
    choices?: { message?: { content?: { text?: string }[] | string } }[];
  };
  const content = output?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((c) => c.text ?? "").join("")
    : (content ?? "");
  return text.trim();
}

/** Qwen3-TTS-Flash: synthesize speech. Returns audio bytes (mp3). */
export async function qwenSpeak(text: string): Promise<Buffer> {
  const data = await post({
    model: TTS_MODEL,
    input: { text, voice: TTS_VOICE, language_type: "Auto" },
  });
  const output = data.output as { audio?: { url?: string; data?: string } };
  const audio = output?.audio;
  if (audio?.data) return Buffer.from(audio.data, "base64");
  if (audio?.url) {
    const { b64 } = await urlToB64(audio.url);
    return Buffer.from(b64, "base64");
  }
  throw new Error("Qwen-TTS returned no audio");
}
