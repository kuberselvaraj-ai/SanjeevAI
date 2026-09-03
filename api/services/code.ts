import { Sandbox } from "@e2b/code-interpreter";

export function codeConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

export interface CodeResult {
  stdout: string;
  stderr: string;
  /** Plain-text representation of the last expression / display() output. */
  results: string[];
  /** base64 PNGs from matplotlib charts etc. */
  images?: string[];
  error?: { name: string; value: string };
}

/** Run Python in an ephemeral E2B sandbox. Sandboxes are killed after each run. */
export async function runPython(code: string): Promise<CodeResult> {
  const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY });
  try {
    const exec = await sandbox.runCode(code, { timeoutMs: 120_000 });
    const results: string[] = [];
    const images: string[] = [];
    for (const r of exec.results ?? []) {
      const text = (r as { text?: string }).text;
      if (text) results.push(text);
      const png = (r as { png?: string }).png;
      if (png) images.push(png);
    }
    return {
      stdout: exec.logs?.stdout?.join("\n") ?? "",
      stderr: exec.logs?.stderr?.join("\n") ?? "",
      results,
      images,
      error: exec.error
        ? { name: exec.error.name, value: exec.error.value }
        : undefined,
    };
  } finally {
    await sandbox.kill().catch(() => {});
  }
}
