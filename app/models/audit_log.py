from enum import StrEnum
from typing import Annotated, Any

from pydantic import AliasChoices, Field
from pymongo.asynchronous.database import AsyncDatabase

from app.models.common.base_model import TimeStampedModel
from app.models.common.generic_crud import GenericCRUDBase
from app.models.common.object_id import PyObjectId

COLLECTION_NAME = "audit_logs"


class AuditLog(TimeStampedModel):
    class EventType(StrEnum):
        LOGIN = "login"
        LOGOUT = "logout"
        SIGNUP = "signup"
        PASSWORD_CHANGE = "password_change"  # noqa: S105
        PROFILE_UPDATE = "profile_update"
        SESSION_EXPIRE = "session_expire"
        EMAIL_VERIFICATION_REQUESTED = "email_verification_requested"
        EMAIL_VERIFICATION_CONFIRMED = "email_verification_confirmed"
        PAYMENT_CREATED = "payment_created"
        PAYMENT_WEBHOOK_RECEIVED = "payment_webhook_received"
        PAYMENT_COMPLETED = "payment_completed"
        PAYMENT_PARTIALLY_PAID = "payment_partially_paid"
        PAYMENT_FAILED = "payment_failed"
        PAYMENT_ERROR = "payment_error"
        CREDITS_APPLIED = "credits_applied"
        ASR_START = "asr_start"
        ASR_STOP = "asr_stop"

    class Status(StrEnum):
        SUCCESS = "success"
        FAILURE = "failure"

    event_type: Annotated[EventType, Field(description="The type of audit event")]
    user_id: Annotated[PyObjectId | None, Field(description="The ID of the user associated with the event")] = None
    email: Annotated[str | None, Field(description="The email address associated with the event")] = None
    status: Annotated[Status, Field(description="Whether the event was successful or failed")]
    ip_address: Annotated[str | None, Field(description="The IP address of the client")] = None
    user_agent: Annotated[str | None, Field(description="The user agent string of the client")] = None
    metadata: Annotated[dict[str, Any] | None, Field(description="Additional metadata for the audit event")] = None

    class Field(StrEnum):
        EVENT_TYPE = "event_type"
        USER_ID = "user_id"
        EMAIL = "email"
        STATUS = "status"


class AuditLogRead(AuditLog):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]


class AuditLogUpdate(TimeStampedModel):
    """Audit logs are read-only from the dashboard; this exists only to satisfy `GenericCRUDBase`'s bound."""

    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]


class AuditLogCRUD(GenericCRUDBase[AuditLog, AuditLogRead, AuditLogUpdate]):
    def __init__(self, db: AsyncDatabase[dict[str, Any]]) -> None:
        super().__init__(db=db, collection_name=COLLECTION_NAME, read_schema=AuditLogRead)
