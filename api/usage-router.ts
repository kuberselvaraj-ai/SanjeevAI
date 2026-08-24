import { PLANS } from "@contracts/constants";
import { createRouter, authedQuery } from "./middleware";
import { getMonthUsage } from "./queries/usage";

export const usageRouter = createRouter({
  /** Current user's plan + this month's consumption. */
  mine: authedQuery.query(async ({ ctx }) => {
    const used = await getMonthUsage(ctx.user.id);
    const unlimited = ctx.user.role === "admin";
    const plan = PLANS[ctx.user.plan] ?? PLANS.free;
    return {
      role: ctx.user.role,
      plan: ctx.user.plan,
      planLabel: plan.label,
      unlimited,
      limits: unlimited ? null : plan,
      used,
    };
  }),
});
