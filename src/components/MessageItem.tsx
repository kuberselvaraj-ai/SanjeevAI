import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  Brain,
  AlertCircle,
  FileText,
  RefreshCw,
  Pencil,
  Play,
  BookmarkPlus,
  Volume2,
  Terminal,
  Loader2,
} from 'lucide-react'
import type { CodeRunResult } from '@/lib/code'
import type { Attachment, ChatMessage } from '@/lib/types'
import { modelLabel } from '@/lib/models'
import { formatSize } from '@/lib/files'
import { addMemory } from '@/lib/memory'

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === 'image' && attachment.dataUrl) {
    return (
      <img
        src={attachment.dataUrl}
        alt={attachment.name}
        title={attachment.name}
        className="h-20 w-20 rounded-lg border border-border object-cover"
      />
    )
  }
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
        attachment.status === 'error'
          ? 'border-destructive/50 bg-destructive/10'
          : 'border-border bg-background/60'
      }`}
      title={attachment.status === 'error' ? attachment.error : attachment.name}
    >
      <FileText
        size={16}
        className={attachment.status === 'error' ? 'text-destructive' : 'text-primary'}
      />
      <span className="max-w-[160px]">
        <span className="block truncate text-xs font-medium">{attachment.name}</span>
        <span className="block text-[10px] text-muted-foreground">
          {attachment.status === 'error' ? 'Failed to read' : formatSize(attachment.size)}
        </span>
      </span>
    </div>
  )
}

/** Languages that can be rendered live in the artifacts panel. */
const PREVIEWABLE = new Set(['html', 'svg'])

function CodeBlock({
  language,
  code,
  dark,
  onPreview,
  onRunCode,
}: {
  language: string
  code: string
  dark: boolean
  onPreview?: (code: string, language: string) => void
  onRunCode?: (code: string) => Promise<CodeRunResult>
}) {
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<CodeRunResult | null>(null)
  const [runError, setRunError] = useState('')
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const run = async () => {
    if (!onRunCode || running) return
    setRunning(true)
    setRunError('')
    setOutput(null)
    try {
      setOutput(await onRunCode(code))
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Code execution failed.')
    } finally {
      setRunning(false)
    }
  }
  const previewable = PREVIEWABLE.has(language.toLowerCase())
  const runnable = onRunCode && ['python', 'py'].includes(language.toLowerCase())
  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border border-border bg-[#282c34] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono-code text-xs text-white/50">{language || 'text'}</span>
        <span className="flex items-center gap-1.5">
          {runnable && (
            <button
              onClick={run}
              disabled={running}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/50 transition-colors hover:text-white disabled:opacity-50"
              title="Run in a Python sandbox"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Terminal size={12} />}
              {running ? 'Running…' : 'Run'}
            </button>
          )}
          {previewable && onPreview && (
            <button
              onClick={() => onPreview(code, language.toLowerCase())}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/50 transition-colors hover:text-white"
              title="Render live in the preview panel"
            >
              <Play size={12} />
              Preview
            </button>
          )}
          <button
            onClick={copy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/50 transition-colors hover:text-white"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={dark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          background: dark ? '#282c34' : '#faf8f2',
          fontSize: '13px',
          lineHeight: 1.6,
        }}
        codeTagProps={{ className: 'font-mono-code' }}
      >
        {code}
      </SyntaxHighlighter>
      {(output || runError) && (
        <div className="border-t border-white/10 bg-black/30 px-3 py-2.5">
          <p className="mb-1 font-mono-code text-[10px] uppercase tracking-wide text-white/40">
            Output
          </p>
          {runError && <pre className="whitespace-pre-wrap font-mono-code text-xs text-red-400">{runError}</pre>}
          {output?.stdout && (
            <pre className="whitespace-pre-wrap font-mono-code text-xs text-emerald-300">{output.stdout}</pre>
          )}
          {output?.results.map((r, i) => (
            <pre key={i} className="whitespace-pre-wrap font-mono-code text-xs text-white/80">{r}</pre>
          ))}
          {output?.stderr && (
            <pre className="whitespace-pre-wrap font-mono-code text-xs text-amber-400">{output.stderr}</pre>
          )}
          {output?.error && (
            <pre className="whitespace-pre-wrap font-mono-code text-xs text-red-400">
              {output.error.name}: {output.error.value}
            </pre>
          )}
          {output && !output.stdout && !output.stderr && !output.error && output.results.length === 0 && (
            <p className="font-mono-code text-xs text-white/40">(no output)</p>
          )}
        </div>
      )}
    </div>
  )
}

export function Markdown({
  text,
  dark,
  onPreview,
  onRunCode,
}: {
  text: string
  dark: boolean
  onPreview?: (code: string, language: string) => void
  onRunCode?: (code: string) => Promise<CodeRunResult>
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Our own tool pipeline embeds images as data: URLs — allow them.
      urlTransform={(url) => url}
      components={{
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt ?? ''}
            className="my-3 max-w-full rounded-xl border border-border shadow-sm"
            loading="lazy"
          />
        ),
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const code = String(children).replace(/\n$/, '')
          const inline = !match && !code.includes('\n')
          if (inline) {
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono-code text-[0.85em] text-primary"
                {...props}
              >
                {children}
              </code>
            )
          }
          return (
            <CodeBlock
              language={match?.[1] ?? ''}
              code={code}
              dark={dark}
              onPreview={onPreview}
              onRunCode={onRunCode}
            />
          )
        },
        p: ({ children }) => <p className="my-2.5 leading-7 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 pl-6">{children}</ul>,
        ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1 pl-6">{children}</ol>,
        li: ({ children }) => <li className="leading-7">{children}</li>,
        h1: ({ children }) => (
          <h1 className="font-display mb-3 mt-5 text-2xl font-semibold first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="font-display mb-2.5 mt-5 text-xl font-semibold first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-primary/50 pl-4 text-muted-foreground">
            {children}
          </blockquote>
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-border bg-muted px-3 py-2 text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="border-b border-border px-3 py-2">{children}</td>,
        hr: () => <hr className="my-4 border-border" />,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2 rounded-lg border border-border bg-muted/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Brain size={13} />
        Thinking
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-xs leading-6 text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return { copied, copy }
}

export const MessageItem = memo(function MessageItem({
  message,
  dark,
  isLast = false,
  onRegenerate,
  onEdit,
  onSpeak,
  onPreview,
  onRunCode,
}: {
  message: ChatMessage
  dark: boolean
  /** true for the most recent assistant message — enables Regenerate */
  isLast?: boolean
  onRegenerate?: () => void
  onEdit?: (id: string, text: string) => void
  onSpeak?: (text: string) => void
  onPreview?: (code: string, language: string) => void
  onRunCode?: (code: string) => Promise<CodeRunResult>
}) {
  const { copied, copy } = useCopy(message.content)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [remembered, setRemembered] = useState(false)
  const remember = () => {
    // Save a compact snippet — full answers belong in the chat, facts in memory.
    addMemory(message.content.replace(/\s+/g, ' ').slice(0, 300))
    setRemembered(true)
    setTimeout(() => setRemembered(false), 1500)
  }

  if (message.role === 'user') {
    return (
      <div className="rise-in group flex justify-end px-4 py-2 md:px-8">
        <div className="max-w-[85%] md:max-w-[75%]">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-2">
              {message.attachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} />
              ))}
            </div>
          )}
          {editing ? (
            <div className="rounded-2xl border border-primary/40 bg-card p-2 shadow-sm">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(10, Math.max(2, draft.split('\n').length))}
                className="w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-7 outline-none"
                autoFocus
              />
              <div className="flex justify-end gap-1.5 px-1 pb-0.5">
                <button
                  onClick={() => {
                    setDraft(message.content)
                    setEditing(false)
                  }}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const v = draft.trim()
                    if (v && v !== message.content) onEdit?.(message.id, v)
                    setEditing(false)
                  }}
                  className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  Save & resend
                </button>
              </div>
            </div>
          ) : (
            message.content && (
              <div className="rounded-2xl rounded-br-md bg-accent px-4 py-2.5">
                <p className="whitespace-pre-wrap leading-7">{message.content}</p>
              </div>
            )
          )}
          {!editing && (
            <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={copy}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy message"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              {onEdit && (
                <button
                  onClick={() => {
                    setDraft(message.content)
                    setEditing(true)
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Edit & branch from here"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const showActions = !message.streaming && !message.error && message.content

  return (
    <div className="rise-in group px-4 py-2 md:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-display flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            S
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {modelLabel(message.model ?? '')}
          </span>
        </div>
        {message.reasoning && <ReasoningBlock text={message.reasoning} />}
        {message.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="flex-1">{message.error}</span>
            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-destructive/15"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className={message.streaming && !message.content ? 'stream-cursor' : ''}>
            {message.content ? (
              <div className={message.streaming ? 'stream-cursor' : ''}>
                <Markdown
                  text={message.content}
                  dark={dark}
                  onPreview={onPreview}
                  onRunCode={onRunCode}
                />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                {message.preparing
                  ? 'Reading uploaded files…'
                  : (message.statusText ?? 'Thinking…')}
              </span>
            )}
          </div>
        )}
        {message.streaming && message.statusText && Boolean(message.content) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {message.statusText}
          </div>
        )}
        {!message.streaming && message.refinedBy && !message.error && (
          <div className="mt-1.5 text-[11px] text-muted-foreground/70">
            Refined with {message.refinedBy}
          </div>
        )}
        {showActions && (
          <div className="mt-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Copy response"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Regenerate response"
              >
                <RefreshCw size={13} />
                Regenerate
              </button>
            )}
            <button
              onClick={remember}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Save to memory (remembered across chats)"
            >
              {remembered ? <Check size={13} /> : <BookmarkPlus size={13} />}
              {remembered ? 'Saved' : 'Remember'}
            </button>
            {onSpeak && (
              <button
                onClick={() => onSpeak(message.content)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Read aloud"
              >
                <Volume2 size={13} />
                Listen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
