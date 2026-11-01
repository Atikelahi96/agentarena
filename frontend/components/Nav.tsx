"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePolling, type Health } from "@/lib/api";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/arena", label: "Live Arena" },
  { href: "/experiments", label: "Experiments" },
  { href: "/scenarios", label: "Scenarios" },
];

export function Nav() {
  const path = usePathname();
  const { data: health, error } = usePolling<Health>("/health", 15000, () => true);
  const realModels = health?.models.filter((m) => !m.simulated && m.available) ?? [];

  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z" fill="none" stroke="var(--accent)" strokeWidth="2" />
            <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          AgentArena
        </Link>
        <div className="flex gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cx("rounded-md px-3 py-1.5 text-sm whitespace-nowrap", active ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg")}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto hidden items-center gap-2 text-xs md:flex">
          {error ? (
            <span className="text-critical-text">● API offline</span>
          ) : !health ? (
            <span className="text-muted">connecting…</span>
          ) : (
            <>
              <span className={health.database ? "text-good-text" : "text-critical-text"}>● Postgres</span>
              <span className={realModels.length ? "text-good-text" : "text-warning"} title={realModels.map((m) => m.label).join(", ")}>
                ● {realModels.length ? `${realModels.length} Meta model${realModels.length > 1 ? "s" : ""} ready` : "No model key — simulated only"}
              </span>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
