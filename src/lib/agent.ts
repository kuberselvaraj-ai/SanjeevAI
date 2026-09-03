import type { Settings } from './types'
import type { ToolCall } from './kimi'
import { runCodeDirect } from './code'
import { generateImageDirect } from './image'

/**
 * The specialist toolbox — no modes, no buttons.
 *
 * The user asks for a THING (a report, research, a marketing plan, working
 * code, an analysis). We detect that the request implies real work and hand
 * the orchestrator (Kimi K3) a set of specialist tools. The model plans
 * silently, calls the specialists it needs, and composes one deliverable.
 *
 * Specialists:
 *  - $web_search   Moonshot builtin (fresh facts, cited sources)
 *  - run_python    E2B sandbox — exact math, data analysis, charts
 *  - generate_image  Nano Banana 2 via fal — covers, diagrams, visuals
 */

// ── Deliverable detection ────────────────────────────────────────────────
// Casual chat stays fast and cheap; real work gets the pipeline.
const DELIVERABLE_RE =
  /\b(report|deep research|research (on|into|about)|analysis|analy[sz]e|marketing plan|business plan|go[- ]to[- ]market|strategy|roadmap|proposal|whitepaper|brief|deck|pitch deck|presentation|case study|white paper|essay|guide|tutorial|curriculum|newsletter|audit|forecast|projection|budget|financial model|dcf|valuation|comparison|compare|versus|vs\.?|review of|literature|survey of|spreadsheet|dataset|chart|graph|plot|diagram|infographic|logo|poster|illustration|cover (image|art)|thumbnail|generate (an? |some )?(image|picture|photo|art|logo|poster)|draw|build me|create (a|an|the|some)|develop (a|an|the)|write (a|an|the) (report|plan|essay|article|paper|blog|book|chapter|whitepaper|script|novel)|calculate|compute|simulate|optimize|regression|statistics for|market size|market share)\b/i

export function needsAgentTools(text: string): boolean {
  const t = text.trim()
  if (t.length < 12) return false
  return DELIVERABLE_RE.test(t)
}

// ── Tool schemas (OpenAI function-calling format, Moonshot-compatible) ────
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_python',
      description:
        'Execute Python 3 in a secure sandbox; returns stdout/stderr and chart images (matplotlib/seaborn work). ALWAYS use this for arithmetic, statistics, financial math, data analysis and charts — never compute numbers in your head when precision matters.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python source code to execute' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate a high-quality image from a text prompt (top-arena image model). Use for covers, illustrations, diagrams, logos and marketing visuals that the deliverable needs. Call at most twice per task. The image is embedded into the reply automatically.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed image description' },
          aspect_ratio: {
            type: 'string',
            enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
            description: 'Default 16:9; use 1:1 for logos, 9:16 for phone-oriented visuals',
          },
        },
        required: ['prompt'],
      },
    },
  },
]

export const AGENT_SYSTEM_HINT = `You have specialist tools available: run_python (exact computation, data analysis, charts) and generate_image (covers, illustrations, diagrams). For substantial deliverables (reports, plans, analyses, decks), plan silently and use the tools that materially improve the result: gather facts, compute numbers with run_python instead of estimating, and create visuals with generate_image where they add value. Then compose the final deliverable in polished Markdown. Never mention tool mechanics to the user; the work should read as one seamless answer.`

// ── Execution ─────────────────────────────────────────────────────────────
export interface ToolArtifact {
  kind: 'image'
  dataUrl: string
  label: string
}

export interface AgentExecContext {
  settings: Settings
  hosted: boolean
  onStatus?: (s: string | null) => void
}

const MAX_TOOL_RESULT_CHARS = 6000

function truncate(s: string): string {
  return s.length > MAX_TOOL_RESULT_CHARS
    ? `${s.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated)`
    : s
}

/** Hosted calls hit our metered tRPC endpoints; desktop uses the user's keys. */
async function runPythonTool(code: string, ctx: AgentExecContext) {
  if (ctx.hosted) {
    const res = await fetch('/api/trpc/code.run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ json: { code, language: 'python' } }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = body?.error?.json?.message ?? `code.run failed (${res.status})`
      throw new Error(msg)
    }
    return body?.result?.data?.json as {
      stdout: string
      stderr: string
      results: string[]
      images?: string[]
      error?: { name: string; value: string }
    }
  }
  return runCodeDirect(ctx.settings, code)
}

async function generateImageTool(
  prompt: string,
  aspectRatio: string,
  ctx: AgentExecContext,
): Promise<{ b64: string; mimeType: string }> {
  if (ctx.hosted) {
    const res = await fetch('/api/trpc/image.generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        json: { prompt, model: 'fal-ai/nano-banana-2', aspectRatio },
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = body?.error?.json?.message ?? `image.generate failed (${res.status})`
      throw new Error(msg)
    }
    return body?.result?.data?.json as { b64: string; mimeType: string }
  }
  if (!ctx.settings.falKey) {
    throw new Error('no fal.ai key configured')
  }
  return generateImageDirect(ctx.settings, {
    prompt,
    model: 'fal-ai/nano-banana-2',
    aspectRatio,
  })
}

/**
 * Execute one specialist call. Always returns a result string — failures are
 * described so the orchestrator can adapt (skip the step, work from its own
 * knowledge) instead of the whole reply dying.
 */
export async function executeAgentTool(
  call: ToolCall,
  ctx: AgentExecContext,
): Promise<{ result: string; artifact?: ToolArtifact }> {
  let args: Record<string, string> = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return { result: 'Tool call had invalid arguments — continue without it.' }
  }

  if (call.function.name === 'run_python') {
    ctx.onStatus?.('Running Python in a sandbox…')
    try {
      const r = await runPythonTool(args.code ?? '', ctx)
      const parts: string[] = []
      if (r.stdout?.trim()) parts.push(`stdout:\n${r.stdout}`)
      if (r.results?.length) parts.push(`result: ${r.results.join('\n')}`)
      if (r.stderr?.trim()) parts.push(`stderr:\n${r.stderr}`)
      if (r.error) parts.push(`error: ${r.error.name}: ${r.error.value}`)
      if (!parts.length) parts.push('(no output — code ran successfully)')
      const chart = r.images?.[0]
      return {
        result: truncate(parts.join('\n\n')) + (chart ? '\n\nA chart was produced and embedded in the reply.' : ''),
        artifact: chart
          ? { kind: 'image', dataUrl: `data:image/png;base64,${chart}`, label: 'Chart' }
          : undefined,
      }
    } catch (e) {
      return {
        result: `Python execution unavailable (${(e as Error).message}). Do the reasoning yourself and state that computed figures are estimates.`,
      }
    } finally {
      ctx.onStatus?.(null)
    }
  }

  if (call.function.name === 'generate_image') {
    ctx.onStatus?.('Generating an image…')
    try {
      const img = await generateImageTool(args.prompt ?? '', args.aspect_ratio ?? '16:9', ctx)
      return {
        result: 'Image generated successfully and embedded in the reply where the user will see it. Continue composing the deliverable.',
        artifact: {
          kind: 'image',
          dataUrl: `data:${img.mimeType || 'image/png'};base64,${img.b64}`,
          label: args.prompt?.slice(0, 60) || 'Generated image',
        },
      }
    } catch (e) {
      return {
        result: `Image generation unavailable (${(e as Error).message}). Continue without visuals — do not mention this failure unless relevant.`,
      }
    } finally {
      ctx.onStatus?.(null)
    }
  }

  return { result: `Unknown tool "${call.function.name}" — continue without it.` }
}
