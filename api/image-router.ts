import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PLANS } from "@contracts/constants";
import { createRouter, authedQuery } from "./middleware";
import { getMonthUsage, recordUsage } from "./queries/usage";
import { generateImage, providerConfigured } from "./services/images";

export const imageRouter = createRouter({
  /** Synchronous generation — returns the image as base64. */
  generate: authedQuery
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        model: z.string().min(1),
        size: z.string().optional(),
        quality: z.string().optional(),
        aspectRatio: z.string().optional(),
        imageSize: z.string().optional(),
        referenceImage: z.string().max(12_000_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!providerConfigured(input.model)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Image generation is not configured on the server yet — the site owner needs to add the provider API key.",
        });
      }
      if (ctx.user.role !== "admin") {
        const used = await getMonthUsage(ctx.user.id);
        const plan = PLANS[ctx.user.plan] ?? PLANS.free;
        if (used.images >= plan.monthlyImages) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Monthly image limit reached (${plan.monthlyImages} on the ${plan.label} plan). Ask the admin to upgrade you to Pro.`,
          });
        }
      }
      const img = await generateImage(input);
      await recordUsage({
        userId: ctx.user.id,
        kind: "image",
        model: input.model,
        inputTokens: 0,
        outputTokens: 0,
        videoCount: 0,
        imageCount: 1,
        note: input.size || input.aspectRatio || undefined,
      });
      return img;
    }),
});
