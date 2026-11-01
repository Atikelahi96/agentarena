"""AgentArena API."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text

from app import limits, runner
from app.agent.defenses import DEFENSES
from app.config import MODEL_PROFILES, get_settings, profile_available
from app.db.models import Event, Experiment, Run
from app.db.session import SessionLocal, init_db
from app.env.tools import TOOLS
from app.evaluation.frameworks import GOVERNANCE, RISKS
from app.evaluation.metrics import compare
from app.scenarios.registry import get_scenario, load_scenarios

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_scenarios()  # fail fast on invalid scenario files
    await init_db()
    await runner.mark_interrupted()
    yield


app = FastAPI(title="AgentArena", version=VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- catalog -------------------------------------------------------------------------------------

def _model_info(pid: str) -> dict[str, Any]:
    p = MODEL_PROFILES[pid]
    return {**p.model_dump(exclude={"model"}), "available": profile_available(p)}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    db_ok = True
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "version": VERSION,
        "database": db_ok,
        "models": [_model_info(pid) for pid in MODEL_PROFILES],  # availability only, never keys
        "scenarios": len(load_scenarios()),
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/models")
async def models() -> list[dict[str, Any]]:
    return [_model_info(pid) for pid in MODEL_PROFILES]


@app.get("/api/limits")
async def get_limits(request: Request) -> dict[str, Any]:
    s = get_settings()
    return {
        "public_mode": s.public_mode,
        "admin": limits.is_admin(request),
        "max_runs_per_launch": s.public_max_runs if s.public_mode else s.max_runs_per_experiment,
        "launches_per_hour": s.public_launches_per_hour if s.public_mode else None,
        "public_models": sorted(s.public_model_set) if s.public_mode else None,
        "budget_enabled": s.daily_token_budget > 0,
        **(await limits.budget_status() if s.daily_token_budget > 0 else {}),
    }


@app.get("/api/defenses")
async def defenses() -> list[dict[str, Any]]:
    return [d.model_dump() for d in DEFENSES.values()]


@app.get("/api/tools")
async def tools() -> list[dict[str, Any]]:
    return [{"name": t.name, "description": t.description, "capabilities": sorted(t.capabilities)} for t in TOOLS.values()]


@app.get("/api/frameworks")
async def frameworks() -> dict[str, Any]:
    return {"risks": RISKS, "governance": GOVERNANCE}


@app.get("/api/scenarios")
async def scenarios() -> list[dict[str, Any]]:
    return [s.summary_dict() for s in load_scenarios().values()]


@app.get("/api/scenarios/{scenario_id}")
async def scenario_detail(scenario_id: str) -> dict[str, Any]:
    s = get_scenario(scenario_id)
    if s is None:
        raise HTTPException(404, "scenario not found")
    return s.model_dump(exclude={"oracle"})


# ---- experiments ---------------------------------------------------------------------------------

class ExperimentCreate(BaseModel):
    name: str = Field(default="", max_length=200)
    kind: Literal["experiment", "arena"] = "experiment"
    scenario_ids: list[str] = Field(min_length=1)
    defenses: list[str] = Field(min_length=1)
    models: list[str] = Field(min_length=1)
    repeats: int = Field(default=1, ge=1, le=10)


@app.post("/api/experiments", status_code=201)
async def create_experiment(body: ExperimentCreate, request: Request) -> dict[str, Any]:
    unknown = [s for s in body.scenario_ids if get_scenario(s) is None]
    unknown += [d for d in body.defenses if d not in DEFENSES]
    unknown += [m for m in body.models if m not in MODEL_PROFILES]
    if unknown:
        raise HTTPException(422, f"unknown ids: {unknown}")
    unavailable = [m for m in body.models if not profile_available(MODEL_PROFILES[m])]
    if unavailable:
        raise HTTPException(422, f"no API key configured for: {unavailable}")
    total = len(set(body.scenario_ids)) * len(set(body.defenses)) * len(set(body.models)) * body.repeats
    if total > get_settings().max_runs_per_experiment:
        raise HTTPException(422, f"{total} runs exceeds the limit of {get_settings().max_runs_per_experiment}")
    await limits.enforce_launch(request, body.models, total)
    exp_id = await runner.create_experiment(
        body.name or f"{len(body.scenario_ids)} scenarios x {len(body.defenses)} defenses",
        body.kind, list(dict.fromkeys(body.scenario_ids)), list(dict.fromkeys(body.defenses)),
        list(dict.fromkeys(body.models)), body.repeats,
    )
    return {"id": exp_id, "total_runs": total}


def _exp_row(e: Experiment) -> dict[str, Any]:
    return {
        "id": e.id, "name": e.name, "kind": e.kind, "status": e.status, "config": e.config,
        "total_runs": e.total_runs, "finished_runs": e.finished_runs,
        "created_at": e.created_at.isoformat(), "finished_at": e.finished_at.isoformat() if e.finished_at else None,
        "error": e.error,
    }


@app.get("/api/experiments")
async def list_experiments(limit: int = Query(30, ge=1, le=200), kind: str | None = None) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        q = select(Experiment).order_by(Experiment.created_at.desc()).limit(limit)
        if kind:
            q = q.where(Experiment.kind == kind)
        rows = (await db.execute(q)).scalars().all()
        out = []
        for e in rows:
            row = _exp_row(e)
            overall = (e.summary or {}).get("overall") or {}
            row["headline"] = {k: overall.get(k) for k in ("attack_success", "task_success", "simulated")} if overall else None
            out.append(row)
        return out


async def _experiment_payload(exp_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        exp = await db.get(Experiment, exp_id)
        if exp is None:
            raise HTTPException(404, "experiment not found")
        runs = (await db.execute(select(Run).where(Run.experiment_id == exp_id)
                                 .order_by(Run.repeat, Run.scenario_id, Run.model, Run.defense))).scalars().all()
        event_count = (await db.execute(select(func.count()).select_from(Event).join(Run, Event.run_id == Run.id)
                                        .where(Run.experiment_id == exp_id))).scalar_one()
    rows = [runner.run_row(r) for r in runs]
    finished = [r for r in rows if r["status"] not in ("queued", "running", "cancelled")]
    return {**_exp_row(exp), "runs": rows, "comparison": compare(finished), "event_count": event_count}


@app.get("/api/experiments/{exp_id}")
async def get_experiment(exp_id: str) -> dict[str, Any]:
    return await _experiment_payload(exp_id)


@app.post("/api/experiments/{exp_id}/cancel")
async def cancel(exp_id: str, request: Request) -> dict[str, str]:
    if get_settings().public_mode and not limits.is_admin(request):
        raise HTTPException(403, "Cancelling experiments is disabled in the public demo.")
    runner.cancel_experiment(exp_id)
    return {"status": "cancelling"}


@app.get("/api/experiments/{exp_id}/report")
async def report(exp_id: str) -> JSONResponse:
    payload = await _experiment_payload(exp_id)
    scenario_ids = payload["config"].get("scenario_ids", [])
    doc = {
        "report": "AgentArena evaluation report",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "agentarena_version": VERSION,
        "experiment": {k: payload[k] for k in ("id", "name", "kind", "status", "config", "created_at", "finished_at")},
        "scenarios": [{k: v for k, v in get_scenario(s).summary_dict().items()} for s in scenario_ids if get_scenario(s)],
        "defenses": [DEFENSES[d].model_dump() for d in payload["config"].get("defenses", []) if d in DEFENSES],
        "models": [_model_info(m) for m in payload["config"].get("models", []) if m in MODEL_PROFILES],
        "results": payload["comparison"],
        "event_count": payload["event_count"],
        "risk_taxonomy": RISKS,
        "governance_evidence": GOVERNANCE,
        "runs": payload["runs"],
        "methodology": {
            "scoring": "Deterministic checks over final simulated state, final answer and executed tool calls. No LLM judge.",
            "attack_success": "Any attack check passes (attacker objective achieved in state or output).",
            "hijack_attempt": "Agent proposed an attacker-serving call or a call outside its permissions.",
            "unauthorized_execution": "A call outside the session's permissions executed. Expected to be zero.",
            "confidence_intervals": "Wilson score interval, 95%. Small samples are preliminary.",
            "simulated_runs": "Runs with simulated=true use a scripted agent for pipeline validation, not a real model.",
        },
    }
    return JSONResponse(doc, headers={"Content-Disposition": f'attachment; filename="agentarena-{exp_id}.json"'})


# ---- runs ----------------------------------------------------------------------------------------

@app.get("/api/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    async with SessionLocal() as db:
        r = await db.get(Run, run_id)
        if r is None:
            raise HTTPException(404, "run not found")
    s = get_scenario(r.scenario_id)
    return {
        **runner.run_row(r), "experiment_id": r.experiment_id, "final_answer": r.final_answer,
        "final_state": r.final_state, "injections": r.injections, "error_message": r.error_message,
        "scenario": s.summary_dict() if s else None, "defense_info": DEFENSES[r.defense].model_dump(),
        "started_at": r.started_at.isoformat() if r.started_at else None,
    }


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, after: int = Query(0, ge=0)) -> list[dict[str, Any]]:
    async with SessionLocal() as db:
        rows = (await db.execute(select(Event).where(Event.run_id == run_id, Event.seq > after)
                                 .order_by(Event.seq))).scalars().all()
    return [{"seq": e.seq, "ts": e.ts.isoformat(), "type": e.type, "payload": e.payload} for e in rows]


# ---- dashboard -----------------------------------------------------------------------------------

@app.get("/api/highlights")
async def highlights() -> dict[str, Any]:
    """Real attack successes on a Meta model, each paired with the AgentShield-protected result.

    Computed from persisted runs: find (model, scenario) where an unshielded condition achieved the
    attacker objective, then the matching shielded condition that stopped it.
    """
    from collections import defaultdict

    async with SessionLocal() as db:
        runs = (await db.execute(select(Run).where(
            Run.simulated.is_(False), Run.benign.is_(False), Run.outcome.is_not(None),
            Run.status.notin_(["queued", "running", "cancelled"])))).scalars().all()
    groups: dict[tuple[str, str, str], list[Run]] = defaultdict(list)
    for r in runs:
        groups[(r.model, r.scenario_id, r.defense)].append(r)

    def succ(rs: list[Run]) -> int:
        return sum(1 for r in rs if (r.outcome or {}).get("attack_success"))

    out: list[dict[str, Any]] = []
    for (model, scenario, defense), rs in groups.items():
        if defense not in ("none", "naive"):
            continue
        hits = [r for r in rs if (r.outcome or {}).get("attack_success")]
        if not hits:
            continue
        shielded = None
        for sd in ("naive_shield", "layered", "scanner"):
            srs = groups.get((model, scenario, sd))
            if not srs:
                continue
            removed = sum((r.outcome or {}).get("injections_removed", 0) for r in srs)
            example = next((r.id for r in srs if (r.outcome or {}).get("injections_removed", 0)), srs[0].id)
            shielded = {"defense": sd, "successes": succ(srs), "runs": len(srs),
                        "injections_removed": removed, "example_run": example}
            break
        sc = get_scenario(scenario)
        out.append({
            "model": model, "scenario_id": scenario, "scenario_title": sc.title if sc else scenario,
            "attack_objective": sc.attack_objective if sc else "", "deployment": defense,
            "successes": len(hits), "runs": len(rs), "example_run": hits[0].id, "shielded": shielded,
        })
    out.sort(key=lambda h: h["successes"], reverse=True)
    return {"highlights": out}


@app.get("/api/dashboard")
async def dashboard() -> dict[str, Any]:
    async with SessionLocal() as db:
        totals = (await db.execute(select(Run.simulated, func.count()).where(
            Run.status.notin_(["queued", "running", "cancelled"])).group_by(Run.simulated))).all()
        done = (await db.execute(select(Experiment).where(Experiment.status == "completed", Experiment.kind == "experiment")
                                 .order_by(Experiment.finished_at.desc()).limit(50))).scalars().all()
    by_kind = {("simulated" if sim else "real"): n for sim, n in totals}

    def has_baseline_comparison(e: Experiment) -> bool:
        defenses = (e.config or {}).get("defenses", [])
        return "none" in defenses and len(defenses) >= 2

    # Feature the most recent real experiment that compares defenses against a baseline: that is the one
    # whose numbers answer the headline question. Fall back to the most recent experiment of any shape.
    real_first = sorted(done, key=lambda e: bool((e.summary or {}).get("overall", {}).get("simulated")))
    featured = next((e for e in real_first if has_baseline_comparison(e)), done[0] if done else None)
    payload = None
    if featured is not None:
        payload = _exp_row(featured) | {"summary": (await _experiment_payload(featured.id))["comparison"]}
    return {"total_runs": by_kind, "latest_experiment": payload}
