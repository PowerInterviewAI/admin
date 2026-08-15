from enum import StrEnum
from typing import Annotated, Any

from pydantic import AliasChoices, Field
from pymongo.asynchronous.database import AsyncDatabase

from app.models.common.base_model import TimeStampedModel
from app.models.common.generic_crud import GenericCRUDBase
from app.models.common.object_id import PyObjectId
from app.schemas.device_info import DeviceInfo

COLLECTION_NAME = "sessions"


class Session(TimeStampedModel):
    token: Annotated[str, Field(description="Session token")]
    user_id: Annotated[PyObjectId, Field(description="The ID of the user associated with the session")]
    device_info: Annotated[DeviceInfo, Field(description="Information about the device used in the session")]

    class Field(StrEnum):
        TOKEN = "token"  # noqa: S105
        USER_ID = "user_id"
        DEVICE_INFO = "device_info"


class SessionRead(Session):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]


class SessionUpdate(TimeStampedModel):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]


class SessionCRUD(GenericCRUDBase[Session, SessionRead, SessionUpdate]):
    def __init__(self, db: AsyncDatabase[dict[str, Any]]) -> None:
        super().__init__(db=db, collection_name=COLLECTION_NAME, read_schema=SessionRead)
