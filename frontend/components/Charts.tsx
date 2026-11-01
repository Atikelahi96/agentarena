"use client";

import Link from "next/link";
import { useState } from "react";
import { DEFENSE_LABEL, DEFENSE_ORDER, pct, type Condition, type MatrixCell, type ScenarioSummary } from "@/lib/api";
import { cx } from "./ui";

const W = 560;
const H = 380;
const PAD = { l: 52, r: 120, t: 20, b: 46 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;
const sx = (v: number) => PAD.l + v * IW;
const sy = (v: number) => PAD.t + (1 - v) * IH;

/** Security/utility trade-off: one point per defense for a single model. */
export function TradeoffChart({ conditions, title }: { conditions: Condition[]; title?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const pts = conditions
    .filter((c) => c.attack_success.rate !== null && c.task_success.rate !== null)
    .sort((a, b) => DEFENSE_ORDER.indexOf(a.defense) - DEFENSE_ORDER.indexOf(b.defense))
    .map((c) => ({ c, x: sx(c.task_success.rate!), y: sy(c.attack_success.rate!) }));

  // Direct labels: nudge down when two labels would collide.
  const labels = pts.map((p) => ({ id: p.c.defense, x: p.x + 10, y: p.y + 4 }));
  const placed: { x: number; y: number }[] = [];
  for (const l of [...labels].sort((a, b) => a.y - b.y)) {
    while (placed.some((q) => Math.abs(q.y - l.y) < 13 && Math.abs(q.x - l.x) < 110)) l.y += 13;
    placed.push(l);
  }
  const hovered = pts.find((p) => p.c.defense === hover);
  const stacked = pts.filter((p) => pts.some((q) => q !== p && Math.abs(q.x - p.x) < 4 && Math.abs(q.y - p.y) < 4));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="relative">
      {title && <figcaption className="mb-2 text-sm font-medium text-fg">{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Attack success versus task success by defense">
        <rect x={sx(0.75)} y={sy(0.25)} width={sx(1) - sx(0.75)} height={sy(0) - sy(0.25)} fill="var(--good-soft)" opacity={0.5} rx={4} />
        <text x={sx(1) - 6} y={sy(0) - 8} textAnchor="end" fontSize={10} fill="var(--good-text)">ideal ↘</text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(0)} x2={sx(1)} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth={1} />
            <line y1={sy(0)} y2={sy(1)} x1={sx(t)} x2={sx(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 8} y={sy(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" className="tabular">{pct(t)}</text>
            <text x={sx(t)} y={sy(0) + 16} textAnchor="middle" fontSize={10} fill="var(--muted)" className="tabular">{pct(t)}</text>
          </g>
        ))}
        <line x1={sx(0)} x2={sx(1)} y1={sy(0)} y2={sy(0)} stroke="var(--axis)" />
        <text x={sx(0.5)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-2)">Task success (utility) →</text>
        <text transform={`translate(14 ${sy(0.5)}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--text-2)">Attack success ↑ (worse)</text>

        {pts.map(({ c, x, y }) => {
          const base = c.defense === "none";
          const col = base ? "var(--muted)" : "var(--accent)";
          const ciX = c.task_success.ci95;
          const ciY = c.attack_success.ci95;
          return (
            <g key={c.defense} opacity={hover && hover !== c.defense ? 0.35 : 1}>
              {ciX && <line x1={sx(ciX[0])} x2={sx(ciX[1])} y1={y} y2={y} stroke={col} strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" />}
              {ciY && <line x1={x} x2={x} y1={sy(ciY[0])} y2={sy(ciY[1])} stroke={col} strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" />}
              <circle cx={x} cy={y} r={6} fill={base ? "var(--surface)" : col} stroke={base ? col : "var(--surface)"} strokeWidth={2} />
              <circle cx={x} cy={y} r={16} fill="transparent" onMouseEnter={() => setHover(c.defense)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
        {labels.map((l) => (
          <text key={l.id} x={l.x} y={l.y} fontSize={11} fill="var(--text)" opacity={hover && hover !== l.id ? 0.35 : 1}>
            {DEFENSE_LABEL[l.id] ?? l.id}
          </text>
        ))}
      </svg>
      {stacked.length >= 2 && (
        <p className="mt-1 text-[11px] text-muted">
          {stacked.length} defenses overlap at the same point ({pct(stacked[0].c.task_success.rate)} task success,{" "}
          {pct(stacked[0].c.attack_success.rate)} attack success). See Defense activity for how differently they behaved.
        </p>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 w-60 rounded-lg border border-line-strong bg-surface-3 p-3 text-xs shadow-xl"
          style={{ left: `${(hovered.x / W) * 100}%`, top: `${(hovered.y / H) * 100}%`, transform: "translate(12px, 12px)" }}
        >
          <div className="mb-1 font-semibold text-fg">{DEFENSE_LABEL[hovered.c.defense]}</div>
          <Row k="Attack success" r={hovered.c.attack_success} />
          <Row k="Task success" r={hovered.c.task_success} />
          <Row k="Benign task success" r={hovered.c.benign_task_success} />
          <Row k="Hijack attempts" r={hovered.c.hijack_attempt} />
          {hovered.c.vs_baseline && (
            <div className="mt-1 border-t border-line pt-1 text-fg-2">
              {fmtPP(hovered.c.vs_baseline.attack_success_reduction_pp)} attack reduction · utility retention{" "}
              {hovered.c.vs_baseline.utility_retention === null ? "undefined" : pct(hovered.c.vs_baseline.utility_retention)}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function Row({ k, r }: { k: string; r: Condition["attack_success"] }) {
  return (
    <div className="flex justify-between gap-2 tabular">
      <span className="text-muted">{k}</span>
      <span className="text-fg">
        {pct(r.rate)} <span className="text-muted">({r.k}/{r.n})</span>
      </span>
    </div>
  );
}

export const fmtPP = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v > 0 ? "−" : v < 0 ? "+" : "±"}${Math.abs(v).toFixed(1)} pp`);

/** Scenario x defense outcome grid for one model. */
export function OutcomeMatrix({ cells, scenarios, defenses }: { cells: MatrixCell[]; scenarios: ScenarioSummary[]; defenses: string[] }) {
  const byKey = new Map(cells.map((c) => [`${c.scenario_id}|${c.defense}`, c]));
  const scenarioIds = [...new Set(cells.map((c) => c.scenario_id))];
  const title = (id: string) => scenarios.find((s) => s.id === id)?.title ?? id;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-muted">Scenario</th>
            {defenses.map((d) => (
              <th key={d} className="px-2 py-1 text-center font-medium text-muted">{DEFENSE_LABEL[d] ?? d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scenarioIds.map((sid) => (
            <tr key={sid}>
              <td className="max-w-64 px-2 py-1.5 text-fg-2">
                <div className="truncate" title={title(sid)}>{title(sid)}</div>
                <div className="font-mono text-[10px] text-muted">{sid}</div>
              </td>
              {defenses.map((d) => {
                const c = byKey.get(`${sid}|${d}`);
                if (!c || !c.valid) return <td key={d} className="rounded bg-surface-2 text-center text-muted">–</td>;
                const ar = c.attack_success / c.valid;
                return (
                  <td key={d} className="rounded p-0 text-center" style={{ background: c.benign || ar === 0 ? "var(--surface-2)" : `rgba(208,59,59,${0.12 + ar * 0.5})` }}>
                    <Link href={c.run_ids[0] ? `/runs/${c.run_ids[0]}` : "#"} className="block px-2 py-1.5 hover:outline hover:outline-1 hover:outline-line-strong">
                      {!c.benign && (
                        <div className={cx("tabular", ar > 0 ? "text-critical-text" : "text-good-text")}>
                          {ar > 0 ? "✕" : "✓"} {c.attack_success}/{c.valid} attacks
                        </div>
                      )}
                      <div className="tabular text-fg-2">task {c.task_success}/{c.valid}</div>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Red shade = attack success rate (darker = more successful attacks); grey = no successful attacks or a benign control. Click a cell to open its trace.</p>
    </div>
  );
}


/** What each defense actually did: protective actions vs. legitimate work it blocked. */
export function DefenseActivityChart({ conditions }: { conditions: Condition[] }) {
  const rows = conditions
    .filter((c) => c.defense !== "none")
    .sort((a, b) => DEFENSE_ORDER.indexOf(a.defense) - DEFENSE_ORDER.indexOf(b.defense))
    .map((c) => {
      const removed = c.injections_removed ?? 0;
      const attackerBlocked = c.attacker_calls_blocked ?? 0;
      return {
        c,
        protective: removed + attackerBlocked,
        removed,
        attackerBlocked,
        legit: c.legit_calls_denied,
        tasksFailed: c.task_success.n - c.task_success.k,
      };
    });
  if (!rows.length) return <p className="text-sm text-muted">No defended conditions in this experiment.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => [r.protective, r.legit]));
  const bar = (v: number) => `${(100 * v) / max}%`;
  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-fg-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#3987e5" }} />
          Protective actions (injections removed + attacker calls blocked)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#d95926" }} />
          Legitimate actions blocked (cost)
        </span>
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.c.defense} className="grid grid-cols-[8.5rem_1fr_6.5rem] items-center gap-3 text-xs">
            <div className="text-fg">{DEFENSE_LABEL[r.c.defense] ?? r.c.defense}</div>
            <div className="space-y-[2px]">
              <div className="flex items-center gap-2" title={`${r.removed} injected instructions removed, ${r.attackerBlocked} attacker calls blocked`}>
                <div className="h-2.5 rounded-r" style={{ width: r.protective ? bar(r.protective) : "2px", background: "#3987e5", opacity: r.protective ? 1 : 0.35 }} />
                <span className="tabular text-fg-2">{r.protective}</span>
              </div>
              <div className="flex items-center gap-2" title={`${r.legit} legitimate calls blocked`}>
                <div className="h-2.5 rounded-r" style={{ width: r.legit ? bar(r.legit) : "2px", background: "#d95926", opacity: r.legit ? 1 : 0.35 }} />
                <span className="tabular text-fg-2">{r.legit}</span>
              </div>
            </div>
            <div className={r.tasksFailed ? "tabular text-critical-text" : "tabular text-good-text"}>
              {r.tasksFailed ? `\u2715 ${r.tasksFailed} tasks lost` : "\u2713 0 tasks lost"}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        A blocked legitimate action only costs a task if the agent cannot recover; the right column counts tasks that actually failed.
      </p>
    </figure>
  );
}
