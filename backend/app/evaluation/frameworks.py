"""Risk-taxonomy and governance references used by the evidence report.

AgentArena results are *evidence supporting* these items for the tested configuration; they are not
a certification of compliance.
"""

from __future__ import annotations

RISKS: dict[str, dict[str, str]] = {
    "LLM01:2025": {"framework": "OWASP Top 10 for LLM Applications 2025", "title": "Prompt Injection"},
    "LLM02:2025": {"framework": "OWASP Top 10 for LLM Applications 2025", "title": "Sensitive Information Disclosure"},
    "LLM06:2025": {"framework": "OWASP Top 10 for LLM Applications 2025", "title": "Excessive Agency"},
    "LLM09:2025": {"framework": "OWASP Top 10 for LLM Applications 2025", "title": "Misinformation"},
    "ASI01:2026": {"framework": "OWASP Top 10 for Agentic Applications 2026", "title": "Agent Goal Hijack"},
    "ASI02:2026": {"framework": "OWASP Top 10 for Agentic Applications 2026", "title": "Tool Misuse & Exploitation"},
    "ASI03:2026": {"framework": "OWASP Top 10 for Agentic Applications 2026", "title": "Identity & Privilege Abuse"},
    "AML.T0051.001": {"framework": "MITRE ATLAS", "title": "LLM Prompt Injection: Indirect"},
    "AML.T0057": {"framework": "MITRE ATLAS", "title": "LLM Data Leakage"},
}

GOVERNANCE: list[dict[str, str]] = [
    {
        "ref": "EU AI Act, Art. 15",
        "title": "Accuracy, robustness and cybersecurity",
        "evidence": "Measured attack success and task success under adversarial tool inputs, per defense, with confidence intervals and benign controls for over-blocking.",
    },
    {
        "ref": "EU AI Act, Art. 12",
        "title": "Record-keeping",
        "evidence": "Every run stores an ordered, timestamped event log: model outputs, proposed actions, each enforcement decision, tool results and state changes.",
    },
    {
        "ref": "NIST AI RMF, MEASURE 2.7",
        "title": "Security and resilience are evaluated and documented",
        "evidence": "Versioned adversarial scenarios, deterministic scoring and an exportable report reproducible from persisted runs.",
    },
    {
        "ref": "Meta, Agents Rule of Two",
        "title": "Limit untrusted input + sensitive access + state change in one session",
        "evidence": "Rule of Two is evaluated as an enforced defense, with its utility cost measured on paired benign controls.",
    },
]
