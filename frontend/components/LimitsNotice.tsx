"use client";

import { usePolling } from "@/lib/api";

type Limits = {
  public_mode: boolean;
  admin: boolean;
  max_runs_per_launch: number;
  launches_per_hour: number | null;
  public_models: string[] | null;
  budget_enabled: boolean;
  budget_tokens?: number;
  spent_tokens?: number;
  remaining_tokens?: number;
};

export function useLimits() {
  return usePolling<Limits>("/limits", 30000, () => true).data;
}

/** Tells public visitors what they can run before they hit a limit. Renders nothing locally. */
export function LimitsNotice() {
  const l = useLimits();
  if (!l || (!l.public_mode && !l.budget_enabled)) return null;
  const pct = l.budget_enabled && l.budget_tokens ? Math.round((100 * (l.remaining_tokens ?? 0)) / l.budget_tokens) : null;
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs text-fg-2">
      {l.public_mode && !l.admin && (
        <>
          Public demo: up to <b className="text-fg">{l.max_runs_per_launch}</b> runs per launch, {l.launches_per_hour} launches per hour.{" "}
        </>
      )}
      {pct !== null && (
        <>
          Today&apos;s real-model budget: <b className={pct > 10 ? "text-fg" : "text-warning"}>{pct}% left</b>
          {pct === 0 && " (simulated runs still work)"}.
        </>
      )}
    </div>
  );
}
