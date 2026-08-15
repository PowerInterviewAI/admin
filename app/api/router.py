from fastapi import APIRouter

from app.api.endpoints import analytics, audit_logs, payments, sessions, users

api_router = APIRouter(prefix="/api")
api_router.include_router(analytics.router)
api_router.include_router(users.router)
api_router.include_router(payments.router)
api_router.include_router(sessions.router)
api_router.include_router(audit_logs.router)
