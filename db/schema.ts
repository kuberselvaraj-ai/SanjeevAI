import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  longtext,
  timestamp,
  bigint,
  int,
  boolean,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Local email/password accounts (unionId = "local:<email>"). Null for Kimi OAuth users.
  passwordHash: varchar("passwordHash", { length: 255 }),
  // Subscription tier — limits live in contracts/constants.ts (PLANS). Admins bypass limits.
  plan: mysqlEnum("plan", ["free", "pro"]).default("free").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** One row per billable action (a chat completion, a video generation). */
export const usageEvents = mysqlTable("usage_events", {
  id: serial("id").primaryKey(),
  // FK referencing serial() PK must be bigint unsigned
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  kind: mysqlEnum("kind", ["chat", "video", "image"]).notNull(),
  model: varchar("model", { length: 100 }),
  inputTokens: int("inputTokens").default(0).notNull(),
  outputTokens: int("outputTokens").default(0).notNull(),
  videoCount: int("videoCount").default(0).notNull(),
  imageCount: int("imageCount").default(0).notNull(),
  note: varchar("note", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = typeof usageEvents.$inferInsert;


/** Invite codes — signup requires one; the code decides the granted plan. */
export const inviteCodes = mysqlTable("invite_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  plan: mysqlEnum("plan", ["free", "pro"]).default("free").notNull(),
  maxUses: int("maxUses").default(1).notNull(),
  usedCount: int("usedCount").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = typeof inviteCodes.$inferInsert;

/** Public read-only snapshots of a conversation, reachable at /share/<slug>. */
export const shareLinks = mysqlTable("share_links", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 24 }).notNull().unique(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  title: varchar("title", { length: 255 }).notNull(),
  /** JSON-serialized message list (text only — attachments are stripped). */
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShareLink = typeof shareLinks.$inferSelect;
export type InsertShareLink = typeof shareLinks.$inferInsert;

/**
 * Scheduled deliverables — "every Monday, refresh this analysis".
 * The server runs the specialist pipeline on a timer; results land in
 * schedule_runs and surface in the user's Briefs inbox.
 */
export const schedules = mysqlTable("schedules", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  title: varchar("title", { length: 120 }).notNull(),
  prompt: text("prompt").notNull(),
  frequency: mysqlEnum("frequency", ["daily", "weekly"]).notNull(),
  /** 0=Sunday … 6=Saturday — weekly only */
  weekday: int("weekday"),
  /** wall-clock time in `timezone` */
  hour: int("hour").notNull(),
  minute: int("minute").notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull(),
  active: boolean("active").default(true).notNull(),
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = typeof schedules.$inferInsert;

/** One execution of a schedule — the deliverable itself lives in `content`. */
export const scheduleRuns = mysqlTable("schedule_runs", {
  id: serial("id").primaryKey(),
  scheduleId: varchar("scheduleId", { length: 36 })
    .notNull()
    .references(() => schedules.id),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  status: mysqlEnum("status", ["running", "done", "failed"]).notNull(),
  /** finished deliverable, Markdown with embedded data-URL images */
  content: longtext("content"),
  error: text("error"),
  /** council pass: premium model that refined this run (pro plans) */
  refinedBy: varchar("refinedBy", { length: 40 }),
  /** Level 5 signal tap: did this deliverable hit the mark? */
  feedback: mysqlEnum("feedback", ["up", "down"]),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type InsertScheduleRun = typeof scheduleRuns.$inferInsert;

/**
 * Connected third-party accounts (Google, Slack, Salesforce…).
 * Tokens are AES-256-GCM encrypted at rest (api/lib/connectCrypto.ts) —
 * never store plaintext here.
 */
export const connections = mysqlTable("connections", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  provider: varchar("provider", { length: 32 }).notNull(), // 'google' | 'slack' | 'salesforce'
  /** account label, e.g. the connected Gmail address */
  label: varchar("label", { length: 320 }),
  scopes: text("scopes"),
  accessTokenEnc: text("accessTokenEnc").notNull(),
  refreshTokenEnc: text("refreshTokenEnc"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Connection = typeof connections.$inferSelect;
export type InsertConnection = typeof connections.$inferInsert;
