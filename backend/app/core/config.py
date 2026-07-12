from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve backend/.env absolutely so settings load no matter the process CWD — e.g. when the
# MCP server is launched by Claude Desktop from a different working directory.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    app_name: str = "Service Tracker"
    env: str = "development"
    database_url: str = "postgresql+psycopg://service:service@localhost:5432/service_tracker"
    seed_demo_data: bool = True

    # Auth (Phase 4)
    jwt_secret: str = "change-me-in-prod"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # AI layer (Phase 5) — off by default. The features (ticket ranking, delivery-note
    # drafting, assistant + agent) always work via deterministic fallbacks; the LLM is only
    # used to enhance them when ai_enabled is true AND the chosen provider is usable.
    ai_enabled: bool = False
    ai_provider: str = "groq"          # "groq" (cloud free tier) | "ollama" (local, offline)
    ai_timeout_seconds: float = 30.0

    # Groq (cloud, free tier — needs a free API key from https://console.groq.com/keys)
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Ollama (fully local, no key — run `ollama serve` and `ollama pull <model>`)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"
    # Ordered local fallback models (comma-separated Ollama tags), tried in turn after the
    # primary if it errors/isn't pulled. All free/local. Principle 2 — model-level failover.
    ollama_fallback_models: str = "qwen2.5:3b,gemma2:2b"

    # Embeddings for the RAG / semantic-search layer (always local Ollama, free).
    ollama_embed_model: str = "nomic-embed-text"
    ollama_embed_dim: int = 768

    # If True, fall over to Groq (cloud) after every local model fails. Default off = local-only.
    ai_cloud_failover: bool = False

    @property
    def ollama_model_chain(self) -> list[str]:
        """Primary model followed by the configured fallbacks (deduped, order preserved)."""
        chain: list[str] = []
        for m in [self.ollama_model, *self.ollama_fallback_models.split(",")]:
            m = m.strip()
            if m and m not in chain:
                chain.append(m)
        return chain

    @property
    def ai_ready(self) -> bool:
        """True only when the LLM path is usable for the configured provider.

        Ollama runs locally and needs no key; Groq needs an API key. Either way the feature
        flag must be on. When False, every AI feature falls back to deterministic logic.
        """
        if not self.ai_enabled:
            return False
        if self.ai_provider == "ollama":
            return True
        return bool(self.groq_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
