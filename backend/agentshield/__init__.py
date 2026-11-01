"""AgentShield: runtime protection for tool-using AI agents."""

from agentshield.judges import muse_judge, openai_judge
from agentshield.scanner import ContentScanner, heuristic_spans
from agentshield.shield import Shield, parse_arguments
from agentshield.types import (
    OUTPUT_SINK, SENSITIVE, STATE_CHANGE, UNTRUSTED, Check, Decision, JudgeRequest, Observation, ScanReport,
    ShieldDenied, ShieldPolicy, ToolPolicy,
)

__all__ = [
    "Shield", "ShieldPolicy", "ToolPolicy", "Decision", "Check", "Observation", "ScanReport", "ShieldDenied",
    "JudgeRequest", "ContentScanner", "heuristic_spans", "parse_arguments", "muse_judge", "openai_judge",
    "UNTRUSTED", "SENSITIVE", "STATE_CHANGE", "OUTPUT_SINK",
]
__version__ = "0.1.0"
