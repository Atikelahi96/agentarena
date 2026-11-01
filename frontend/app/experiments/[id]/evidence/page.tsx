"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  DEFENSE_LABEL, DEFENSE_ORDER, pct, usePolling,
  type ExperimentDetail, type Frameworks, type ModelInfo, type ScenarioSummary,
} from "@/lib/api";
import { ConditionsTable, Findings } from "@/components/Results";
import { Button, SimulatedBadge } from "@/components/ui";

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-line pt-6">
      <h2 className="mb-3 text-lg font-semibold">
        <span className="mr-2 text-muted">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const { data: exp } = usePolling<ExperimentDetail>(`/experiments/${id}`, 0);
  const { data: scenarios } = usePolling<ScenarioSummary[]>("/scenarios", 0);
  const { data: models } = usePolling<ModelInfo[]>("/models", 0);
  const { data: fw } = usePolling<Frameworks>("/frameworks", 0);

  if (!exp || !scenarios || !fw) return <div className="py-16 text-center text-sm text-muted">Loading report…</div>;

  const cmp = exp.comparison;
  const inExp = scenarios.filter((s) => exp.config.scenario_ids.includes(s.id));
  const modelIds = [...new Set(cmp.conditions.map((c) => c.model))];
  const modelLabel = (m: string) => models?.find((x) => x.id === m)?.label ?? m;
  const defenses = DEFENSE_ORDER.filter((d) => exp.config.defenses.includes(d));

  // Risk coverage: aggregate attack success over the scenarios tagged with each risk.
  const riskIds = [...new Set(inExp.flatMap((s) => Object.values(s.frameworks ?? {}).flat()))].sort();
  const riskRate = (risk: string, model: string, defense: string) => {
    const sids = new Set(inExp.filter((s) => Object.values(s.frameworks ?? {}).flat().includes(risk)).map((s) => s.id));
    const cells = cmp.matrix.filter((c) => c.model === model && c.defense === defense && sids.has(c.scenario_id) && !c.benign);
    const k = cells.reduce((a, c) => a + c.attack_success, 0);
    const n = cells.reduce((a, c) => a + c.valid, 0);
    return { k, n, rate: n ? k / n : null };
  };

  return (
    <article className="mx-auto max-w-5xl space-y-8 print:max-w-none print:text-black">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-widest text-accent">AgentArena · Agent security evidence report</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{exp.name}</h1>
          <p className="mt-2 text-sm text-fg-2">
            Experiment <span className="font-mono">{exp.id}</span> · started {new Date(exp.created_at).toLocaleString()}
            {exp.finished_at && <> · finished {new Date(exp.finished_at).toLocaleString()}</>} · status {exp.status}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={`/experiments/${id}`} className="rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-surface-3">← Results</Link>
          <a href={`/api/experiments/${id}/report`} className="rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-surface-3">⤓ JSON</a>
          <Button onClick={() => window.print()}>Print / PDF</Button>
        </div>
      </div>

      {cmp.overall.simulated && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <SimulatedBadge /> Some runs in this experiment use the scripted simulated agent. Those results validate the pipeline and are not model measurements.
        </div>
      )}

      <Section n={1} title="Scope">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Models under test</dt><dd>{exp.config.models.map(modelLabel).join(", ")}</dd></div>
          <div><dt className="text-muted">Defense conditions</dt><dd>{defenses.map((d) => DEFENSE_LABEL[d] ?? d).join(", ")}</dd></div>
          <div><dt className="text-muted">Scenarios</dt><dd>{inExp.length} ({inExp.filter((s) => !s.benign).length} adversarial, {inExp.filter((s) => s.benign).length} benign controls)</dd></div>
          <div><dt className="text-muted">Runs / repeats</dt><dd>{cmp.overall.runs} runs · {exp.config.repeats} repeats per condition · {cmp.overall.error_rate.k} errors</dd></div>
          <div><dt className="text-muted">Audit trail</dt><dd>{exp.event_count.toLocaleString()} ordered trace events persisted</dd></div>
          <div><dt className="text-muted">Tokens consumed</dt><dd>{cmp.overall.total_tokens.toLocaleString()}</dd></div>
        </dl>
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-muted"><tr className="border-b border-line"><th className="py-1.5 pr-3 font-medium">Scenario</th><th className="py-1.5 pr-3 font-medium">Version</th><th className="py-1.5 pr-3 font-medium">Category</th><th className="py-1.5 font-medium">Attacker objective</th></tr></thead>
          <tbody>
            {inExp.map((s) => (
              <tr key={s.id} className="border-b border-line/60 align-top">
                <td className="py-1.5 pr-3">{s.title}<div className="font-mono text-[10px] text-muted">{s.id}</div></td>
                <td className="py-1.5 pr-3 font-mono">{s.version}</td>
                <td className="py-1.5 pr-3">{s.category}</td>
                <td className="py-1.5 text-fg-2">{s.benign ? "— benign control (measures over-blocking)" : s.attack_objective}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section n={2} title="Key findings">
        <div className="space-y-5">
          {modelIds.map((m) => (
            <div key={m}>
              {modelIds.length > 1 && <h3 className="mb-2 font-medium">{modelLabel(m)}</h3>}
              <Findings comparison={cmp} model={m} scenarios={scenarios} />
            </div>
          ))}
        </div>
      </Section>

      <Section n={3} title="Risk coverage (OWASP LLM 2025, OWASP Agentic 2026, MITRE ATLAS)">
        {modelIds.map((m) => (
          <div key={m} className="mb-4 overflow-x-auto">
            {modelIds.length > 1 && <h3 className="mb-2 font-medium">{modelLabel(m)}</h3>}
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 pr-3 font-medium">Risk</th>
                  {defenses.map((d) => <th key={d} className="py-1.5 pr-3 text-right font-medium">{DEFENSE_LABEL[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {riskIds.map((r) => (
                  <tr key={r} className="border-b border-line/60">
                    <td className="py-1.5 pr-3">
                      <span className="font-mono">{r}</span> {fw.risks[r]?.title}
                      <div className="text-[10px] text-muted">{fw.risks[r]?.framework}</div>
                    </td>
                    {defenses.map((d) => {
                      const v = riskRate(r, m, d);
                      return (
                        <td key={d} className="py-1.5 pr-3 text-right tabular">
                          {v.rate === null ? "–" : <><span className={v.k ? "text-critical-text" : "text-good-text"}>{pct(v.rate)}</span> <span className="text-muted">{v.k}/{v.n}</span></>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">Cells: attack success rate across adversarial runs of the scenarios mapped to that risk (lower is better).</p>
          </div>
        ))}
      </Section>

      <Section n={4} title="Defense comparison">
        {modelIds.map((m) => (
          <div key={m} className="mb-4">
            {modelIds.length > 1 && <h3 className="mb-2 font-medium">{modelLabel(m)}</h3>}
            <ConditionsTable comparison={cmp} model={m} />
          </div>
        ))}
      </Section>

      <Section n={5} title="Governance evidence">
        <table className="w-full text-left text-sm">
          <tbody>
            {fw.governance.map((g) => (
              <tr key={g.ref} className="border-b border-line/60 align-top">
                <td className="w-56 py-2 pr-4"><div className="font-medium">{g.ref}</div><div className="text-xs text-muted">{g.title}</div></td>
                <td className="py-2 text-fg-2">{g.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          These results are evidence for the tested configuration only. They do not certify compliance with any regulation or standard.
        </p>
      </Section>

      <Section n={6} title="Methodology">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-2">
          <li>Paired design: within a model, every defense condition runs the same task, initial state, attack payload, tool surface and hard permission gateway. Only the defense layer changes.</li>
          <li>Scoring is deterministic: checks over the final simulated state, final answer and executed tool calls. No LLM acts as judge.</li>
          <li>Attack success = the predefined attacker objective was achieved. Hijack attempt = the agent proposed an attacker-serving or out-of-permission call, whether or not it executed. Unauthorized execution = an out-of-permission call executed (expected 0).</li>
          <li>Model errors, timeouts and malformed responses are recorded as errors and never counted as successful defenses.</li>
          <li>Rates carry 95% Wilson score intervals. Defense improvement is reported in percentage points against the baseline on the same model.</li>
        </ul>
      </Section>

      <Section n={7} title="Limitations">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-2">
          <li>A small, fixed scenario suite cannot establish general agent safety; defenses can be overfit to known scenarios.</li>
          <li>Model behavior varies between runs; small samples are preliminary and should not be read as statistically significant.</li>
          <li>Results for one model and configuration do not transfer automatically to others.</li>
          <li>A gateway denial proves enforcement worked, not that the model reasoned safely; hijack-attempt rates are reported for that reason.</li>
          <li>All tools, data and recipients are synthetic; no real systems or personal data were involved.</li>
        </ul>
      </Section>
    </article>
  );
}
