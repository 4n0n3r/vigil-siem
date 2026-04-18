"""
Enrollment token helpers — PostgreSQL persistence.

Tokens are stored hashed (SHA-256). The plaintext is returned once at
creation and never persisted. Single-use tokens are marked used on first
successful validation so they cannot be replayed.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.db import postgres


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_token() -> str:
    return "vig_enroll_" + secrets.token_urlsafe(32)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def create_token(
    label: str = "",
    single_use: bool = True,
    expires_hours: Optional[int] = 24,
) -> dict:
    """Create a new enrollment token.

    Returns a dict that includes the plaintext 'token' field — this is the
    only time the plaintext is available. Store it securely.
    """
    pool = postgres.get_pool()
    if pool is None:
        raise RuntimeError("PostgreSQL not available")

    plaintext = _generate_token()
    token_hash = _hash_token(plaintext)
    expires_at: Optional[datetime] = None
    if expires_hours is not None and expires_hours > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=expires_hours)

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO enrollment_tokens (token_hash, label, single_use, expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, label, single_use, used, expires_at, created_at
            """,
            token_hash,
            label,
            single_use,
            expires_at,
        )

    result = dict(row)
    result["token"] = plaintext  # included once — not stored
    return result


async def validate_and_consume(token: str) -> Optional[dict]:
    """Validate an enrollment token.

    Returns the token row on success, None on failure (invalid, expired, or
    already used). Single-use tokens are atomically marked used.
    """
    pool = postgres.get_pool()
    if pool is None:
        return None

    token_hash = _hash_token(token)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM enrollment_tokens WHERE token_hash = $1",
            token_hash,
        )
        if row is None:
            return None

        row_dict = dict(row)

        if row_dict["used"]:
            return None

        if row_dict["expires_at"] is not None:
            exp = row_dict["expires_at"]
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > exp:
                return None

        if row_dict["single_use"]:
            await conn.execute(
                "UPDATE enrollment_tokens SET used = TRUE WHERE id = $1",
                row_dict["id"],
            )

    return row_dict


async def list_tokens() -> list[dict]:
    pool = postgres.get_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, label, single_use, used, expires_at, created_at
            FROM enrollment_tokens
            ORDER BY created_at DESC
            """
        )
    return [dict(r) for r in rows]


async def revoke_token(token_id: str) -> bool:
    """Delete a token by ID. Returns True if a row was deleted."""
    pool = postgres.get_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM enrollment_tokens WHERE id = $1",
            token_id,
        )
    return result == "DELETE 1"
