import { Sandbox } from '@e2b/code-interpreter'
import type { Settings } from './types'

export interface CodeRunResult {
  stdout: string
  stderr: string
  results: string[]
  error?: { name: string; value: string }
}

/** Desktop mode: run Python straight from the app with the user's E2B key. */
export async function runCodeDirect(settings: Settings, code: string): Promise<CodeRunResult> {
  if (!settings.e2bKey) {
    throw new Error('Add an E2B API key in Settings to run code (e2b.dev → API keys).')
  }
  const sandbox = await Sandbox.create({ apiKey: settings.e2bKey })
  try {
    const exec = await sandbox.runCode(code, { timeoutMs: 120_000 })
    return {
      stdout: exec.logs?.stdout?.join('\n') ?? '',
      stderr: exec.logs?.stderr?.join('\n') ?? '',
      results: (exec.results ?? [])
        .map((r) => (r as { text?: string }).text)
        .filter((t): t is string => Boolean(t)),
      error: exec.error ? { name: exec.error.name, value: exec.error.value } : undefined,
    }
  } finally {
    await sandbox.kill().catch(() => {})
  }
}
