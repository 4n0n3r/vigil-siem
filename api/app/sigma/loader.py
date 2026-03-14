"""
Sigma rule loader — fetches enabled rules from PostgreSQL, caches them in memory.

The cache is invalidated on any write to /v1/detections.
The evaluator reads rules via get_enabled_rules() (sync, safe to call from routes).
"""

from __future__ import annotations

import asyncio
import logging
import sys

import yaml

logger = logging.getLogger(__name__)

_rule_cache: list[dict] = []
_cache_lock = asyncio.Lock()


async def load_rules_from_db() -> None:
    """Fetch all enabled rules from PostgreSQL and update the in-memory cache."""
    from app.db import postgres  # noqa: PLC0415 — lazy to avoid circular imports

    pool = postgres.get_pool()
    if pool is None:
        logger.debug("PostgreSQL not available — rule cache stays empty")
        return

    try:
        async with _cache_lock:
            rows = await pool.fetch(
                """
                SELECT id, name, severity, sigma_yaml
                FROM   detection_rules
                WHERE  enabled = TRUE
                ORDER  BY created_at
                """
            )

            new_cache: list[dict] = []
            for row in rows:
                try:
                    parsed = _parse_sigma_detection(row["sigma_yaml"])
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        '{"event": "sigma_parse_error", "rule_id": "%s", "error": "%s"}',
                        row["id"],
                        str(exc).replace('"', "'"),
                    )
                    continue

                new_cache.append(
                    {
                        "id": str(row["id"]),
                        "name": row["name"],
                        "severity": row["severity"],
                        "sigma_yaml": row["sigma_yaml"],
                        "parsed_detection": parsed,
                    }
                )

            _rule_cache.clear()
            _rule_cache.extend(new_cache)
            logger.info(
                '{"event": "rules_loaded", "count": %d}',
                len(_rule_cache),
            )

    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "rules_load_error", "error": "%s"}',
            str(exc).replace('"', "'"),
        )


async def invalidate_cache() -> None:
    """Force a reload from the database on the next relevant call."""
    await load_rules_from_db()


def get_enabled_rules() -> list[dict]:
    """Return the current cached list of enabled rules (sync-safe)."""
    return list(_rule_cache)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_sigma_detection(sigma_yaml: str) -> dict:
    """Parse a Sigma YAML string and return the detection block dict.

    The returned dict always contains a 'condition' key (may be empty string).
    Raises on parse error — caller should catch.
    """
    doc = yaml.safe_load(sigma_yaml)
    if not isinstance(doc, dict):
        raise ValueError("Sigma YAML is not a mapping")

    detection = doc.get("detection", {})
    if not isinstance(detection, dict):
        raise ValueError("'detection' block is not a mapping")

    return detection
