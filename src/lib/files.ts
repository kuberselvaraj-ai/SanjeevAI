import type { Attachment, Settings } from './types'
import { uid } from './storage'

export const ACCEPTED_FILE_TYPES =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.py,.js,.ts,.java,.go,.rs,.c,.cpp,.html,.css,image/*'

export const MAX_DOC_SIZE = 100 * 1024 * 1024 // 100 MB
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20 MB

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

/** Read a file as a base64 data URL, downscaling large images so they
 *  fit comfortably in requests and local storage. */
export function fileToDataUrl(file: File, maxDim = 1568): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!isImageMime(file.type)) return resolve(dataUrl)
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        if (scale >= 1) return resolve(dataUrl)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(dataUrl)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Upload a document to the Kimi Files API and return its extracted text.
 * (purpose=file-extract — the model reads the extracted text as context.
 * Images get OCR'd through the same endpoint.)
 */
export async function extractDocumentText(settings: Settings, file: File): Promise<string> {
  const base = settings.moonshotBaseUrl.replace(/\/+$/, '')
  const auth = { Authorization: `Bearer ${settings.moonshotKey}` }

  const form = new FormData()
  form.append('purpose', 'file-extract')
  form.append('file', file, file.name)

  const upRes = await fetch(`${base}/files`, { method: 'POST', headers: auth, body: form })
  const upData = await upRes.json().catch(() => ({}))
  if (!upRes.ok || !upData.id) {
    throw new Error(upData?.error?.message || `File upload failed (${upRes.status})`)
  }

  const contentRes = await fetch(`${base}/files/${upData.id}/content`, { headers: auth })
  if (!contentRes.ok) {
    const err = await contentRes.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Could not read extracted content (${contentRes.status})`)
  }
  const contentType = contentRes.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await contentRes.json()
    return data.content ?? data.text ?? JSON.stringify(data)
  }
  return contentRes.text()
}

/** Process one user-picked file into an Attachment ready for the API. */
export async function processFile(settings: Settings, file: File): Promise<Attachment> {
  const base: Attachment = {
    id: uid(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: isImageMime(file.type) ? 'image' : 'doc',
    status: 'ready',
  }
  try {
    if (base.kind === 'image') {
      if (file.size > MAX_IMAGE_SIZE) throw new Error('Image exceeds the 20 MB limit')
      base.dataUrl = await fileToDataUrl(file)
    } else {
      if (file.size > MAX_DOC_SIZE) throw new Error('File exceeds the 100 MB limit')
      base.extractedText = await extractDocumentText(settings, file)
    }
  } catch (e) {
    base.status = 'error'
    base.error = (e as Error).message
  }
  return base
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
