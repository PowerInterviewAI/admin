from enum import StrEnum
from typing import Annotated, Any

from pydantic import AliasChoices, Field
from pymongo.asynchronous.database import AsyncDatabase

from app.models.common.base_model import TimeStampedModel
from app.models.common.generic_crud import GenericCRUDBase
from app.models.common.object_id import PyObjectId
from app.schemas.payment import CreditPlan

COLLECTION_NAME = "payments"


class Payment(TimeStampedModel):
    class Status(StrEnum):
        PENDING = "pending"
        WAITING = "waiting"
        CONFIRMING = "confirming"
        CONFIRMED = "confirmed"
        SENDING = "sending"
        PARTIALLY_PAID = "partially_paid"
        FINISHED = "finished"
        FAILED = "failed"
        REFUNDED = "refunded"
        EXPIRED = "expired"

    user_id: Annotated[PyObjectId, Field(description="The user ID who made the payment")]
    plan: Annotated[CreditPlan, Field(description="The payment plan purchased")]
    payment_id: Annotated[str | None, Field(description="NOWPayments payment ID")] = None
    order_id: Annotated[str, Field(description="Internal order ID")]
    status: Annotated[Status, Field(description="Payment status")] = Status.PENDING
    pay_address: Annotated[str | None, Field(description="Crypto payment address")] = None
    pay_amount: Annotated[float | None, Field(description="Amount to pay in crypto")] = None
    pay_currency: Annotated[str | None, Field(description="Cryptocurrency used")] = None
    price_amount: Annotated[float, Field(description="Price in USD")]
    credits_amount: Annotated[int, Field(description="Amount of credits purchased")]
    credits_applied: Annotated[bool, Field(description="Whether credits have been applied")] = False
    purchase_id: Annotated[str | None, Field(description="NOWPayments purchase ID")] = None
    root_payment_id: Annotated[PyObjectId | None, Field(description="Original payment ID, if a follow-up")] = None

    class Field(StrEnum):
        USER_ID = "user_id"
        PLAN = "plan"
        PAYMENT_ID = "payment_id"
        ORDER_ID = "order_id"
        STATUS = "status"
        CREDITS_APPLIED = "credits_applied"


class PaymentRead(Payment):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]


class PaymentUpdate(TimeStampedModel):
    id: Annotated[PyObjectId, Field(alias="_id", validation_alias=AliasChoices("id", "_id"))]
    status: Payment.Status | None = None
    credits_applied: bool | None = None


class PaymentCRUD(GenericCRUDBase[Payment, PaymentRead, PaymentUpdate]):
    def __init__(self, db: AsyncDatabase[dict[str, Any]]) -> None:
        super().__init__(db=db, collection_name=COLLECTION_NAME, read_schema=PaymentRead)
