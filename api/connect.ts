import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { and, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";
import { decryptToken, encryptToken } from "./lib/connectCrypto";

/**
 * Connectors — third-party accounts (Google first) linked via OAuth.
 * The agent calls tools through POST /api/connect/tool; tokens stay
 * server-side, encrypted at rest, refreshed transparently.
 */

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

interface GoogleConnection {
  id: number;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function loadGoogleConnection(userId: number): Promise<GoogleConnection | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.userId, userId), eq(schema.connections.provider, "google")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    accessToken: decryptToken(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null,
    expiresAt: row.expiresAt ?? null,
  };
}

/** Returns a valid access token, refreshing via the refresh token when expired. */
async function googleAccessToken(userId: number): Promise<string> {
  const conn = await loadGoogleConnection(userId);
  if (!conn) throw new Error("Google is not connected. Connect it in Settings → Connections.");
  // Refresh when expired (with a 60s safety margin).
  if (conn.expiresAt && conn.expiresAt.getTime() - 60_000 < Date.now()) {
    if (!conn.refreshToken) throw new Error("Google connection expired — reconnect in Settings.");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: conn.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new Error(`Google token refresh failed (${data.error ?? res.status}) — reconnect in Settings.`);
    }
    conn.accessToken = data.access_token;
    await getDb()
      .update(schema.connections)
      .set({
        accessTokenEnc: encryptToken(data.access_token),
        expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      })
      .where(eq(schema.connections.id, conn.id));
  }
  return conn.accessToken;
}

async function googleApi(
  userId: number,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: unknown }> {
  const token = await googleAccessToken(userId);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── Gmail helpers ───────────────────────────────────────────────────────────

interface GmailHeader {
  name: string;
  value: string;
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBody(payload: { body?: { data?: string }; parts?: unknown[] } | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  const parts = (payload.parts ?? []) as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[];
  const textPart = parts.find((p) => p.mimeType === "text/plain") ?? parts[0];
  return textPart ? decodeBody(textPart) : "";
}

function buildRfc822(to: string, subject: string, body: string): string {
  const raw = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n",
  );
  return Buffer.from(raw, "utf8").toString("base64url");
}

// ── Tool implementations ────────────────────────────────────────────────────

async function gmailList(userId: number, args: { query?: string; max?: number }) {
  const q = args.query ? `&q=${encodeURIComponent(args.query)}` : "&q=is:unread";
  const max = Math.min(args.max ?? 8, 20);
  const list = await googleApi(userId, `messages?maxResults=${max}${q}`);
  if (list.status !== 200) throw new Error(`Gmail list failed (${list.status})`);
  const ids = ((list.data as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
  const out = [];
  for (const id of ids.slice(0, max)) {
    const msg = await googleApi(
      userId,
      `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    const d = msg.data as { id: string; snippet?: string; payload?: { headers?: GmailHeader[] } };
    out.push({
      id: d.id,
      from: header(d.payload?.headers, "From"),
      subject: header(d.payload?.headers, "Subject"),
      date: header(d.payload?.headers, "Date"),
      snippet: d.snippet ?? "",
    });
  }
  return out;
}

async function gmailRead(userId: number, args: { id: string }) {
  const msg = await googleApi(userId, `messages/${args.id}?format=full`);
  if (msg.status !== 200) throw new Error(`Gmail read failed (${msg.status})`);
  const d = msg.data as {
    id: string;
    threadId: string;
    payload?: { headers?: GmailHeader[]; body?: { data?: string }; parts?: unknown[] };
  };
  const body = decodeBody(d.payload).replace(/\s+\n/g, "\n").trim();
  return {
    id: d.id,
    threadId: d.threadId,
    from: header(d.payload?.headers, "From"),
    to: header(d.payload?.headers, "To"),
    subject: header(d.payload?.headers, "Subject"),
    date: header(d.payload?.headers, "Date"),
    body: body.slice(0, 8000),
  };
}

async function gmailDraft(userId: number, args: { to: string; subject: string; body: string }) {
  const res = await googleApi(userId, "drafts", {
    method: "POST",
    body: JSON.stringify({
      message: { raw: buildRfc822(args.to, args.subject, args.body) },
    }),
  });
  if (res.status !== 200) throw new Error(`Gmail draft failed (${res.status})`);
  const d = res.data as { id: string };
  return { draftId: d.id, to: args.to, subject: args.subject };
}

async function gmailSend(userId: number, args: { draftId: string }) {
  const res = await googleApi(userId, "drafts/send", {
    method: "POST",
    body: JSON.stringify({ id: args.draftId }),
  });
  if (res.status !== 200) throw new Error(`Gmail send failed (${res.status})`);
  return { sent: true };
}

async function calendarUpcoming(userId: number, args: { days?: number; max?: number }) {
  const token = await googleAccessToken(userId);
  const days = Math.min(args.days ?? 2, 14);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    maxResults: String(Math.min(args.max ?? 10, 25)),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = (await res.json().catch(() => ({}))) as {
    items?: {
      id: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: { email: string }[];
    }[];
  };
  if (!res.ok) throw new Error(`Calendar list failed (${res.status})`);
  return (data.items ?? []).map((e) => ({
    id: e.id,
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    location: e.location,
    attendees: (e.attendees ?? []).map((a) => a.email).slice(0, 8),
  }));
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerConnectRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  // Start OAuth — redirect to Google consent.
  app.get("/api/connect/google/start", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!googleConfigured()) {
      return c.json({ error: "Google connector is not configured on this server." }, 503);
    }
    const origin = new URL(c.req.url).origin;
    const state = encryptToken(JSON.stringify({ u: user.unionId, t: Date.now() }));
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: `${origin}/api/connect/google/callback`,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // OAuth callback — exchange code, store encrypted tokens, back to the app.
  app.get("/api/connect/google/callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const origin = url.origin;
    if (!code || !googleConfigured()) {
      return c.redirect(`${origin}/#/?connect=error`);
    }
    let unionId: string;
    try {
      const parsed = JSON.parse(decryptToken(state)) as { u: string; t: number };
      if (Date.now() - parsed.t > 10 * 60_000) throw new Error("stale state");
      unionId = parsed.u;
    } catch {
      return c.redirect(`${origin}/#/?connect=error`);
    }
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: `${origin}/api/connect/google/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tokens = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      if (!tokenRes.ok || !tokens.access_token) throw new Error("token exchange failed");

      const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const info = (await infoRes.json()) as { email?: string };

      const db = getDb();
      const userRows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.unionId, unionId))
        .limit(1);
      const user = userRows[0];
      if (!user) throw new Error("user not found");

      const existing = await db
        .select()
        .from(schema.connections)
        .where(
          and(eq(schema.connections.userId, user.id), eq(schema.connections.provider, "google")),
        )
        .limit(1);
      const values = {
        label: info.email ?? null,
        scopes: tokens.scope ?? GOOGLE_SCOPES,
        accessTokenEnc: encryptToken(tokens.access_token),
        ...(tokens.refresh_token ? { refreshTokenEnc: encryptToken(tokens.refresh_token) } : {}),
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      };
      if (existing[0]) {
        await db.update(schema.connections).set(values).where(eq(schema.connections.id, existing[0].id));
      } else {
        await db.insert(schema.connections).values({
          userId: user.id,
          provider: "google",
          refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
          ...values,
        });
      }
      return c.redirect(`${origin}/#/?connect=google`);
    } catch {
      return c.redirect(`${origin}/#/?connect=error`);
    }
  });

  // Connection status for the signed-in user.
  app.get("/api/connect/status", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const rows = await getDb()
      .select({
        provider: schema.connections.provider,
        label: schema.connections.label,
        createdAt: schema.connections.createdAt,
      })
      .from(schema.connections)
      .where(eq(schema.connections.userId, user.id));
    return c.json({ configured: { google: googleConfigured() }, connections: rows });
  });

  // Disconnect a provider.
  app.post("/api/connect/disconnect", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { provider?: string };
    if (!body.provider) return c.json({ error: "provider is required" }, 400);
    await getDb()
      .delete(schema.connections)
      .where(
        and(eq(schema.connections.userId, user.id), eq(schema.connections.provider, body.provider)),
      );
    return c.json({ ok: true });
  });

  // Agent tool execution — the model never sees tokens, just results.
  app.post("/api/connect/tool", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      tool?: string;
      args?: Record<string, unknown>;
    };
    const args = body.args ?? {};
    try {
      switch (body.tool) {
        case "gmail_list":
          return c.json({ ok: true, result: await gmailList(user.id, args as never) });
        case "gmail_read":
          return c.json({ ok: true, result: await gmailRead(user.id, args as never) });
        case "gmail_draft":
          return c.json({ ok: true, result: await gmailDraft(user.id, args as never) });
        case "gmail_send":
          return c.json({ ok: true, result: await gmailSend(user.id, args as never) });
        case "calendar_upcoming":
          return c.json({ ok: true, result: await calendarUpcoming(user.id, args as never) });
        default:
          return c.json({ error: `Unknown tool: ${body.tool}` }, 400);
      }
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
}
