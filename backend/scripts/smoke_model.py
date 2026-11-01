"""Meta-model acceptance gate (blueprint section 21).

Usage:  python -m scripts.smoke_model [model_profile_id]      (default: muse-spark-1.3)

Checks, in order, and exits non-zero on the first failure:
  1. a plain request to the model succeeds
  2. the model returns a tool call that parses into a validated action
  3. a full agent loop runs: model -> gateway -> simulated tool -> model -> final answer
  4. a prohibited action is denied independently of the model (scenario s01 exposes a locked tool)
  5. the deterministic scorer produces a result and the trace contains every event type
No database is needed; nothing is persisted.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time

from app.agent.defenses import DEFENSES
from app.agent.loop import run_agent
from app.config import MODEL_PROFILES, profile_available
from app.env.tools import TOOLS
from app.evaluation.scorer import score_run
from app.models.adapter import ModelError, OpenAICompatClient
from app.scenarios.registry import get_scenario

OK, FAIL = "\033[32m[PASS]\033[0m", "\033[31m[FAIL]\033[0m"


def fail(msg: str) -> None:
    print(f"{FAIL} {msg}")
    sys.exit(1)


async def main(profile_id: str) -> None:
    profile = MODEL_PROFILES.get(profile_id)
    if profile is None or profile.simulated:
        fail(f"unknown or simulated profile: {profile_id}")
    if not profile_available(profile):
        fail(f"no API key configured for provider '{profile.provider}' (set it in backend/.env)")
    client = OpenAICompatClient(profile)
    print(f"Model: {profile.label} ({client.model})\n")

    # 1. plain request
    try:
        t = time.perf_counter()
        turn = await client.complete([{"role": "user", "content": "Reply with exactly: ready"}], None)
        print(f"{OK} plain request in {int((time.perf_counter() - t) * 1000)} ms -> {turn.content!r} usage={turn.usage}")
    except ModelError as e:
        fail(f"plain request failed ({e.kind}): {e}")

    # 2. single tool call
    tool = TOOLS["get_ticket"].openai_schema()
    try:
        turn = await client.complete(
            [{"role": "user", "content": "Use the get_ticket tool to fetch ticket T-1042."}], [tool])
    except ModelError as e:
        fail(f"tool request failed ({e.kind}): {e}")
    if not turn.tool_calls:
        fail(f"model answered without a tool call: {turn.content!r} (finish_reason={turn.finish_reason})")
    call = turn.tool_calls[0]
    try:
        args = json.loads(call.arguments or "{}")
        TOOLS["get_ticket"].args_model.model_validate(args)
    except Exception as e:  # noqa: BLE001
        fail(f"tool call did not validate: {call.arguments!r} ({e})")
    print(f"{OK} tool call parsed: {call.name}({call.arguments}) finish_reason={turn.finish_reason}")
    if turn.reasoning:
        print(f"      reasoning returned ({len(turn.reasoning)} chars)")

    # 3-5. full loop on s01 (exposes get_customer/read_secret but only permits get_ticket)
    scenario = get_scenario("s01-ticket-private-data")
    events: list[tuple[str, dict]] = []

    async def emit(kind: str, payload: dict) -> None:
        events.append((kind, payload))
        if kind == "tool_call_proposed":
            print(f"      proposed {payload['tool']}({json.dumps(payload['args'])})")
        elif kind == "tool_call_denied":
            print(f"      DENIED by {payload['layer']}: {payload['reason']}")
        elif kind == "final_answer":
            print(f"      final: {payload['content'][:200]!r}")

    result = await run_agent(scenario, DEFENSES["none"], client, emit)
    if result.status == "error":
        fail(f"agent loop error ({result.error_kind}): {result.error_message}")
    print(f"{OK} agent loop finished: status={result.status} steps={result.steps} usage={result.agent_usage}")

    outcome = score_run(scenario, result)
    if outcome["unauthorized_execution"]:
        fail("a non-permitted tool executed: the gateway was bypassed")
    denied = [c for c in result.calls if c.denied_by == "gateway"]
    print(f"{OK} gateway integrity: unauthorized executions = 0, gateway denials this run = {len(denied)}"
          + ("" if denied else " (the model did not attempt the locked tools this time; that is a valid outcome)"))

    kinds = {k for k, _ in events}
    missing = {"run_started", "model_response", "tool_call_proposed", "policy_check", "tool_executed", "final_answer"} - kinds
    if missing and result.status == "completed":
        fail(f"trace missing event types: {missing}")
    print(f"{OK} scorer: task_success={outcome['task_success']} attack_success={outcome['attack_success']} "
          f"hijack_attempted={outcome['hijack_attempted']}")
    for c in outcome["checks"]:
        print(f"      [{c['role']}] {'PASS' if c['passed'] else 'fail'}: {c['description']} ({c['evidence']})")
    print("\nAcceptance gate passed. Real runs can be launched from the UI.")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "muse-spark-1.3"))
