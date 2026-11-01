"use client";

import type { ReactNode } from "react";
import { DEFENSE_LABEL, DEFENSE_ORDER, pct, type Comparison, type ModelInfo, type ScenarioSummary } from "@/lib/api";
import { DefenseActivityChart, fmtPP, OutcomeMatrix, TradeoffChart } from "./Charts";
import { Badge, Card, RateText, SimulatedBadge } from "./ui";

export function ConditionsTable({ comparison, model }: { comparison: Comparison; model: string }) {
  const rows = comparison.conditions
    .filter((c) => c.model === model)
    .sort((a, b) => DEFENSE_ORDER.indexOf(a.defense) - DEFENSE_ORDER.indexOf(b.defense));
  const hasBaseline = rows.some((c) => c.defense === "none");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Defense</th>
            <th className="py-2 pr-3 font-medium">Attack success ↓</th>
            <th className="py-2 pr-3 font-medium">Δ vs baseline</th>
            <th className="py-2 pr-3 font-medium">Hijack attempts</th>
            <th className="py-2 pr-3 font-medium">Task success ↑</th>
            <th className="py-2 pr-3 font-medium">Benign controls ↑</th>
            <th className="py-2 pr-3 font-medium">Utility retention</th>
            <th className="py-2 pr-3 font-medium" title="Calls blocked per layer, plus injected instructions the content scanner removed before the agent read them">Defense activity</th>
            <th className="py-2 pr-3 font-medium" title="Calls outside session permissions that executed. Must be 0.">Unauth. exec</th>
            <th className="py-2 font-medium">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.defense} className="border-b border-line/60 align-top">
              <td className="py-2 pr-3 font-medium text-fg">{DEFENSE_LABEL[c.defense] ?? c.defense}</td>
              <td className="py-2 pr-3"><RateText r={c.attack_success} /></td>
              <td className="py-2 pr-3 tabular text-fg-2">{c.vs_baseline ? fmtPP(c.vs_baseline.attack_success_reduction_pp) : <span className="text-muted">{c.defense === "none" ? "reference" : hasBaseline ? "–" : "no baseline run"}</span>}</td>
              <td className="py-2 pr-3"><RateText r={c.hijack_attempt} /></td>
              <td className="py-2 pr-3"><RateText r={c.task_success} /></td>
              <td className="py-2 pr-3"><RateText r={c.benign_task_success} /></td>
              <td className="py-2 pr-3 tabular text-fg-2">
                {c.vs_baseline ? (c.vs_baseline.utility_retention === null ? "undefined" : pct(c.vs_baseline.utility_retention)) : "–"}
              </td>
              <td className="py-2 pr-3">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(c.blocked_by).map(([layer, n]) => (
                    <Badge key={layer} title={`${n} call(s) blocked by ${layer}`}>{layer} blocked · {n}</Badge>
                  ))}
                  {!!c.injections_removed && (
                    <Badge tone="good" title="Untrusted sources where the scanner removed injected instructions before the agent read them">
                      scanner removed · {c.injections_removed}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="py-2 pr-3 tabular">
                {c.unauthorized_executions === 0 ? <span className="text-good-text">✓ 0</span> : <span className="text-critical-text">✕ {c.unauthorized_executions}</span>}
              </td>
              <td className="py-2 tabular text-fg-2">{c.error_rate.k}/{c.error_rate.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        Rates show k/n and a 95% Wilson interval. Δ is percentage points of attack success removed relative to the baseline on the same model.
        Small samples are preliminary.
      </p>
    </div>
  );
}

/** Deterministic, data-derived sentences. Every number traces to the comparison payload. */
export function Findings({ comparison, model, scenarios }: { comparison: Comparison; model: string; scenarios: ScenarioSummary[] }) {
  const conds = comparison.conditions.filter((c) => c.model === model);
  const base = conds.find((c) => c.defense === "none");
  const defended = conds.filter((c) => c.defense !== "none" && c.attack_success.rate !== null);
  const L = (d: string) => DEFENSE_LABEL[d] ?? d;
  const items: { tone: "good" | "critical" | "neutral"; text: ReactNode }[] = [];

  if (base && base.attack_success.rate !== null) {
    items.push(base.attack_success.rate > 0
      ? {
          tone: "critical",
          text: <>Without an extra defense, attacks succeeded in <b>{pct(base.attack_success.rate)}</b> of attack runs ({base.attack_success.k}/{base.attack_success.n}), even with the permission gateway on: these attacks use only tools the agent is allowed to call.</>,
        }
      : {
          tone: "good",
          text: <>With no defense layer at all, the model resisted every attack: <b>0/{base.attack_success.n}</b> succeeded, and it attempted an attacker action in {base.hijack_attempt.k}/{base.hijack_attempt.n} runs.</>,
        });
  }
  const bySec = [...defended].sort((a, b) => a.attack_success.rate! - b.attack_success.rate! || (b.task_success.rate ?? 0) - (a.task_success.rate ?? 0));
  const best = bySec[0];
  if (best && base && base.attack_success.rate !== null && best.attack_success.rate! < base.attack_success.rate) {
    items.push({
      tone: "good",
      text: <><b>{L(best.defense)}</b> had the lowest attack success, <b>{pct(best.attack_success.rate)}</b> ({best.vs_baseline?.attack_success_reduction_pp ?? "–"} pp below baseline), while keeping task success at {pct(best.task_success.rate)}.</>,
    });
  }
  const benignWorst = [...defended].filter((c) => c.benign_task_success.rate !== null).sort((a, b) => a.benign_task_success.rate! - b.benign_task_success.rate!)[0];
  if (benignWorst && base?.benign_task_success.rate != null && benignWorst.benign_task_success.rate! < base.benign_task_success.rate) {
    items.push({
      tone: "critical",
      text: <><b>{L(benignWorst.defense)}</b> had the biggest utility cost: it completed only <b>{pct(benignWorst.benign_task_success.rate)}</b> of benign control tasks vs {pct(base.benign_task_success.rate)} at baseline. Security that blocks legitimate work is not free.</>,
    });
  }
  if (best && best.hijack_attempt.rate) {
    items.push({
      tone: "neutral",
      text: <>Even under {L(best.defense)}, the agent still <i>attempted</i> attacker actions in {pct(best.hijack_attempt.rate)} of attack runs. Defenses contained the attempts; they did not make the model immune.</>,
    });
  }
  const cells = comparison.matrix.filter((c) => c.model === model && !c.benign && c.defense !== "none" && c.valid);
  const leak = new Map<string, number>();
  cells.forEach((c) => leak.set(c.scenario_id, (leak.get(c.scenario_id) ?? 0) + c.attack_success));
  const hardest = [...leak.entries()].sort((a, b) => b[1] - a[1])[0];
  if (hardest && hardest[1] > 0) {
    const title = scenarios.find((s) => s.id === hardest[0])?.title ?? hardest[0];
    items.push({ tone: "neutral", text: <>Hardest scenario for defenses: <b>{title}</b> ({hardest[1]} successful attacks across all defended conditions).</> });
  }
  const scanners = conds.filter((c) => (c.injections_removed ?? 0) > 0);
  for (const c of scanners) {
    items.push({
      tone: "good",
      text: <><b>{L(c.defense)}</b> removed injected instructions <b>{c.injections_removed}</b> times before the agent read them, and the agent still completed {c.task_success.k}/{c.task_success.n} tasks.</>,
    });
  }
  for (const c of conds.filter((x) => x.defense !== "none" && x.legit_calls_denied > 0)) {
    const lost = c.task_success.n - c.task_success.k;
    items.push(lost
      ? { tone: "critical", text: <><b>{L(c.defense)}</b> blocked {c.legit_calls_denied} legitimate action(s) and lost {lost} of {c.task_success.n} tasks.</> }
      : { tone: "neutral", text: <>{L(c.defense)} blocked {c.legit_calls_denied} legitimate action(s), but the agent recovered every time and completed all {c.task_success.n} tasks.</> });
  }
  if (!base) {
    const attempts = conds.reduce((n, c) => n + c.hijack_attempt.k, 0);
    const nAttack = conds.reduce((n, c) => n + c.hijack_attempt.n, 0);
    items.unshift({
      tone: attempts ? "critical" : "good",
      text: <>The model attempted attacker actions in <b>{attempts}</b> of {nAttack} defended attack runs. This experiment has no baseline condition, so compare defenses with each other.</>,
    });
  }
  const unauth = conds.reduce((n, c) => n + c.unauthorized_executions, 0);
  const gw = conds.reduce((n, c) => n + (c.blocked_by.gateway ?? 0), 0);
  items.push({
    tone: unauth === 0 ? "good" : "critical",
    text: <>The independent gateway denied <b>{gw}</b> out-of-permission or malformed calls; unauthorized executions: <b>{unauth}</b>.</>,
  });

  return (
    <ul className="space-y-3 text-sm text-fg-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className={it.tone === "good" ? "text-good-text" : it.tone === "critical" ? "text-critical-text" : "text-muted"}>
            {it.tone === "good" ? "✓" : it.tone === "critical" ? "✕" : "•"}
          </span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Results({ comparison, scenarios, models }: { comparison: Comparison; scenarios: ScenarioSummary[]; models: ModelInfo[] }) {
  const modelIds = [...new Set(comparison.conditions.map((c) => c.model))];
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  return (
    <div className="space-y-6">
      {modelIds.map((m) => {
        const conds = comparison.conditions.filter((c) => c.model === m);
        const defenses = DEFENSE_ORDER.filter((d) => conds.some((c) => c.defense === d));
        const simulated = conds.some((c) => c.simulated);
        return (
          <div key={m} className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{label(m)}</h2>
              {simulated && <SimulatedBadge />}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Security vs. utility">
                <TradeoffChart conditions={conds} />
              </Card>
              <Card title="Findings" action={<span className="text-[11px] text-muted">generated from persisted runs, no LLM</span>}>
                <Findings comparison={comparison} model={m} scenarios={scenarios} />
              </Card>
            </div>
            <Card title="Defense activity: what each layer actually did">
              <DefenseActivityChart conditions={conds} />
            </Card>
            <Card title="Paired comparison">
              <ConditionsTable comparison={comparison} model={m} />
            </Card>
            <Card title="Per-scenario outcomes">
              <OutcomeMatrix cells={comparison.matrix.filter((c) => c.model === m)} scenarios={scenarios} defenses={defenses} />
            </Card>
          </div>
        );
      })}
    </div>
  );
}
