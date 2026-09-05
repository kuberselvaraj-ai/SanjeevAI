/**
 * Server-side Moonshot (Kimi) API access. The API key lives ONLY here —
 * in server env — never in the client bundle.
 */

const BASE = "https://api.moonshot.ai/v1";

export function moonshotKey(): string {
  return process.env.MOONSHOT_API_KEY ?? "";
}

/** Open a streaming chat completion. Returns the raw upstream Response. */
export async function openChatStream(payload: {
  model: string;
  messages: unknown[];
  temperature?: number;
  tools?: unknown[];
}): Promise<Response> {
  const call = (temperature: number) =>
    fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${moonshotKey()}`,
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        temperature,
        stream: true,
        stream_options: { include_usage: true },
        ...(payload.tools ? { tools: payload.tools } : {}),
      }),
    });

  const requested = payload.temperature ?? 0.6;
  const res = await call(requested);
  // Some models (e.g. kimi-k2.6) only accept temperature=1 — retry transparently.
  if (res.status === 400 && requested !== 1) {
    const errBody = await res.text().catch(() => "");
    if (errBody.includes("invalid temperature")) {
      return call(1);
    }
    return new Response(errBody, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  return res;
}

/** Non-streaming chat completion — short structured jobs (deck design, briefs). */
export async function chatComplete(payload: {
  model: string;
  messages: unknown[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const call = (temperature: number) =>
    fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${moonshotKey()}`,
      },
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        temperature,
        max_tokens: payload.maxTokens ?? 900,
        stream: false,
      }),
    });
  let res = await call(payload.temperature ?? 0.4);
  // Some models (e.g. kimi-k3) only accept temperature=1 — retry transparently.
  if (res.status === 400) {
    const errBody = await res.text().catch(() => "");
    if (errBody.includes("invalid temperature")) res = await call(1);
    else throw new Error(`Moonshot 400: ${errBody.slice(0, 300)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Moonshot ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Upload a document to the Kimi Files API and return its extracted text. */
export async function extractFileText(
  name: string,
  buf: Buffer,
  mime: string,
): Promise<string> {
  const form = new FormData();
  form.append("purpose", "file-extract");
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), name);

  const up = await fetch(`${BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${moonshotKey()}` },
    body: form,
  });
  const upData = (await up.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!up.ok || !upData.id) {
    throw new Error(upData.error?.message || `File upload failed (${up.status})`);
  }

  const contentRes = await fetch(`${BASE}/files/${upData.id}/content`, {
    headers: { Authorization: `Bearer ${moonshotKey()}` },
  });
  const contentData = (await contentRes.json().catch(() => ({}))) as {
    content?: string;
    error?: { message?: string };
  };
  if (!contentRes.ok || typeof contentData.content !== "string") {
    throw new Error(
      contentData.error?.message || `Text extraction failed (${contentRes.status})`,
    );
  }
  return contentData.content;
}
