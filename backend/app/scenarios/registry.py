"""Loads and validates scenario definitions from app/scenarios/data/*.json."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.env.tools import TOOLS
from app.scenarios.schema import Scenario

DATA_DIR = Path(__file__).parent / "data"


def _validate_against_tools(s: Scenario) -> None:
    unknown = set(s.tools) - set(TOOLS)
    if unknown:
        raise ValueError(f"{s.id}: unknown tools {unknown}")
    trajectories = [s.oracle.safe] + ([s.oracle.hijacked] if s.oracle.hijacked else [])
    for traj in trajectories:
        for call in traj.calls:
            if call.tool not in s.tools:
                raise ValueError(f"{s.id}: oracle uses invisible tool {call.tool}")


@lru_cache
def load_scenarios() -> dict[str, Scenario]:
    scenarios: dict[str, Scenario] = {}
    for path in sorted(DATA_DIR.glob("*.json")):
        scenario = Scenario.model_validate(json.loads(path.read_text(encoding="utf-8")))
        _validate_against_tools(scenario)
        if scenario.id in scenarios:
            raise ValueError(f"duplicate scenario id {scenario.id}")
        scenarios[scenario.id] = scenario
    for s in scenarios.values():
        if s.pair_of and s.pair_of not in scenarios:
            raise ValueError(f"{s.id}: pair_of references unknown scenario {s.pair_of}")
    return scenarios


def get_scenario(scenario_id: str) -> Scenario | None:
    return load_scenarios().get(scenario_id)
