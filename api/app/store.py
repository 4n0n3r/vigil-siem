"""
In-memory event store.

Module-level list acts as the database for Phase 1.
Replace this module with ClickHouse calls in Phase 2 — callers should only
use the helper functions below, never touch _events directly.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.models import StoredEvent

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

_events: list[StoredEvent] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def add_event(event: StoredEvent) -> None:
    """Append a new event to the store."""
    _events.append(event)


def all_events() -> list[StoredEvent]:
    """Return a shallow copy of all stored events."""
    return list(_events)


def count_last_24h() -> int:
    """Return how many events were ingested in the last 24 hours."""
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    return sum(
        1 for e in _events
        if _ensure_tz(e.timestamp) >= cutoff
    )


def search_events(
    query: Optional[str],
    from_time: Optional[datetime],
    to_time: Optional[datetime],
    limit: int,
) -> list[StoredEvent]:
    """
    Filter the in-memory store.

    - from_time / to_time: inclusive range filter on event timestamp.
    - query: substring match against the string representation of the full
      StoredEvent dict (source + event payload).
    - limit: max results returned (most-recent first).
    """
    results: list[StoredEvent] = []

    for ev in _events:
        ts = _ensure_tz(ev.timestamp)

        if from_time is not None and ts < _ensure_tz(from_time):
            continue
        if to_time is not None and ts > _ensure_tz(to_time):
            continue
        if query is not None:
            haystack = str(ev.model_dump()).lower()
            if query.lower() not in haystack:
                continue

        results.append(ev)

    # Most recent first, then apply limit
    results.sort(key=lambda e: _ensure_tz(e.timestamp), reverse=True)
    return results[:limit]


# ---------------------------------------------------------------------------
# Internal util
# ---------------------------------------------------------------------------

def _ensure_tz(dt: datetime) -> datetime:
    """Return a timezone-aware datetime, assuming UTC if naive."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
