import type { Settings } from './types'

/**
 * Image generation — desktop/direct-API mode (hosted mode goes through
 * the server's image router instead, so keys stay server-side).
 *
 * GPT Image 2 (OpenAI): POST /v1/images/generations, edits via
 *   /v1/images/edits (multipart) when a reference image is given.
 * Nano Banana 2 (Google): POST generativelanguage v1beta generateContent,
 *   reference images as inlineData parts. Model: gemini-3.1-flash-image.
 */

export const IMAGE_MODELS = [
  {
    id: 'fal-ai/nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'Google via fal',
    description: 'Arena #4 overall · best quality-per-dollar · ~$0.08/img',
    badge: 'Best pick',
  },
  {
    id: 'fal-ai/flux-2-flex',
    label: 'FLUX.2',
    provider: 'fal.ai',
    description: 'Western photorealism · kills the “AI look” · ~$0.03/img',
    badge: 'Photoreal',
  },
  {
    id: 'fal-ai/nano-banana-pro',
    label: 'Nano Banana Pro',
    provider: 'Google via fal',
    description: 'Google flagship · 4K · best editing · ~$0.15/img',
    badge: 'Premium',
  },
  {
    id: 'fal-ai/ideogram-4',
    label: 'Ideogram 4',
    provider: 'via fal.ai',
    description: 'Best legible text in images · posters & logos',
    badge: 'Typography',
  },
  {
    id: 'doubao-seedream-4-5-251128',
    label: 'Seedream 4.5',
    provider: 'Volcano',
    description: 'ByteDance flagship · 4K · great text rendering · ~$0.035/img',
    badge: 'Value',
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    provider: 'OpenAI',
    description: 'Flagship quality · text & layout · ~$0.006–0.21/img',
    badge: 'Premium',
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    provider: 'Google',
    description: 'Fast & cheap · best at editing your photos · ~$0.045/img',
    badge: 'Editor',
  },
  {
    id: 'qwen-image-2.0-pro',
    label: 'Qwen Image 2 Pro',
    provider: 'Alibaba',
    description: 'Alibaba Bailian · strong Chinese text & posters',
    badge: 'China-friendly',
  },
] as const

export const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
export const OPENAI_QUALITIES = ['low', 'medium', 'high'] as const
export const GEMINI_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const
export const GEMINI_SIZES = ['1K', '2K', '4K'] as const
export const QWEN_SIZES = [
  '2048*2048',
  '2688*1536',
  '1536*2688',
  '2368*1728',
  '1728*2368',
] as const
export const SEEDREAM_SIZES = ['2048x2048', '2304x1728', '1728x2304', '2560x1440', '1440x2560'] as const
export const FAL_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const

export const isOpenAiImage = (model: string) => model.startsWith('gpt-image')
export const isGeminiImage = (model: string) => model.startsWith('gemini')
export const isQwenImage = (model: string) => model.startsWith('qwen-image')
export const isSeedreamImage = (model: string) => model.startsWith('doubao-seedream')
export const isFalImage = (model: string) => model.startsWith('fal-ai/')

export interface GenerateImageOpts {
  prompt: string
  model: string
  size?: string
  quality?: string
  aspectRatio?: string
  imageSize?: string
  referenceImage?: string // data URL
}

export interface GeneratedImage {
  b64: string
  mimeType: string
}

function parseDataUrl(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl)
  if (!m) throw new Error('Invalid reference image format')
  return { mime: m[1], b64: m[2] }
}

async function generateOpenAi(settings: Settings, opts: GenerateImageOpts): Promise<GeneratedImage> {
  const size = opts.size || '1024x1024'
  const quality = opts.quality || 'medium'

  if (opts.referenceImage) {
    const { mime, b64 } = parseDataUrl(opts.referenceImage)
    const ext = mime.split('/')[1] || 'png'
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('prompt', opts.prompt)
    form.append('size', size)
    form.append('quality', quality)
    form.append('image', new Blob([bytes], { type: mime }), `reference.${ext}`)
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.openaiKey}` },
      body: form,
    })
    const data = (await res.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[]
      error?: { message?: string }
    }
    const out = data.data?.[0]?.b64_json
    if (!res.ok || !out) throw new Error(data.error?.message || `OpenAI API error ${res.status}`)
    return { b64: out, mimeType: 'image/png' }
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({ model: 'gpt-image-2', prompt: opts.prompt, size, quality }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string }[]
    error?: { message?: string }
  }
  const out = data.data?.[0]?.b64_json
  if (!res.ok || !out) throw new Error(data.error?.message || `OpenAI API error ${res.status}`)
  return { b64: out, mimeType: 'image/png' }
}

async function generateGemini(settings: Settings, opts: GenerateImageOpts): Promise<GeneratedImage> {
  type Part = { text: string } | { inlineData: { mimeType: string; data: string } }
  const parts: Part[] = [{ text: opts.prompt }]
  if (opts.referenceImage) {
    const { mime, b64 } = parseDataUrl(opts.referenceImage)
    parts.push({ inlineData: { mimeType: mime, data: b64 } })
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: opts.aspectRatio || '1:1',
            imageSize: opts.imageSize || '1K',
          },
        },
      }),
    },
  )
  const data = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[]
    error?: { message?: string }
  }
  const img = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
  if (!res.ok || !img) throw new Error(data.error?.message || `Gemini API error ${res.status}`)
  return { b64: img.data, mimeType: img.mimeType || 'image/png' }
}

async function urlToB64(url: string): Promise<GeneratedImage> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download generated file (${res.status})`)
  const mimeType = res.headers.get('content-type') || 'image/png'
  const buf = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  }
  return { b64: btoa(bin), mimeType }
}

async function generateQwen(settings: Settings, opts: GenerateImageOpts): Promise<GeneratedImage> {
  if (!settings.dashscopeKey) {
    throw new Error('Add an Alibaba Bailian API key in Settings to use Qwen Image.')
  }
  const content: ({ text: string } | { image: string })[] = []
  if (opts.referenceImage) content.push({ image: opts.referenceImage })
  content.push({ text: opts.prompt })
  const res = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.dashscopeKey}`,
      },
      body: JSON.stringify({
        model: opts.model || 'qwen-image-2.0-pro',
        input: { messages: [{ role: 'user', content }] },
        parameters: { size: opts.size || '2048*2048', prompt_extend: true, watermark: false },
      }),
    },
  )
  const data = (await res.json().catch(() => ({}))) as {
    output?: { choices?: { message?: { content?: { image?: string }[] } }[] }
    message?: string
  }
  const imgUrl = data.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image
  if (!res.ok || !imgUrl) throw new Error(data.message || `DashScope API error ${res.status}`)
  return urlToB64(imgUrl)
}

async function generateSeedream(
  settings: Settings,
  opts: GenerateImageOpts,
): Promise<GeneratedImage> {
  if (!settings.arkKey) {
    throw new Error('Add a Volcano Engine Ark API key in Settings to use Seedream.')
  }
  const body: Record<string, unknown> = {
    model: opts.model || 'doubao-seedream-4-5-251128',
    prompt: opts.prompt,
    size: opts.size || '2048x2048',
    response_format: 'b64_json',
    watermark: false,
  }
  if (opts.referenceImage) body.image = opts.referenceImage
  const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.arkKey}` },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string; url?: string }[]
    error?: { message?: string }
  }
  if (!res.ok) throw new Error(data.error?.message || `Ark API error ${res.status}`)
  const first = data.data?.[0]
  if (first?.b64_json) return { b64: first.b64_json, mimeType: 'image/png' }
  if (first?.url) return urlToB64(first.url)
  throw new Error('Seedream returned no image')
}

function fluxSize(aspectRatio?: string): string {
  switch (aspectRatio) {
    case '16:9':
      return 'landscape_16_9'
    case '9:16':
      return 'portrait_16_9'
    case '4:3':
      return 'landscape_4_3'
    case '3:4':
      return 'portrait_4_3'
    default:
      return 'square_hd'
  }
}

async function generateFal(settings: Settings, opts: GenerateImageOpts): Promise<GeneratedImage> {
  if (!settings.falKey) {
    throw new Error('Add a fal.ai API key in Settings to use FLUX.2, Nano Banana Pro and Ideogram 4.')
  }
  const ratio = opts.aspectRatio || '1:1'
  let body: Record<string, unknown>
  if (opts.model.includes('nano-banana')) {
    body = { prompt: opts.prompt, aspect_ratio: ratio, output_format: 'png' }
    // Nano Banana Pro supports a resolution knob; Nano Banana 2 doesn't.
    if (opts.model.includes('pro')) body.resolution = '2K'
  } else if (opts.model.includes('ideogram')) {
    body = { prompt: opts.prompt, aspect_ratio: ratio }
  } else {
    body = { prompt: opts.prompt, image_size: fluxSize(ratio), output_format: 'png' }
  }
  if (opts.referenceImage) body.image_urls = [opts.referenceImage]
  const res = await fetch(`https://fal.run/${opts.model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${settings.falKey}` },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as {
    images?: { url?: string; content_type?: string }[]
    detail?: string | { msg?: string }[]
    message?: string
  }
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join('; ') : data.detail
    throw new Error(detail || data.message || `fal.ai API error ${res.status}`)
  }
  const img = data.images?.[0]
  if (!img?.url) throw new Error('fal.ai returned no image')
  const out = await urlToB64(img.url)
  if (img.content_type) out.mimeType = img.content_type
  return out
}

export async function generateImageDirect(
  settings: Settings,
  opts: GenerateImageOpts,
): Promise<GeneratedImage> {
  if (isOpenAiImage(opts.model)) return generateOpenAi(settings, opts)
  if (isQwenImage(opts.model)) return generateQwen(settings, opts)
  if (isSeedreamImage(opts.model)) return generateSeedream(settings, opts)
  if (isFalImage(opts.model)) return generateFal(settings, opts)
  return generateGemini(settings, opts)
}

/** Read an image File as a data URL (reference image for editing). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error(`Could not read ${file.name}`))
    r.readAsDataURL(file)
  })
}
