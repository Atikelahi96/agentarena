"""Spend-protection rules (no database needed: the daily budget is disabled in these tests)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import limits
from app.config import get_settings


def _request(ip: str = "203.0.113.7", admin: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", ip.encode())]
    if admin is not None:
        headers.append((b"x-admin-token", admin.encode()))
    return Request({"type": "http", "headers": headers, "client": ("10.0.0.1", 1234)})


@pytest.fixture
def public(monkeypatch):
    monkeypatch.setenv("PUBLIC_MODE", "true")
    monkeypatch.setenv("PUBLIC_MAX_RUNS", "10")
    monkeypatch.setenv("PUBLIC_LAUNCHES_PER_HOUR", "2")
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret-admin")
    monkeypatch.setenv("DAILY_TOKEN_BUDGET", "0")
    get_settings.cache_clear()
    limits._launches.clear()
    yield
    get_settings.cache_clear()
    limits._launches.clear()


async def test_public_mode_blocks_expensive_models(public):
    with pytest.raises(HTTPException) as e:
        await limits.enforce_launch(_request(), ["muse-wonder-1.0"], 1)
    assert e.value.status_code == 403


async def test_public_mode_caps_runs_per_launch(public):
    with pytest.raises(HTTPException) as e:
        await limits.enforce_launch(_request(), ["simulated"], 11)
    assert e.value.status_code == 422


async def test_rate_limit_is_per_client_and_admin_bypasses(public):
    await limits.enforce_launch(_request("198.51.100.1"), ["simulated"], 2)
    await limits.enforce_launch(_request("198.51.100.1"), ["simulated"], 2)
    with pytest.raises(HTTPException) as e:
        await limits.enforce_launch(_request("198.51.100.1"), ["simulated"], 2)
    assert e.value.status_code == 429 and "Retry-After" in e.value.headers
    await limits.enforce_launch(_request("198.51.100.2"), ["simulated"], 2)  # another visitor is unaffected
    await limits.enforce_launch(_request("198.51.100.1", admin="s3cret-admin"), ["muse-wonder-1.0"], 50)


async def test_wrong_admin_token_does_not_bypass(public):
    with pytest.raises(HTTPException):
        await limits.enforce_launch(_request(admin="guess"), ["muse-wonder-1.0"], 1)
