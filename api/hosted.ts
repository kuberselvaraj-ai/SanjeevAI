import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { and, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { PLANS } from "@contracts/constants";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";
import { getMonthUsage, recordUsage } from "./queries/usage";
import { chatComplete, extractFileText, moonshotKey, openChatStream } from "./services/moonshot";
import { dashscopeConfigured, qwenSpeak, qwenTranscribe } from "./services/dashscope";
import { elevenlabsConfigured, elevenSpeak, elevenTranscribe } from "./services/elevenlabs";
import {
  isPremiumChatModel,
  openRouterChatStream,
  openrouterConfigured,
} from "./services/openrouter";
import { anthropicChatStream, anthropicConfigured } from "./services/anthropic";
import { openAiChatStream, openaiConfigured } from "./services/openai";
import { minimaxConfigured } from "./services/minimax";
import { falVideoConfigured } from "./services/fal-video";
import { startScheduler } from "./scheduler";

/**
 * Hosted-mode API: the browser talks to these endpoints, the server calls
 * Moonshot with the site owner's key, and usage is metered per user.
 * (The desktop Electron app bypasses this and uses the user's own key.)
 */

const MAX_MESSAGE_CHARS = 400_000;
const MAX_EXTRACT_BYTES = 30 * 1024 * 1024;

/** EXTRA_MODELS env → picker entries. JSON array, or "slug:Label,slug2:Label2". */
function parseExtraModels(raw?: string): { id: string; label: string; description?: string }[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((m): m is { id: string; label?: string; description?: string } =>
          Boolean(m && typeof (m as { id?: unknown }).id === "string" && (m as { id: string }).id.includes("/")),
        )
        .map((m) => ({
          id: m.id,
          label: m.label || m.id.split("/").pop() || m.id,
          description: m.description,
        }));
    }
  } catch {
    // not JSON — fall through to the comma format
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.includes("/"))
    .map((part) => {
      const [id, ...rest] = part.split(":");
      return { id: id.trim(), label: rest.join(":").trim() || id.split("/").pop() || id };
    });
}

interface ChatRequestBody {
  model?: string;
  messages?: Array<{ content?: unknown }>;
  temperature?: number;
  tools?: unknown[];
}

export function registerHostedRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  // Level 4: scheduled deliverables run here, browser closed or not.
  startScheduler();

  // ── Which providers the server has keys for (drives Auto routing) ──────
  app.get("/api/hosted/capabilities", (c) =>
    c.json({
      claude: anthropicConfigured() || openrouterConfigured(),
      gpt: openaiConfigured() || openrouterConfigured(),
      voice: elevenlabsConfigured() || dashscopeConfigured(),
      video: minimaxConfigured() || falVideoConfigured(),
      // Admin-added models without a code change:
      // EXTRA_MODELS='[{"id":"google/gemini-4-pro","label":"Gemini 4 Pro"}]'
      // (a plain "slug:Label,slug2:Label2" list works too)
      extraModels: parseExtraModels(process.env.EXTRA_MODELS),
    }),
  );

  // ── Deck design — the AI arranges the executive's dashboard ───────────
  // Given the user's memories, recent chats, connected accounts, and today's
  // counts, the model picks and orders deck sections and writes a headline
  // for each. Output is validated against a fixed catalog, so the model can
  // arrange but never invent structure.
  const DECK_SECTIONS = new Set([
    "needs_response",
    "needs_attention",
    "in_motion",
    "briefs",
    "vault",
  ]);
  app.post("/api/hosted/deck-design", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!moonshotKey()) {
      return c.json({ error: "Chat is not configured on this server." }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      memories?: string[];
      recentChats?: string[];
      connections?: string[];
      counts?: Record<string, number>;
      hour?: number;
    };
    const context = {
      memories: (body.memories ?? []).slice(0, 12),
      recentChats: (body.recentChats ?? []).slice(0, 10),
      connections: body.connections ?? [],
      counts: body.counts ?? {},
      localHour: body.hour ?? new Date().getHours(),
    };
    const raw = await chatComplete({
      model: "kimi-k3",
      temperature: 0.5,
      // Reasoning models burn tokens on thinking before content — keep the
      // budget generous so the JSON answer actually lands.
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: `You design the home dashboard of an executive AI console. Choose and order dashboard sections for THIS user, and write a short headline (3-6 words, plain sentence case) plus an optional one-line note for each. Section catalog (use only these ids): needs_response (messages and emails awaiting the user), needs_attention (decisions, meetings to prep, deals closing), in_motion (ongoing brainstorms and chats to continue), briefs (scheduled AI briefings), vault (recent files). Reply with ONLY JSON: {"sections":[{"id":"needs_response","headline":"…","note":"…"}]}. Pick 3-5 sections, most relevant first. Match the user's world (their memories, chat topics, connected apps) — an executive tone, never cute.`,
        },
        { role: "user", content: JSON.stringify(context) },
      ],
    }).catch(() => "");
    // Lenient JSON extraction + strict catalog validation.
    let sections: { id: string; headline: string; note?: string }[] = [];
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? "") as {
        sections?: { id?: string; headline?: string; note?: string }[];
      };
      const seen = new Set<string>();
      for (const s of parsed.sections ?? []) {
        if (!s.id || !DECK_SECTIONS.has(s.id) || seen.has(s.id)) continue;
        seen.add(s.id);
        sections.push({
          id: s.id,
          headline: String(s.headline ?? "").slice(0, 60) || s.id,
          ...(s.note ? { note: String(s.note).slice(0, 120) } : {}),
        });
        if (sections.length >= 5) break;
      }
    } catch {
      sections = [];
    }
    if (sections.length < 2) {
      sections = [
        { id: "needs_response", headline: "Needs your response" },
        { id: "needs_attention", headline: "Needs attention" },
        { id: "in_motion", headline: "In motion" },
        { id: "briefs", headline: "Briefs" },
        { id: "vault", headline: "From your vault" },
      ];
    }
    return c.json({ ok: true, sections });
  });

  // ── Next moves: given a deck question + the AI's answer, propose the ────
  // concrete follow-up actions an executive would take. The model suggests,
  // the deck renders them as one-tap action cards; clicking one just sends
  // its prompt back through the normal chat pipeline.
  app.post("/api/hosted/deck-actions", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!moonshotKey()) {
      return c.json({ error: "Chat is not configured on this server." }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      answer?: string;
      connections?: string[];
    };
    const context = {
      query: String(body.query ?? "").slice(0, 600),
      answer: String(body.answer ?? "").slice(0, 2500),
      connectedApps: body.connections ?? [],
    };
    if (!context.query || !context.answer) return c.json({ ok: true, actions: [] });
    const raw = await chatComplete({
      model: "kimi-k3",
      temperature: 0.4,
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: `You are the action layer of an executive AI console. Given the executive's request and the AI's answer, propose 1-3 concrete NEXT MOVES the executive would plausibly tap. Each move is executed by the AI when tapped. Rules: reply with ONLY JSON {"actions":[{"title":"…","prompt":"…"}]}; title = 2-5 words, imperative verb first ("Draft the reply", "Summarize for the board", "Save this to my vault"); prompt = the exact self-contained instruction to give the AI (first person, as the executive would say it); prefer moves that act on the answer's content (draft, decide, delegate, schedule, save) over generic follow-ups; never propose anything requiring apps that are not connected; if nothing sensible, return {"actions":[]}.`,
        },
        { role: "user", content: JSON.stringify(context) },
      ],
    }).catch(() => "");
    let actions: { title: string; prompt: string }[] = [];
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? "") as {
        actions?: { title?: string; prompt?: string }[];
      };
      for (const a of parsed.actions ?? []) {
        const title = String(a.title ?? "").trim().slice(0, 48);
        const prompt = String(a.prompt ?? "").trim().slice(0, 600);
        if (!title || !prompt) continue;
        actions.push({ title, prompt });
        if (actions.length >= 3) break;
      }
    } catch {
      actions = [];
    }
    return c.json({ ok: true, actions });
  });

  // ── Chat digest: internal labeling + rolling compression ───────────────
  // Given a transcript window (and optionally the previous digest), produce
  // a compact {summary, labels, openLoops} triple. The client stores it on
  // the conversation and replays IT — instead of raw history — whenever old
  // context is needed, which is what keeps token spend flat as threads grow.
  app.post("/api/hosted/chat-digest", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!moonshotKey()) {
      return c.json({ error: "Chat is not configured on this server." }, 503);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: { role?: string; content?: string }[];
      priorDigest?: string;
    };
    const window = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-40)
      .map((m) => ({ role: m.role as string, content: String(m.content).slice(0, 900) }));
    if (window.length === 0) {
      return c.json({ ok: true, digest: { summary: "", labels: [], openLoops: [] } });
    }
    const raw = await chatComplete({
      model: "kimi-k3",
      temperature: 0.3,
      maxTokens: 3000,
      messages: [
        {
          role: "system",
          content: `You maintain the internal memory of an executive AI console. Compress the given conversation window into a compact digest. Reply with ONLY JSON: {"summary":"…","labels":["…"],"openLoops":["…"]}. summary: 2-3 sentences (≤90 words) capturing what the user wanted, what was decided or produced, and any facts worth keeping (names, numbers, deadlines) — written so a future AI can use it INSTEAD of the raw messages. labels: 3-6 lowercase topic tags, 1-2 words each (e.g. "board prep", "fundraising", "hiring"). openLoops: 0-3 unresolved questions or promised next steps, short phrases; [] if none. If a prior digest is provided, fold its still-relevant content into the new summary — never repeat or contradict it. Internal metadata, so be dense and factual, never conversational.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            priorDigest: String(body.priorDigest ?? "").slice(0, 800) || undefined,
            window,
          }),
        },
      ],
    }).catch(() => "");
    let digest = { summary: "", labels: [] as string[], openLoops: [] as string[] };
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? "") as {
        summary?: string;
        labels?: string[];
        openLoops?: string[];
      };
      digest = {
        summary: String(parsed.summary ?? "").trim().slice(0, 700),
        labels: (parsed.labels ?? [])
          .map((l) => String(l).trim().toLowerCase().slice(0, 30))
          .filter(Boolean)
          .slice(0, 6),
        openLoops: (parsed.openLoops ?? [])
          .map((l) => String(l).trim().slice(0, 140))
          .filter(Boolean)
          .slice(0, 3),
      };
    } catch {
      /* fall through with the empty digest */
    }
    return c.json({ ok: true, digest });
  });

  // ── Digest sync: the portable memory of each thread ────────────────────
  // Conversations stay client-side; their digests mirror here so rolling
  // compression, labels, and cross-chat recall survive device switches.
  app.get("/api/hosted/digests", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.chatDigests)
      .where(eq(schema.chatDigests.userId, user.id));
    return c.json({
      digests: rows.map((r) => ({
        convId: r.convId,
        digest: r.digest,
        labels: r.labels ? r.labels.split(",").filter(Boolean) : [],
        openLoops: (() => {
          try {
            const v = JSON.parse(r.openLoops ?? "[]") as unknown;
            return Array.isArray(v) ? v.map(String).slice(0, 3) : [];
          } catch {
            return [];
          }
        })(),
        digestThrough: r.digestThrough,
        updatedAt: r.updatedAt.getTime(),
      })),
    });
  });

  app.put("/api/hosted/digests", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      convId?: string;
      digest?: string;
      labels?: string[];
      openLoops?: string[];
      digestThrough?: string;
    };
    const convId = String(body.convId ?? "").slice(0, 64);
    const digest = String(body.digest ?? "").trim().slice(0, 700);
    if (!convId || !digest) return c.json({ error: "convId and digest are required" }, 400);
    const labels = (body.labels ?? [])
      .map((l) => String(l).trim().toLowerCase().slice(0, 30))
      .filter(Boolean)
      .slice(0, 6)
      .join(",");
    const openLoops = JSON.stringify(
      (body.openLoops ?? []).map((l) => String(l).slice(0, 140)).filter(Boolean).slice(0, 3),
    );
    const digestThrough = String(body.digestThrough ?? "").slice(0, 64);
    const db = getDb();
    await db
      .insert(schema.chatDigests)
      .values({ userId: user.id, convId, digest, labels, openLoops, digestThrough })
      .onDuplicateKeyUpdate({
        set: { digest, labels, openLoops, digestThrough, updatedAt: new Date() },
      });
    return c.json({ ok: true });
  });

  app.delete("/api/hosted/digests/:convId", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const db = getDb();
    await db
      .delete(schema.chatDigests)
      .where(
        and(
          eq(schema.chatDigests.userId, user.id),
          eq(schema.chatDigests.convId, c.req.param("convId").slice(0, 64)),
        ),
      );
    return c.json({ ok: true });
  });

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

    // Premium models (Claude / GPT): first-party keys preferred, OpenRouter fallback.
    const premium = isPremiumChatModel(model);
    const isClaude = model.startsWith("anthropic/");
    const isGpt = model.startsWith("openai/");
    const premiumReady = isClaude
      ? anthropicConfigured() || openrouterConfigured()
      : isGpt
        ? openaiConfigured() || openrouterConfigured()
        : openrouterConfigured();
    if (premium && !premiumReady) {
      return c.json(
        {
          error:
            "Premium models (Claude Fable 5.1, GPT-6 Astra) are not configured on the server yet — the site owner needs to add an Anthropic / OpenAI key (or an OpenRouter key). Meanwhile, Kimi K3 answers everything.",
        },
        503,
      );
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

    // Pick the upstream: first-party key wins, OpenRouter covers the gaps.
    const premiumUpstream = () => {
      if (isClaude && anthropicConfigured())
        return { label: "Anthropic", call: anthropicChatStream({ messages: messages as never, model }) };
      if (isGpt && openaiConfigured())
        return { label: "OpenAI", call: openAiChatStream({ messages, temperature, model }) };
      return { label: "OpenRouter", call: openRouterChatStream({ model, messages, temperature }) };
    };
    const chosen = premium ? premiumUpstream() : null;
    const upstream = chosen
      ? await chosen.call.catch(
          (e) => new Response(null, { status: 502, statusText: (e as Error).message }),
        )
      : await openChatStream({ model, messages, temperature, tools }).catch(
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
      return c.json(
        { error: `${chosen ? chosen.label : "Kimi"} API error ${upstream.status}: ${detail}` },
        502,
      );
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
    const useEleven = elevenlabsConfigured();
    const useOpenAi = !useEleven && Boolean(process.env.OPENAI_API_KEY);
    const useDashscope = !useEleven && !useOpenAi && dashscopeConfigured();
    if (!useEleven && !useOpenAi && !useDashscope) {
      return c.json(
        { error: "Voice input is not configured yet (no ElevenLabs, OpenAI or Alibaba Bailian key on the server)." },
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
    if (useEleven) {
      try {
        text = await elevenTranscribe(file);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
      asrModel = "scribe_v2";
    } else if (useOpenAi) {
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
    const useEleven = elevenlabsConfigured();
    const useOpenAi = !useEleven && Boolean(process.env.OPENAI_API_KEY);
    const useDashscope = !useEleven && !useOpenAi && dashscopeConfigured();
    if (!useEleven && !useOpenAi && !useDashscope) {
      return c.json(
        { error: "Read aloud is not configured yet (no ElevenLabs, OpenAI or Alibaba Bailian key on the server)." },
        503,
      );
    }
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null;
    const text = body?.text?.slice(0, 4000);
    if (!text) return c.json({ error: "text is required" }, 400);

    let audioBody: ConstructorParameters<typeof Response>[0];
    let ttsModel: string;
    if (useEleven) {
      try {
        audioBody = await elevenSpeak(text);
      } catch (e) {
        return c.json({ error: (e as Error).message }, 502);
      }
      ttsModel = "eleven_flash_v2_5";
    } else if (useOpenAi) {
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
