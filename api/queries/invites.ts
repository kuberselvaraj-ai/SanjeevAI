import { and, desc, eq, lt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as schema from "@db/schema";
import { getDb } from "./connection";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no easily-confused 0/O/1/I/L

export function generateCode(): string {
  const part = () =>
    Array.from(randomBytes(4))
      .map((b) => ALPHABET[b % ALPHABET.length])
      .join("");
  return `SANJ-${part()}-${part()}`;
}

export async function createInvite(
  plan: "free" | "pro",
  maxUses: number,
  expiresInDays?: number,
) {
  const code = generateCode();
  await getDb()
    .insert(schema.inviteCodes)
    .values({
      code,
      plan,
      maxUses,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    });
  return code;
}

export async function listInvites() {
  return getDb()
    .select()
    .from(schema.inviteCodes)
    .orderBy(desc(schema.inviteCodes.id));
}

export async function deactivateInvite(id: number) {
  await getDb()
    .update(schema.inviteCodes)
    .set({ active: false })
    .where(eq(schema.inviteCodes.id, id));
}

/** Returns the invite only if it can still be redeemed right now. */
export async function getValidInvite(code: string) {
  const rows = await getDb()
    .select()
    .from(schema.inviteCodes)
    .where(eq(schema.inviteCodes.code, code.trim().toUpperCase()))
    .limit(1);
  const invite = rows.at(0);
  if (!invite || !invite.active) return null;
  if (invite.expiresAt && invite.expiresAt < new Date()) return null;
  if (invite.usedCount >= invite.maxUses) return null;
  return invite;
}

/** Atomically consume one use; false if the code was exhausted meanwhile. */
export async function consumeInvite(id: number): Promise<boolean> {
  const res = await getDb()
    .update(schema.inviteCodes)
    .set({ usedCount: sql`${schema.inviteCodes.usedCount} + 1` })
    .where(
      and(
        eq(schema.inviteCodes.id, id),
        lt(schema.inviteCodes.usedCount, schema.inviteCodes.maxUses),
      ),
    );
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number };
  return Number(header?.affectedRows ?? 0) > 0;
}
