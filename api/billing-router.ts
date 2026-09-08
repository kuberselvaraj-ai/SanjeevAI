import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { findUserByUnionId, upsertUser } from "./queries/users";
import { createRouter, publicQuery } from "./middleware";
import {
  hashPassword,
  isOwnerEmail,
  issueSession,
  localId,
} from "./local-auth-router";

/**
 * Paid-signup claiming — the tRPC half of the Stripe money path.
 * After checkout, the buyer lands on /#/login?paid=cs_… ; claimInfo previews
 * the purchase, paidSignup turns it into an account on the pro plan.
 */

const sessionId = z
  .string()
  .min(10)
  .max(200)
  .regex(/^cs_[a-zA-Z0-9_]+$/, "Malformed session id");

async function findUnclaimed(session: string) {
  const rows = await getDb()
    .select()
    .from(schema.paidSignups)
    .where(eq(schema.paidSignups.sessionId, session))
    .limit(1);
  const row = rows.at(0);
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "We couldn't find that purchase — it can take a minute to arrive after payment. Refresh, or contact support.",
    });
  }
  if (row.claimedAt) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "That purchase was already claimed — log in instead.",
    });
  }
  return row;
}

export const billingRouter = createRouter({
  /** Preview a completed purchase so the signup form can prefill the email. */
  claimInfo: publicQuery
    .input(z.object({ sessionId }))
    .query(async ({ input }) => {
      const row = await findUnclaimed(input.sessionId);
      return { email: row.email, tier: row.tier };
    }),

  /** Turn a completed Stripe checkout into an account on the pro plan. */
  paidSignup: publicQuery
    .input(
      z.object({
        sessionId,
        name: z.string().min(1).max(80),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await findUnclaimed(input.sessionId);
      const unionId = localId(row.email);
      if (await findUserByUnionId(unionId)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists — log in instead.",
        });
      }
      // Atomically mark the purchase claimed before creating the account, so a
      // double-submit can't create two accounts from one payment.
      const claim = await getDb()
        .update(schema.paidSignups)
        .set({ claimedAt: new Date() })
        .where(
          and(
            eq(schema.paidSignups.sessionId, row.sessionId),
            isNull(schema.paidSignups.claimedAt),
          ),
        );
      const header = (Array.isArray(claim) ? claim[0] : claim) as {
        affectedRows?: number;
      };
      if (!Number(header?.affectedRows ?? 0)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That purchase was just claimed — log in instead.",
        });
      }
      await upsertUser({
        unionId,
        email: row.email,
        name: input.name.trim(),
        passwordHash: hashPassword(input.password),
        lastSignInAt: new Date(),
        plan: "pro",
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        subscriptionTier: row.tier,
        subscriptionStatus: "active",
        ...(isOwnerEmail(row.email) ? { role: "admin" as const } : {}),
      });
      // Best-effort backlink from the purchase row to the account.
      const user = await findUserByUnionId(unionId);
      if (user) {
        await getDb()
          .update(schema.paidSignups)
          .set({ userId: user.id })
          .where(eq(schema.paidSignups.sessionId, row.sessionId));
      }
      await issueSession(ctx, unionId);
      return { ok: true };
    }),
});
