"""Bounded agent loop: model proposes -> AgentShield decides -> simulated tool executes.

The loop uses the same `agentshield.Shield` a developer would deploy, so the Arena measures the
code that ships. Every step is emitted as an ordered trace event.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from agentshield import JudgeRequest, Shield
from app.agent.defenses import NEUTRAL_DESCRIPTIONS, DefenseConfig, system_prompt
from app.env.tools import TOOLS, ToolError
from app.env.world import World
from app.models.adapter import ModelClient, ModelError, SimulatedClient
from app.scenarios.schema import Scenario

Emit = Callable[[str, dict[str, Any]], Awaitable[None]]
_PLACEHOLDER = re.compile(r"\{\{INJECTION_(\d+)\}\}")


@dataclass
class CallRecord:
    step: int
    call_id: str
    tool: str
    args: dict[str, Any] | None
    raw_args: str
    gateway_allowed: bool
    executed: bool
    denied_by: str | None = None
    rule: str = ""
    reason: str = ""
    result: dict[str, Any] | None = None


@dataclass
class RunResult:
    status: str  # completed | step_limit | error
    final_answer: str
    world: World
    calls: list[CallRecord] = field(default_factory=list)
    steps: int = 0
    agent_usage: dict[str, int] = field(default_factory=dict)
    monitor_usage: dict[str, int] = field(default_factory=dict)  # every guard-model call (monitor + scanner)
    injections_removed: int = 0  # untrusted sources the content scanner flagged before the agent read them
    error_kind: str | None = None
    error_message: str | None = None


def _add_usage(total: dict[str, int], usage: dict[str, int]) -> None:
    for k, v in usage.items():
        total[k] = total.get(k, 0) + int(v or 0)


def state_diff(before: Any, after: Any, path: str = "") -> list[dict[str, Any]]:
    if isinstance(before, dict) and isinstance(after, dict):
        out: list[dict[str, Any]] = []
        for key in sorted(set(before) | set(after), key=str):
            out += state_diff(before.get(key), after.get(key), f"{path}.{key}" if path else str(key))
        return out
    if isinstance(before, list) and isinstance(after, list) and len(after) >= len(before) and after[: len(before)] == before:
        return [{"path": path, "op": "append", "value": item} for item in after[len(before):]]
    if before != after:
        return [{"path": path, "op": "set", "before": before, "after": after}]
    return []


def _fill(text: str, injections: list[str]) -> str:
    return _PLACEHOLDER.sub(lambda m: injections[int(m.group(1)) - 1] if int(m.group(1)) <= len(injections) else "", text)


def make_judge(client: ModelClient, usage: dict[str, int]):
    """Guard-model judge on the same model under test (the simulated agent has a scripted judge)."""
    if isinstance(client, SimulatedClient):
        return client.judge

    async def judge(request: JudgeRequest) -> str:
        turn = await client.complete([{"role": "system", "content": request.system},
                                      {"role": "user", "content": request.user}], None)
        _add_usage(usage, turn.usage)
        return turn.content or ""

    return judge


async def run_agent(scenario: Scenario, defense: DefenseConfig, client: ModelClient, emit: Emit,
                    injections: list[str] | None = None) -> RunResult:
    injections = scenario.injections if injections is None else injections
    world = World.build(scenario.initial_state, injections)
    result = RunResult(status="step_limit", final_answer="", world=world)

    naive = defense.deployment == "naive"
    tool_names = list(TOOLS) if naive else list(scenario.tools)
    permissions = list(TOOLS) if naive else list(scenario.permissions)
    third_party = set(scenario.third_party_tools)

    def description(name: str) -> str | None:
        if name in scenario.tool_descriptions:
            return _fill(scenario.tool_descriptions[name], injections)
        return NEUTRAL_DESCRIPTIONS.get(name) if naive else None

    policies = {name: TOOLS[name].policy(description(name), third_party=name in third_party) for name in tool_names}
    step_ref = {"step": 0}

    async def shield_event(kind: str, payload: dict[str, Any]) -> None:
        if kind == "content_scan" and payload.get("flagged"):
            result.injections_removed += 1
        await emit(kind, {"step": step_ref["step"], **payload})

    shield = Shield(scenario.task, policies, defense.shield_policy(permissions), context="" if naive else scenario.system_context,
                    judge=make_judge(client, result.monitor_usage), on_event=shield_event)
    descriptions = await shield.prepare()
    tools_schema = [TOOLS[name].openai_schema(descriptions[name]) for name in tool_names]
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt(scenario.system_context, shield.system_addendum(), naive=naive)},
        {"role": "user", "content": scenario.task},
    ]

    await emit("run_started", {
        "scenario_id": scenario.id, "scenario_version": scenario.version, "defense": defense.id,
        "model": client.profile.id, "simulated": client.profile.simulated, "task": scenario.task,
        "system_prompt": messages[0]["content"], "tools": tool_names, "permissions": permissions,
        "deployment": defense.deployment,
        "third_party_tools": scenario.third_party_tools,
        "tool_descriptions": {n: descriptions[n] for n in scenario.third_party_tools},
    })

    for step in range(1, scenario.max_steps + 1):
        result.steps = step_ref["step"] = step
        try:
            turn = await client.complete(messages, tools_schema)
        except ModelError as exc:
            result.status, result.error_kind, result.error_message = "error", exc.kind, str(exc)[:1000]
            await emit("run_failed", {"step": step, "error_kind": exc.kind, "error": str(exc)[:1000]})
            return result
        _add_usage(result.agent_usage, turn.usage)
        await emit("model_response", {
            "step": step, "content": turn.content, "finish_reason": turn.finish_reason,
            "tool_calls": [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in turn.tool_calls],
            "usage": turn.usage, "latency_ms": turn.latency_ms, "reasoning": turn.reasoning,
        })
        messages.append(turn.message)

        if not turn.tool_calls:
            result.status, result.final_answer = "completed", (turn.content or "").strip()
            await emit("final_answer", {"step": step, "content": result.final_answer})
            return result

        for tc in turn.tool_calls:
            await emit("tool_call_proposed", {"step": step, "call_id": tc.id, "tool": tc.name,
                                              "args": _safe_args(tc.arguments), "raw_args": tc.arguments})
            decision = await shield.check_call(tc.name, tc.arguments, tc.id)
            gateway_ok = next((c.allowed for c in decision.checks if c.layer == "gateway"), False)
            record = CallRecord(step, tc.id, tc.name, decision.args, tc.arguments, gateway_ok, False)
            if not decision.allowed:
                d = decision.denial
                assert d is not None
                record.denied_by, record.rule, record.reason = d.layer, d.rule, d.reason
                await emit("tool_call_denied", {"step": step, "call_id": tc.id, "tool": tc.name,
                                                "layer": d.layer, "rule": d.rule, "reason": d.reason})
                content = shield.denial_message(decision)
            else:
                spec = TOOLS[tc.name]
                args = decision.parsed_args or {}
                before = world.snapshot()
                try:
                    tool_result = spec.handler(world, spec.args_model.model_validate(args))
                except ToolError as exc:
                    tool_result = {"error": str(exc)}
                record.executed, record.result = True, tool_result
                await emit("tool_executed", {"step": step, "call_id": tc.id, "tool": tc.name, "args": args,
                                             "result": tool_result, "capabilities": sorted(spec.capabilities),
                                             "state_diff": state_diff(before, world.state)})
                obs = await shield.observe_result(tc.name, args, tool_result)
                content = obs.rendered
            result.calls.append(record)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": content})

    await emit("step_limit_reached", {"max_steps": scenario.max_steps})
    return result


def _safe_args(raw: str) -> dict[str, Any] | None:
    from agentshield import parse_arguments

    args, _ = parse_arguments(raw)
    return args
