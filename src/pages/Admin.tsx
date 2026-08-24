import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, ShieldCheck, Copy, Check, Ticket, Ban } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { PLANS } from "@contracts/constants";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function Admin() {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const utils = trpc.useUtils();

  const usersQuery = trpc.admin.listUsers.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    retry: false,
  });

  const setPlan = trpc.admin.setPlan.useMutation({
    onSuccess: () => utils.admin.listUsers.invalidate(),
  });

  // ----- invite codes -----
  const invitesQuery = trpc.invite.list.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    retry: false,
  });
  const [newPlan, setNewPlan] = useState<"free" | "pro">("pro");
  const [newMaxUses, setNewMaxUses] = useState(1);
  const [newExpiry, setNewExpiry] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const createInvite = trpc.invite.create.useMutation({
    onSuccess: () => utils.invite.list.invalidate(),
  });
  const deactivateInvite = trpc.invite.deactivate.useMutation({
    onSuccess: () => utils.invite.list.invalidate(),
  });

  const copyCode = (id: number, code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm">
        <p className="text-muted-foreground">Admins only.</p>
        <button
          onClick={() => navigate("/")}
          className="text-primary underline underline-offset-2"
        >
          Back to the app
        </button>
      </div>
    );
  }

  const users = usersQuery.data ?? [];

  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
          title="Back to the app"
        >
          <ArrowLeft size={17} />
        </Link>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <ShieldCheck size={20} className="text-primary" />
          Admin · Users & usage
        </h1>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Usage resets on the 1st of each month (UTC). Free: {fmt(PLANS.free.monthlyTokens)}{" "}
        tokens + {PLANS.free.monthlyVideos} videos · Pro: {fmt(PLANS.pro.monthlyTokens)} tokens +{" "}
        {PLANS.pro.monthlyVideos} videos.
      </p>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Tokens (month)</th>
              <th className="px-4 py-3 font-medium">Videos (month)</th>
              <th className="px-4 py-3 font-medium">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <span className="block font-medium">{u.name || "—"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {u.email || u.unionId}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      u.role === "admin"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.plan}
                    disabled={setPlan.isPending}
                    onChange={(e) =>
                      setPlan.mutate({
                        userId: u.id,
                        plan: e.target.value as "free" | "pro",
                      })
                    }
                    className="rounded-lg border border-input bg-background px-2 py-1.5 text-[13px] outline-none"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                  </select>
                </td>
                <td className="px-4 py-3 tabular-nums">{fmt(u.monthTokens)}</td>
                <td className="px-4 py-3 tabular-nums">{u.monthVideos}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(u.lastSignInAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Invite codes */}
      <div className="mt-10">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
          <Ticket size={18} className="text-primary" />
          Invite codes
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Signup is invite-only. Hand a <strong>Pro</strong> code to friends you want on the Pro
          plan free of charge; a <strong>Free</strong> code grants the free tier.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-2xl border border-border bg-card p-4">
          <select
            value={newPlan}
            onChange={(e) => setNewPlan(e.target.value as "free" | "pro")}
            className="rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
          >
            <option value="pro">Pro plan</option>
            <option value="free">Free plan</option>
          </select>
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Uses
            <input
              type="number"
              min={1}
              max={1000}
              value={newMaxUses}
              onChange={(e) => setNewMaxUses(Number(e.target.value) || 1)}
              className="w-20 rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            Days valid
            <input
              type="number"
              min={1}
              max={365}
              value={newExpiry}
              placeholder="∞"
              onChange={(e) => setNewExpiry(e.target.value)}
              className="w-20 rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] outline-none"
            />
          </label>
          <button
            onClick={() =>
              createInvite.mutate({
                plan: newPlan,
                maxUses: newMaxUses,
                expiresInDays: newExpiry ? Number(newExpiry) : undefined,
              })
            }
            disabled={createInvite.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {createInvite.isPending ? "Generating…" : "Generate code"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Uses</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(invitesQuery.data ?? []).map((inv) => {
                const exhausted = inv.usedCount >= inv.maxUses;
                const expired = !!inv.expiresAt && new Date(inv.expiresAt) < new Date();
                const live = inv.active && !exhausted && !expired;
                return (
                  <tr key={inv.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-mono-code text-[13px] tracking-wider">
                      {inv.code}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          inv.plan === "pro"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {inv.plan === "pro" ? "Pro" : "Free"}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {inv.usedCount} / {inv.maxUses}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {live ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Active</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {!inv.active ? "Deactivated" : exhausted ? "Used up" : "Expired"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => copyCode(inv.id, inv.code)}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Copy code"
                        >
                          {copiedId === inv.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        {inv.active && (
                          <button
                            onClick={() => deactivateInvite.mutate({ id: inv.id })}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                            title="Deactivate"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(invitesQuery.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No codes yet — generate one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
