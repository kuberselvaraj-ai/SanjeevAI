import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { createShareLink, getShareBySlug } from "./queries/shares";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100_000),
  model: z.string().optional(),
});

export const shareRouter = createRouter({
  /** Publish a read-only snapshot of a conversation. Returns the public slug. */
  create: authedQuery
    .input(
      z.object({
        title: z.string().min(1).max(255),
        messages: z.array(messageSchema).min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Strip anything that isn't plain text — no attachments, no internals.
      const snapshot = JSON.stringify(
        input.messages.map((m) => ({
          role: m.role,
          content: m.content,
          model: m.model ?? null,
        })),
      );
      const slug = await createShareLink(ctx.user.id, input.title, snapshot);
      return { slug };
    }),

  /** Public: fetch a shared conversation by slug. */
  get: publicQuery
    .input(z.object({ slug: z.string().min(1).max(24) }))
    .query(async ({ input }) => {
      const row = await getShareBySlug(input.slug);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Shared chat not found." });
      return {
        title: row.title,
        createdAt: row.createdAt,
        messages: JSON.parse(row.snapshot) as Array<{
          role: "user" | "assistant";
          content: string;
          model: string | null;
        }>,
      };
    }),
});
