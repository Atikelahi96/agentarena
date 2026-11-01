"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, CAPABILITY, usePolling, type ScenarioDetail, type ScenarioSummary } from "@/lib/api";
import { Badge, Card, PageHeader } from "@/components/ui";

type ToolInfo = { name: string; description: string; capabilities: string[] };

export default function ScenariosPage() {
  const { data: list } = usePolling<ScenarioSummary[]>("/scenarios", 0);
  const { data: tools } = usePolling<ToolInfo[]>("/tools", 0);
  const [details, setDetails] = useState<Record<string, ScenarioDetail>>({});

  useEffect(() => {
    list?.forEach((s) => api<ScenarioDetail>(`/scenarios/${s.id}`).then((d) => setDetails((p) => ({ ...p, [s.id]: d }))));
  }, [list]);

  const caps = (t: string) => tools?.find((x) => x.name === t)?.capabilities ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scenario library"
        subtitle="Versioned, synthetic scenarios. Each fixes the task, world state, attack payload, tool surface, hard permissions and deterministic checks, so paired runs differ only in the defense."
      />
      <Card title="Tool capabilities (Meta's Agents Rule of Two)">
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-fg-2">
          {Object.values(CAPABILITY).map((c) => (
            <span key={c.letter}><span className="rounded border border-line-strong px-1 font-mono">{c.letter}</span> {c.label}</span>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tools?.map((t) => (
            <div key={t.name} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{t.name}</span>
                {t.capabilities.map((c) => (
                  <span key={c} className="rounded border border-line-strong px-1 font-mono text-[10px] text-fg-2" title={CAPABILITY[c]?.label}>{CAPABILITY[c]?.letter}</span>
                ))}
              </div>
              <div className="text-xs text-muted">{t.description}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {list?.map((s) => {
          const d = details[s.id];
          return (
            <Card key={s.id} title={<span>{s.benign ? "◌ " : "⚔ "}{s.title}</span>} action={<span className="font-mono text-[11px] text-muted">{s.id} v{s.version}</span>}>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={s.benign ? "neutral" : "serious"}>{s.category}</Badge>
                  {s.pair_of && <Badge>paired with {s.pair_of}</Badge>}
                </div>
                <p className="text-fg-2">{s.summary}</p>
                <div>
                  <div className="text-xs text-muted">User task</div>
                  <div className="text-fg">{s.task}</div>
                </div>
                {!s.benign && d && (
                  <div>
                    <div className="text-xs text-muted">Injected payload</div>
                    {d.injections.map((inj, i) => <p key={i} className="mt-1 font-mono text-xs"><mark className="injection">{inj}</mark></p>)}
                  </div>
                )}
                <div>
                  <div className="mb-1 text-xs text-muted">Tools (🔒 visible but not permitted)</div>
                  <div className="flex flex-wrap gap-1">
                    {s.tools.map((t) => (
                      <Badge key={t} tone={s.permissions.includes(t) ? "neutral" : "critical"}>
                        {t} {caps(t).map((c) => CAPABILITY[c]?.letter).join("")}{!s.permissions.includes(t) && " 🔒"}
                      </Badge>
                    ))}
                  </div>
                </div>
                {d && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-muted">Task checks (all must pass)</div>
                      <ul className="space-y-0.5 text-xs text-fg-2">{d.task_checks.map((c, i) => <li key={i}>✓ {c.description}</li>)}</ul>
                    </div>
                    {!s.benign && (
                      <div>
                        <div className="mb-1 text-xs text-muted">Attack succeeds if any</div>
                        <ul className="space-y-0.5 text-xs text-fg-2">{d.attack_checks.map((c, i) => <li key={i}>✕ {c.description}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
                <Link href={`/arena?scenario=${s.id}`} className="inline-block text-xs text-accent hover:underline">Run in the Arena →</Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
