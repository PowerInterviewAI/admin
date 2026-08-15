from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    MONGO_URL: str = "mongodb://127.0.0.1:27017"
    MONGO_DB: str = "power_interview_ai"

    HOST: str = "0.0.0.0"  # noqa: S104
    PORT: int = 8000
    DEBUG: bool = False

    # Comma-separated list of origins allowed to call this API from a browser.
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


config = Config()
