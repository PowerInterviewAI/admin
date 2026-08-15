from typing import Annotated, Any

from fastapi import Depends
from pymongo.asynchronous.database import AsyncDatabase

from app.db.mongo import get_database
from app.models.audit_log import AuditLogCRUD
from app.models.payment import PaymentCRUD
from app.models.session import SessionCRUD
from app.models.user import UserCRUD

DB = Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)]


def get_user_crud(db: DB) -> UserCRUD:
    return UserCRUD(db)


def get_payment_crud(db: DB) -> PaymentCRUD:
    return PaymentCRUD(db)


def get_session_crud(db: DB) -> SessionCRUD:
    return SessionCRUD(db)


def get_audit_log_crud(db: DB) -> AuditLogCRUD:
    return AuditLogCRUD(db)


UserCRUDDep = Annotated[UserCRUD, Depends(get_user_crud)]
PaymentCRUDDep = Annotated[PaymentCRUD, Depends(get_payment_crud)]
SessionCRUDDep = Annotated[SessionCRUD, Depends(get_session_crud)]
AuditLogCRUDDep = Annotated[AuditLogCRUD, Depends(get_audit_log_crud)]
