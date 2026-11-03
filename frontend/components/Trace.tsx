"use client";

import { useState, type ReactNode } from "react";
import { CAPABILITY, DEFENSE_LABEL, type TraceEvent } from "@/lib/api";
import { Badge, cx } from "./ui";

const LAYER_LABEL: Record<string, string> = {
  gateway: "Gateway",
  rule_of_two: "Rule of Two",
  provenance: "Provenance",
  monitor: "Alignment monitor",
};

/** Wrap occurrences of `needles` inside `text` with a <mark>. */
function highlight(text: string, needles: string[], cls: string): ReactNode {
  const active = needles.filter((n) => n && n.length > 3);
  if (!active.length) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let best = -1;
    let len = 0;
    for (const n of active) {
      const at = lower.indexOf(n.toLowerCase(), i);
      if (at !== -1 && (best === -1 || at < best)) {
        best = at;
        len = n.length;
      }
    }
    if (best === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (best > i) parts.push(text.slice(i, best));
    parts.push(
      <mark key={best} className={cls}>
        {text.slice(best, best + len)}
      </mark>,
    );
    i = best + len;
  }
  return parts;
}

function Value({ v, injections, depth = 0 }: { v: unknown; injections: string[]; depth?: number }) {
  if (v === null || v === undefined) return <span className="text-muted">null</span>;
  if (typeof v === "string") return <span className="whitespace-pre-wrap break-words text-fg">{highlight(v, injections, "injection")}</span>;
  if (typeof v !== "object") return <span className="text-accent">{String(v)}</span>;
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
  if (!entries.length) return <span className="text-muted">{Array.isArray(v) ? "[]" : "{}"}</span>;
  return (
    <div className={cx(depth > 0 && "border-l border-line pl-3")}>
      {entries.map(([k, x]) => (
        <div key={k} className="flex gap-2 py-0.5">
          <span className="shrink-0 text-muted">{k}:</span>
          <div className="min-w-0 flex-1">
            <Value v={x} injections={injections} depth={depth + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}

function stripImage(result: any): any {
  if (result?.attachment?.image_url) {
    return { ...result, attachment: { ...result.attachment, image_url: "[image rendered above]" } };
  }
  return result;
}

function Caps({ caps }: { caps: string[] }) {
  return (
    <span className="inline-flex gap-1">
      {caps.map((c) => (
        <span key={c} title={CAPABILITY[c]?.label ?? c} className="rounded border border-line-strong px-1 font-mono text-[10px] text-fg-2">
          {CAPABILITY[c]?.letter ?? c}
        </span>
      ))}
    </span>
  );
}

type CallView = {
  callId: string;
  step: number;
  tool: string;
  args: Record<string, unknown> | null;
  rawArgs: string | null;
  checks: Record<string, any>[];
  executed?: Record<string, any>;
  denied?: Record<string, any>;
};

type Item =
  | { kind: "start"; p: Record<string, any> }
  | { kind: "thought"; step: number; content: string; reasoning?: string | null; usage?: any; latency?: number }
  | { kind: "call"; call: CallView }
  | { kind: "scan"; p: Record<string, any> }
  | { kind: "final"; content: string }
  | { kind: "assertions"; checks: Record<string, any>[] }
  | { kind: "completed"; p: Record<string, any> }
  | { kind: "failed"; p: Record<string, any> }
  | { kind: "limit"; p: Record<string, any> };

function buildItems(events: TraceEvent[]): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, CallView>();
  let assertions: Record<string, any>[] | null = null;
  for (const e of events) {
    const p = e.payload;
    switch (e.type) {
      case "run_started":
        items.push({ kind: "start", p });
        break;
      case "model_response":
        // A response without tool calls is the final answer, rendered by the final_answer event.
        if ((p.content || p.reasoning) && p.tool_calls?.length) items.push({ kind: "thought", step: p.step, content: p.content ?? "", reasoning: p.reasoning, usage: p.usage, latency: p.latency_ms });
        break;
      case "tool_call_proposed": {
        const call: CallView = { callId: p.call_id, step: p.step, tool: p.tool, args: p.args, rawArgs: p.raw_args, checks: [] };
        calls.set(p.call_id, call);
        items.push({ kind: "call", call });
        break;
      }
      case "policy_check":
        calls.get(p.call_id)?.checks.push(p);
        break;
      case "tool_executed": {
        const c = calls.get(p.call_id);
        if (c) c.executed = p;
        break;
      }
      case "tool_call_denied": {
        const c = calls.get(p.call_id);
        if (c) c.denied = p;
        break;
      }
      case "content_scan":
        items.push({ kind: "scan", p });
        break;
      case "final_answer":
        items.push({ kind: "final", content: p.content });
        break;
      case "assertion":
        if (!assertions) {
          assertions = [];
          items.push({ kind: "assertions", checks: assertions });
        }
        assertions.push(p);
        break;
      case "run_completed":
        items.push({ kind: "completed", p });
        break;
      case "run_failed":
        items.push({ kind: "failed", p });
        break;
      case "step_limit_reached":
        items.push({ kind: "limit", p });
        break;
    }
  }
  return items;
}

function CallCard({ call, injections, compact }: { call: CallView; injections: string[]; compact: boolean }) {
  const [open, setOpen] = useState(!compact);
  const denied = !!call.denied;
  const pending = !call.executed && !call.denied;
  const failedCheck = call.checks.find((c) => !c.allowed);
  const tainted: any[] = failedCheck?.tainted ?? [];

  return (
    <div
      className={cx(
        "rise rounded-lg border",
        denied ? "border-critical/50 bg-critical-soft/40" : pending ? "border-accent/40 bg-surface-2" : "border-line bg-surface-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="font-mono text-[11px] text-muted">step {call.step}</span>
        <span className="font-mono text-sm font-semibold text-fg">{call.tool}</span>
        {call.executed && <Caps caps={call.executed.capabilities ?? []} />}
        <span className="ml-auto">
          {denied ? (
            <Badge tone="critical">✕ Blocked by {LAYER_LABEL[call.denied!.layer] ?? call.denied!.layer}</Badge>
          ) : call.executed ? (
            <Badge tone="good">✓ Executed</Badge>
          ) : (
            <Badge tone="accent">● Checking…</Badge>
          )}
        </span>
      </div>

      <div className="border-t border-line px-3 py-2 font-mono text-xs">
        {call.args ? <Value v={call.args} injections={[]} /> : <span className="text-critical-text">malformed: {call.rawArgs}</span>}
      </div>

      {call.checks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          {call.checks.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted">→</span>}
              <Badge tone={c.allowed ? "neutral" : "critical"} title={c.reason}>
                {c.allowed ? "✓" : "✕"} {LAYER_LABEL[c.layer] ?? c.layer}
              </Badge>
            </span>
          ))}
        </div>
      )}

      {denied && (
        <div className="border-t border-critical/30 px-3 py-2 text-xs text-critical-text">
          {call.denied!.reason}
          {tainted.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {tainted.map((t, i) => (
                <div key={i} className="rounded border border-critical/30 bg-bg/40 p-2 font-mono text-[11px] text-fg-2">
                  <div>
                    <span className="text-muted">{t.arg} = </span>
                    <mark className="taint">{t.value}</mark>
                    <span className="text-muted"> ← traced to {t.source}</span>
                  </div>
                  <div className="mt-1 text-fg-2">…{highlight(t.excerpt, [t.value], "taint")}…</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {call.executed && (
        <div className="border-t border-line px-3 py-2">
          {call.executed.result?.attachment?.image_url && (
            <figure className="mb-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
                <span aria-hidden>🖼</span> screenshot attachment — read by the agent with Muse Spark vision
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={call.executed.result.attachment.image_url} alt={call.executed.result.attachment.alt || "screenshot"}
                   className="max-h-72 w-auto rounded border border-line-strong" />
            </figure>
          )}
          {call.executed.state_diff?.length > 0 && (
            <div className="mb-2 space-y-1">
              {call.executed.state_diff.map((d: any, i: number) => (
                <div key={i} className="rounded bg-warning-soft px-2 py-1 font-mono text-[11px] text-warning">
                  state · {d.path}{" "}
                  {d.op === "set" ? (
                    <>
                      <span className="text-fg-2">{JSON.stringify(d.before)}</span> → <span className="font-semibold">{JSON.stringify(d.after)}</span>
                    </>
                  ) : (
                    <>+ {JSON.stringify(d.value).slice(0, 160)}</>
                  )}
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setOpen(!open)} className="text-[11px] text-muted hover:text-fg">
            {open ? "▾" : "▸"} tool result
          </button>
          {open && (
            <div className="mt-1 max-h-72 overflow-auto font-mono text-xs">
              <Value v={stripImage(call.executed.result)} injections={injections} />
            </div>
          )}
          {!open && JSON.stringify(call.executed.result).match(new RegExp(injections.map((s) => s.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "$^")) && (
            <div className="mt-1 text-[11px] text-serious">⚠ contains injected instructions</div>
          )}
        </div>
      )}
    </div>
  );
}

export function Trace({ events, injections = [], compact = false }: { events: TraceEvent[]; injections?: string[]; compact?: boolean }) {
  const items = buildItems(events);
  if (!events.length) return <div className="py-8 text-center text-sm text-muted">Waiting for the first event…</div>;
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => {
        switch (it.kind) {
          case "start":
            return compact ? null : (
              <div key={i} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">User task</div>
                <div className="text-sm text-fg">{it.p.task}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {it.p.tools.map((t: string) => (
                    <Badge key={t} tone={it.p.permissions.includes(t) ? "neutral" : "critical"} title={it.p.permissions.includes(t) ? "permitted" : "visible but not permitted"}>
                      {t}
                      {!it.p.permissions.includes(t) && " 🔒"}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          case "thought":
            return (
              <div key={i} className="rise rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-2">
                <div className="mb-0.5 text-[11px] text-muted">
                  agent · step {it.step}
                  {it.latency ? ` · ${it.latency} ms` : ""}
                </div>
                {it.content && <div className="whitespace-pre-wrap">{it.content}</div>}
                {it.reasoning && (
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer">reasoning</summary>
                    <div className="whitespace-pre-wrap">{it.reasoning}</div>
                  </details>
                )}
              </div>
            );
          case "call":
            return <CallCard key={it.call.callId} call={it.call} injections={injections} compact={compact} />;
          case "scan":
            return it.p.flagged ? (
              <div key={i} className="rise rounded-lg border border-good/40 bg-good-soft px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="good">🛡 AgentShield scanner</Badge>
                  <span className="text-fg">
                    {it.p.action === "redact" ? "removed" : "flagged"} {it.p.spans.length} injected instruction{it.p.spans.length === 1 ? "" : "s"} from{" "}
                    <span className="font-mono">{it.p.source}</span> before the agent read it
                  </span>
                  <span className="text-muted">· {it.p.method}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {it.p.spans.map((s: string, j: number) => (
                    <div key={j} className="font-mono text-[11px] leading-relaxed">
                      <mark className="injection line-through decoration-serious/70">{s}</mark>
                    </div>
                  ))}
                </div>
                {it.p.reason && <div className="mt-1 text-[11px] text-fg-2">{it.p.reason}</div>}
              </div>
            ) : compact ? null : (
              <div key={i} className="px-1 text-[11px] text-muted">✓ scanned {it.p.source}: no injected instructions ({it.p.method})</div>
            );
          case "final":
            return (
              <div key={i} className="rise rounded-lg border border-accent/40 bg-accent-soft px-3 py-2">
                <div className="mb-0.5 text-[11px] text-accent">final answer</div>
                <div className="whitespace-pre-wrap text-sm text-fg">{it.content || <span className="text-muted">(empty)</span>}</div>
              </div>
            );
          case "assertions":
            return (
              <div key={i} className="rise rounded-lg border border-line bg-surface px-3 py-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Deterministic checks</div>
                <ul className="space-y-1">
                  {it.checks.map((c, j) => {
                    const bad = c.role === "attack" ? c.passed : !c.passed;
                    return (
                      <li key={j} className="flex items-start gap-2 text-xs">
                        <span className={bad ? "text-critical-text" : "text-good-text"}>{bad ? "✕" : "✓"}</span>
                        <span className="text-fg-2">
                          <span className="text-muted">[{c.role === "task" ? "task" : "attack objective"}]</span> {c.description}
                          <span className="text-muted"> — {c.role === "attack" ? (c.passed ? "ACHIEVED" : "not achieved") : c.passed ? "met" : "not met"} ({c.evidence})</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          case "completed":
            return null;
          case "failed":
            return (
              <div key={i} className="rounded-lg border border-serious/50 bg-serious-soft px-3 py-2 text-sm text-serious">
                ⚠ Run failed ({it.p.error_kind}): {it.p.error}
              </div>
            );
          case "limit":
            return (
              <div key={i} className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
                ! Step limit reached ({it.p.max_steps})
              </div>
            );
        }
      })}
    </div>
  );
}

export function outcomeOf(events: TraceEvent[]) {
  return events.find((e) => e.type === "run_completed")?.payload as Record<string, any> | undefined;
}

export { DEFENSE_LABEL };
