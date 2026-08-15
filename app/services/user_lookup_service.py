from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from app.models.user import COLLECTION_NAME as USERS_COLLECTION
from app.models.user import User
from app.schemas.user_label import UserLabel


async def get_user_labels(
    db: AsyncDatabase[dict[str, Any]],
    user_ids: list[Any],
) -> dict[str, UserLabel]:
    """Resolve a page of user ids to display labels in one query.

    Payments and sessions only carry `user_id`; a raw ObjectId tells an admin nothing, so every
    list view that references a user resolves the whole page at once rather than per row.
    """
    unique_ids = list({uid for uid in user_ids if uid is not None})
    if not unique_ids:
        return {}

    projection = {User.Field.USERNAME.value: 1, User.Field.EMAIL.value: 1}
    cursor = db.get_collection(USERS_COLLECTION).find({"_id": {"$in": unique_ids}}, projection)
    return {
        str(doc["_id"]): UserLabel(
            id=str(doc["_id"]),
            username=doc.get(User.Field.USERNAME.value, ""),
            email=doc.get(User.Field.EMAIL.value, ""),
        )
        async for doc in cursor
    }
