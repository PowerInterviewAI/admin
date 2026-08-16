import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.dependency import PaymentCRUDDep, SessionCRUDDep, UserCRUDDep
from app.models.common.object_id import PyObjectId
from app.models.user import InterviewConfig, User, UserRead, UserUpdate
from app.schemas.common import Page

router = APIRouter(prefix="/users", tags=["users"])


class UserPatchBody(BaseModel):
    """PATCH body for a user - `id` comes from the URL path, not the body."""

    username: str | None = None
    email: str | None = None
    role: User.Role | None = None
    status: User.Status | None = None
    credits: int | None = None
    interview_config: InterviewConfig | None = None


@router.get("")
async def list_users(
    crud: UserCRUDDep,
    q: str | None = None,
    role: User.Role | None = None,
    status_: Annotated[User.Status | None, Query(alias="status")] = None,
    sort_by: str = "created_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: Annotated[int, Query(le=200)] = 50,
) -> Page[UserRead]:
    query: dict[str, Any] = {}
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        query["$or"] = [{"username": pattern}, {"email": pattern}]
    if role:
        query[User.Field.ROLE.value] = role.value
    if status_:
        query[User.Field.STATUS.value] = status_.value

    sort = [(sort_by, -1 if sort_dir == "desc" else 1)]
    items = await crud.search(query=query, sort=sort, offset=offset, length=limit)
    total = await crud.count(query=query)
    return Page(items=items, total=total, offset=offset, limit=limit)


@router.get("/{user_id}")
async def get_user(
    user_id: PyObjectId,
    crud: UserCRUDDep,
    payment_crud: PaymentCRUDDep,
    session_crud: SessionCRUDDep,
) -> dict[str, Any]:
    user = await crud.get(user_id)
    payment_count = await payment_crud.count({"user_id": user_id})
    session_count = await session_crud.count({"user_id": user_id})
    return {"user": user, "payment_count": payment_count, "session_count": session_count}


@router.patch("/{user_id}")
async def update_user(user_id: PyObjectId, body: UserPatchBody, crud: UserCRUDDep) -> UserRead:
    patch = UserUpdate(id=user_id, **body.model_dump(exclude_unset=True))
    return await crud.update(patch)


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: PyObjectId, crud: UserCRUDDep) -> None:
    await crud.delete(user_id)
