"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { api, DEFENSE_LABEL, usePolling, type ExperimentDetail, type ModelInfo, type ScenarioSummary } from "@/lib/api";
import { Results } from "@/components/Results";
import { Badge, Button, Card, ErrorNote, PageHeader, Progress, SimulatedBadge, Verdict } from "@/components/ui";

export default function ExperimentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: exp, error } = usePolling<ExperimentDetail>(`/experiments/${id}`, 2000, (d) => !d || d.status === "queued" || d.status === "running");
  const { data: scenarios } = usePolling<ScenarioSummary[]>("/scenarios", 0);
  const { data: models } = usePolling<ModelInfo[]>("/models", 0);
  const running = exp && (exp.status === "running" || exp.status === "queued");

  return (
    <div className="space-y-6">
      <PageHeader
        title={exp?.name ?? "Experiment"}
        subtitle={exp && `${exp.config.scenario_ids.length} scenarios × ${exp.config.defenses.length} defenses × ${exp.config.models.length} model(s) × ${exp.config.repeats} repeats`}
        actions={
          exp && (
            <>
              {running && <Button variant="ghost" onClick={() => api(`/experiments/${id}/cancel`, { method: "POST" })}>Cancel</Button>}
              <a href={`/api/experiments/${id}/report`} className="inline-flex items-center rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-surface-3">⤓ JSON report</a>
              <Link href={`/experiments/${id}/evidence`} className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">Evidence report →</Link>
            </>
          )
        }
      />
      <ErrorNote error={error} />
      {exp && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={exp.status === "completed" ? "good" : running ? "accent" : "warning"}>{exp.status}</Badge>
          {exp.comparison.overall.simulated && <SimulatedBadge />}
          <div className="w-72"><Progress value={exp.finished_runs} total={exp.total_runs} /></div>
          {running && <span className="text-xs text-muted">results update live as runs finish</span>}
        </div>
      )}
      {exp && exp.comparison.overall.runs > 0 && <Results comparison={exp.comparison} scenarios={scenarios ?? []} models={models ?? []} />}

      {exp && (
        <Card title={`Runs (${exp.runs.length})`}>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Scenario</th>
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Defense</th>
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 pr-3 font-medium">Tokens</th>
                  <th className="py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {exp.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line/60">
                    <td className="py-1.5 pr-3"><Link href={`/runs/${r.id}`} className="font-mono text-accent hover:underline">{r.scenario_id}</Link></td>
                    <td className="py-1.5 pr-3 text-fg-2">{r.model}</td>
                    <td className="py-1.5 pr-3 text-fg-2">{DEFENSE_LABEL[r.defense] ?? r.defense}</td>
                    <td className="py-1.5 pr-3 tabular text-muted">{r.repeat + 1}</td>
                    <td className="py-1.5 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {r.status === "queued" || r.status === "running" ? <Verdict kind="running" /> : r.status === "error" ? (
                          <Badge tone="serious">⚠ {r.error_kind}</Badge>
                        ) : r.outcome ? (
                          <>
                            {r.benign ? <Verdict kind="benign" /> : <Verdict kind={r.outcome.attack_success ? "attack_success" : "attack_blocked"} />}
                            <Verdict kind={r.outcome.task_success ? "task_done" : "task_failed"} />
                          </>
                        ) : <Badge>{r.status}</Badge>}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 tabular text-muted">{r.usage?.total_tokens || "–"}</td>
                    <td className="py-1.5 tabular text-muted">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
