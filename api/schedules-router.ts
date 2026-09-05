import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import * as schema from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { computeNextRun, executeSchedule } from "./scheduler";

const createInput = z.object({
  prompt: z.string().min(12).max(4000),
  frequency: z.enum(["daily", "weekly"]),
  weekday: z.number().int().min(0).max(6).optional(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().min(1).max(64),
});

export const schedulesRouter = createRouter({
  /** All schedules for the user, with unread-run counts and latest status. */
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.userId, ctx.user.id))
      .orderBy(desc(schema.schedules.createdAt));
    const unread = await db
      .select({
        scheduleId: schema.scheduleRuns.scheduleId,
        n: sql<number>`count(*)`,
      })
      .from(schema.scheduleRuns)
      .where(
        and(
          eq(schema.scheduleRuns.userId, ctx.user.id),
          eq(schema.scheduleRuns.status, "done"),
          isNull(schema.scheduleRuns.readAt),
        ),
      )
      .groupBy(schema.scheduleRuns.scheduleId);
    const unreadBy = new Map(unread.map((u) => [u.scheduleId, Number(u.n)]));
    return rows.map((s) => ({ ...s, unread: unreadBy.get(s.id) ?? 0 }));
  }),

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.scheduleRuns)
      .where(
        and(
          eq(schema.scheduleRuns.userId, ctx.user.id),
          eq(schema.scheduleRuns.status, "done"),
          isNull(schema.scheduleRuns.readAt),
        ),
      );
    return Number(row?.n ?? 0);
  }),

  create: authedQuery.input(createInput).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const draft = {
      frequency: input.frequency,
      weekday: input.frequency === "weekly" ? (input.weekday ?? 1) : null,
      hour: input.hour,
      minute: input.minute,
      timezone: input.timezone,
    };
    const id = randomUUID();
    const title = input.prompt.replace(/\s+/g, " ").trim().slice(0, 60);
    await db.insert(schema.schedules).values({
      id,
      userId: ctx.user.id,
      title,
      prompt: input.prompt.trim(),
      ...draft,
      nextRunAt: computeNextRun({ ...draft, weekday: draft.weekday ?? null }),
    });
    return { id };
  }),

  setActive: authedQuery
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const patch: Partial<schema.InsertSchedule> = { active: input.active };
      if (input.active) {
        const [s] = await db
          .select()
          .from(schema.schedules)
          .where(and(eq(schema.schedules.id, input.id), eq(schema.schedules.userId, ctx.user.id)));
        if (!s) throw new TRPCError({ code: "NOT_FOUND" });
        patch.nextRunAt = computeNextRun(s);
      }
      await db
        .update(schema.schedules)
        .set(patch)
        .where(and(eq(schema.schedules.id, input.id), eq(schema.schedules.userId, ctx.user.id)));
      return { ok: true };
    }),

  remove: authedQuery
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(schema.scheduleRuns)
        .where(and(eq(schema.scheduleRuns.scheduleId, input.id), eq(schema.scheduleRuns.userId, ctx.user.id)));
      await db
        .delete(schema.schedules)
        .where(and(eq(schema.schedules.id, input.id), eq(schema.schedules.userId, ctx.user.id)));
      return { ok: true };
    }),

  /** Fire a schedule immediately (demo, testing, "refresh now"). */
  runNow: authedQuery
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [s] = await db
        .select()
        .from(schema.schedules)
        .where(and(eq(schema.schedules.id, input.id), eq(schema.schedules.userId, ctx.user.id)));
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      const runId = await executeSchedule(s);
      return { runId };
    }),

  /** Level 5 signal tap: thumbs up/down on a finished run. */
  setFeedback: authedQuery
    .input(z.object({ runId: z.number(), feedback: z.enum(["up", "down"]).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(schema.scheduleRuns)
        .set({ feedback: input.feedback })
        .where(and(eq(schema.scheduleRuns.id, input.runId), eq(schema.scheduleRuns.userId, ctx.user.id)));
      return { ok: true };
    }),

  /** Run history for one schedule — excerpts only, no full content. */
  runs: authedQuery
    .input(z.object({ scheduleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.scheduleRuns.id,
          status: schema.scheduleRuns.status,
          error: schema.scheduleRuns.error,
          refinedBy: schema.scheduleRuns.refinedBy,
          feedback: schema.scheduleRuns.feedback,
          readAt: schema.scheduleRuns.readAt,
          createdAt: schema.scheduleRuns.createdAt,
          completedAt: schema.scheduleRuns.completedAt,
          excerpt: sql<string>`left(${schema.scheduleRuns.content}, 160)`,
        })
        .from(schema.scheduleRuns)
        .where(
          and(
            eq(schema.scheduleRuns.scheduleId, input.scheduleId),
            eq(schema.scheduleRuns.userId, ctx.user.id),
          ),
        )
        .orderBy(desc(schema.scheduleRuns.createdAt))
        .limit(20);
      return rows;
    }),

  /** Full deliverable content; marks the run read. */
  runContent: authedQuery
    .input(z.object({ runId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.scheduleRuns)
        .where(and(eq(schema.scheduleRuns.id, input.runId), eq(schema.scheduleRuns.userId, ctx.user.id)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (!row.readAt && row.status === "done") {
        await db
          .update(schema.scheduleRuns)
          .set({ readAt: new Date() })
          .where(eq(schema.scheduleRuns.id, row.id));
      }
      return row;
    }),
});
