"""Experiment orchestration: expands a configuration into paired runs and executes them.

Events are written to Postgres as they happen so the UI can follow a run live. Failed runs are
kept with their evidence and reported as errors; they never count as a successful defense.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from sqlalchemy import select, update

from app.agent.defenses import DEFENSES
from app.agent.loop import run_agent
from app.config import MODEL_PROFILES, get_settings
from app.db.models import Event, Experiment, Run, utcnow
from app.db.session import SessionLocal
from app.evaluation.metrics import compare
from app.evaluation.scorer import score_run
from app.models.adapter import ModelError, build_client
from app.scenarios.registry import get_scenario

log = logging.getLogger(__name__)

_tasks: set[asyncio.Task[Any]] = set()
_cancelled: set[str] = set()
_semaphore: asyncio.Semaphore | None = None


def _sem() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().run_concurrency)
    return _semaphore


async def create_experiment(name: str, kind: str, scenario_ids: list[str], defenses: list[str], models: list[str],
                            repeats: int, injections_override: dict[str, list[str]] | None = None) -> str:
    async with SessionLocal() as db:
        exp = Experiment(name=name, kind=kind, status="queued", config={
            "scenario_ids": scenario_ids, "defenses": defenses, "models": models, "repeats": repeats,
        })
        db.add(exp)
        await db.flush()
        runs = []
        # Experiments use fixed seeds (reproducible); each arena match draws a fresh one.
        # Paired runs always share the seed of their repeat.
        seed_base = random.randrange(1, 1_000_000) if kind == "arena" else 0
        # Interleave conditions so partial results stay balanced across defenses.
        for repeat in range(repeats):
            for scenario_id in scenario_ids:
                scenario = get_scenario(scenario_id)
                assert scenario is not None
                injections = (injections_override or {}).get(scenario_id, scenario.injections)
                for model in models:
                    for defense in defenses:
                        runs.append(Run(
                            experiment_id=exp.id, scenario_id=scenario.id, scenario_version=scenario.version,
                            benign=scenario.benign, model=model, defense=defense, repeat=repeat, seed=seed_base + repeat,
                            simulated=MODEL_PROFILES[model].simulated, injections=injections,
                        ))
        db.add_all(runs)
        exp.total_runs = len(runs)
        await db.commit()
        run_ids = [r.id for r in runs]
        exp_id = exp.id
    task = asyncio.create_task(_execute_experiment(exp_id, run_ids))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return exp_id


def cancel_experiment(exp_id: str) -> None:
    _cancelled.add(exp_id)


async def _execute_experiment(exp_id: str, run_ids: list[str]) -> None:
    async with SessionLocal() as db:
        await db.execute(update(Experiment).where(Experiment.id == exp_id).values(status="running"))
        await db.commit()
    try:
        await asyncio.gather(*(_guarded_run(exp_id, rid) for rid in run_ids))
        status = "cancelled" if exp_id in _cancelled else "completed"
        await refresh_summary(exp_id, status=status)
    except Exception as exc:  # noqa: BLE001
        log.exception("experiment %s failed", exp_id)
        async with SessionLocal() as db:
            await db.execute(update(Experiment).where(Experiment.id == exp_id).values(
                status="failed", error=repr(exc)[:2000], finished_at=utcnow()))
            await db.commit()
    finally:
        _cancelled.discard(exp_id)


async def _guarded_run(exp_id: str, run_id: str) -> None:
    async with _sem():
        if exp_id in _cancelled:
            async with SessionLocal() as db:
                await db.execute(update(Run).where(Run.id == run_id).values(status="cancelled", finished_at=utcnow()))
                await db.commit()
        elif not await _run_within_budget(run_id):
            async with SessionLocal() as db:
                await db.execute(update(Run).where(Run.id == run_id).values(
                    status="error", error_kind="budget_exceeded", finished_at=utcnow(),
                    error_message="Daily model budget reached before this run started."))
                await db.commit()
        else:
            await execute_run(run_id)
    async with SessionLocal() as db:
        await db.execute(update(Experiment).where(Experiment.id == exp_id)
                         .values(finished_runs=Experiment.finished_runs + 1))
        await db.commit()


async def _run_within_budget(run_id: str) -> bool:
    from app.limits import budget_allows_run

    async with SessionLocal() as db:
        run = await db.get(Run, run_id)
        simulated = bool(run and run.simulated)
    return simulated or await budget_allows_run()


async def execute_run(run_id: str) -> None:
    async with SessionLocal() as db:
        run = await db.get(Run, run_id)
        assert run is not None
        run.status, run.started_at = "running", utcnow()
        await db.commit()
        scenario_id, model_id, defense_id = run.scenario_id, run.model, run.defense
        seed, injections = run.seed, list(run.injections or [])

    scenario = get_scenario(scenario_id)
    defense = DEFENSES[defense_id]
    profile = MODEL_PROFILES[model_id]
    seq = 0

    async def emit(event_type: str, payload: dict[str, Any]) -> None:
        nonlocal seq
        seq += 1
        async with SessionLocal() as edb:
            edb.add(Event(run_id=run_id, seq=seq, type=event_type, payload=payload))
            await edb.commit()

    started = time.perf_counter()
    values: dict[str, Any]
    try:
        assert scenario is not None
        client = build_client(profile, scenario, defense.spotlight, seed, injections=injections)
        result = await run_agent(scenario, defense, client, emit, injections=injections)
        outcome = score_run(scenario, result)
        outcome["simulated"] = profile.simulated
        for check in outcome["checks"]:
            await emit("assertion", check)
        await emit("run_completed", {k: v for k, v in outcome.items() if k != "checks"})
        usage = {"agent": result.agent_usage, "monitor": result.monitor_usage,
                 "total_tokens": result.agent_usage.get("total_tokens", 0) + result.monitor_usage.get("total_tokens", 0)}
        values = dict(status=result.status, outcome=outcome, final_answer=result.final_answer,
                      final_state=result.world.state, usage=usage,
                      error_kind=result.error_kind, error_message=result.error_message)
    except ModelError as exc:
        await emit("run_failed", {"error_kind": exc.kind, "error": str(exc)[:1000]})
        values = dict(status="error", error_kind=exc.kind, error_message=str(exc)[:2000])
    except Exception as exc:  # noqa: BLE001 - infrastructure failure is recorded, not hidden
        log.exception("run %s crashed", run_id)
        await emit("run_failed", {"error_kind": "internal", "error": repr(exc)[:1000]})
        values = dict(status="error", error_kind="internal", error_message=repr(exc)[:2000])

    async with SessionLocal() as db:
        await db.execute(update(Run).where(Run.id == run_id).values(
            finished_at=utcnow(), duration_ms=int((time.perf_counter() - started) * 1000), **values))
        await db.commit()


def run_row(r: Run) -> dict[str, Any]:
    return {
        "id": r.id, "model": r.model, "defense": r.defense, "scenario_id": r.scenario_id,
        "scenario_version": r.scenario_version, "benign": r.benign, "repeat": r.repeat,
        "simulated": r.simulated, "status": r.status, "outcome": r.outcome, "usage": r.usage,
        "duration_ms": r.duration_ms, "error_kind": r.error_kind,
    }


async def refresh_summary(exp_id: str, status: str | None = None) -> dict[str, Any]:
    async with SessionLocal() as db:
        runs = (await db.execute(select(Run).where(Run.experiment_id == exp_id))).scalars().all()
        finished = [run_row(r) for r in runs if r.status not in ("queued", "running", "cancelled")]
        summary = compare(finished)
        values: dict[str, Any] = {"summary": summary}
        if status:
            values.update(status=status, finished_at=utcnow())
        await db.execute(update(Experiment).where(Experiment.id == exp_id).values(**values))
        await db.commit()
        return summary


async def mark_interrupted() -> None:
    """Runs that were in flight when the server stopped are recorded as errors, not dropped."""
    async with SessionLocal() as db:
        await db.execute(update(Run).where(Run.status.in_(["queued", "running"])).values(
            status="error", error_kind="interrupted", error_message="Server restarted before the run finished.",
            finished_at=utcnow()))
        stale = (await db.execute(select(Experiment.id).where(Experiment.status.in_(["queued", "running"])))).scalars().all()
        await db.commit()
    for exp_id in stale:
        await refresh_summary(exp_id, status="failed")
