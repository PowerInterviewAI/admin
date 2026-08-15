from enum import StrEnum


class CreditPlan(StrEnum):
    """Available payment plans, mirrored from backend's `app/schemas/payment.py`."""

    STARTER = "starter"
    PRO = "pro"
    ENTERPRISE = "enterprise"
