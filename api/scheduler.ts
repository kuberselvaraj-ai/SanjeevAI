/**
 * Scheduler — the heartbeat of Level 4.
 *
 * Every minute, due schedules run the deliverable pipeline server-side and
 * the finished brief lands in the user's Briefs inbox (schedule_runs).
 * Times are wall-clock in the user's own timezone, DST-safe.
 */
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { runDeliverable } from "./services/deliverable";

// ── Timezone math ────────────────────────────────────────────────────────

function tzParts(tz: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

/** Offset (ms) of the timezone wall clock ahead of UTC at this instant. */
function tzOffsetMs(tz: string, date: Date): number {
  const p = tzParts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` to the corresponding UTC instant. */
function zonedToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const adjusted = guess - tzOffsetMs(tz, new Date(t));
    if (adjusted === t) break;
    t = adjusted;
  }
  return new Date(t);
}

/** Next UTC instant this schedule should fire, strictly after `from`. */
export function computeNextRun(
  s: Pick<schema.Schedule, "frequency" | "weekday" | "hour" | "minute" | "timezone">,
  from = new Date(),
): Date {
  for (let offset = 0; offset <= 8; offset++) {
    const probe = new Date(from.getTime() + offset * 86_400_000);
    const p = tzParts(s.timezone, probe);
    if (s.frequency === "weekly" && p.weekday !== (s.weekday ?? 1)) continue;
    const candidate = zonedToUtc(s.timezone, p.year, p.month, p.day, s.hour, s.minute);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Unreachable for valid input — fall back to tomorrow.
  return new Date(from.getTime() + 86_400_000);
}

// ── Execution ────────────────────────────────────────────────────────────

/** Execute one schedule right now: insert a run row, run the pipeline, record usage. */
export async function executeSchedule(schedule: schema.Schedule): Promise<number> {
  const db = getDb();
  const [ inserted ] = await db
    .insert(schema.scheduleRuns)
    .values({ scheduleId: schedule.id, userId: schedule.userId, status: "running" })
    .$returningId();
  const runId = inserted.id;

  try {
    // Refresh-style continuity: hand the model the previous edition.
    const prev = await db
      .select({ content: schema.scheduleRuns.content })
      .from(schema.scheduleRuns)
      .where(
        and(
          eq(schema.scheduleRuns.scheduleId, schedule.id),
          eq(schema.scheduleRuns.status, "done"),
        ),
      )
      .orderBy(desc(schema.scheduleRuns.createdAt))
      .limit(1);

    const result = await runDeliverable(schedule.prompt, prev[0]?.content ?? undefined);

    await db
      .update(schema.scheduleRuns)
      .set({ status: "done", content: result.content, completedAt: new Date() })
      .where(eq(schema.scheduleRuns.id, runId));
    await db
      .update(schema.schedules)
      .set({ lastRunAt: new Date() })
      .where(eq(schema.schedules.id, schedule.id));
    await db.insert(schema.usageEvents).values({
      userId: schedule.userId,
      kind: "chat",
      model: "kimi-k3",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      imageCount: result.imageCount,
      note: `schedule:${schedule.id}`,
    });
  } catch (e) {
    await db
      .update(schema.scheduleRuns)
      .set({ status: "failed", error: (e as Error).message, completedAt: new Date() })
      .where(eq(schema.scheduleRuns.id, runId));
  }
  return runId;
}

// ── Tick loop ────────────────────────────────────────────────────────────

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      const db = getDb();
      const due = await db
        .select()
        .from(schema.schedules)
        .where(and(eq(schema.schedules.active, true), lte(schema.schedules.nextRunAt, new Date())))
        .limit(5);
      for (const schedule of due) {
        // Advance nextRunAt FIRST so a crash never double-fires a schedule.
        await db
          .update(schema.schedules)
          .set({ nextRunAt: computeNextRun(schedule) })
          .where(eq(schema.schedules.id, schedule.id));
        void executeSchedule(schedule);
      }
    } catch (e) {
      console.error("[scheduler] tick failed:", (e as Error).message);
    }
  };

  void tick();
  setInterval(() => void tick(), 60_000).unref();
  console.log("[scheduler] started — checking for due briefs every 60s");
}
