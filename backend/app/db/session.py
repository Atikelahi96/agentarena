from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import asyncpg
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

log = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
BASELINE_REVISION = "fa8a341f1ecd"  # initial schema

engine = create_async_engine(get_settings().database_url, pool_size=10, max_overflow=10, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def ensure_database() -> None:
    """Create the target database if it does not exist yet (local dev convenience)."""
    url = make_url(get_settings().database_url)
    name = url.database
    conn = await asyncpg.connect(
        user=url.username, password=url.password, host=url.host or "localhost", port=url.port or 5432,
        database="postgres",
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{name}"')
            log.info("created database %s", name)
    finally:
        await conn.close()


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.attributes["configure_logger"] = False
    return cfg


async def init_db() -> None:
    try:
        await ensure_database()
    except Exception as exc:  # noqa: BLE001 - managed Postgres may not allow CREATE DATABASE
        log.warning("could not verify/create database: %s", exc)

    async with engine.connect() as conn:
        tables = set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
    cfg = _alembic_config()
    # Alembic's async env starts its own event loop, so run it off the server loop.
    if "experiments" in tables and "alembic_version" not in tables:
        log.info("existing schema without migration history; stamping baseline %s", BASELINE_REVISION)
        await asyncio.to_thread(command.stamp, cfg, BASELINE_REVISION)
    await asyncio.to_thread(command.upgrade, cfg, "head")
    log.info("database schema is at head")
