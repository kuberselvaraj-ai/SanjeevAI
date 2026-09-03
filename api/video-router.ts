import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PLANS } from "@contracts/constants";
import { createRouter, authedQuery } from "./middleware";
import { getMonthUsage, recordUsage } from "./queries/usage";
import { createVideo, minimaxConfigured, pollVideo } from "./services/minimax";
import {
  createFalVideo,
  falVideoConfigured,
  pollFalVideo,
} from "./services/fal-video";

const isFalVideo = (model: string) => model.startsWith("fal-ai/");

export const videoRouter = createRouter({
  create: authedQuery
    .input(
      z.object({
        prompt: z.string().min(1).max(3000),
        model: z.string().min(1),
        duration: z.number().int().min(1).max(30),
        resolution: z.string().min(1),
        ratio: z.string().optional(),
        firstFrameImage: z.string().max(8_000_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const fal = isFalVideo(input.model);
      if (fal ? !falVideoConfigured() : !minimaxConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: fal
            ? "This video model is not configured on the server yet — the site owner needs to add a fal.ai API key."
            : "Video generation is not configured on the server yet — the site owner needs to add a MiniMax API key.",
        });
      }
      if (ctx.user.role !== "admin") {
        const used = await getMonthUsage(ctx.user.id);
        const plan = PLANS[ctx.user.plan] ?? PLANS.free;
        if (used.videos >= plan.monthlyVideos) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Monthly video limit reached (${plan.monthlyVideos} on the ${plan.label} plan). Ask the admin to upgrade you to Pro.`,
          });
        }
      }
      const taskId = fal ? await createFalVideo(input) : await createVideo(input);
      await recordUsage({
        userId: ctx.user.id,
        kind: "video",
        model: input.model,
        inputTokens: 0,
        outputTokens: 0,
        videoCount: 1,
        note: `${input.duration}s ${input.resolution}`,
      });
      return { taskId };
    }),

  poll: authedQuery
    .input(z.object({ taskId: z.string().min(1), model: z.string().min(1) }))
    .mutation(({ input }) =>
      isFalVideo(input.model)
        ? pollFalVideo(input.taskId, input.model)
        : pollVideo(input.taskId, input.model),
    ),
});
