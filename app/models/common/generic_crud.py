from collections.abc import Mapping
from typing import Any, Protocol

from fastapi import HTTPException, status
from loguru import logger
from pydantic import BaseModel
from pymongo import IndexModel, errors
from pymongo.asynchronous.database import AsyncDatabase

from app.models.common.base_model import TimeStampedModel
from app.models.common.object_id import PyObjectId
from app.utils.datetime import current_timestamp_ms


class _UpdateSchema(Protocol):
    """Structural bound for update schemas: a pydantic model with an `id` field."""

    id: PyObjectId

    def model_dump(self, *, exclude_unset: bool = ..., by_alias: bool = ...) -> dict[str, Any]: ...


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")


def _conflict(ex: errors.DuplicateKeyError) -> HTTPException:
    details = ex.details or {}
    key_value = details.get("keyValue", {})
    field = next(iter(key_value), None) if key_value else None
    field_title = str(field).replace("_", " ") if field else "value"
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"The same {field_title} already exists")


class GenericCRUDBase[
    DBSchema: BaseModel,
    ReadSchema: BaseModel,
    UpdateSchema: _UpdateSchema,
]:
    """Async CRUD base over a single MongoDB collection, ported from backend's `GenericCRUDBase`."""

    def __init__(
        self,
        db: AsyncDatabase[dict[str, Any]],
        collection_name: str,
        read_schema: type[ReadSchema],
    ) -> None:
        self.db = db
        self.coll = db.get_collection(collection_name)
        self.read_schema = read_schema

    async def get(
        self,
        obj_id: PyObjectId | str,
        projection: Mapping[str, Any] | None = None,
    ) -> ReadSchema:
        doc = await self.coll.find_one({"_id": PyObjectId(obj_id)}, projection)
        if doc is None:
            raise _not_found()
        return self.read_schema.model_validate(doc)

    async def search(
        self,
        query: dict[str, Any] | None = None,
        sort: list[tuple[str, int]] | None = None,
        offset: int = 0,
        length: int | None = None,
    ) -> list[ReadSchema]:
        cursor = self.coll.find(query or {})
        if sort:
            cursor = cursor.sort(sort)
        if offset:
            cursor = cursor.skip(offset)
        if length is not None:
            cursor = cursor.limit(length)
        return [self.read_schema.model_validate(doc) async for doc in cursor]

    async def count(self, query: dict[str, Any] | None = None) -> int:
        return await self.coll.count_documents(query or {})

    async def update(
        self,
        obj_update: UpdateSchema,
        projection: Mapping[str, Any] | None = None,
    ) -> ReadSchema:
        try:
            obj_id = obj_update.id
            obj_dict = obj_update.model_dump(exclude_unset=True, by_alias=True)
            obj_dict.pop("_id", None)
            if isinstance(obj_update, TimeStampedModel):
                obj_dict[TimeStampedModel.Field.UPDATED_AT.value] = current_timestamp_ms()

            res = await self.coll.update_one({"_id": obj_id}, {"$set": obj_dict})
            if res.matched_count == 0:
                raise _not_found()

            doc = await self.coll.find_one({"_id": PyObjectId(obj_id)}, projection)
            if doc is None:
                raise _not_found()
            return self.read_schema.model_validate(doc)

        except errors.DuplicateKeyError as ex:
            raise _conflict(ex) from ex

    async def delete(self, obj_id: PyObjectId | str) -> None:
        res = await self.coll.delete_one({"_id": PyObjectId(obj_id)})
        if res.deleted_count == 0:
            raise _not_found()

    async def aggregate(self, pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
        cursor = await self.coll.aggregate(pipeline)
        return [doc async for doc in cursor]

    async def create_indexes(self, indexes: list[tuple[list[str], bool]]) -> None:
        try:
            await self.coll.create_indexes([IndexModel(index, unique=unique) for (index, unique) in indexes])
        except errors.OperationFailure as ex:
            logger.error(f"Failed to create indexes on {self.coll.name}: {ex}")
