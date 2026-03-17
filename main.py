import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Awaitable, Callable

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi_mongo_admin import mount_admin_app
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase


@dataclass(frozen=True)
class Settings:
    """Application settings loaded from environment variables."""

    mongo_uri: str
    mongo_db: str = "admin"

    admin_prefix: str = "/admin"
    ui_mount_path: str = "/admin-ui"

    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False


def _load_dotenv() -> None:
    env_path = Path(".env")
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)


@lru_cache()
def get_settings() -> Settings:
    _load_dotenv()

    mongo_uri = os.getenv("MONGO_URI", "").strip()
    if not mongo_uri:
        raise RuntimeError("MONGO_URI must be set in the environment or .env file")

    return Settings(
        mongo_uri=mongo_uri,
        mongo_db=os.getenv("MONGO_DB", "admin"),
        admin_prefix=os.getenv("ADMIN_PREFIX", "/admin"),
        ui_mount_path=os.getenv("ADMIN_UI_MOUNT_PATH", "/admin-ui"),
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        debug=os.getenv("DEBUG", "false").lower() in ("1", "true", "yes"),
    )


@lru_cache()
def get_motor_client() -> AsyncIOMotorClient:
    settings = get_settings()
    return AsyncIOMotorClient(settings.mongo_uri)


def get_database() -> AsyncIOMotorDatabase:
    """Return a MongoDB database instance.

    Motor client objects should be reused across the app lifetime.
    """

    settings = get_settings()
    return get_motor_client()[settings.mongo_db]


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="MongoDB Admin Panel", debug=settings.debug)

    @app.middleware("http")
    async def log_requests(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
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
