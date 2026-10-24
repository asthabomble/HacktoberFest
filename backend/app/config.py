from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_provider: Literal["google", "ollama"] = "google"

    google_api_key: str = ""
    google_model: str = "gemma-4-26b-a4b-it"
    google_thinking_level: str = "minimal"  # Gemma 4 thinks before answering; "" = model default (slower)

    # Google OAuth web client. Keep the client secret server-side only.
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_redirect_uri: str = "http://localhost:8000/api/auth/google/callback"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gemma3:4b"

    ai_timeout_seconds: float = 90

    database_url: str = "sqlite:///./data/hisaabkitaab.db"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
