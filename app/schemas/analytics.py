from pydantic import BaseModel

from app.models.audit_log import AuditLogRead


class DailyCount(BaseModel):
    date: str
    count: int


class DailyAmount(BaseModel):
    date: str
    amount: float


class UsersAnalytics(BaseModel):
    total: int
    by_role: dict[str, int]
    by_status: dict[str, int]
    signups_per_day: list[DailyCount]


class RevenueAnalytics(BaseModel):
    total_usd: float
    per_day: list[DailyAmount]
    payments_by_status: dict[str, int]


class ActivityAnalytics(BaseModel):
    """Real usage signals sourced from `audit_logs`.

    Deliberately does not surface `global_state.active_sessions` - that field is a simulated
    `random.gauss(260, 10)` value in backend (`app/services/ping_client_service.py`), not a real
    metric, so it has no place in an analytics dashboard.
    """

    logins_per_day: list[DailyCount]
    signups_per_day: list[DailyCount]
    asr_sessions_per_day: list[DailyCount]


class AnalyticsOverview(BaseModel):
    users: UsersAnalytics
    revenue: RevenueAnalytics
    credits_outstanding: int
    activity: ActivityAnalytics
    recent_activity: list[AuditLogRead]
