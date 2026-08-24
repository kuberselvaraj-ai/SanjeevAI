import { z } from "zod";
import { createRouter, adminQuery } from "./middleware";
import { createInvite, deactivateInvite, listInvites } from "./queries/invites";

export const inviteRouter = createRouter({
  create: adminQuery
    .input(
      z.object({
        plan: z.enum(["free", "pro"]),
        maxUses: z.number().int().min(1).max(1000).default(1),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .mutation(({ input }) => createInvite(input.plan, input.maxUses, input.expiresInDays)),

  list: adminQuery.query(() => listInvites()),

  deactivate: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deactivateInvite(input.id);
      return { ok: true };
    }),
});
