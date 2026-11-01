"""Runtime configuration. Secrets come from the environment / .env and never leave the server."""

from __future__ import annotations

from functools import lru_cache

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/agentarena"

    # Meta Model API (OpenAI-compatible). The docs call the key MODEL_API_KEY.
    meta_api_key: str = ""
    model_api_key: str = ""
    meta_base_url: str = "https://api.meta.ai/v1"
    meta_reasoning_effort: str = ""  # optional: minimal | low | medium | high | max

    # Partner inference for Meta open-weight models (OpenAI-compatible endpoints).
    fireworks_api_key: str = ""
    fireworks_base_url: str = "https://api.fireworks.ai/inference/v1"
    fireworks_model: str = "accounts/fireworks/models/muse-spark-open"
    baseten_api_key: str = ""
    baseten_base_url: str = "https://inference.baseten.co/v1"
    baseten_model: str = "meta-models/muse-spark-open"  # id as listed by Baseten /v1/models (the guide mentioned a -1026 suffix)

    request_timeout_s: float = 90.0
    max_retries: int = 3
    run_concurrency: int = 4
    max_runs_per_experiment: int = 400

    cors_origins: str = "http://localhost:3000"

    # Spend protection (see app/limits.py). Budget applies everywhere; the rest only in public mode.
    daily_token_budget: int = 0  # 0 disables; set e.g. 3000000 (a few dollars of Muse Spark) when deployed
    estimated_tokens_per_run: int = 6_000
    public_mode: bool = False
    public_max_runs: int = 24
    public_launches_per_hour: int = 6
    public_models: str = "muse-spark-1.3,muse-spark-1.3@minimal,simulated"
    admin_token: str = ""

    @property
    def public_model_set(self) -> set[str]:
        return {m.strip() for m in self.public_models.split(",") if m.strip()}

    @property
    def meta_key(self) -> str:
        return self.meta_api_key or self.model_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()


class ModelProfile(BaseModel):
    """One model under test. `simulated` profiles never call a network API."""

    id: str
    label: str
    provider: str  # meta | fireworks | baseten | mock
    model: str
    family: str  # closed | open-weights | simulated
    simulated: bool = False
    reasoning_effort: str = ""  # minimal | low | medium | high | max; empty = provider default
    temperature: float | None = None  # None = provider default
    note: str = ""


MODEL_PROFILES: dict[str, ModelProfile] = {
    p.id: p
    for p in [
        ModelProfile(
            id="muse-spark-1.3", label="Muse Spark 1.3", provider="meta", model="muse-spark-1.3",
            family="closed", note="Meta Model API, standard mode",
        ),
        ModelProfile(
            id="muse-spark-1.3@minimal", label="Muse Spark 1.3 · minimal reasoning", provider="meta",
            model="muse-spark-1.3", family="closed", reasoning_effort="minimal",
            note="Same model, fastest/cheapest reasoning setting",
        ),
        ModelProfile(
            id="muse-spark-1.3@high", label="Muse Spark 1.3 · high reasoning", provider="meta",
            model="muse-spark-1.3", family="closed", reasoning_effort="high",
        ),
        ModelProfile(
            id="muse-spark-1.3-contributor", label="Muse Spark 1.3 (Contributor)", provider="meta",
            model="muse-spark-1.3-contributor", family="closed",
            note="Discounted; prompts may be used for training. Synthetic data only.",
        ),
        ModelProfile(
            id="muse-spark-1.1", label="Muse Spark 1.1", provider="meta", model="muse-spark-1.1", family="closed",
        ),
        ModelProfile(
            id="muse-spark-1.1@t1", label="Muse Spark 1.1 · temperature 1.0", provider="meta", model="muse-spark-1.1",
            family="closed", temperature=1.0, note="High-temperature robustness probe (more stochastic)",
        ),
        ModelProfile(
            id="muse-spark-1.3@t1", label="Muse Spark 1.3 · temperature 1.0", provider="meta", model="muse-spark-1.3",
            family="closed", temperature=1.0, note="High-temperature robustness probe",
        ),
        ModelProfile(
            id="muse-wonder-1.0", label="Muse Wonder", provider="meta", model="muse-wonder-1.0", family="closed",
            note="Preview; highest cost",
        ),
        ModelProfile(
            id="muse-spark-open@fireworks", label="Muse Spark Open (Fireworks)", provider="fireworks",
            model="", family="open-weights",
        ),
        ModelProfile(
            id="muse-spark-open@baseten", label="Muse Spark Open (Baseten)", provider="baseten",
            model="", family="open-weights",
        ),
        ModelProfile(
            id="simulated", label="Simulated agent", provider="mock", model="simulated", family="simulated",
            simulated=True, note="Scripted stand-in for pipeline testing. Not a real model result.",
        ),
    ]
}


def provider_credentials(provider: str) -> tuple[str, str, str]:
    """Return (api_key, base_url, model_override) for a provider."""
    s = get_settings()
    if provider == "meta":
        return s.meta_key, s.meta_base_url, ""
    if provider == "fireworks":
        return s.fireworks_api_key, s.fireworks_base_url, s.fireworks_model
    if provider == "baseten":
        return s.baseten_api_key, s.baseten_base_url, s.baseten_model
    return "", "", ""


def profile_available(profile: ModelProfile) -> bool:
    if profile.simulated:
        return True
    key, _, _ = provider_credentials(profile.provider)
    return bool(key)
