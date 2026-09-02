import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { codeConfigured, runPython } from "./services/code";

export const codeRouter = createRouter({
  /** Execute Python in a server-side E2B sandbox. */
  run: authedQuery
    .input(
      z.object({
        code: z.string().min(1).max(50_000),
        language: z.literal("python"),
      }),
    )
    .mutation(async ({ input }) => {
      if (!codeConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Code execution is not configured on the server yet — the site owner needs to add an E2B API key.",
        });
      }
      try {
        return await runPython(input.code);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Code execution failed.",
        });
      }
    }),
});
