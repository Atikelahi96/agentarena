"""Spend protection for a public deployment.

- Daily token budget across all real (non-simulated) runs, checked before an experiment is accepted
  and again before every run starts, so an in-flight experiment stops once the budget is spent.
- Per-client launch rate limit (sliding window, in memory: one API instance).
- In public mode: a cap on runs per launch and an allowlist of affordable models.
An admin token (X-Admin-Token header) bypasses the per-client limits, never the daily budget.
"""

from __future__ import annotations

import hmac
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlalchemy import Integer, cast, func, select

from app.config import MODEL_PROFILES, get_settings
from app.db.models import Run
from app.db.session import SessionLocal

_launches: dict[str, deque[float]] = defaultdict(deque)


def client_id(request: Request) -> str:
    # Behind the Next.js proxy the first X-Forwarded-For hop is the browser. It is spoofable, which is
    # acceptable here: the daily budget, not this limit, is the hard ceiling on spend.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def is_admin(request: Request) -> bool:
    token = get_settings().admin_token
    supplied = request.headers.get("x-admin-token", "")
    return bool(token) and hmac.compare_digest(token, supplied)


def _day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def tokens_spent_today() -> int:
    total = cast(Run.usage["total_tokens"].astext, Integer)
    async with SessionLocal() as db:
        value = (await db.execute(
            select(func.coalesce(func.sum(total), 0)).where(Run.simulated.is_(False), Run.created_at >= _day_start())
        )).scalar_one()
    return int(value or 0)


async def budget_status() -> dict[str, int]:
    budget = get_settings().daily_token_budget
    spent = await tokens_spent_today()
    return {"budget_tokens": budget, "spent_tokens": spent, "remaining_tokens": max(0, budget - spent)}


async def budget_allows_run() -> bool:
    budget = get_settings().daily_token_budget
    return budget <= 0 or await tokens_spent_today() < budget


async def enforce_launch(request: Request, models: list[str], total_runs: int) -> None:
    s = get_settings()
    admin = is_admin(request)
    real_runs = total_runs if any(not MODEL_PROFILES[m].simulated for m in models) else 0

    if s.public_mode and not admin:
        blocked = [m for m in models if m not in s.public_model_set]
        if blocked:
            raise HTTPException(403, f"These models are not available in the public demo: {blocked}")
        if total_runs > s.public_max_runs:
            raise HTTPException(422, f"The public demo allows up to {s.public_max_runs} runs per launch ({total_runs} requested).")
        window = _launches[client_id(request)]
        now = time.monotonic()
        while window and now - window[0] > 3600:
            window.popleft()
        if len(window) >= s.public_launches_per_hour:
            retry = int(3600 - (now - window[0])) + 1
            raise HTTPException(429, f"Launch limit reached ({s.public_launches_per_hour} per hour). Try again in {retry // 60 + 1} min.",
                                headers={"Retry-After": str(retry)})
        window.append(now)

    if real_runs and s.daily_token_budget > 0:
        status = await budget_status()
        needed = real_runs * s.estimated_tokens_per_run
        if status["remaining_tokens"] < needed:
            raise HTTPException(429, f"Daily model budget reached: about {needed:,} tokens needed, "
                                     f"{status['remaining_tokens']:,} left today. Simulated runs are still available.")
