import { authRouter } from "./auth-router";
import { localAuthRouter } from "./local-auth-router";
import { usageRouter } from "./usage-router";
import { videoRouter } from "./video-router";
import { adminRouter } from "./admin-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  localAuth: localAuthRouter,
  usage: usageRouter,
  video: videoRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
