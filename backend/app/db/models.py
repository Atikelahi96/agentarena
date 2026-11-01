from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return uuid.uuid4().hex[:16]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Experiment(Base):
    __tablename__ = "experiments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[str] = mapped_column(String(20), default="experiment")  # experiment | arena | redteam
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | completed | cancelled | failed
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    total_runs: Mapped[int] = mapped_column(Integer, default=0)
    finished_runs: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    runs: Mapped[list["Run"]] = relationship(back_populates="experiment", cascade="all, delete-orphan")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    scenario_id: Mapped[str] = mapped_column(String(100), index=True)
    scenario_version: Mapped[str] = mapped_column(String(20))
    benign: Mapped[bool] = mapped_column(Boolean, default=False)
    model: Mapped[str] = mapped_column(String(100), index=True)
    defense: Mapped[str] = mapped_column(String(50), index=True)
    repeat: Mapped[int] = mapped_column(Integer, default=0)
    seed: Mapped[int] = mapped_column(Integer, default=0)  # shared by paired runs; drives the simulated agent only
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | completed | step_limit | error | cancelled
    injections: Mapped[list[str]] = mapped_column(JSONB, default=list)
    outcome: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    final_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_state: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    usage: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    error_kind: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    experiment: Mapped[Experiment] = relationship(back_populates="runs")


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("run_id", "seq"), Index("ix_events_run_seq", "run_id", "seq"))

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
