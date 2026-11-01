"""Re-derive outcome counters added after some runs were recorded, from their persisted traces.

Usage: python -m scripts.backfill_outcomes
Fills `injections_removed` (flagged content_scan events) and `attacker_calls_blocked` (calls denied by a
defense layer that matched the scenario's attacker actions). Idempotent; never touches verdicts.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.db.models import Event, Run
from app.db.session import SessionLocal
from app.runner import refresh_summary
from app.scenarios.registry import get_scenario


async def main() -> None:
    touched_experiments: set[str] = set()
    async with SessionLocal() as db:
        runs = (await db.execute(select(Run).where(Run.outcome.is_not(None)))).scalars().all()
        updated = 0
        for run in runs:
            outcome = dict(run.outcome or {})
            if "injections_removed" in outcome and "attacker_calls_blocked" in outcome:
                continue
            events = (await db.execute(select(Event).where(Event.run_id == run.id).order_by(Event.seq))).scalars().all()
            scenario = get_scenario(run.scenario_id)
            proposed = {e.payload.get("call_id"): e.payload for e in events if e.type == "tool_call_proposed"}
            removed = sum(1 for e in events if e.type == "content_scan" and e.payload.get("flagged"))
            blocked = 0
            for e in events:
                if e.type != "tool_call_denied" or e.payload.get("layer") == "gateway" or scenario is None:
                    continue
                call = proposed.get(e.payload.get("call_id"), {})
                if any(m.matches(call.get("tool", ""), call.get("args") or {}) for m in scenario.attacker_actions):
                    blocked += 1
            outcome.setdefault("injections_removed", removed)
            outcome.setdefault("attacker_calls_blocked", blocked)
            run.outcome = outcome
            touched_experiments.add(run.experiment_id)
            updated += 1
        await db.commit()
    for exp_id in touched_experiments:
        await refresh_summary(exp_id)
    print(f"backfilled {updated} runs across {len(touched_experiments)} experiments")


if __name__ == "__main__":
    asyncio.run(main())
