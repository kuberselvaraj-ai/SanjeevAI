import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Zap } from "lucide-react";

interface BillingConfig {
  enabled: boolean;
  activation: number;
  tiers: { id: string; label: string; monthly: number }[];
}

const TIER_FEATURES: Record<string, string[]> = {
  solo: [
    "Unlimited chat & executive deck",
    "Memory that carries across threads",
    "Gmail, Calendar, Slack & Salesforce",
    "Cloud vault, web + desktop app",
  ],
  executive: [
    "Everything in Solo",
    "Premium-model council (Claude + GPT)",
    "Cross-device memory sync",
    "Priority support",
  ],
  concierge: [
    "Everything in Executive",
    "Monthly tuning session with the founder",
    "Done-for-you briefings & automations",
    "Direct line — same-day answers",
  ],
};

const TIER_BLURB: Record<string, string> = {
  solo: "For a founder running their own day.",
  executive: "For an exec who wants the sharpest model on call.",
  concierge: "For the principal who'd rather ask than configure.",
};

/**
 * Public pricing → Stripe Checkout. Renders from /api/billing/config so a
 * deployment without Stripe keys shows a contact fallback instead of a
 * broken paywall.
 */
export default function Pricing() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/billing/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setConfig)
      .catch(() => setFailed(true));
  }, []);

  const checkout = async (tier: string) => {
    setBusyTier(tier);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed — try again.");
      setBusyTier(null);
    }
  };

  const tiers = config?.tiers ?? [];
  const ready = Boolean(config?.enabled && tiers.length);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <button
          onClick={() => navigate("/login")}
          className="text-[13px] text-muted-foreground hover:text-foreground"
        >
          ← Back to sign in
        </button>

        <div className="mt-10 text-center">
          <h1 className="font-display text-4xl tracking-tight">
            Your AI chief of staff, set up for you
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-6 text-muted-foreground">
            Not another chat box — an action layer across your email, calendar,
            Slack and Salesforce, with memory that carries from thread to thread.
          </p>
        </div>

        {config?.activation ? (
          <div className="mx-auto mt-8 flex max-w-2xl items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 px-5 py-4">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[13.5px] leading-5">
              <span className="font-medium">
                One-time activation — ${config.activation}.
              </span>{" "}
              <span className="text-muted-foreground">
                White-glove onboarding: we connect your accounts, load your
                vault, tune your deck, and walk you through it live. Most
                clients are fully running the same day.
              </span>
            </p>
          </div>
        ) : null}

        {!config && !failed && (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {ready && (
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {tiers.map((t) => {
              const featured = t.id === "executive";
              return (
                <div
                  key={t.id}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    featured
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card"
                  }`}
                >
                  {featured && (
                    <span className="mb-3 w-fit rounded-full border border-primary/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                      Most chosen
                    </span>
                  )}
                  <h2 className="font-display text-xl">{t.label}</h2>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    {TIER_BLURB[t.id]}
                  </p>
                  <p className="mt-4">
                    <span className="font-display text-4xl">${t.monthly}</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {(TIER_FEATURES[t.id] ?? []).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] leading-5">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-6 w-full"
                    variant={featured ? "default" : "outline"}
                    size="lg"
                    disabled={busyTier !== null}
                    onClick={() => checkout(t.id)}
                  >
                    {busyTier === t.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      `Start with ${t.label}`
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {(failed || (config && !ready)) && (
          <div className="mx-auto mt-12 max-w-md rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-[15px] font-medium">Founding-client onboarding</p>
            <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
              We're onboarding clients personally right now. Reach out and we'll
              set up a demo and your activation.
            </p>
            <Button
              className="mt-5"
              size="lg"
              onClick={() => {
                window.location.href = "mailto:hello@sanjeevai.com?subject=SanjeevAI%20demo";
              }}
            >
              Book a demo
            </Button>
          </div>
        )}

        {error && (
          <p className="mx-auto mt-6 max-w-md rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-center text-[13px] text-destructive">
            {error}
          </p>
        )}

        <p className="mt-10 text-center text-[12px] text-muted-foreground">
          Annual billing available on onboarding — two months free. Cancel
          anytime; your data exports with you.
        </p>
      </div>
    </div>
  );
}
