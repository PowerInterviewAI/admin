from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field


class TimeStampedModel(BaseModel):
    created_at: Annotated[
        int | None,
        Field(description="Unix timestamp in milliseconds for created at"),
    ] = None
    updated_at: Annotated[
        int | None,
        Field(description="Unix timestamp in milliseconds for updated at"),
    ] = None

    class Field(StrEnum):
        CREATED_AT = "created_at"
        UPDATED_AT = "updated_at"
