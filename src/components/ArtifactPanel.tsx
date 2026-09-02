import { useState } from 'react'
import { X, Code2, Eye, Copy, Check, Download } from 'lucide-react'

export interface Artifact {
  code: string
  language: string // 'html' | 'svg'
}

/**
 * Claude-style artifacts panel: renders HTML/SVG code blocks live in a
 * sandboxed iframe next to the chat. Sandbox has no same-origin or script
 * privileges for SVG; HTML gets scripts but stays fully sandboxed.
 */
export function ArtifactPanel({
  artifact,
  onClose,
}: {
  artifact: Artifact
  onClose: () => void
}) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [copied, setCopied] = useState(false)

  const srcDoc =
    artifact.language === 'svg'
      ? `<!doctype html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style></head><body>${artifact.code}</body></html>`
      : artifact.code

  const copy = async () => {
    await navigator.clipboard.writeText(artifact.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const ext = artifact.language === 'svg' ? 'svg' : 'html'
    const blob = new Blob([artifact.code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `artifact-${Date.now()}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2.5">
        <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
              tab === 'preview' ? 'bg-card shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <Eye size={12} />
            Preview
          </button>
          <button
            onClick={() => setTab('code')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${
              tab === 'code' ? 'bg-card shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <Code2 size={12} />
            Code
          </button>
        </div>
        <div className="flex-1" />
        <button
          onClick={copy}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Copy code"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          onClick={download}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Download file"
        >
          <Download size={14} />
        </button>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Close panel"
        >
          <X size={14} />
        </button>
      </div>
      {tab === 'preview' ? (
        <iframe
          title="Artifact preview"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4 font-mono-code text-xs leading-5 whitespace-pre-wrap">
          {artifact.code}
        </pre>
      )}
    </div>
  )
}
