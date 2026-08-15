from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from app.api.dependency import SessionCRUDDep
from app.models.common.object_id import PyObjectId
from app.models.session import Session, SessionRead
from app.schemas.common import Page

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("")
async def list_sessions(
    crud: SessionCRUDDep,
    user_id: PyObjectId | None = None,
    sort_by: str = "created_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: Annotated[int, Query(le=200)] = 50,
) -> Page[SessionRead]:
    query: dict[str, Any] = {}
    if user_id:
        query[Session.Field.USER_ID.value] = user_id

    sort = [(sort_by, -1 if sort_dir == "desc" else 1)]
    items = await crud.search(query=query, sort=sort, offset=offset, length=limit)
    total = await crud.count(query=query)
    return Page(items=items, total=total, offset=offset, limit=limit)


@router.delete("/{session_id}", status_code=204)
async def revoke_session(session_id: PyObjectId, crud: SessionCRUDDep) -> None:
    await crud.delete(session_id)
