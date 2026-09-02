export const Session = {
  cookieName: "kimi_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
} as const;

/** Monthly usage allowances per plan. Admin role bypasses these entirely. */
export const PLANS = {
  free: { label: "Free", monthlyTokens: 500_000, monthlyVideos: 3, monthlyImages: 10 },
  pro: { label: "Pro", monthlyTokens: 8_000_000, monthlyVideos: 30, monthlyImages: 100 },
} as const;

export type PlanId = keyof typeof PLANS;
