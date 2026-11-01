"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  api, DEFENSE_LABEL, DEFENSE_ORDER, usePolling, useRunEvents,
  type Defense, type ExperimentDetail, type ModelInfo, type ScenarioDetail, type ScenarioSummary,
} from "@/lib/api";
import { outcomeOf, Trace } from "@/components/Trace";
import { Badge, Button, Card, cx, ErrorNote, PageHeader, SimulatedBadge, Verdict } from "@/components/ui";
import { LimitsNotice, useLimits } from "@/components/LimitsNotice";

function Lane({ runId, defense, injections, benign }: { runId: string | null; defense: string; injections: string[]; benign: boolean }) {
  const { events, done } = useRunEvents(runId, 450);
  const outcome = outcomeOf(events);
  const failed = events.some((e) => e.type === "run_failed");
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="font-semibold">{DEFENSE_LABEL[defense] ?? defense}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {!runId ? null : failed ? (
            <Verdict kind="error" />
          ) : !done ? (
            <Verdict kind="running" />
          ) : outcome ? (
            <>
              {benign ? <Verdict kind="benign" /> : <Verdict kind={outcome.attack_success ? "attack_success" : "attack_blocked"} />}
              <Verdict kind={outcome.task_success ? "task_done" : "task_failed"} />
            </>
          ) : null}
        </span>
      </header>
      <div className="max-h-[70vh] min-h-64 overflow-y-auto p-3">
        {runId ? <Trace events={events} injections={injections} compact /> : <div className="py-16 text-center text-sm text-muted">Launch a match to stream the trace.</div>}
      </div>
      {runId && done && (
        <footer className="border-t border-line px-4 py-2 text-right text-xs">
          <Link href={`/runs/${runId}`} className="text-accent hover:underline">Full trace & final state →</Link>
        </footer>
      )}
    </div>
  );
}

export default function ArenaPage() {
  const { data: scenarios } = usePolling<ScenarioSummary[]>("/scenarios", 0);
  const { data: models } = usePolling<ModelInfo[]>("/models", 0);
  const { data: defenses } = usePolling<Defense[]>("/defenses", 0);
  const [scenarioId, setScenarioId] = useState("s04-customer-email-exfil");
  const [model, setModel] = useState<string>("");
  const [left, setLeft] = useState("none");
  const [right, setRight] = useState("provenance");
  const [expId, setExpId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  const lim = useLimits();
  const publicLocked = (id: string) => !!lim?.public_mode && !lim.admin && !(lim.public_models ?? []).includes(id);

  useEffect(() => {
    if (!model && models?.length) setModel((models.find((m) => m.available && !m.simulated) ?? models.find((m) => m.simulated))!.id);
  }, [models, model]);

  useEffect(() => {
    api<ScenarioDetail>(`/scenarios/${scenarioId}`).then(setDetail).catch(() => setDetail(null));
  }, [scenarioId]);

  // Restore a match from the URL (?exp=<id>) or preselect a scenario (?scenario=<id>).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sid = q.get("scenario");
    if (sid) setScenarioId(sid);
    const eid = q.get("exp");
    if (!eid) return;
    api<ExperimentDetail>(`/experiments/${eid}`)
      .then((e) => {
        setScenarioId(e.config.scenario_ids[0]);
        setModel(e.config.models[0]);
        setLeft(e.config.defenses[0]);
        setRight(e.config.defenses[1] ?? e.config.defenses[0]);
        setExpId(eid);
      })
      .catch(() => setError("Could not load that match."));
  }, []);

  const { data: exp } = usePolling<ExperimentDetail>(expId ? `/experiments/${expId}` : null, 1500, (d) => !d || d.status === "queued" || d.status === "running");
  const runFor = (d: string) => exp?.runs.find((r) => r.defense === d)?.id ?? null;
  const selectedModel = models?.find((m) => m.id === model);

  const launch = async () => {
    setLaunching(true);
    setError(null);
    setExpId(null);
    try {
      const res = await api<{ id: string }>("/experiments", {
        method: "POST",
        body: JSON.stringify({ kind: "arena", name: `Arena: ${scenarioId}`, scenario_ids: [scenarioId], defenses: [left, right], models: [model], repeats: 1 }),
      });
      setExpId(res.id);
      window.history.replaceState(null, "", `/arena?exp=${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };

  const sorted = useMemo(() => [...(defenses ?? [])].sort((a, b) => DEFENSE_ORDER.indexOf(a.id) - DEFENSE_ORDER.indexOf(b.id)), [defenses]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Arena"
        subtitle="Same model, same task, same attack, same tools. Only the defense differs. Watch both agents decide in real time."
      />

      <Card>
        <div className="grid gap-4 md:grid-cols-4">
          <label className="md:col-span-2">
            <div className="mb-1 text-xs text-muted">Scenario</div>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm">
              {scenarios?.map((s) => (
                <option key={s.id} value={s.id}>{s.benign ? "◌ " : "⚔ "}{s.title}</option>
              ))}
            </select>
          </label>
          <label>
            <div className="mb-1 text-xs text-muted">Model under test</div>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm">
              {models?.map((m) => (
                <option key={m.id} value={m.id} disabled={!m.available || publicLocked(m.id)}>
                  {m.label}{!m.available ? " (no key)" : publicLocked(m.id) ? " (not in public demo)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button onClick={launch} disabled={launching || !model} className="w-full">{launching ? "Launching…" : "⚔ Launch match"}</Button>
          </div>
          <label>
            <div className="mb-1 text-xs text-muted">Left corner</div>
            <select value={left} onChange={(e) => setLeft(e.target.value)} className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm">
              {sorted.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label>
            <div className="mb-1 text-xs text-muted">Right corner</div>
            <select value={right} onChange={(e) => setRight(e.target.value)} className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm">
              {sorted.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2 md:col-span-2">{selectedModel?.simulated && <SimulatedBadge />}</div>
        </div>
        <div className="mt-3 space-y-2">
          <LimitsNotice />
          <ErrorNote error={error} />
        </div>
      </Card>

      {detail && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="User task" className="lg:col-span-1">
            <p className="text-sm text-fg">{detail.task}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {detail.tools.map((t) => (
                <Badge key={t} tone={detail.permissions.includes(t) ? "neutral" : "critical"}>{t}{!detail.permissions.includes(t) && " 🔒"}</Badge>
              ))}
            </div>
          </Card>
          <Card title={detail.benign ? "Control: no attack" : "Hidden attack"} className={cx("lg:col-span-2", !detail.benign && "border-serious/40")}>
            {detail.benign ? (
              <p className="text-sm text-fg-2">{detail.summary}</p>
            ) : (
              <>
                <div className="mb-2 text-xs text-muted">Attacker objective: <span className="text-fg-2">{detail.attack_objective}</span></div>
                {detail.injections.map((inj, i) => (
                  <p key={i} className="mb-2 font-mono text-xs leading-relaxed"><mark className="injection">{inj}</mark></p>
                ))}
              </>
            )}
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Lane key={`L-${expId}`} runId={runFor(left)} defense={left} injections={detail?.injections ?? []} benign={!!detail?.benign} />
        <Lane key={`R-${expId}`} runId={runFor(right)} defense={right} injections={detail?.injections ?? []} benign={!!detail?.benign} />
      </div>
    </div>
  );
}
