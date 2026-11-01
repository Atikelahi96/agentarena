"""Core types shared by every AgentShield layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Protocol

from pydantic import BaseModel

# Capabilities from Meta's "Agents Rule of Two" plus one AgentShield-specific tag.
UNTRUSTED = "untrusted_input"  # A: returns content an outside party could have authored
SENSITIVE = "sensitive_access"  # B: reads private data or secrets
STATE_CHANGE = "state_change"  # C: changes state or communicates externally
OUTPUT_SINK = "output_sink"  # writes a user-facing deliverable (not a Rule-of-Two property)

RULE_OF_TWO = (UNTRUSTED, SENSITIVE, STATE_CHANGE)

# Argument names whose whole value selects *what* is acted on (recipient, record, task...).
DEFAULT_CONTROL_FIELDS = frozenset({
    "to", "cc", "bcc", "recipient", "recipients", "url", "repo", "repository", "path",
    "task_id", "customer_id", "record_id", "ticket_id", "issue_number", "name",
})


def is_sink(capabilities: frozenset[str]) -> bool:
    return STATE_CHANGE in capabilities or OUTPUT_SINK in capabilities


@dataclass(frozen=True)
class ToolPolicy:
    """What AgentShield needs to know about one tool."""

    capabilities: frozenset[str] = frozenset()
    args_model: type[BaseModel] | None = None  # validates arguments when provided
    control_fields: frozenset[str] = DEFAULT_CONTROL_FIELDS
    third_party: bool = False  # description authored outside your trust boundary (e.g. a remote MCP server)
    description: str = ""


@dataclass(frozen=True)
class ShieldPolicy:
    permissions: frozenset[str] | None = None  # tools this session may call; None = every registered tool
    spotlight: bool = False  # datamark untrusted content and harden the system prompt
    scanner: Literal["off", "heuristic", "model"] = "off"  # content scanner on untrusted input
    scanner_action: Literal["redact", "flag"] = "redact"
    provenance: bool = False  # taint tracking on state-changing calls
    rule_of_two: bool = False  # Meta's Agents Rule of Two
    monitor: bool = False  # model-based alignment check of every call


@dataclass
class Check:
    layer: str
    allowed: bool
    rule: str
    reason: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class Decision:
    tool: str
    args: dict[str, Any] | None
    checks: list[Check]
    parsed_args: dict[str, Any] | None = None  # validated/normalized arguments when allowed

    @property
    def allowed(self) -> bool:
        return all(c.allowed for c in self.checks)

    @property
    def denial(self) -> Check | None:
        return next((c for c in self.checks if not c.allowed), None)


@dataclass
class ScanReport:
    source: str
    flagged: bool
    spans: list[str]
    method: str  # heuristic | model | model+heuristic | heuristic(fallback)
    reason: str = ""
    action: str = "none"  # none | redact | flag


@dataclass
class Observation:
    """A tool result after AgentShield processed it."""

    content: Any  # what the agent should see (possibly redacted)
    rendered: str  # string form to send to the model (possibly datamarked)
    scan: ScanReport | None = None


@dataclass
class JudgeRequest:
    """A request to the model behind the monitor or the scanner.

    `system`/`user` are ready-to-send prompts; the structured fields let non-LLM judges
    (tests, simulations) decide without parsing prompts.
    """

    kind: Literal["monitor", "scan"]
    system: str
    user: str
    task: str = ""
    tool: str = ""
    args: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    text: str = ""


class Judge(Protocol):
    def __call__(self, request: JudgeRequest) -> Awaitable[str]: ...


EventHook = Callable[[str, dict[str, Any]], Awaitable[None]]


class ShieldDenied(Exception):
    def __init__(self, decision: Decision):
        denial = decision.denial
        super().__init__(denial.reason if denial else "denied")
        self.decision = decision
