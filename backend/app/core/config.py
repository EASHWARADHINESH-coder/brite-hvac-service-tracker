from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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

    # Embeddings for the RAG / semantic-search layer (always local Ollama, free).
    ollama_embed_model: str = "nomic-embed-text"
    ollama_embed_dim: int = 768

    # Reliability: try the other provider if the primary errors (Principle 2 — failover).
    ai_failover: bool = True

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
