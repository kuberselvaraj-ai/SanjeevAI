import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { listUsersWithUsage } from "./queries/usage";

export const adminRouter = createRouter({
  listUsers: adminQuery.query(() => listUsersWithUsage()),

  setPlan: adminQuery
    .input(z.object({ userId: z.number(), plan: z.enum(["free", "pro"]) }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(users)
        .set({ plan: input.plan })
        .where(eq(users.id, input.userId));
      return { ok: true };
    }),

  setRole: adminQuery
    .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.userId));
      return { ok: true };
    }),
});
