/**
 * OpenAI direct — GPT-6 Astra / GPT-5.6 Sol via the first-party Chat Completions API.
 * Preferred when OPENAI_API_KEY is set (the same key also powers GPT Image 2
 * in the Image Studio); OpenRouter remains the fallback.
 *
 * The response is already in the OpenAI chunk shape our relay + client parse,
 * so it passes through untouched (stream_options adds a usage chunk for
 * per-user metering).
 */

const ROOT = "https://api.openai.com/v1";

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function openAiChatStream(payload: {
  messages: unknown[];
  temperature?: number;
  model?: string;
}): Promise<Response> {
  const model = process.env.OPENAI_MODEL || payload.model?.replace(/^openai\//, "") || "gpt-5.6-sol";
  const call = (withTemperature: boolean) =>
    fetch(`${ROOT}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: payload.messages,
        ...(withTemperature ? { temperature: payload.temperature } : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

  let res = await call(true);
  // Reasoning-style models sometimes reject temperature — retry without it.
  if (res.status === 400 && payload.temperature !== undefined) {
    const body = await res.text().catch(() => "");
    res = body.includes("temperature") ? await call(false) : new Response(body, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return res;
}
