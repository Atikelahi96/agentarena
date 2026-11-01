"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, DEFENSE_ORDER, pct, usePolling, type Defense, type Experiment, type ModelInfo, type ScenarioSummary } from "@/lib/api";
import { Badge, Button, Card, cx, ErrorNote, PageHeader, Progress } from "@/components/ui";
import { LimitsNotice, useLimits } from "@/components/LimitsNotice";

function Toggle({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
        on ? "border-accent bg-accent-soft text-fg" : "border-line bg-surface-2 text-fg-2 hover:border-line-strong",
      )}
    >
      <span className="mr-1.5">{on ? "☑" : "☐"}</span>
      {children}
    </button>
  );
}

export default function ExperimentsPage() {
  const router = useRouter();
  const { data: scenarios } = usePolling<ScenarioSummary[]>("/scenarios", 0);
  const { data: models } = usePolling<ModelInfo[]>("/models", 0);
  const { data: defenses } = usePolling<Defense[]>("/defenses", 0);
  const { data: list } = usePolling<Experiment[]>("/experiments?kind=experiment", 3000, () => true);
  const lim = useLimits();
  const publicLocked = (id: string) => !!lim?.public_mode && !lim.admin && !(lim.public_models ?? []).includes(id);

  const [sel, setSel] = useState<{ s: string[]; d: string[]; m: string[] }>({ s: [], d: DEFENSE_ORDER, m: [] });
  const [repeats, setRepeats] = useState(3);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scenarios && !sel.s.length) setSel((p) => ({ ...p, s: scenarios.map((s) => s.id) }));
  }, [scenarios, sel.s.length]);
  useEffect(() => {
    if (models && !sel.m.length) {
      const real = models.find((m) => m.available && !m.simulated);
      setSel((p) => ({ ...p, m: [real?.id ?? "simulated"] }));
    }
  }, [models, sel.m.length]);

  const flip = (key: "s" | "d" | "m", id: string) =>
    setSel((p) => ({ ...p, [key]: p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id] }));
  const total = sel.s.length * sel.d.length * sel.m.length * repeats;

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id: string }>("/experiments", {
        method: "POST",
        body: JSON.stringify({ name, scenario_ids: sel.s, defenses: sel.d, models: sel.m, repeats }),
      });
      router.push(`/experiments/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Experiments" subtitle="Paired evaluation: every scenario runs under every selected defense and model with identical tasks, attacks and tools." />

      <Card title="New experiment">
        <div className="space-y-5">
          <LimitsNotice />
          <div>
            <div className="mb-2 text-xs text-muted">Models under test</div>
            <div className="flex flex-wrap gap-2">
              {models?.map((m) => (
                <Toggle key={m.id} on={sel.m.includes(m.id)} onClick={() => flip("m", m.id)} disabled={!m.available || publicLocked(m.id)} title={m.note}>
                  {m.label} {m.family === "open-weights" && <Badge>open weights</Badge>} {m.simulated && <Badge tone="warning">simulated</Badge>}
                  {!m.available && <span className="ml-1 text-xs text-muted">(no key)</span>}
                </Toggle>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs text-muted">Defenses (baseline is the reference for Δ)</div>
            <div className="flex flex-wrap gap-2">
              {[...(defenses ?? [])].sort((a, b) => DEFENSE_ORDER.indexOf(a.id) - DEFENSE_ORDER.indexOf(b.id)).map((d) => (
                <Toggle key={d.id} on={sel.d.includes(d.id)} onClick={() => flip("d", d.id)} title={d.description}>{d.label}</Toggle>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs text-muted">Scenarios</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {scenarios?.map((s) => (
                <Toggle key={s.id} on={sel.s.includes(s.id)} onClick={() => flip("s", s.id)} title={s.summary}>
                  <span className="text-xs">{s.benign ? "◌ control · " : "⚔ "}{s.title}</span>
                </Toggle>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label>
              <div className="mb-1 text-xs text-muted">Repeats per condition</div>
              <input type="number" min={1} max={10} value={repeats} onChange={(e) => setRepeats(Math.max(1, Math.min(10, +e.target.value || 1)))}
                className="w-24 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm" />
            </label>
            <label className="min-w-64 flex-1">
              <div className="mb-1 text-xs text-muted">Name (optional)</div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Muse Spark 1.3 — full grid"
                className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm" />
            </label>
            <div className="text-sm text-fg-2 tabular">{total} runs</div>
            <Button onClick={launch} disabled={busy || !total}>{busy ? "Launching…" : "Launch experiment"}</Button>
          </div>
          <ErrorNote error={error} />
        </div>
      </Card>

      <Card title="History">
        {!list?.length ? (
          <div className="py-4 text-sm text-muted">No experiments yet.</div>
        ) : (
          <div className="divide-y divide-line">
            {list.map((e) => (
              <Link key={e.id} href={`/experiments/${e.id}`} className="flex flex-wrap items-center gap-4 py-3 hover:bg-surface-2">
                <div className="min-w-48 flex-1">
                  <div className="font-medium text-fg">{e.name}</div>
                  <div className="text-xs text-muted">{new Date(e.created_at).toLocaleString()} · {e.config.models.join(", ")}</div>
                </div>
                <div className="w-48">
                  {e.status === "running" || e.status === "queued" ? <Progress value={e.finished_runs} total={e.total_runs} /> : <Badge tone={e.status === "completed" ? "good" : "warning"}>{e.status}</Badge>}
                </div>
                <div className="w-56 text-xs text-fg-2 tabular">
                  {e.headline?.attack_success && <>overall attack {pct(e.headline.attack_success.rate)} · task {pct(e.headline.task_success.rate)}</>}
                  {e.headline?.simulated && <Badge tone="warning" className="ml-2">sim</Badge>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
