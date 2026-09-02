import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as schema from "@db/schema";
import { getDb } from "./connection";

function generateSlug(): string {
  return randomBytes(9).toString("base64url"); // 12 chars, URL-safe
}

export async function createShareLink(
  userId: number,
  title: string,
  snapshot: string,
): Promise<string> {
  const slug = generateSlug();
  await getDb().insert(schema.shareLinks).values({ slug, userId, title, snapshot });
  return slug;
}

export async function getShareBySlug(slug: string) {
  const rows = await getDb()
    .select()
    .from(schema.shareLinks)
    .where(eq(schema.shareLinks.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}
