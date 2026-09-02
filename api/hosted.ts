import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { PLANS } from "@contracts/constants";
import { authenticateRequest } from "./kimi/auth";
import { getMonthUsage, recordUsage } from "./queries/usage";
import { extractFileText, moonshotKey, openChatStream } from "./services/moonshot";
import { dashscopeConfigured, qwenSpeak, qwenTranscribe } from "./services/dashscope";

/**
 * Hosted-mode API: the browser talks to these endpoints, the server calls
 * Moonshot with the site owner's key, and usage is metered per user.
 * (The desktop Electron app bypasses this and uses the user's own key.)
 */

const MAX_MESSAGE_CHARS = 400_000;
const MAX_EXTRACT_BYTES = 30 * 1024 * 1024;

interface ChatRequestBody {
  model?: string;
  messages?: Array<{ content?: unknown }>;
  temperature?: number;
  tools?: unknown[];
}

export function registerHostedRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  // ── Streaming chat relay with per-user token metering ──────────────────
  app.post("/api/hosted/chat", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in to use Sanjeev AI." }, 401);
    }
    if (!moonshotKey()) {
      return c.json({ error: "Chat is not configured yet (missing server API key)." }, 503);
    }

    let body: ChatRequestBody;
    try {
      body = (await c.req.json()) as ChatRequestBody;
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
    const { model, messages, temperature, tools } = body;
    if (!model || !Array.isArray(messages)) {
      return c.json({ error: "model and messages are required" }, 400);
    }

    const totalChars = messages.reduce(
      (n, m) =>
        n +
        (typeof m.content === "string"
          ? m.content.length
          : JSON.stringify(m.content ?? "").length),
      0,
    );
    if (totalChars > MAX_MESSAGE_CHARS) {
      return c.json(
        { error: "This conversation is too large for the hosted plan. Start a new chat." },
        413,
      );
    }

    if (user.role !== "admin") {
      const used = await getMonthUsage(user.id);
      const plan = PLANS[user.plan] ?? PLANS.free;
      if (used.tokens >= plan.monthlyTokens) {
        return c.json(
          {
            error: `Monthly token limit reached (${plan.monthlyTokens.toLocaleString()} tokens on the ${plan.label} plan). Ask the admin to upgrade you to Pro.`,
          },
          429,
        );
      }
    }

    const upstream = await openChatStream({ model, messages, temperature, tools }).catch(
      (e) => new Response(null, { status: 502, statusText: (e as Error).message }),
    );
    if (!upstream.ok || !upstream.body) {
      let detail = "";
      try {
        const j = (await upstream.json()) as { error?: { message?: string } };
        detail = j?.error?.message ?? JSON.stringify(j);
      } catch {
        detail = upstream.statusText;
      }
      return c.json({ error: `Kimi API error ${upstream.status}: ${detail}` }, 502);
    }

    // Relay upstream SSE to the client; keep a tail buffer for usage accounting.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let tail = "";
    let outChars = 0;
    const userId = user.id;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          try {
            let promptTokens = 0;
            let completionTokens = 0;
            const m = tail.match(
              /"usage"\s*:\s*\{[^}]*?"prompt_tokens"\s*:\s*(\d+)[^}]*?"completion_tokens"\s*:\s*(\d+)/,
            );
            if (m) {
              promptTokens = Number(m[1]);
              completionTokens = Number(m[2]);
            } else {
              // Fallback estimate if the provider omits a usage chunk
              promptTokens = Math.ceil(totalChars / 4);
              completionTokens = Math.ceil(outChars / 4);
            }
            await recordUsage({
              userId,
              kind: "chat",
              model,
              inputTokens: promptTokens,
              outputTokens: completionTokens,
              videoCount: 0,
            });
          } catch (e) {
            console.error("[hosted] failed to record usage", e);
          }
          return;
        }
        const text = decoder.decode(value, { stream: true });
        tail = (tail + text).slice(-8192);
        outChars += text.length;
        controller.enqueue(value);
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  });

  // ── Document text extraction (Kimi Files API) ──────────────────────────
  app.post("/api/hosted/extract", async (c) => {
    try {
      await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in to use Sanjeev AI." }, 401);
    }
    if (!moonshotKey()) {
      return c.json({ error: "File extraction is not configured yet (missing server API key)." }, 503);
    }

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }
    if (file.size > MAX_EXTRACT_BYTES) {
      return c.json({ error: "File too large for hosted extraction (30 MB max)." }, 413);
    }

    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const text = await extractFileText(
        file.name,
        buf,
        file.type || "application/octet-stream",
      );
      return c.json({ text });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // ── Voice input: Whisper transcription ─────────────────────────────────
  app.post("/api/hosted/transcribe", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in to use Sanjeev AI." }, 401);
    }
    const useOpenAi = Boolean(process.env.OPENAI_API_KEY);
    const useDashscope = !useOpenAi && dashscopeConfigured();
    if (!useOpenAi && !useDashscope) {
      return c.json(
        { error: "Voice input is not configured yet (no OpenAI or Alibaba Bailian key on the server)." },
        503,
      );
    }
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "audio file is required" }, 400);
    }
    if (file.size > 25 * 1024 * 1024) {
      return c.json({ error: "Audio too large (25 MB max)." }, 413);
    }
    let text: string;
    let asrModel: string;
    if (useOpenAi) {
      const out = new FormData();
      out.append("model", "whisper-1");
      out.append("file", file, file.name || "audio.webm");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: out,
      });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.text === undefined) {
        return c.json({ error: data.error?.message || `OpenAI API error ${res.status}` }, 502);
      }
      text = data.text;
      asrModel = "whisper-1";
    } else {
      const buf = Buffer.from(await file.arrayBuffer());
      try {
        text = await qwenTranscribe(
          buf.toString("base64"),
          file.type || "audio/webm",
        );
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
      asrModel = "qwen3-asr-flash";
    }
    // Rough metering: ~1 token per 20KB of audio
    await recordUsage({
      userId: user.id,
      kind: "chat",
      model: asrModel,
      inputTokens: Math.ceil(file.size / 20000),
      outputTokens: 0,
      videoCount: 0,
    }).catch(() => {});
    return c.json({ text });
  });

  // ── Read aloud: OpenAI TTS ─────────────────────────────────────────────
  app.post("/api/hosted/tts", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in to use Sanjeev AI." }, 401);
    }
    const useOpenAi = Boolean(process.env.OPENAI_API_KEY);
    const useDashscope = !useOpenAi && dashscopeConfigured();
    if (!useOpenAi && !useDashscope) {
      return c.json(
        { error: "Read aloud is not configured yet (no OpenAI or Alibaba Bailian key on the server)." },
        503,
      );
    }
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null;
    const text = body?.text?.slice(0, 4000);
    if (!text) return c.json({ error: "text is required" }, 400);

    let audioBody: BodyInit;
    let ttsModel: string;
    if (useOpenAi) {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return c.json({ error: j.error?.message || `OpenAI API error ${res.status}` }, 502);
      }
      audioBody = Buffer.from(await res.arrayBuffer());
      ttsModel = "tts-1";
    } else {
      try {
        audioBody = await qwenSpeak(text);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
      ttsModel = "qwen3-tts-flash";
    }
    await recordUsage({
      userId: user.id,
      kind: "chat",
      model: ttsModel,
      inputTokens: 0,
      outputTokens: Math.ceil(text.length / 4),
      videoCount: 0,
    }).catch(() => {});
    return new Response(audioBody, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  });
}
