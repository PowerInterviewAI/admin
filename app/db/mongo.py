from typing import Any

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.asynchronous.mongo_client import AsyncMongoClient

from app.cfg import config as cfg

pymongo_client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(
    cfg.MONGO_URL,
    document_class=dict[str, Any],
)

pymongo_db: AsyncDatabase[dict[str, Any]] = pymongo_client.get_database(cfg.MONGO_DB)


def get_database() -> AsyncDatabase[dict[str, Any]]:
    return pymongo_db
