/**
 * Anthropic direct — Claude Fable 5 via the first-party Messages API.
 * Preferred path when ANTHROPIC_API_KEY is set (no relay markup, prompt
 * caching, highest rate limits); OpenRouter remains the fallback.
 *
 * Fable 5 quirks (per Anthropic docs):
 * - model id is exactly "claude-fable-5" (override via ANTHROPIC_MODEL)
 * - adaptive thinking is always on — sampling params like temperature are
 *   not accepted, so we omit them
 * - system prompt is a top-level param, not a message
 * - SSE events (content_block_delta etc.) differ from OpenAI's shape, so we
 *   transform the stream into OpenAI-style chunks for our relay + metering
 */

const ROOT = "https://api.anthropic.com";
const MAX_OUTPUT_TOKENS = 16_000;

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

interface InMessage {
  role: string;
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >
    | null;
}

function toAnthropicMessages(messages: InMessage[]) {
  const systemParts: string[] = [];
  const out: Array<{ role: string; content: unknown }> = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") continue;

    if (typeof m.content === "string") {
      if (!m.content) continue;
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (Array.isArray(m.content)) {
      const parts = m.content.map((p) => {
        if (p.type === "text") return { type: "text", text: p.text };
        // data:image/png;base64,.... → Anthropic base64 image block
        const match = p.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return { type: "text", text: "[image omitted]" };
        return {
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        };
      });
      out.push({ role: m.role, content: parts });
    }
  }
  // Anthropic requires the first message to be from the user.
  while (out.length && out[0].role !== "user") out.shift();
  return { system: systemParts.join("\n\n") || undefined, messages: out };
}

export async function anthropicChatStream(payload: {
  messages: InMessage[];
}): Promise<Response> {
  const { system, messages } = toAnthropicMessages(payload.messages);
  const res = await fetch(`${ROOT}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-fable-5",
      max_tokens: MAX_OUTPUT_TOKENS,
      ...(system ? { system } : {}),
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) return res;

  // Transform Anthropic SSE → OpenAI-style chunks the client already parses.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          emit({ choices: [], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          let event: any;
          try {
            event = JSON.parse(trimmed.slice(5).trim());
          } catch {
            continue;
          }
          if (event.type === "message_start") {
            inputTokens = event.message?.usage?.input_tokens ?? 0;
          } else if (event.type === "content_block_delta") {
            const d = event.delta;
            if (d?.type === "text_delta" && d.text) {
              emit({ choices: [{ delta: { content: d.text } }] });
            } else if (d?.type === "thinking_delta" && d.thinking) {
              emit({ choices: [{ delta: { reasoning_content: d.thinking } }] });
            }
          } else if (event.type === "message_delta") {
            outputTokens = event.usage?.output_tokens ?? outputTokens;
          } else if (event.type === "error") {
            emit({ choices: [{ delta: { content: `\n\n[Anthropic error: ${event.error?.message ?? "unknown"}]` } }] });
          }
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
