import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** UTC start of the current calendar month — usage resets monthly. */
export function monthStart(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function recordUsage(
  event: Omit<schema.InsertUsageEvent, "id" | "createdAt">,
) {
  await getDb().insert(schema.usageEvents).values(event);
}

export async function getMonthUsage(userId: number) {
  const rows = await getDb()
    .select({
      tokens: sql<number>`COALESCE(SUM(${schema.usageEvents.inputTokens} + ${schema.usageEvents.outputTokens}), 0)`,
      videos: sql<number>`COALESCE(SUM(${schema.usageEvents.videoCount}), 0)`,
      images: sql<number>`COALESCE(SUM(${schema.usageEvents.imageCount}), 0)`,
    })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.userId, userId),
        gte(schema.usageEvents.createdAt, monthStart()),
      ),
    );
  const r = rows.at(0);
  return {
    tokens: Number(r?.tokens ?? 0),
    videos: Number(r?.videos ?? 0),
    images: Number(r?.images ?? 0),
  };
}

/** All users plus their current-month usage. Never expose passwordHash. */
export async function listUsersWithUsage() {
  const allUsers = await getDb().select().from(schema.users);
  const usage = await getDb()
    .select({
      userId: schema.usageEvents.userId,
      tokens: sql<number>`COALESCE(SUM(${schema.usageEvents.inputTokens} + ${schema.usageEvents.outputTokens}), 0)`,
      videos: sql<number>`COALESCE(SUM(${schema.usageEvents.videoCount}), 0)`,
      images: sql<number>`COALESCE(SUM(${schema.usageEvents.imageCount}), 0)`,
    })
    .from(schema.usageEvents)
    .where(gte(schema.usageEvents.createdAt, monthStart()))
    .groupBy(schema.usageEvents.userId);
  const byUser = new Map(usage.map((u) => [u.userId, u]));
  return allUsers.map((u) => {
    const { passwordHash: _ignored, ...rest } = u;
    return {
      ...rest,
      monthTokens: Number(byUser.get(u.id)?.tokens ?? 0),
      monthVideos: Number(byUser.get(u.id)?.videos ?? 0),
      monthImages: Number(byUser.get(u.id)?.images ?? 0),
    };
  });
}
