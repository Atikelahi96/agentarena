"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Rate = { k: number; n: number; rate: number | null; ci95: [number, number] | null };

export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  family: string;
  simulated: boolean;
  note: string;
  available: boolean;
};

export type Defense = {
  id: string;
  label: string;
  description: string;
  spotlight: boolean;
  scanner: string;
  monitor: boolean;
  rule_of_two: boolean;
  provenance: boolean;
};

export type ScenarioSummary = {
  id: string;
  version: string;
  title: string;
  category: string;
  summary: string;
  benign: boolean;
  pair_of: string | null;
  task: string;
  attack_objective: string;
  tools: string[];
  permissions: string[];
  task_check_count: number;
  attack_check_count: number;
  frameworks: Record<string, string[]>;
};

export type Check = {
  kind: string;
  description: string;
  target?: string;
  values?: string[];
  path?: string;
  value?: unknown;
  to?: string;
};

export type ScenarioDetail = ScenarioSummary & {
  system_context: string;
  injections: string[];
  task_checks: Check[];
  attack_checks: Check[];
  initial_state: Record<string, unknown>;
  max_steps: number;
};

export type Outcome = {
  status: string;
  valid: boolean;
  simulated: boolean;
  task_success: boolean;
  attack_success: boolean | null;
  hijack_attempted: boolean;
  hijack_executed: boolean;
  unauthorized_execution: number;
  blocked_by: Record<string, number>;
  legit_calls_denied: number;
  tool_calls_proposed: number;
  tool_calls_executed: number;
  steps: number;
  checks: { role: "task" | "attack"; kind: string; description: string; passed: boolean; evidence: string }[];
  error_kind: string | null;
};

export type RunRow = {
  id: string;
  model: string;
  defense: string;
  scenario_id: string;
  scenario_version: string;
  benign: boolean;
  repeat: number;
  simulated: boolean;
  status: string;
  outcome: Outcome | null;
  usage: { total_tokens?: number } | null;
  duration_ms: number | null;
  error_kind: string | null;
};

export type Summary = {
  runs: number;
  valid_runs: number;
  error_rate: Rate;
  task_success: Rate;
  task_success_under_attack: Rate;
  benign_task_success: Rate;
  attack_success: Rate;
  hijack_attempt: Rate;
  hijack_executed: Rate;
  unauthorized_executions: number;
  legit_calls_denied: number;
  injections_removed?: number;
  attacker_calls_blocked?: number;
  defense_interventions?: number;
  blocked_by: Record<string, number>;
  total_tokens: number;
  simulated: boolean;
};

export type Condition = Summary & {
  model: string;
  defense: string;
  vs_baseline: {
    attack_success_reduction_pp: number | null;
    utility_retention: number | null;
    task_success_change_pp: number | null;
  } | null;
};

export type MatrixCell = {
  model: string;
  defense: string;
  scenario_id: string;
  benign: boolean;
  n: number;
  valid: number;
  task_success: number;
  attack_success: number;
  hijack_attempted: number;
  run_ids: string[];
};

export type Comparison = { baseline: string; overall: Summary; conditions: Condition[]; matrix: MatrixCell[] };

export type Experiment = {
  id: string;
  name: string;
  kind: string;
  status: string;
  config: { scenario_ids: string[]; defenses: string[]; models: string[]; repeats: number };
  total_runs: number;
  finished_runs: number;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  headline?: { attack_success: Rate; task_success: Rate; simulated: boolean } | null;
};

export type ExperimentDetail = Experiment & { runs: RunRow[]; comparison: Comparison; event_count: number };

export type Frameworks = {
  risks: Record<string, { framework: string; title: string }>;
  governance: { ref: string; title: string; evidence: string }[];
};

export type TraceEvent = { seq: number; ts: string; type: string; payload: Record<string, any> };

export type RunDetail = RunRow & {
  experiment_id: string;
  final_answer: string | null;
  final_state: Record<string, any> | null;
  injections: string[];
  error_message: string | null;
  scenario: ScenarioSummary | null;
  defense_info: Defense;
  started_at: string | null;
};

export type Health = { status: string; database: boolean; models: ModelInfo[]; scenarios: number; version: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** Fetch once, then keep polling while `active(data)` is true. */
export function usePolling<T>(path: string | null, intervalMs: number, active: (d: T | undefined) => boolean = () => false) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (!stop && activeRef.current(d)) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [path, intervalMs, load]);

  return { data, error, reload: load };
}

/** Incrementally stream a run's trace by polling `?after=seq` until the run finishes. */
export function useRunEvents(runId: string | null, intervalMs = 600) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setEvents([]);
    setDone(false);
    if (!runId) return;
    let stop = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const batch = await api<TraceEvent[]>(`/runs/${runId}/events?after=${last}`);
        if (batch.length) {
          last = batch[batch.length - 1].seq;
          setEvents((prev) => [...prev, ...batch]);
        }
        if (batch.some((e) => e.type === "run_completed" || e.type === "run_failed")) {
          setDone(true);
          return;
        }
      } catch {}
      if (!stop) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId, intervalMs]);

  return { events, done };
}

export const pct = (r: number | null | undefined, digits = 0) =>
  r === null || r === undefined ? "–" : `${(r * 100).toFixed(digits)}%`;

export const DEFENSE_ORDER = ["none", "spotlight", "scanner", "monitor", "rule_of_two", "provenance", "layered", "naive", "naive_shield"];

export const DEFENSE_LABEL: Record<string, string> = {
  none: "Baseline",
  spotlight: "Spotlighting",
  scanner: "Content scanner",
  monitor: "Alignment monitor",
  rule_of_two: "Rule of Two",
  provenance: "Provenance guard",
  layered: "AgentShield",
  naive: "Naive agent",
  naive_shield: "Naive + AgentShield",
};

export const CAPABILITY: Record<string, { letter: string; label: string }> = {
  untrusted_input: { letter: "A", label: "Untrusted input" },
  sensitive_access: { letter: "B", label: "Sensitive access" },
  state_change: { letter: "C", label: "State change" },
  output_sink: { letter: "O", label: "Output sink" },
};
