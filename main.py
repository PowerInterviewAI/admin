from functools import lru_cache
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi_mongo_admin import mount_admin_app
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseSettings, Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    mongo_uri: str = Field(..., env="MONGO_URI")
    mongo_db: str = Field("admin", env="MONGO_DB")

    admin_prefix: str = Field("/admin", env="ADMIN_PREFIX")
    ui_mount_path: str = Field("/admin-ui", env="ADMIN_UI_MOUNT_PATH")

    host: str = Field("0.0.0.0", env="HOST")
    port: int = Field(8000, env="PORT")
    debug: bool = Field(False, env="DEBUG")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def get_database() -> AsyncIOMotorDatabase:
    """Return a MongoDB database instance.

    Motor client objects should be reused across the app lifetime.
    """

    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongo_uri)
    return client[settings.mongo_db]


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="MongoDB Admin Panel", debug=settings.debug)

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        logger.info("%s %s", request.method, request.url)
        response = await call_next(request)
        logger.info("%s %s -> %s", request.method, request.url, response.status_code)
        return response

    mount_admin_app(
        app,
        get_database=get_database,
        router_prefix=settings.admin_prefix,
        ui_mount_path=settings.ui_mount_path,
        require_auth=False,  # Set to True for production and provide an auth_dependency
    )

    @app.get("/")
    def read_root() -> dict[str, str]:
        return {"message": "MongoDB Admin Panel is running."}

    return app


app = create_app()
