"use client";

import Link from "next/link";
import { DEFENSE_LABEL, pct, usePolling } from "@/lib/api";

type Shield = { defense: string; successes: number; runs: number; injections_removed: number; example_run: string };
type Item = {
  model: string;
  scenario_id: string;
  scenario_title: string;
  attack_objective: string;
  deployment: string;
  successes: number;
  runs: number;
  example_run: string;
  shielded: Shield | null;
};

const MODEL_LABEL: Record<string, string> = {
  "muse-spark-1.1": "Muse Spark 1.1",
  "muse-spark-1.3": "Muse Spark 1.3",
  "muse-spark-1.3@minimal": "Muse Spark 1.3 (minimal reasoning)",
  "muse-spark-open@baseten": "Muse Spark Open",
};

export function Highlight() {
  const { data } = usePolling<{ highlights: Item[] }>("/highlights", 0);
  const top = data?.highlights?.[0];
  if (!top) return null;
  const s = top.shielded;
  const model = MODEL_LABEL[top.model] ?? top.model;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-critical-soft/30 px-6 py-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-critical-text">Key finding · real runs</span>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-2">
        {/* Attack landed */}
        <div className="bg-surface p-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg" aria-hidden>✕</span>
            <h3 className="font-semibold text-critical-text">The attack landed</h3>
          </div>
          <p className="text-sm text-fg-2">
            On <b className="text-fg">{model}</b>, deployed the naive way (generic prompt, every tool allowed), the{" "}
            <b className="text-fg">{top.scenario_title}</b> attack succeeded in{" "}
            <b className="text-critical-text">{top.successes} of {top.runs}</b> runs.
          </p>
          <p className="mt-2 text-xs text-muted">{top.attack_objective}</p>
          <div className="mt-3 text-3xl font-semibold text-critical-text tabular">{pct(top.successes / top.runs)} <span className="text-base text-muted">attack success</span></div>
          <Link href={`/runs/${top.example_run}`} className="mt-3 inline-block text-xs text-accent hover:underline">
            Open a trace where it landed →
          </Link>
        </div>

        {/* AgentShield stopped it */}
        <div className="bg-surface p-6">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg" aria-hidden>🛡</span>
            <h3 className="font-semibold text-good-text">AgentShield stopped it</h3>
          </div>
          {s ? (
            <>
              <p className="text-sm text-fg-2">
                Same model, same attack, protected by <b className="text-fg">AgentShield</b>: the scanner removed the injected
                instructions <b className="text-fg">{s.injections_removed}</b> time{s.injections_removed === 1 ? "" : "s"} before the
                agent read them. Attack success dropped to{" "}
                <b className="text-good-text">{s.successes} of {s.runs}</b>.
              </p>
              <div className="mt-3 text-3xl font-semibold text-good-text tabular">{pct(s.successes / s.runs)} <span className="text-base text-muted">attack success</span></div>
              <Link href={`/runs/${s.example_run}`} className="mt-3 inline-block text-xs text-accent hover:underline">
                Open the protected trace →
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">No paired AgentShield run yet for this scenario.</p>
          )}
        </div>
      </div>
      <div className="border-t border-line px-6 py-2 text-[11px] text-muted">
        Every number is computed from persisted runs. The model refused the instruction, but under the strict pre-registered check the
        attacker&apos;s content still reached the output; AgentShield removes it before the agent ever sees it.
      </div>
    </section>
  );
}
