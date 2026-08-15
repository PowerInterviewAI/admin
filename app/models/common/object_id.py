from collections.abc import Callable
from typing import Any

from bson import ObjectId
from pydantic import GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema


class PyObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(
        cls,
        source_type: type[Any],
        handler: Callable[[Any], core_schema.CoreSchema],
    ) -> core_schema.CoreSchema:
        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema(
                [
                    core_schema.is_instance_schema(ObjectId),
                    core_schema.no_info_plain_validator_function(cls.validate),
                ]
            ),
            serialization=core_schema.to_string_ser_schema(),
        )

    @classmethod
    def validate(cls, value: str | ObjectId) -> ObjectId:
        if isinstance(value, ObjectId):
            return value
        if isinstance(value, str) and ObjectId.is_valid(value):
            return ObjectId(value)
        msg = f"Invalid ObjectId: {value}"
        raise ValueError(msg)

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        core_schema: Any,  # noqa: ANN401
        handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        schema = handler(core_schema)
        schema.update(
            example="64a7bf3f9f2abf8d92a7b123",
            title="ObjectId",
        )
        return schema
