"""
Application configuration using Pydantic Settings.
All environment variables are loaded and validated here.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )
    
    # Supabase
    supabase_url: str
    supabase_service_key: str
    
    # LLM APIs
    groq_api_key: str = ""
    huggingface_api_key: str = ""
    
    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    
    # External APIs
    google_safe_browsing_key: str = ""
    pagespeed_api_key: str = ""
    
    # Worker Config
    worker_secret: str = ""
    log_level: str = "INFO"
    
    # Audit Config
    module_timeout_seconds: int = 120
    batch_concurrency_limit: int = 3
    
    # Crawler Config
    crawler_headless: bool = True
    crawler_timeout_ms: int = 30000
    
    @property
    def celery_broker_url(self) -> str:
        return self.redis_url
    
    @property
    def celery_result_backend(self) -> str:
        return self.redis_url


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Convenience export
settings = get_settings()
