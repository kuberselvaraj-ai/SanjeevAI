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
] as const

export const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const
export const OPENAI_QUALITIES = ['low', 'medium', 'high'] as const
export const GEMINI_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const
export const GEMINI_SIZES = ['1K', '2K', '4K'] as const

export const isOpenAiImage = (model: string) => model.startsWith('gpt-image')

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

export async function generateImageDirect(
  settings: Settings,
  opts: GenerateImageOpts,
): Promise<GeneratedImage> {
  return isOpenAiImage(opts.model) ? generateOpenAi(settings, opts) : generateGemini(settings, opts)
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
