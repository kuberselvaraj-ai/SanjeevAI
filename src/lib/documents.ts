/**
 * Client side of the document suite — format metadata for the composer
 * picker, a gentle intent detector ("make a spreadsheet of…" offers the
 * Excel action without any menu), and the API call itself.
 */

export type DocFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx'

export const DOC_FORMATS: { id: DocFormat; label: string; noun: string }[] = [
  { id: 'pdf', label: 'PDF', noun: 'PDF report' },
  { id: 'docx', label: 'Word', noun: 'Word document' },
  { id: 'xlsx', label: 'Excel', noun: 'spreadsheet' },
  { id: 'pptx', label: 'Slides', noun: 'slide deck' },
]

const INTENT_VERB = /\b(make|create|generate|build|draft|prepare|produce|turn|put|compile|assemble)\b/i
const FORMAT_HINTS: [RegExp, DocFormat][] = [
  [/\b(spreadsheet|excel|xlsx|workbook|table of|numbers into)\b/i, 'xlsx'],
  [/\b(slide ?deck|slides|presentation|pptx|powerpoint)\b/i, 'pptx'],
  [/\b(pdf)\b/i, 'pdf'],
  [/\b(word doc|docx|word document|memo|letter)\b/i, 'docx'],
]

/** "make a spreadsheet of the Globex numbers" → 'xlsx'. Null when the text
 *  isn't clearly a document request. */
export function detectDocIntent(text: string): DocFormat | null {
  if (!INTENT_VERB.test(text)) return null
  for (const [re, fmt] of FORMAT_HINTS) {
    if (re.test(text)) return fmt
  }
  return null
}

export interface GeneratedDoc {
  title: string
  file: { id: string; name: string; mimeType: string; size: number; kind: string } | null
}

export async function requestDocument(
  format: DocFormat,
  brief: string,
  context: string,
): Promise<GeneratedDoc> {
  const res = await fetch('/api/hosted/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ format, brief, context }),
  })
  const data = (await res.json().catch(() => ({}))) as GeneratedDoc & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Document generation failed')
  return data
}
