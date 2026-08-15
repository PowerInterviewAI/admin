from pydantic import BaseModel


class UserLabel(BaseModel):
    """Minimal user identity attached to rows that only store a `user_id`."""

    id: str
    username: str
    email: str
