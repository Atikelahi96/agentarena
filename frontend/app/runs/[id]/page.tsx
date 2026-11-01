"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DEFENSE_LABEL, usePolling, useRunEvents, type RunDetail } from "@/lib/api";
import { Trace } from "@/components/Trace";
import { Badge, Card, ErrorNote, PageHeader, SimulatedBadge, Verdict } from "@/components/ui";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { data: run, error } = usePolling<RunDetail>(`/runs/${id}`, 1500, (d) => !d || d.status === "queued" || d.status === "running");
  const { events } = useRunEvents(id);
  const o = run?.outcome;

  return (
    <div className="space-y-6">
      <PageHeader
        title={run?.scenario?.title ?? "Run"}
        subtitle={run && (
          <>
            <span className="font-mono">{run.scenario_id} v{run.scenario_version}</span> · {run.model} · {DEFENSE_LABEL[run.defense] ?? run.defense} · repeat {run.repeat + 1} ·{" "}
            <Link href={`/experiments/${run.experiment_id}`} className="text-accent hover:underline">experiment</Link>
          </>
        )}
      />
      <ErrorNote error={error} />
      {run && (
        <div className="flex flex-wrap gap-2">
          {run.simulated && <SimulatedBadge />}
          {o ? (
            <>
              {run.benign ? <Verdict kind="benign" /> : <Verdict kind={o.attack_success ? "attack_success" : "attack_blocked"} />}
              <Verdict kind={o.task_success ? "task_done" : "task_failed"} />
              {o.hijack_attempted && <Badge tone="serious">⚑ hijack attempted</Badge>}
              <Badge tone={o.unauthorized_execution ? "critical" : "good"}>{o.unauthorized_execution ? "✕" : "✓"} unauthorized executions: {o.unauthorized_execution}</Badge>
              <Badge>{o.tool_calls_executed}/{o.tool_calls_proposed} calls executed</Badge>
            </>
          ) : run.status === "error" ? <Badge tone="serious">⚠ {run.error_kind}: {run.error_message}</Badge> : <Verdict kind="running" />}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Execution trace">
            <Trace events={events} injections={run?.injections ?? []} />
          </Card>
        </div>
        <div className="space-y-6">
          {run?.defense_info && (
            <Card title={`Defense: ${run.defense_info.label}`}>
              <p className="text-sm text-fg-2">{run.defense_info.description}</p>
            </Card>
          )}
          {run?.final_state && (
            <Card title="Final world state">
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-fg-2">
                {JSON.stringify(run.final_state, null, 2)}
              </pre>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
