from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.dependency import DB, PaymentCRUDDep
from app.models.common.object_id import PyObjectId
from app.models.payment import Payment, PaymentRead, PaymentUpdate
from app.schemas.common import Page
from app.schemas.payment import CreditPlan
from app.schemas.user_label import UserLabel
from app.services.user_lookup_service import get_user_labels

router = APIRouter(prefix="/payments", tags=["payments"])


class PaymentPatchBody(BaseModel):
    """PATCH body for a payment - `id` comes from the URL path, not the body."""

    status: Payment.Status | None = None
    credits_applied: bool | None = None


class PaymentWithUser(PaymentRead):
    """A payment row plus the identity of the user it belongs to."""

    user: UserLabel | None = None


@router.get("")
async def list_payments(
    crud: PaymentCRUDDep,
    db: DB,
    status_: Annotated[Payment.Status | None, Query(alias="status")] = None,
    plan: CreditPlan | None = None,
    user_id: PyObjectId | None = None,
    sort_by: str = "created_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: Annotated[int, Query(le=200)] = 50,
) -> Page[PaymentWithUser]:
    query: dict[str, Any] = {}
    if status_:
        query[Payment.Field.STATUS.value] = status_.value
    if plan:
        query[Payment.Field.PLAN.value] = plan.value
    if user_id:
        query[Payment.Field.USER_ID.value] = user_id

    sort = [(sort_by, -1 if sort_dir == "desc" else 1)]
    items = await crud.search(query=query, sort=sort, offset=offset, length=limit)
    total = await crud.count(query=query)

    labels = await get_user_labels(db, [item.user_id for item in items])
    rows = [PaymentWithUser(**item.model_dump(by_alias=True), user=labels.get(str(item.user_id))) for item in items]
    return Page(items=rows, total=total, offset=offset, limit=limit)


@router.get("/{payment_id}")
async def get_payment(payment_id: PyObjectId, crud: PaymentCRUDDep) -> PaymentRead:
    return await crud.get(payment_id)


@router.patch("/{payment_id}")
async def update_payment(payment_id: PyObjectId, body: PaymentPatchBody, crud: PaymentCRUDDep) -> PaymentRead:
    """Manual override of `status`/`credits_applied` for support cases. Does not call NOWPayments."""
    patch = PaymentUpdate(id=payment_id, **body.model_dump(exclude_unset=True))
    return await crud.update(patch)
