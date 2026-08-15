from datetime import UTC, datetime


def current_timestamp_ms() -> int:
    """Current time as a Unix timestamp in milliseconds, matching backend's `created_at`/`updated_at` fields."""
    return int(datetime.now(tz=UTC).timestamp() * 1000)
