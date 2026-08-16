from enum import StrEnum
from typing import Annotated, Any

from pydantic import AliasChoices, BaseModel, Field, field_serializer
from pymongo.asynchronous.database import AsyncDatabase

from app.models.common.base_model import TimeStampedModel
from app.models.common.generic_crud import GenericCRUDBase
from app.models.common.object_id import PyObjectId

COLLECTION_NAME = "users"


class InterviewConfig(BaseModel):
    """A user's interview setup (full name, profile/CV, context)."""

    full_name: str = ""
    profile_data: str = ""
    context: str = ""


class User(TimeStampedModel):
    class Role(StrEnum):
        USER = "user"
        TRIAL_USER = "trial_user"
        ADMIN = "admin"

    class Status(StrEnum):
        ACTIVE = "active"
        INACTIVE = "inactive"

    username: Annotated[str, Field(description="The username of the user")]
    email: Annotated[str, Field(description="The email of the user")]
    password_hash: Annotated[str | None, Field(description="The password hash of the user")] = None
    role: Annotated[Role, Field(description="The role of the user")] = Role.USER
    status: Annotated[Status, Field(description="The status of the user")] = Status.INACTIVE
    credits: Annotated[int, Field(description="The credits of the user")] = 0
    interview_config: Annotated[InterviewConfig | None, Field(description="Interview setup")] = None

    class Field(StrEnum):
        USERNAME = "username"
        EMAIL = "email"
        PASSWORD_HASH = "password_hash"  # noqa: S105
        ROLE = "role"
        STATUS = "status"
        CREDITS = "credits"
        INTERVIEW_CONFIG = "interview_config"


class UserRead(User):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]

    @field_serializer(User.Field.PASSWORD_HASH.value)
    def mask_password_hash(self, _value: str | None) -> str | None:
        """Never let the stored hash reach a client; API responses always report it as null."""
        return None


class UserUpdate(TimeStampedModel):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]
    username: str | None = None
    email: str | None = None
    role: User.Role | None = None
    status: User.Status | None = None
    credits: int | None = None
    interview_config: InterviewConfig | None = None


class UserCRUD(GenericCRUDBase[User, UserRead, UserUpdate]):
    def __init__(self, db: AsyncDatabase[dict[str, Any]]) -> None:
        super().__init__(db=db, collection_name=COLLECTION_NAME, read_schema=UserRead)
