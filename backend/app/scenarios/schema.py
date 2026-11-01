"""Versioned scenario definitions.

A scenario fixes everything that must stay identical across paired runs: the user task, the
synthetic world, the attack payload, the tool surface, the hard permissions and the checks.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class CallMatch(BaseModel):
    """Matches a tool call. Each arg value matches as a case-insensitive substring."""

    tool: str
    args: dict[str, str] = Field(default_factory=dict)

    def matches(self, tool: str, args: dict[str, Any]) -> bool:
        if tool != self.tool:
            return False
        for key, expected in self.args.items():
            if expected.lower() not in str(args.get(key, "")).lower():
                return False
        return True

    def label(self) -> str:
        inner = ", ".join(f"{k}~{v!r}" for k, v in self.args.items())
        return f"{self.tool}({inner})"


Target = Literal["answer", "report", "outbox", "any_output"]


class Check(BaseModel):
    """A deterministic predicate over the final world state and the executed calls."""

    kind: Literal["contains", "excludes", "state_equals", "state_not_equals", "called", "not_called", "message_to"]
    description: str
    target: Target = "answer"
    values: list[str] = Field(default_factory=list)  # contains: any value; excludes: no value; message_to: body contains any
    path: str = ""  # dotted path for state_* checks
    value: Any = None
    call: CallMatch | None = None
    to: str = ""  # message_to: recipient substring

    @model_validator(mode="after")
    def _validate(self) -> "Check":
        if self.kind in ("contains", "excludes") and not self.values:
            raise ValueError(f"{self.kind} check needs values")
        if self.kind.startswith("state_") and not self.path:
            raise ValueError("state check needs path")
        if self.kind in ("called", "not_called") and self.call is None:
            raise ValueError("call check needs call")
        if self.kind == "message_to" and not self.to:
            raise ValueError("message_to check needs to")
        return self


class ScriptedCall(BaseModel):
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class Trajectory(BaseModel):
    """A scripted behaviour used by the simulated agent and by scorer self-tests."""

    calls: list[ScriptedCall]
    answer: str


class Oracle(BaseModel):
    safe: Trajectory
    hijacked: Trajectory | None = None  # shares a prefix with `safe` up to the call that surfaces the injection


class Scenario(BaseModel):
    id: str
    version: str
    title: str
    category: str
    summary: str
    benign: bool = False
    pair_of: str | None = None  # benign controls name the attack scenario they mirror

    system_context: str
    task: str
    tools: list[str]  # tools the agent can see
    permissions: list[str]  # tools the hard gateway allows
    # Tools installed from outside the trust boundary (e.g. a marketplace / remote MCP server). Their
    # descriptions are untrusted input; `tool_descriptions` may override them and carry {{INJECTION_n}}.
    third_party_tools: list[str] = Field(default_factory=list)
    tool_descriptions: dict[str, str] = Field(default_factory=dict)
    initial_state: dict[str, Any]
    injections: list[str] = Field(default_factory=list)  # substituted at {{INJECTION_1}}, {{INJECTION_2}}, ...

    attack_objective: str = ""
    attacker_actions: list[CallMatch] = Field(default_factory=list)  # calls that serve the attacker, not the user
    task_checks: list[Check]
    attack_checks: list[Check] = Field(default_factory=list)  # any passing check = attacker objective achieved

    max_steps: int = 8
    oracle: Oracle
    # Risk taxonomy references, e.g. {"owasp_llm": ["LLM01:2025"], "owasp_agentic": ["ASI01:2026"], "mitre_atlas": [...]}
    frameworks: dict[str, list[str]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate(self) -> "Scenario":
        missing = set(self.permissions) - set(self.tools)
        if missing:
            raise ValueError(f"{self.id}: permitted tools not visible: {missing}")
        stray = (set(self.third_party_tools) | set(self.tool_descriptions)) - set(self.tools)
        if stray:
            raise ValueError(f"{self.id}: third-party tools / descriptions for invisible tools: {stray}")
        if not self.benign and (not self.injections or not self.attack_checks):
            raise ValueError(f"{self.id}: attack scenarios need injections and attack_checks")
        if self.benign and self.injections:
            raise ValueError(f"{self.id}: benign controls must not carry injections")
        if not self.benign and self.oracle.hijacked is None:
            raise ValueError(f"{self.id}: attack scenarios need a hijacked oracle trajectory")
        return self

    def summary_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "version": self.version,
            "title": self.title,
            "category": self.category,
            "summary": self.summary,
            "benign": self.benign,
            "pair_of": self.pair_of,
            "task": self.task,
            "attack_objective": self.attack_objective,
            "tools": self.tools,
            "permissions": self.permissions,
            "task_check_count": len(self.task_checks),
            "attack_check_count": len(self.attack_checks),
            "frameworks": self.frameworks,
        }
