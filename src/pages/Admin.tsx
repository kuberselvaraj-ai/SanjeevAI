import { Link, useNavigate } from "react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
    </div>
  );
}
