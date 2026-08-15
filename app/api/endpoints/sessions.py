from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from app.api.dependency import DB, SessionCRUDDep
from app.models.common.object_id import PyObjectId
from app.models.session import Session, SessionRead
from app.schemas.common import Page
from app.schemas.user_label import UserLabel
from app.services.user_lookup_service import get_user_labels

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionWithUser(SessionRead):
    """A session row plus the identity of the user it belongs to."""

    user: UserLabel | None = None


@router.get("")
async def list_sessions(
    crud: SessionCRUDDep,
    db: DB,
    user_id: PyObjectId | None = None,
    sort_by: str = "created_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: Annotated[int, Query(le=200)] = 50,
) -> Page[SessionWithUser]:
    query: dict[str, Any] = {}
    if user_id:
        query[Session.Field.USER_ID.value] = user_id

    sort = [(sort_by, -1 if sort_dir == "desc" else 1)]
    items = await crud.search(query=query, sort=sort, offset=offset, length=limit)
    total = await crud.count(query=query)

    labels = await get_user_labels(db, [item.user_id for item in items])
    rows = [SessionWithUser(**item.model_dump(by_alias=True), user=labels.get(str(item.user_id))) for item in items]
    return Page(items=rows, total=total, offset=offset, limit=limit)


@router.delete("/{session_id}", status_code=204)
async def revoke_session(session_id: PyObjectId, crud: SessionCRUDDep) -> None:
    await crud.delete(session_id)
