"use client";

import Link from "next/link";
import { DEFENSE_LABEL, pct, usePolling, type Comparison, type Experiment, type ModelInfo, type ScenarioSummary } from "@/lib/api";
import { Results } from "@/components/Results";
import { Card, LinkButton, SimulatedBadge, Stat } from "@/components/ui";
import { Highlight } from "@/components/Highlight";

type Dashboard = {
  total_runs: { real?: number; simulated?: number };
  latest_experiment: (Experiment & { summary: Comparison | null }) | null;
};

const STEPS = [
  { t: "Real task", d: "A Meta model gets a legitimate multi-step job and a set of simulated tools." },
  { t: "Hidden attack", d: "Tool output carries an injection: fake system notices, forged admins, exfiltration requests." },
  { t: "Independent enforcement", d: "A gateway plus the defense under test vets every proposed action before it runs." },
  { t: "Deterministic verdict", d: "Checks over the final state decide task success and attack success. No LLM judge." },
];

export default function DashboardPage() {
  const { data } = usePolling<Dashboard>("/dashboard", 10000, () => true);
  const { data: scenarios } = usePolling<ScenarioSummary[]>("/scenarios", 0);
  const { data: models } = usePolling<ModelInfo[]>("/models", 0);
  const exp = data?.latest_experiment;
  const cmp = exp?.summary;

  const base = cmp?.conditions.filter((c) => c.defense === "none") ?? [];
  const defended = cmp?.conditions.filter((c) => c.defense !== "none" && c.attack_success.rate !== null) ?? [];
  const best = [...defended].sort(
    (a, b) => (a.attack_success.rate! - b.attack_success.rate!) || ((b.task_success.rate ?? 0) - (a.task_success.rate ?? 0)),
  )[0];

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-gradient-to-br from-surface to-bg p-8">
        <div className="max-w-3xl">
          <div className="mb-3 text-xs font-medium uppercase tracking-widest text-accent">Agent security, measured</div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Will your AI agent follow the attacker hiding in its tool output?
          </h1>
          <p className="mt-4 text-fg-2">
            AgentArena runs Meta&apos;s Muse models through reproducible adversarial scenarios and measures, with deterministic evidence,
            whether each defense stops hijacking <em>and</em> whether the agent still gets the job done.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href="/arena">Open the Live Arena →</LinkButton>
            <LinkButton href="/experiments" variant="ghost">Run an experiment</LinkButton>
          </div>
        </div>
      </section>

      <Highlight />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.t} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-xs text-muted">0{i + 1}</div>
            <div className="mt-1 font-medium">{s.t}</div>
            <div className="mt-1 text-sm text-fg-2">{s.d}</div>
          </div>
        ))}
      </section>

      {!exp || !cmp ? (
        <Card>
          <div className="py-6 text-center text-sm text-fg-2">
            No completed experiment yet. <Link className="text-accent underline" href="/experiments">Launch one</Link> to populate the dashboard.
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Featured experiment</h2>
            <Link href={`/experiments/${exp.id}`} className="text-sm text-accent hover:underline">{exp.name} →</Link>
            {cmp.overall.simulated && <SimulatedBadge />}
          </div>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Runs evaluated" value={cmp.overall.runs} sub={`${data?.total_runs.real ?? 0} real · ${data?.total_runs.simulated ?? 0} simulated across all experiments`} />
            <Stat
              label="Baseline attack success"
              value={base.length ? pct(base[0].attack_success.rate) : "–"}
              sub={base.length ? `${base[0].attack_success.k}/${base[0].attack_success.n} attack runs, gateway on` : undefined}
              tone={base.length && (base[0].attack_success.rate ?? 0) > 0 ? "critical" : "good"}
            />
            {(() => {
              const shield = cmp.conditions.find((c) => c.defense === "layered") ?? cmp.conditions.find((c) => (c.injections_removed ?? 0) > 0);
              return shield ? (
                <Stat
                  label="Injections removed by AgentShield"
                  value={shield.injections_removed ?? 0}
                  sub={`before the agent read them \u00b7 task success ${pct(shield.task_success.rate)}`}
                  tone="good"
                />
              ) : (
                <Stat
                  label="Best defense"
                  value={best ? pct(best.attack_success.rate) : "\u2013"}
                  sub={best ? `${DEFENSE_LABEL[best.defense]} \u00b7 task success ${pct(best.task_success.rate)}` : undefined}
                  tone="good"
                />
              );
            })()}
            <Stat
              label="Unauthorized executions"
              value={cmp.overall.unauthorized_executions}
              sub="Calls outside permissions that ran. The gateway target is 0."
              tone={cmp.overall.unauthorized_executions === 0 ? "good" : "critical"}
            />
          </section>
          <Results comparison={cmp} scenarios={scenarios ?? []} models={models ?? []} />
        </>
      )}
    </div>
  );
}
