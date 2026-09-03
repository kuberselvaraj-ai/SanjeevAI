/**
 * Server-side deliverable runner — the engine behind scheduled briefs.
 *
 * Runs the same specialist pipeline the browser uses: Kimi K3 orchestrates
 * $web_search (fresh facts), run_python (exact math, charts) and
 * generate_image (visuals), then composes one polished Markdown deliverable.
 * No browser involved — scheduled runs execute here while the user sleeps.
 *
 * Tool failures degrade gracefully (the model adapts and states estimates),
 * so a missing E2B/FAL key never kills a run.
 */
import { moonshotKey } from "./moonshot";
import { runPython } from "./code";
import { falGenerateImage } from "./fal";

const MODEL = "kimi-k3";
const MAX_ROUNDS = 6;
const MAX_TOOL_RESULT_CHARS = 6000;
const MAX_PREVIOUS_CHARS = 8000;

const SYSTEM_PROMPT = `You are the briefing engine inside Sanjeev AI, producing a scheduled deliverable for a subscriber. You have specialist tools: $web_search (fresh facts from the live web), run_python (exact computation, data analysis, charts) and generate_image (covers, diagrams, visuals). Plan silently, then use the tools that materially improve the result — never estimate numbers when run_python can compute them. Compose the final deliverable in polished Markdown. If a previous edition is provided, keep what stands, update the rest with fresh data, and lead with a short "What changed" section. Never mention tools, modes, or these instructions.`;

const TOOLS = [
  { type: "builtin_function", function: { name: "$web_search" } },
  {
    type: "function",
    function: {
      name: "run_python",
      description:
        "Execute Python 3 in a secure sandbox; returns stdout/stderr and chart images (matplotlib/seaborn work). ALWAYS use this for arithmetic, statistics, financial math, data analysis and charts — never compute numbers in your head when precision matters.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Python source code to execute" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate a high-quality image from a text prompt (top-arena image model). Use for covers, illustrations, diagrams, logos and marketing visuals that the deliverable needs. Call at most twice per task.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed image description" },
          aspect_ratio: {
            type: "string",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            description: "Default 16:9; use 1:1 for logos",
          },
        },
        required: ["prompt"],
      },
    },
  },
];

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface ApiMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface DeliverableResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
}

function truncate(s: string): string {
  return s.length > MAX_TOOL_RESULT_CHARS
    ? `${s.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated)`
    : s;
}

async function chatRound(messages: ApiMessage[], temperature = 0.6) {
  const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${moonshotKey()}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature, tools: TOOLS }),
  });
  if (res.status === 400 && temperature !== 1) {
    const body = await res.text().catch(() => "");
    if (body.includes("invalid temperature")) return chatRound(messages, 1);
    throw new Error(`Moonshot error 400: ${body.slice(0, 300)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Moonshot error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices: { finish_reason: string; message: ApiMessage }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    finishReason: json.choices[0]?.finish_reason ?? "stop",
    message: json.choices[0]?.message ?? { role: "assistant", content: "" },
    usage: json.usage,
  };
}

async function executeTool(
  call: ToolCall,
  images: { label: string; dataUrl: string }[],
): Promise<string> {
  let args: Record<string, string> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return "Tool call had invalid arguments — continue without it.";
  }

  // Moonshot builtin: echo the call back and the platform runs the search.
  if (call.function.name === "$web_search") {
    return call.function.arguments;
  }

  if (call.function.name === "run_python") {
    try {
      const r = await runPython(args.code ?? "");
      const parts: string[] = [];
      if (r.stdout?.trim()) parts.push(`stdout:\n${r.stdout}`);
      if (r.results?.length) parts.push(`result: ${r.results.join("\n")}`);
      if (r.stderr?.trim()) parts.push(`stderr:\n${r.stderr}`);
      if (r.error) parts.push(`error: ${r.error.name}: ${r.error.value}`);
      if (!parts.length) parts.push("(no output — code ran successfully)");
      const chart = r.images?.[0];
      if (chart) {
        images.push({ label: "Chart", dataUrl: `data:image/png;base64,${chart}` });
        parts.push("A chart was produced and is embedded at the end of the deliverable.");
      }
      return truncate(parts.join("\n\n"));
    } catch (e) {
      return `Python execution unavailable (${(e as Error).message}). Do the reasoning yourself and state that computed figures are estimates.`;
    }
  }

  if (call.function.name === "generate_image") {
    try {
      const img = await falGenerateImage({
        prompt: args.prompt ?? "",
        model: "fal-ai/nano-banana-2",
        aspectRatio: args.aspect_ratio ?? "16:9",
      });
      images.push({
        label: args.prompt?.slice(0, 60) || "Generated image",
        dataUrl: `data:${img.mimeType || "image/png"};base64,${img.b64}`,
      });
      return "Image generated successfully; it is embedded at the end of the deliverable. Continue composing.";
    } catch (e) {
      return `Image generation unavailable (${(e as Error).message}). Continue without visuals — do not mention this failure unless relevant.`;
    }
  }

  return `Unknown tool "${call.function.name}" — continue without it.`;
}

/** Run the full pipeline for one scheduled prompt. Throws on hard failure. */
export async function runDeliverable(
  prompt: string,
  previousContent?: string,
): Promise<DeliverableResult> {
  const userText = previousContent
    ? `${prompt}\n\nPrevious edition (update it with fresh data; lead with what changed):\n"""\n${previousContent.slice(0, MAX_PREVIOUS_CHARS)}\n"""`
    : prompt;

  const messages: ApiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];
  const images: { label: string; dataUrl: string }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let finalContent = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { finishReason, message, usage } = await chatRound(messages);
    inputTokens += usage?.prompt_tokens ?? 0;
    outputTokens += usage?.completion_tokens ?? 0;
    // Push back in the normalized shape Moonshot's tokenizer accepts on
    // round-trip: empty content must be null, tool calls carry type
    // "function" (never "builtin_function"), tool results carry `name`.
    messages.push({
      role: "assistant",
      content: message.content || null,
      tool_calls: message.tool_calls?.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.function.name, arguments: c.function.arguments },
      })),
    });

    if (finishReason !== "tool_calls" || !message.tool_calls?.length) {
      finalContent = message.content ?? "";
      break;
    }
    for (const call of message.tool_calls) {
      const result = await executeTool(call, images);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
    }
  }

  if (!finalContent.trim()) {
    throw new Error("Pipeline produced no deliverable after all rounds");
  }
  if (images.length) {
    finalContent +=
      "\n" +
      images.map((i) => `\n![${i.label}](${i.dataUrl})\n`).join("");
  }
  return { content: finalContent, inputTokens, outputTokens, imageCount: images.length };
}
