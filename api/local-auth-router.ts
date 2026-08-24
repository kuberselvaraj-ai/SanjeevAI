import { z } from "zod";
import * as cookie from "cookie";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { findUserByUnionId, upsertUser } from "./queries/users";
import { consumeInvite, getValidInvite } from "./queries/invites";
import { signSessionToken } from "./kimi/session";
import { getSessionCookieOptions } from "./lib/cookies";
import { Session } from "@contracts/constants";
import { env } from "./lib/env";
import type { TrpcContext } from "./context";

/**
 * Email/password accounts alongside Kimi OAuth.
 * Local users get unionId = "local:<email>" so the rest of the auth
 * machinery (JWT session, ctx.user lookup by unionId) works unchanged.
 */

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const reference = Buffer.from(hash, "hex");
  return reference.length === candidate.length && timingSafeEqual(reference, candidate);
}

const localId = (email: string) => `local:${email.trim().toLowerCase()}`;

/** Emails listed in ADMIN_EMAILS (comma-separated) get the admin role on
 *  signup/login — this is how the owner becomes admin without Kimi OAuth. */
function isOwnerEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

async function issueSession(ctx: TrpcContext, unionId: string) {
  const token = await signSessionToken({ unionId, clientId: env.appId });
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: Session.maxAgeMs / 1000,
    }),
  );
}

const credentials = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const localAuthRouter = createRouter({
  signup: publicQuery
    .input(
      credentials.extend({
        name: z.string().min(1).max(80),
        code: z.string().min(4, "An invite code is required to sign up."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const unionId = localId(input.email);
      const existing = await findUserByUnionId(unionId);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists — log in instead.",
        });
      }
      const invite = await getValidInvite(input.code);
      if (!invite) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Invalid, expired, or fully-used invite code.",
        });
      }
      await upsertUser({
        unionId,
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        passwordHash: hashPassword(input.password),
        lastSignInAt: new Date(),
        plan: invite.plan,
        ...(isOwnerEmail(input.email) ? { role: "admin" as const } : {}),
      });
      const consumed = await consumeInvite(invite.id);
      if (!consumed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That invite code was just used up — ask for a fresh one.",
        });
      }
      await issueSession(ctx, unionId);
      return { ok: true };
    }),

  loginWithPassword: publicQuery.input(credentials).mutation(async ({ ctx, input }) => {
    const unionId = localId(input.email);
    const user = await findUserByUnionId(unionId);
    if (!user?.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password.",
      });
    }
    await upsertUser({
      unionId,
      lastSignInAt: new Date(),
      ...(isOwnerEmail(input.email) && user.role !== "admin"
        ? { role: "admin" as const }
        : {}),
    });
    await issueSession(ctx, unionId);
    return { ok: true };
  }),
});
