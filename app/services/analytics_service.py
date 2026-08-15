from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.models.audit_log import AuditLog, AuditLogRead
from app.models.payment import Payment
from app.schemas.analytics import (
    ActivityAnalytics,
    DailyAmount,
    DailyCount,
    RevenueAnalytics,
    UsersAnalytics,
)
from app.utils.datetime import current_timestamp_ms

ANALYTICS_WINDOW_DAYS = 30
_MS_PER_DAY = 86_400_000


def _day_bucket(ts_field: str) -> dict[str, Any]:
    return {"$dateToString": {"format": "%Y-%m-%d", "date": {"$toDate": f"${ts_field}"}}}


def _window_cutoff() -> int:
    return current_timestamp_ms() - ANALYTICS_WINDOW_DAYS * _MS_PER_DAY


async def _run_pipeline(
    db: AsyncDatabase[dict[str, Any]],
    collection: str,
    pipeline: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cursor = await db.get_collection(collection).aggregate(pipeline)
    return await cursor.to_list(None)


async def _counts_by_field(db: AsyncDatabase[dict[str, Any]], collection: str, field: str) -> dict[str, int]:
    pipeline = [{"$group": {"_id": f"${field}", "count": {"$sum": 1}}}]
    docs = await _run_pipeline(db, collection, pipeline)
    return {str(doc["_id"]): doc["count"] for doc in docs if doc["_id"] is not None}


async def _daily_counts(
    db: AsyncDatabase[dict[str, Any]],
    collection: str,
    match: dict[str, Any],
    ts_field: str,
) -> list[DailyCount]:
    pipeline = [
        {"$match": {**match, ts_field: {"$gte": _window_cutoff()}}},
        {"$group": {"_id": _day_bucket(ts_field), "value": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    docs = await _run_pipeline(db, collection, pipeline)
    return [DailyCount(date=doc["_id"], count=doc["value"]) for doc in docs]


async def _daily_amounts(
    db: AsyncDatabase[dict[str, Any]],
    collection: str,
    match: dict[str, Any],
    ts_field: str,
    amount_field: str,
) -> list[DailyAmount]:
    pipeline = [
        {"$match": {**match, ts_field: {"$gte": _window_cutoff()}}},
        {"$group": {"_id": _day_bucket(ts_field), "value": {"$sum": f"${amount_field}"}}},
        {"$sort": {"_id": 1}},
    ]
    docs = await _run_pipeline(db, collection, pipeline)
    return [DailyAmount(date=doc["_id"], amount=doc["value"]) for doc in docs]


async def _sum_field(db: AsyncDatabase[dict[str, Any]], collection: str, match: dict[str, Any], field: str) -> float:
    pipeline = [{"$match": match}, {"$group": {"_id": None, "total": {"$sum": f"${field}"}}}]
    docs = await _run_pipeline(db, collection, pipeline)
    return float(docs[0]["total"]) if docs else 0.0


async def get_users_analytics(db: AsyncDatabase[dict[str, Any]]) -> UsersAnalytics:
    total = await db.get_collection("users").count_documents({})
    by_role = await _counts_by_field(db, "users", "role")
    by_status = await _counts_by_field(db, "users", "status")
    signups_per_day = await _daily_counts(db, "users", {}, "created_at")
    return UsersAnalytics(total=total, by_role=by_role, by_status=by_status, signups_per_day=signups_per_day)


async def get_revenue_analytics(db: AsyncDatabase[dict[str, Any]]) -> RevenueAnalytics:
    finished = {Payment.Field.STATUS.value: Payment.Status.FINISHED.value}
    total_usd = await _sum_field(db, "payments", finished, "price_amount")
    per_day = await _daily_amounts(db, "payments", finished, "updated_at", "price_amount")
    payments_by_status = await _counts_by_field(db, "payments", "status")
    return RevenueAnalytics(total_usd=total_usd, per_day=per_day, payments_by_status=payments_by_status)


async def get_credits_outstanding(db: AsyncDatabase[dict[str, Any]]) -> int:
    total = await _sum_field(db, "users", {}, "credits")
    return int(total)


async def get_activity_analytics(db: AsyncDatabase[dict[str, Any]]) -> ActivityAnalytics:
    login_match = {AuditLog.Field.EVENT_TYPE.value: AuditLog.EventType.LOGIN.value}
    signup_match = {AuditLog.Field.EVENT_TYPE.value: AuditLog.EventType.SIGNUP.value}
    asr_match = {AuditLog.Field.EVENT_TYPE.value: AuditLog.EventType.ASR_START.value}
    return ActivityAnalytics(
        logins_per_day=await _daily_counts(db, "audit_logs", login_match, "created_at"),
        signups_per_day=await _daily_counts(db, "audit_logs", signup_match, "created_at"),
        asr_sessions_per_day=await _daily_counts(db, "audit_logs", asr_match, "created_at"),
    )


async def get_recent_activity(db: AsyncDatabase[dict[str, Any]], limit: int = 20) -> list[AuditLogRead]:
    cursor = db.get_collection("audit_logs").find({}).sort("created_at", -1).limit(limit)
    return [AuditLogRead.model_validate(doc) async for doc in cursor]
