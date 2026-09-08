import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";

/**
 * Stripe billing — the money path:
 *   /#/pricing → POST /api/billing/checkout → Stripe Checkout
 *   → webhook (checkout.session.completed) plants a paid_signups row
 *   → buyer lands back on /#/login?paid=cs_… and claims it with a password.
 * Subscription lifecycle events keep users.plan in sync (cancel → free).
 *
 * Env (all optional — billing is simply "off" without them):
 *   STRIPE_SECRET_KEY          sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET      whsec_… for the endpoint below
 *   STRIPE_PRICE_SOLO          recurring price id (price_…)
 *   STRIPE_PRICE_EXECUTIVE     recurring price id
 *   STRIPE_PRICE_CONCIERGE     recurring price id
 *   STRIPE_PRICE_ACTIVATION    one-time price id (the setup fee)
 *   APP_BASE_URL               https://… used for success/cancel URLs
 */

export const BILLING_TIERS = {
  solo: { label: "Solo", monthly: 49, priceEnv: "STRIPE_PRICE_SOLO" },
  executive: { label: "Executive", monthly: 99, priceEnv: "STRIPE_PRICE_EXECUTIVE" },
  concierge: { label: "Concierge", monthly: 199, priceEnv: "STRIPE_PRICE_CONCIERGE" },
} as const;

export type BillingTier = keyof typeof BILLING_TIERS;

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function priceIdFor(tier: BillingTier): string | undefined {
  return process.env[BILLING_TIERS[tier].priceEnv];
}

/** Billing is "on" when we can actually create a checkout session. */
function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && priceIdFor("solo"));
}

function baseUrl(c: { req: { header: (name: string) => string | undefined } }): string {
  const configured = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  const origin = c.req.header("origin");
  if (origin) return origin.replace(/\/+$/, "");
  return "http://localhost:3000";
}

async function recordPaidSignup(session: Stripe.Checkout.Session) {
  const email = session.customer_details?.email?.trim().toLowerCase();
  if (!email) return;
  const tier = (session.metadata?.tier ?? "solo") as string;
  const values = {
    sessionId: session.id,
    email,
    tier: tier in BILLING_TIERS ? tier : "solo",
    stripeCustomerId:
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
    stripeSubscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
  };
  // Idempotent — Stripe retries webhooks; never clobber a claimed row.
  await getDb()
    .insert(schema.paidSignups)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        email: values.email,
        tier: values.tier,
        stripeCustomerId: values.stripeCustomerId,
        stripeSubscriptionId: values.stripeSubscriptionId,
        amountTotal: values.amountTotal,
        currency: values.currency,
      },
    });
}

async function syncSubscription(sub: Stripe.Subscription) {
  const active = sub.status === "active" || sub.status === "trialing";
  await getDb()
    .update(schema.users)
    .set({
      plan: active ? "pro" : "free",
      subscriptionStatus: sub.status,
      ...(typeof sub.metadata?.tier === "string" && active
        ? { subscriptionTier: sub.metadata.tier }
        : {}),
    })
    .where(eq(schema.users.stripeSubscriptionId, sub.id));
}

export function registerBillingRoutes(app: Hono<{ Bindings: HttpBindings }>) {
  /** What the pricing page needs to render. */
  app.get("/api/billing/config", (c) =>
    c.json({
      enabled: billingEnabled(),
      activation: process.env.STRIPE_PRICE_ACTIVATION ? 199 : 0,
      tiers: (Object.keys(BILLING_TIERS) as BillingTier[])
        .filter((t) => priceIdFor(t))
        .map((t) => ({
          id: t,
          label: BILLING_TIERS[t].label,
          monthly: BILLING_TIERS[t].monthly,
        })),
    }),
  );

  /** Kick off Stripe Checkout for a tier. Returns the URL to redirect to. */
  app.post("/api/billing/checkout", async (c) => {
    const stripe = stripeClient();
    if (!stripe || !billingEnabled()) {
      return c.json({ error: "Billing is not configured on this deployment." }, 503);
    }
    let tier: BillingTier;
    try {
      const body = (await c.req.json()) as { tier?: string };
      if (!body.tier || !(body.tier in BILLING_TIERS)) throw new Error("bad tier");
      tier = body.tier as BillingTier;
    } catch {
      return c.json({ error: "Unknown tier." }, 400);
    }
    const price = priceIdFor(tier);
    if (!price) return c.json({ error: "That tier is not available yet." }, 400);

    const base = baseUrl(c);
    const activation = process.env.STRIPE_PRICE_ACTIVATION;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          { price, quantity: 1 },
          // One-time activation fee rides the first invoice of the subscription.
          ...(activation ? [{ price: activation, quantity: 1 }] : []),
        ],
        success_url: `${base}/#/login?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/#/pricing`,
        metadata: { tier },
        subscription_data: { metadata: { tier } },
        allow_promotion_codes: true,
      });
      return c.json({ url: session.url });
    } catch (err) {
      console.error("[billing] checkout failed", err);
      return c.json({ error: "Could not start checkout — try again." }, 502);
    }
  });

  /**
   * Stripe webhook. Must read the RAW body for signature verification —
   * do not route this through any JSON-parsing middleware.
   */
  app.post("/api/billing/webhook", async (c) => {
    const stripe = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) {
      return c.json({ error: "Billing is not configured on this deployment." }, 503);
    }
    const payload = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? "";
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }
    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.payment_status === "paid") {
          await recordPaidSignup(session);
        }
      } else if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await syncSubscription(event.data.object as Stripe.Subscription);
      }
    } catch (err) {
      // 500 so Stripe retries rather than dropping the event.
      console.error(`[billing] webhook ${event.type} failed`, err);
      return c.json({ error: "Webhook handling failed" }, 500);
    }
    return c.json({ received: true });
  });
}
