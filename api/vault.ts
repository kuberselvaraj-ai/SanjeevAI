import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { and, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";

/**
 * Cloud vault API — one file library across every device.
 * Payloads ride as base64 (≤8 MB originals); the shape is storage-agnostic
 * so blobs can move to GCS later without touching clients.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024;

async function auth(c: { req: { raw: { headers: Headers } } }) {
  try {
    return await authenticateRequest(c.req.raw.headers);
  } catch {
    return null;
  }
}

function rowToMeta(r: schema.VaultFileRow) {
  return {
    id: String(r.id),
    hash: r.hash,
    name: r.name,
    mimeType: r.mimeType,
    size: r.size,
    kind: r.kind,
    folderId: r.folderId ?? null,
    tags: r.tags ? r.tags.split(",").filter(Boolean) : [],
    createdAt: r.createdAt.getTime(),
    hasPayload: Boolean(r.payload),
    hasText: Boolean(r.extractedText),
  };
}

export function registerVaultRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  // Full tree: folders + file metadata (payloads fetched on demand).
  app.get("/api/vault/tree", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    const db = getDb();
    const [folders, files] = await Promise.all([
      db
        .select()
        .from(schema.vaultFolders)
        .where(eq(schema.vaultFolders.userId, user.id)),
      db
        .select()
        .from(schema.vaultFiles)
        .where(eq(schema.vaultFiles.userId, user.id)),
    ]);
    return c.json({
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId ?? null,
      })),
      files: files.map(rowToMeta),
    });
  });

  app.post("/api/vault/folders", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      parentId?: number | null;
    };
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name is required" }, 400);
    const res = await getDb()
      .insert(schema.vaultFolders)
      .values({ userId: user.id, name: name.slice(0, 120), parentId: body.parentId ?? null })
      .$returningId();
    return c.json({ ok: true, id: res[0]?.id });
  });

  app.delete("/api/vault/folders/:id", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    const id = Number(c.req.param("id"));
    const db = getDb();
    // Files in the deleted folder float back to root.
    await db
      .update(schema.vaultFiles)
      .set({ folderId: null })
      .where(and(eq(schema.vaultFiles.userId, user.id), eq(schema.vaultFiles.folderId, id)));
    await db
      .update(schema.vaultFolders)
      .set({ parentId: null })
      .where(and(eq(schema.vaultFolders.userId, user.id), eq(schema.vaultFolders.parentId, id)));
    await db
      .delete(schema.vaultFolders)
      .where(and(eq(schema.vaultFolders.userId, user.id), eq(schema.vaultFolders.id, id)));
    return c.json({ ok: true });
  });

  // Upload — deduped by content hash per user. Returns the existing entry on a hit.
  app.post("/api/vault/upload", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      mimeType?: string;
      size?: number;
      hash?: string;
      kind?: "image" | "doc";
      folderId?: number | null;
      tags?: string[];
      payloadB64?: string;
      extractedText?: string;
    };
    if (!body.name || !body.hash || !body.kind) {
      return c.json({ error: "name, hash and kind are required" }, 400);
    }
    if ((body.size ?? 0) > MAX_FILE_BYTES) {
      return c.json({ error: "File exceeds the 8 MB cloud-vault limit." }, 413);
    }
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.vaultFiles)
      .where(and(eq(schema.vaultFiles.userId, user.id), eq(schema.vaultFiles.hash, body.hash)))
      .limit(1);
    if (existing[0]) return c.json({ ok: true, file: rowToMeta(existing[0]), deduped: true });
    // checkOnly: pure dedupe probe — no insert on a miss.
    if ((body as { checkOnly?: boolean }).checkOnly) {
      return c.json({ ok: true, file: null, deduped: false });
    }

    const res = await db
      .insert(schema.vaultFiles)
      .values({
        userId: user.id,
        folderId: body.folderId ?? null,
        name: body.name.slice(0, 255),
        mimeType: (body.mimeType ?? "application/octet-stream").slice(0, 120),
        size: body.size ?? 0,
        hash: body.hash,
        kind: body.kind,
        payload: body.payloadB64 ?? null,
        extractedText: body.extractedText ?? null,
        tags: (body.tags ?? []).slice(0, 8).join(","),
      })
      .$returningId();
    const rows = await db
      .select()
      .from(schema.vaultFiles)
      .where(eq(schema.vaultFiles.id, res[0]?.id ?? 0))
      .limit(1);
    return c.json({ ok: true, file: rows[0] ? rowToMeta(rows[0]) : null });
  });

  // Payload on demand (attach to chat / download to device).
  app.get("/api/vault/files/:id/payload", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    const rows = await getDb()
      .select()
      .from(schema.vaultFiles)
      .where(
        and(
          eq(schema.vaultFiles.userId, user.id),
          eq(schema.vaultFiles.id, Number(c.req.param("id"))),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return c.json({ error: "Not found" }, 404);
    return c.json({
      id: String(r.id),
      name: r.name,
      mimeType: r.mimeType,
      payloadB64: r.payload,
      extractedText: r.extractedText,
    });
  });

  // Rename / move / retag / edit extracted text (in-cloud editing).
  app.patch("/api/vault/files/:id", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      folderId?: number | null;
      tags?: string[];
      extractedText?: string;
    };
    const patch: Record<string, unknown> = {};
    if (body.name?.trim()) patch.name = body.name.trim().slice(0, 255);
    if (body.folderId !== undefined) patch.folderId = body.folderId;
    if (body.tags) patch.tags = body.tags.slice(0, 8).join(",");
    if (body.extractedText !== undefined) patch.extractedText = body.extractedText;
    if (Object.keys(patch).length === 0) return c.json({ error: "nothing to update" }, 400);
    await getDb()
      .update(schema.vaultFiles)
      .set(patch)
      .where(
        and(
          eq(schema.vaultFiles.userId, user.id),
          eq(schema.vaultFiles.id, Number(c.req.param("id"))),
        ),
      );
    return c.json({ ok: true });
  });

  app.delete("/api/vault/files/:id", async (c) => {
    const user = await auth(c);
    if (!user) return c.json({ error: "Please sign in first." }, 401);
    await getDb()
      .delete(schema.vaultFiles)
      .where(
        and(
          eq(schema.vaultFiles.userId, user.id),
          eq(schema.vaultFiles.id, Number(c.req.param("id"))),
        ),
      );
    return c.json({ ok: true });
  });
}
