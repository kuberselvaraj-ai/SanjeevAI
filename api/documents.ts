import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { PLANS } from "@contracts/constants";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";
import { getMonthUsage, recordUsage } from "./queries/usage";
import { chatComplete, moonshotKey } from "./services/moonshot";
import {
  FORMAT_META,
  renderDocx,
  renderPdf,
  renderPptx,
  renderXlsx,
  type DeckSpec,
  type DocFormat,
  type DocNarrative,
  type WorkbookSpec,
} from "./services/documents";

/**
 * Document generation — "pull the Globex numbers into a spreadsheet".
 * One endpoint, four formats: the LLM structures the brief into JSON, a
 * pure-JS renderer turns it into real Office/PDF bytes, and the result
 * lands in the user's cloud vault (so it syncs to every device) with a
 * downloadable artifact in the chat thread.
 */

const MAX_BRIEF_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 24_000;

const STRUCTURE_PROMPTS: Record<DocFormat, string> = {
  pdf: `You turn an executive brief into a polished PDF report. Respond with ONLY JSON:
{"title":"…","subtitle":"…","sections":[{"heading":"…","paragraphs":["…"],"bullets":["…"]}]}
Rules: 2-6 sections; paragraphs are full sentences (2-4 per section max); bullets are terse. No markdown, no preamble.`,
  docx: `You turn an executive brief into a Word document. Respond with ONLY JSON:
{"title":"…","subtitle":"…","sections":[{"heading":"…","paragraphs":["…"],"bullets":["…"]}]}
Rules: 2-6 sections; paragraphs are full sentences (2-4 per section max); bullets are terse. No markdown, no preamble.`,
  xlsx: `You turn an executive brief into an Excel workbook. Respond with ONLY JSON:
{"title":"…","sheets":[{"name":"…","columns":["col",…],"rows":[[value,…],…]}]}
Rules: 1-3 sheets, 2-10 columns, up to 100 rows. Numbers as numbers where numeric. Every row has exactly columns.length cells. No markdown, no preamble.`,
  pptx: `You turn an executive brief into a slide deck. Respond with ONLY JSON:
{"title":"…","subtitle":"…","slides":[{"title":"…","bullets":["…"],"notes":"…"}]}
Rules: 3-8 content slides; 3-6 terse bullets each; notes optional (speaker notes, 1-2 sentences). No markdown, no preamble.`,
};

function extractJson(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON in model output");
  return JSON.parse(match[0]);
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

function sanitizeNarrative(v: unknown): DocNarrative {
  const o = (v ?? {}) as Record<string, unknown>;
  const sections = Array.isArray(o.sections) ? o.sections : [];
  return {
    title: str(o.title, 120) ?? "Untitled report",
    subtitle: str(o.subtitle, 200),
    sections: sections.slice(0, 8).map((s) => {
      const sec = (s ?? {}) as Record<string, unknown>;
      const list = (key: string, cap: number, len: number) =>
        (Array.isArray(sec[key]) ? (sec[key] as unknown[]) : [])
          .map((x) => str(x, len))
          .filter((x): x is string => Boolean(x))
          .slice(0, cap);
      return {
        heading: str(sec.heading, 100),
        paragraphs: list("paragraphs", 6, 1200),
        bullets: list("bullets", 10, 240),
      };
    }),
  };
}

function sanitizeWorkbook(v: unknown): WorkbookSpec {
  const o = (v ?? {}) as Record<string, unknown>;
  const sheets = Array.isArray(o.sheets) ? o.sheets : [];
  return {
    title: str(o.title, 120) ?? "Workbook",
    sheets: sheets.slice(0, 3).map((s, i) => {
      const sh = (s ?? {}) as Record<string, unknown>;
      const columns = (Array.isArray(sh.columns) ? (sh.columns as unknown[]) : [])
        .map((x) => str(x, 60))
        .filter((x): x is string => Boolean(x))
        .slice(0, 10);
      const rows = (Array.isArray(sh.rows) ? (sh.rows as unknown[]) : [])
        .slice(0, 200)
        .map((r) =>
          (Array.isArray(r) ? r : [])
            .slice(0, columns.length)
            .map((cell) =>
              typeof cell === "number" && Number.isFinite(cell)
                ? cell
                : String(cell ?? "").slice(0, 200),
            ),
        )
        .filter((r) => r.length === columns.length);
      return { name: str(sh.name, 31) ?? `Sheet ${i + 1}`, columns, rows };
    }),
  };
}

function sanitizeDeck(v: unknown): DeckSpec {
  const o = (v ?? {}) as Record<string, unknown>;
  const slides = Array.isArray(o.slides) ? o.slides : [];
  return {
    title: str(o.title, 100) ?? "Deck",
    subtitle: str(o.subtitle, 160),
    slides: slides.slice(0, 10).map((s) => {
      const sl = (s ?? {}) as Record<string, unknown>;
      return {
        title: str(sl.title, 100) ?? "Slide",
        bullets: (Array.isArray(sl.bullets) ? (sl.bullets as unknown[]) : [])
          .map((x) => str(x, 160))
          .filter((x): x is string => Boolean(x))
          .slice(0, 8),
        notes: str(sl.notes, 400),
      };
    }),
  };
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "document";
}

export function registerDocumentRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  app.post("/api/hosted/documents", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!moonshotKey()) {
      return c.json({ error: "Documents are not configured on this server." }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      format?: string;
      brief?: string;
      context?: string;
    };
    const format = body.format as DocFormat;
    if (!format || !(format in FORMAT_META)) {
      return c.json({ error: "format must be one of pdf, docx, xlsx, pptx" }, 400);
    }
    const brief = (body.brief ?? "").trim();
    if (!brief) return c.json({ error: "Tell me what the document is about." }, 400);
    if (brief.length > MAX_BRIEF_CHARS) {
      return c.json({ error: "Brief is too long — keep it under 4,000 characters." }, 413);
    }
    const context = (body.context ?? "").slice(0, MAX_CONTEXT_CHARS);

    if (user.role !== "admin") {
      const used = await getMonthUsage(user.id);
      const plan = PLANS[user.plan] ?? PLANS.free;
      if (used.tokens >= plan.monthlyTokens) {
        return c.json(
          { error: `Monthly token limit reached on the ${plan.label} plan.` },
          429,
        );
      }
    }

    // Step 1 — structure the brief into format-specific JSON.
    const messages = [
      { role: "system", content: STRUCTURE_PROMPTS[format] },
      {
        role: "user",
        content: context
          ? `Brief: ${brief}\n\nWorking context (use its facts, don't copy it wholesale):\n${context}`
          : `Brief: ${brief}`,
      },
    ];
    const raw = await chatComplete({
      model: "kimi-k3",
      temperature: 0.4,
      maxTokens: 4000,
      messages,
    });

    let buffer: Buffer;
    let title: string;
    try {
      const parsed = extractJson(raw);
      if (format === "xlsx") {
        const spec = sanitizeWorkbook(parsed);
        if (!spec.sheets.length || !spec.sheets[0].columns.length) throw new Error("empty workbook");
        title = spec.title;
        buffer = await renderXlsx(spec);
      } else if (format === "pptx") {
        const spec = sanitizeDeck(parsed);
        if (!spec.slides.length) throw new Error("empty deck");
        title = spec.title;
        buffer = await renderPptx(spec);
      } else {
        const spec = sanitizeNarrative(parsed);
        if (!spec.sections.length) throw new Error("empty document");
        title = spec.title;
        buffer = format === "pdf" ? await renderPdf(spec) : await renderDocx(spec);
      }
    } catch (err) {
      console.error("[documents] structure/render failed", err);
      return c.json(
        { error: "I couldn't shape that into a document — try a more specific brief." },
        502,
      );
    }

    // Step 2 — vault it (dedupes on content hash) and meter the run.
    const meta = FORMAT_META[format];
    const hash = createHash("sha256").update(buffer).digest("hex");
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.vaultFiles)
      .where(and(eq(schema.vaultFiles.userId, user.id), eq(schema.vaultFiles.hash, hash)))
      .limit(1);

    let fileRow = existing[0];
    if (!fileRow) {
      const name = `${slugify(title)}.${meta.ext}`;
      const res = await db
        .insert(schema.vaultFiles)
        .values({
          userId: user.id,
          folderId: null,
          name: name.slice(0, 255),
          mimeType: meta.mime,
          size: buffer.length,
          hash,
          kind: "doc",
          payload: buffer.toString("base64"),
          extractedText: `Generated ${meta.label}: ${title}\nBrief: ${brief.slice(0, 500)}`,
          tags: ["generated", format].join(","),
        })
        .$returningId();
      const rows = await db
        .select()
        .from(schema.vaultFiles)
        .where(eq(schema.vaultFiles.id, res[0]?.id ?? 0))
        .limit(1);
      fileRow = rows[0];
    }

    // Estimated metering (the structuring call doesn't report usage) — counts
    // against the same monthly token cap as chat.
    const inputTokens = Math.ceil(
      messages.reduce((n, m) => n + m.content.length, 0) / 4,
    );
    const outputTokens = Math.ceil(raw.length / 4);
    await recordUsage({
      userId: user.id,
      kind: "chat",
      model: "kimi-k3",
      inputTokens,
      outputTokens,
      note: `doc:${format}`,
    }).catch(() => {});

    return c.json({
      ok: true,
      title,
      file: fileRow
        ? {
            id: String(fileRow.id),
            name: fileRow.name,
            mimeType: fileRow.mimeType,
            size: fileRow.size,
            kind: fileRow.kind,
          }
        : null,
    });
  });
}
