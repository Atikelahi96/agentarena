"""Deterministic guards: Rule of Two and provenance (taint) tracking."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from agentshield.types import RULE_OF_TWO, SENSITIVE, STATE_CHANGE, UNTRUSTED, ToolPolicy, is_sink

RULE_OF_TWO_LABELS = {UNTRUSTED: "A untrusted input", SENSITIVE: "B sensitive access", STATE_CHANGE: "C state change"}


@dataclass
class RuleOfTwoGuard:
    """Tracks which Rule-of-Two properties the session has acquired from *executed* calls."""

    acquired: set[str] = field(default_factory=set)

    def check(self, tool: str, policy: ToolPolicy) -> tuple[bool, str]:
        after = self.acquired | set(policy.capabilities)
        if len(after & set(RULE_OF_TWO)) >= 3:
            held = ", ".join(RULE_OF_TWO_LABELS[c] for c in sorted(self.acquired & set(RULE_OF_TWO)))
            adds = ", ".join(RULE_OF_TWO_LABELS[c] for c in sorted(set(policy.capabilities) & set(RULE_OF_TWO) - self.acquired))
            return False, (
                f"Rule of Two: this session already holds [{held}]; '{tool}' would add [{adds}]. "
                "An agent may not combine untrusted input, sensitive access and state change without human approval."
            )
        return True, "Session stays within two Rule-of-Two properties."

    def record(self, policy: ToolPolicy) -> None:
        self.acquired |= set(policy.capabilities) & set(RULE_OF_TWO)


# Channels an attacker can use to route data or users elsewhere. Checked in every argument.
_CHANNEL_RE = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"  # email
    r"|https?://[^\s\"'<>)\]]+"  # url
    r"|\b(?:[a-z0-9-]+\.)+(?:example|com|net|org|io|ai|co|dev|app)\b"  # bare domain
)


def extract_entities(field_name: str, value: Any, control_fields: frozenset[str]) -> set[str]:
    """Control values in one argument: channels anywhere, plus the whole value of control fields.

    Free text (subject, body) is not a control field, so incidental ids such as tracking numbers in
    an email body are not treated as control values.
    """
    if isinstance(value, list):
        return set().union(*(extract_entities(field_name, v, control_fields) for v in value)) if value else set()
    if not isinstance(value, (str, int)):
        return set()
    value = str(value)
    found = {m.group(0).rstrip(".,;:").lower() for m in _CHANNEL_RE.finditer(value)}
    if field_name in control_fields and value.strip():
        found.add(value.strip().lower())
    return found


@dataclass
class ProvenanceGuard:
    trusted: list[str] = field(default_factory=list)
    untrusted: list[tuple[str, str]] = field(default_factory=list)  # (source label, text)

    @classmethod
    def new(cls, *trusted_texts: str) -> "ProvenanceGuard":
        return cls(trusted=[t.lower() for t in trusted_texts if t])

    def observe(self, source_label: str, text: str, trusted: bool) -> None:
        if trusted:
            self.trusted.append(text.lower())
        else:
            self.untrusted.append((source_label, text))

    def check(self, policy: ToolPolicy, args: dict[str, Any]) -> tuple[bool, str, list[dict[str, Any]]]:
        if not is_sink(policy.capabilities):
            return True, "Read-only call; provenance not required.", []
        tainted: list[dict[str, Any]] = []
        for arg_name, value in args.items():
            for entity in sorted(extract_entities(arg_name, value, policy.control_fields)):
                if any(entity in t for t in self.trusted):
                    continue
                for label, text in self.untrusted:
                    idx = text.lower().find(entity)
                    if idx != -1:
                        lo, hi = max(0, idx - 80), min(len(text), idx + len(entity) + 80)
                        tainted.append({"arg": arg_name, "value": entity, "source": label, "excerpt": text[lo:hi]})
                        break
        if tainted:
            first = tainted[0]
            return False, (
                f"Provenance: argument '{first['arg']}' uses '{first['value']}', which appears only in untrusted "
                f"content from {first['source']} and not in the user's request or any trusted source. "
                "If the user's request genuinely requires this value, confirm it from a trusted internal source first."
            ), tainted
        return True, "All control values trace to the user's request or trusted sources.", []
