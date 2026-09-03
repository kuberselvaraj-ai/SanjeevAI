/**
 * OpenRouter — one key unlocks the premium Western chat models
 * (Claude Fable 5, GPT-5.6 Sol) behind an OpenAI-compatible API.
 * https://openrouter.ai/docs — pay-per-use, card billing, no region lock.
 *
 * Model ids arrive as OpenRouter slugs ("anthropic/claude-fable-5"); if
 * OpenRouter renames a model, remap it in .env without a code change:
 *   OPENROUTER_MODEL_CLAUDE=anthropic/claude-fable-5
 *   OPENROUTER_MODEL_GPT=openai/gpt-5.6-sol
 */

const ROOT = "https://openrouter.ai/api/v1";

export function openrouterKey(): string {
  return process.env.OPENROUTER_API_KEY ?? "";
}

export function openrouterConfigured(): boolean {
  return Boolean(openrouterKey());
}

export const isPremiumChatModel = (model: string) => model.includes("/");

/** Map our canonical ids to whatever slug OpenRouter currently uses. */
function resolveSlug(model: string): string {
  if (model.startsWith("anthropic/"))
    return process.env.OPENROUTER_MODEL_CLAUDE || model;
  if (model.startsWith("openai/"))
    return process.env.OPENROUTER_MODEL_GPT || model;
  return model;
}

export async function openRouterChatStream(payload: {
  model: string;
  messages: unknown[];
  temperature?: number;
}): Promise<Response> {
  return fetch(`${ROOT}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openrouterKey()}`,
      "HTTP-Referer": "https://sanjeevai.com",
      "X-Title": "Sanjeev AI",
    },
    body: JSON.stringify({
      model: resolveSlug(payload.model),
      messages: payload.messages,
      temperature: payload.temperature,
      stream: true,
      // Ask OpenRouter to append a usage chunk so metering stays accurate.
      usage: { include: true },
    }),
  });
}
