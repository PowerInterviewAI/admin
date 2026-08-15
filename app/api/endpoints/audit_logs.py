from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.api.dependency import AuditLogCRUDDep
from app.models.audit_log import AuditLog, AuditLogRead
from app.models.common.base_model import TimeStampedModel
from app.models.common.object_id import PyObjectId
from app.schemas.common import Page

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


@router.get("")
async def list_audit_logs(
    crud: AuditLogCRUDDep,
    event_type: AuditLog.EventType | None = None,
    status_: Annotated[AuditLog.Status | None, Query(alias="status")] = None,
    user_id: PyObjectId | None = None,
    from_: Annotated[int | None, Query(alias="from")] = None,
    to: int | None = None,
    offset: int = 0,
    limit: Annotated[int, Query(le=200)] = 50,
) -> Page[AuditLogRead]:
    query: dict[str, Any] = {}
    if event_type:
        query[AuditLog.Field.EVENT_TYPE.value] = event_type.value
    if status_:
        query[AuditLog.Field.STATUS.value] = status_.value
    if user_id:
        query[AuditLog.Field.USER_ID.value] = user_id
    if from_ is not None or to is not None:
        created_range: dict[str, int] = {}
        if from_ is not None:
            created_range["$gte"] = from_
        if to is not None:
            created_range["$lte"] = to
        query[TimeStampedModel.Field.CREATED_AT.value] = created_range

    sort = [(TimeStampedModel.Field.CREATED_AT.value, -1)]
    items = await crud.search(query=query, sort=sort, offset=offset, length=limit)
    total = await crud.count(query=query)
    return Page(items=items, total=total, offset=offset, limit=limit)
