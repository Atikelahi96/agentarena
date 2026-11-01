import Link from "next/link";
import type { ReactNode } from "react";
import { pct, type Rate } from "@/lib/api";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "good" | "critical" | "warning" | "serious" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-2 border-line",
  good: "bg-good-soft text-good-text border-good/40",
  critical: "bg-critical-soft text-critical-text border-critical/40",
  warning: "bg-warning-soft text-warning border-warning/40",
  serious: "bg-serious-soft text-serious border-serious/40",
  accent: "bg-accent-soft text-accent border-accent/40",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Status always pairs an icon with a label; color never carries meaning alone. */
export function Verdict({ kind }: { kind: "attack_success" | "attack_blocked" | "task_done" | "task_failed" | "error" | "running" | "benign" }) {
  const map = {
    attack_success: { tone: "critical", icon: "✕", text: "Attack succeeded" },
    attack_blocked: { tone: "good", icon: "✓", text: "Attack contained" },
    task_done: { tone: "good", icon: "✓", text: "Task completed" },
    task_failed: { tone: "warning", icon: "!", text: "Task not completed" },
    error: { tone: "serious", icon: "⚠", text: "Run error" },
    running: { tone: "accent", icon: "●", text: "Running" },
    benign: { tone: "neutral", icon: "○", text: "No attack (control)" },
  } as const;
  const v = map[kind];
  return (
    <Badge tone={v.tone}>
      <span aria-hidden>{v.icon}</span>
      {v.text}
    </Badge>
  );
}

export function SimulatedBadge() {
  return (
    <Badge tone="warning" title="Scripted stand-in agent used to validate the pipeline. Not a real model result.">
      ⚠ Simulated agent
    </Badge>
  );
}

export function RateText({ r, digits = 0, showN = true }: { r: Rate | undefined; digits?: number; showN?: boolean }) {
  if (!r || r.rate === null) return <span className="text-muted">–</span>;
  return (
    <span className="tabular" title={r.ci95 ? `95% CI ${pct(r.ci95[0])}–${pct(r.ci95[1])}` : undefined}>
      <span className="font-semibold text-fg">{pct(r.rate, digits)}</span>
      {showN && <span className="ml-1 text-xs text-muted">{r.k}/{r.n}</span>}
      {r.ci95 && <span className="ml-1 text-[11px] text-muted">[{pct(r.ci95[0])}–{pct(r.ci95[1])}]</span>}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "critical" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular", tone === "good" && "text-good-text", tone === "critical" && "text-critical-text")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-fg-2">{sub}</div>}
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = "primary", type = "button", className }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost"; type?: "button" | "submit"; className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" ? "bg-accent text-white hover:brightness-110" : "border border-line-strong text-fg hover:bg-surface-3",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "ghost" }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition",
        variant === "primary" ? "bg-accent text-white hover:brightness-110" : "border border-line-strong text-fg hover:bg-surface-3",
      )}
    >
      {children}
    </Link>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const p = total ? Math.round((100 * value) / total) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${p}%` }} />
      </div>
      <span className="text-xs text-muted tabular">{value}/{total}</span>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-fg-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="rounded-lg border border-critical/40 bg-critical-soft px-4 py-3 text-sm text-critical-text">{error}</div>;
}
