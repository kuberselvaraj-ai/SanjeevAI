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

/* ---------------- Slack ---------------- */

const SLACK_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "chat:write",
  "users:read",
].join(",");

function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

async function loadConnection(userId: number, provider: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.userId, userId), eq(schema.connections.provider, provider)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    accessToken: decryptToken(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null,
    expiresAt: row.expiresAt ?? null,
    instanceUrl: row.instanceUrl ?? null,
  };
}

async function slackApi(
  userId: number,
  method: string,
  params: Record<string, string>,
  asPost = false,
): Promise<Record<string, unknown>> {
  const conn = await loadConnection(userId, "slack");
  if (!conn) throw new Error("Slack is not connected. Connect it in Settings → Connections.");
  const url = `https://slack.com/api/${method}${asPost ? "" : `?${new URLSearchParams(params)}`}`;
  const res = await fetch(url, {
    method: asPost ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      ...(asPost ? { "Content-Type": "application/json" } : {}),
    },
    ...(asPost ? { body: JSON.stringify(params) } : {}),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || !data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? res.status}`);
  return data;
}

async function slackChannels(userId: number) {
  const data = await slackApi(userId, "conversations.list", {
    types: "public_channel,private_channel",
    limit: "50",
    exclude_archived: "true",
  });
  return ((data.channels as Record<string, unknown>[]) ?? []).map((ch) => ({
    id: ch.id,
    name: ch.name,
    members: ch.num_members,
  }));
}

async function slackRead(userId: number, args: { channel: string; limit?: number }) {
  const data = await slackApi(userId, "conversations.history", {
    channel: args.channel,
    limit: String(Math.min(args.limit ?? 15, 50)),
  });
  const messages = (data.messages as { user?: string; text?: string; ts?: string }[]) ?? [];
  // Resolve user ids to display names (best effort).
  const names = new Map<string, string>();
  try {
    const users = await slackApi(userId, "users.list", { limit: "200" });
    for (const u of (users.members as { id: string; real_name?: string; name?: string }[]) ?? [])
      names.set(u.id, u.real_name ?? u.name ?? u.id);
  } catch {
    /* names stay as ids */
  }
  return messages.map((m) => ({
    from: (m.user && names.get(m.user)) || m.user || "unknown",
    text: (m.text ?? "").slice(0, 500),
    ts: m.ts,
  }));
}

async function slackSend(userId: number, args: { channel: string; text: string; confirm?: boolean }) {
  if (args.confirm !== true) {
    throw new Error(
      "Message not sent — Slack posts need explicit confirmation. Show the user the channel and text, then call slack_send again with confirm=true only after they approve.",
    );
  }
  const data = await slackApi(userId, "chat.postMessage", {
    channel: args.channel,
    text: args.text,
  }, true);
  return { sent: true, ts: data.ts };
}

/* ---------------- Salesforce ---------------- */

const SF_LOGIN = () => process.env.SALESFORCE_LOGIN_HOST || "https://login.salesforce.com";
const SF_SCOPES = "api refresh_token openid";

function salesforceConfigured(): boolean {
  return Boolean(process.env.SALESFORCE_CLIENT_ID && process.env.SALESFORCE_CLIENT_SECRET);
}

async function sfRefresh(userId: number, conn: NonNullable<Awaited<ReturnType<typeof loadConnection>>>) {
  if (!conn.refreshToken) throw new Error("Salesforce session expired — reconnect in Settings.");
  const res = await fetch(`${SF_LOGIN()}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    instance_url?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(`Salesforce token refresh failed (${data.error ?? res.status}) — reconnect in Settings.`);
  }
  conn.accessToken = data.access_token;
  if (data.instance_url) conn.instanceUrl = data.instance_url;
  await getDb()
    .update(schema.connections)
    .set({
      accessTokenEnc: encryptToken(conn.accessToken),
      ...(data.instance_url ? { instanceUrl: data.instance_url } : {}),
    })
    .where(eq(schema.connections.id, conn.id));
}

async function sfApi(
  userId: number,
  path: string,
  init?: { method?: string; body?: unknown },
  retried = false,
): Promise<Record<string, unknown>> {
  const conn = await loadConnection(userId, "salesforce");
  if (!conn) throw new Error("Salesforce is not connected. Connect it in Settings → Connections.");
  if (!conn.instanceUrl) throw new Error("Salesforce instance URL missing — reconnect in Settings.");
  const res = await fetch(`${conn.instanceUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 401 && !retried) {
    await sfRefresh(userId, conn);
    return sfApi(userId, path, init, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Salesforce API error ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return {};
  return (await res.json()) as Record<string, unknown>;
}

async function sfQuery(userId: number, soql: string) {
  if (!/^\s*select\s/i.test(soql)) throw new Error("Only SELECT (SOQL) queries are allowed.");
  const data = await sfApi(userId, `/services/data/v61.0/query?q=${encodeURIComponent(soql)}`);
  const records = (data.records as Record<string, unknown>[]) ?? [];
  return {
    totalSize: data.totalSize ?? records.length,
    records: records.slice(0, 50).map((r) => {
      const { attributes, ...rest } = r;
      return rest;
    }),
  };
}

async function sfOpportunities(userId: number) {
  return sfQuery(
    userId,
    "SELECT Id, Name, StageName, Amount, CloseDate, Account.Name FROM Opportunity WHERE IsClosed = false ORDER BY CloseDate ASC LIMIT 20",
  );
}

async function sfUpdate(
  userId: number,
  args: { objectType: string; id: string; fields: Record<string, unknown>; confirm?: boolean },
) {
  if (args.confirm !== true) {
    throw new Error(
      "Record not updated — Salesforce writes need explicit confirmation. Show the user the object, id and field changes, then call salesforce_update again with confirm=true only after they approve.",
    );
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(args.objectType)) throw new Error("Invalid object type.");
  await sfApi(userId, `/services/data/v61.0/sobjects/${args.objectType}/${args.id}`, {
    method: "PATCH",
    body: args.fields ?? {},
  });
  return { updated: true, objectType: args.objectType, id: args.id };
}

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

  /* ---------------- Slack OAuth ---------------- */

  app.get("/api/connect/slack/start", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!slackConfigured()) {
      return c.json({ error: "Slack connector is not configured on this server." }, 503);
    }
    const origin = new URL(c.req.url).origin;
    const state = encryptToken(JSON.stringify({ u: user.unionId, t: Date.now() }));
    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      redirect_uri: `${origin}/api/connect/slack/callback`,
      user_scope: SLACK_SCOPES,
      state,
    });
    return c.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
  });

  app.get("/api/connect/slack/callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const origin = url.origin;
    if (!code || !slackConfigured()) return c.redirect(`${origin}/#/?connect=error`);
    let unionId: string;
    try {
      const parsed = JSON.parse(decryptToken(state)) as { u: string; t: number };
      if (Date.now() - parsed.t > 10 * 60_000) throw new Error("stale state");
      unionId = parsed.u;
    } catch {
      return c.redirect(`${origin}/#/?connect=error`);
    }
    try {
      const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.SLACK_CLIENT_ID!,
          client_secret: process.env.SLACK_CLIENT_SECRET!,
          redirect_uri: `${origin}/api/connect/slack/callback`,
        }),
      });
      const data = (await tokenRes.json()) as {
        ok?: boolean;
        authed_user?: { access_token?: string };
        team?: { name?: string };
      };
      const accessToken = data.authed_user?.access_token;
      if (!data.ok || !accessToken) throw new Error("slack token exchange failed");

      const db = getDb();
      const userRows = await db.select().from(schema.users).where(eq(schema.users.unionId, unionId)).limit(1);
      const user = userRows[0];
      if (!user) throw new Error("user not found");
      const existing = await db
        .select()
        .from(schema.connections)
        .where(and(eq(schema.connections.userId, user.id), eq(schema.connections.provider, "slack")))
        .limit(1);
      const values = {
        label: data.team?.name ?? "Slack workspace",
        scopes: SLACK_SCOPES,
        accessTokenEnc: encryptToken(accessToken),
      };
      if (existing[0]) {
        await db.update(schema.connections).set(values).where(eq(schema.connections.id, existing[0].id));
      } else {
        await db.insert(schema.connections).values({ userId: user.id, provider: "slack", ...values });
      }
      return c.redirect(`${origin}/#/?connect=slack`);
    } catch {
      return c.redirect(`${origin}/#/?connect=error`);
    }
  });

  /* ---------------- Salesforce OAuth ---------------- */

  app.get("/api/connect/salesforce/start", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    if (!salesforceConfigured()) {
      return c.json({ error: "Salesforce connector is not configured on this server." }, 503);
    }
    const origin = new URL(c.req.url).origin;
    const state = encryptToken(JSON.stringify({ u: user.unionId, t: Date.now() }));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      redirect_uri: `${origin}/api/connect/salesforce/callback`,
      scope: SF_SCOPES,
      state,
    });
    return c.redirect(`${SF_LOGIN()}/services/oauth2/authorize?${params}`);
  });

  app.get("/api/connect/salesforce/callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const origin = url.origin;
    if (!code || !salesforceConfigured()) return c.redirect(`${origin}/#/?connect=error`);
    let unionId: string;
    try {
      const parsed = JSON.parse(decryptToken(state)) as { u: string; t: number };
      if (Date.now() - parsed.t > 10 * 60_000) throw new Error("stale state");
      unionId = parsed.u;
    } catch {
      return c.redirect(`${origin}/#/?connect=error`);
    }
    try {
      const tokenRes = await fetch(`${SF_LOGIN()}/services/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.SALESFORCE_CLIENT_ID!,
          client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
          redirect_uri: `${origin}/api/connect/salesforce/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tokens = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        instance_url?: string;
      };
      if (!tokenRes.ok || !tokens.access_token || !tokens.instance_url) {
        throw new Error("salesforce token exchange failed");
      }
      let label = "Salesforce";
      try {
        const infoRes = await fetch(`${tokens.instance_url}/services/oauth2/userinfo`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const info = (await infoRes.json()) as { name?: string; email?: string };
        label = info.name ?? info.email ?? label;
      } catch {
        /* label stays generic */
      }

      const db = getDb();
      const userRows = await db.select().from(schema.users).where(eq(schema.users.unionId, unionId)).limit(1);
      const user = userRows[0];
      if (!user) throw new Error("user not found");
      const existing = await db
        .select()
        .from(schema.connections)
        .where(
          and(eq(schema.connections.userId, user.id), eq(schema.connections.provider, "salesforce")),
        )
        .limit(1);
      const values = {
        label,
        scopes: SF_SCOPES,
        instanceUrl: tokens.instance_url,
        accessTokenEnc: encryptToken(tokens.access_token),
        ...(tokens.refresh_token ? { refreshTokenEnc: encryptToken(tokens.refresh_token) } : {}),
      };
      if (existing[0]) {
        await db.update(schema.connections).set(values).where(eq(schema.connections.id, existing[0].id));
      } else {
        await db.insert(schema.connections).values({
          userId: user.id,
          provider: "salesforce",
          refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
          ...values,
        });
      }
      return c.redirect(`${origin}/#/?connect=salesforce`);
    } catch {
      return c.redirect(`${origin}/#/?connect=error`);
    }
  });

  /* ---------------- Mission Deck snapshot ---------------- */

  // One call, every connected surface — the single-screen briefing.
  app.get("/api/connect/deck", async (c) => {
    let user;
    try {
      user = await authenticateRequest(c.req.raw.headers);
    } catch {
      return c.json({ error: "Please sign in first." }, 401);
    }
    const sections: Record<string, unknown> = {};
    const has = async (provider: string) =>
      Boolean(await loadConnection(user.id, provider));

    if (await has("google")) {
      try {
        sections.gmail = await gmailList(user.id, { query: "is:unread", max: 5 } as never);
      } catch (e) {
        sections.gmail = { error: (e as Error).message };
      }
      try {
        sections.calendar = await calendarUpcoming(user.id, { days: 2, max: 5 } as never);
      } catch (e) {
        sections.calendar = { error: (e as Error).message };
      }
    }
    if (await has("slack")) {
      try {
        sections.slack = await slackChannels(user.id);
      } catch (e) {
        sections.slack = { error: (e as Error).message };
      }
    }
    if (await has("salesforce")) {
      try {
        sections.salesforce = await sfOpportunities(user.id);
      } catch (e) {
        sections.salesforce = { error: (e as Error).message };
      }
    }
    return c.json({ ok: true, sections });
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
    return c.json({
      configured: {
        google: googleConfigured(),
        slack: slackConfigured(),
        salesforce: salesforceConfigured(),
      },
      connections: rows,
    });
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
        case "slack_channels":
          return c.json({ ok: true, result: await slackChannels(user.id) });
        case "slack_read":
          return c.json({ ok: true, result: await slackRead(user.id, args as never) });
        case "slack_send":
          return c.json({ ok: true, result: await slackSend(user.id, args as never) });
        case "salesforce_query":
          return c.json({ ok: true, result: await sfQuery(user.id, String(args.soql ?? "")) });
        case "salesforce_opportunities":
          return c.json({ ok: true, result: await sfOpportunities(user.id) });
        case "salesforce_update":
          return c.json({ ok: true, result: await sfUpdate(user.id, args as never) });
        default:
          return c.json({ error: `Unknown tool: ${body.tool}` }, 400);
      }
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
}
