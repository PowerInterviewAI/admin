from fastapi import APIRouter

from app.api.dependency import DB
from app.schemas.analytics import AnalyticsOverview
from app.services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
async def get_overview(db: DB) -> AnalyticsOverview:
    users = await analytics_service.get_users_analytics(db)
    revenue = await analytics_service.get_revenue_analytics(db)
    credits_outstanding = await analytics_service.get_credits_outstanding(db)
    activity = await analytics_service.get_activity_analytics(db)
    recent_activity = await analytics_service.get_recent_activity(db)
    return AnalyticsOverview(
        users=users,
        revenue=revenue,
        credits_outstanding=credits_outstanding,
        activity=activity,
        recent_activity=recent_activity,
    )
