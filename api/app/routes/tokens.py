"""
/v1/tokens — enrollment token management.

When VIGIL_REQUIRE_AUTH=true, all token endpoints require the X-Vigil-Admin-Key
header to match the VIGIL_ADMIN_KEY environment variable. When VIGIL_ADMIN_KEY
is not set (or auth is disabled), these endpoints are open — intended for dev
and single-operator setups where network access is the only gate.
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.db import pg_tokens, postgres
from app.models import (
    EnrollmentToken,
    EnrollmentTokenCreate,
    EnrollmentTokenCreatedResponse,
    EnrollmentTokenListResponse,
    ErrorResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_REQUIRE_AUTH = os.environ.get("VIGIL_REQUIRE_AUTH", "").lower() in ("true", "1", "yes")
_ADMIN_KEY = os.environ.get("VIGIL_ADMIN_KEY", "")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_admin(request: Request) -> bool:
    """Return True if the request carries admin credentials (or auth is off)."""
    if not _REQUIRE_AUTH:
        return True
    if not _ADMIN_KEY:
        # Auth is on but no admin key configured — allow (operator trusts the network).
        return True
    return request.headers.get("X-Vigil-Admin-Key", "") == _ADMIN_KEY


def _unauthorized() -> JSONResponse:
    body = ErrorResponse(
        error_code="UNAUTHORIZED",
        message="Admin key required for token management.",
        hint="Set X-Vigil-Admin-Key header matching VIGIL_ADMIN_KEY on the server.",
    )
    return JSONResponse(status_code=401, content=body.model_dump())


def _db_unavailable() -> JSONResponse:
    body = ErrorResponse(
        error_code="DB_NOT_CONNECTED",
        message="PostgreSQL is not available.",
        detail=None,
    )
    return JSONResponse(status_code=503, content=body.model_dump())


# ---------------------------------------------------------------------------
# POST /tokens
# ---------------------------------------------------------------------------

@router.post("/tokens", response_model=EnrollmentTokenCreatedResponse, status_code=201)
async def create_token(body: EnrollmentTokenCreate, request: Request):
    """Create an enrollment token. The plaintext token is returned once — save it."""
    if not _check_admin(request):
        return _unauthorized()
    if postgres.get_pool() is None:
        return _db_unavailable()

    try:
        row = await pg_tokens.create_token(
            label=body.label,
            single_use=body.single_use,
            expires_hours=body.expires_hours,
        )
    except Exception as exc:  # noqa: BLE001
        err = ErrorResponse(
            error_code="TOKEN_CREATE_ERROR",
            message="Failed to create enrollment token.",
            detail=str(exc),
        )
        return JSONResponse(status_code=500, content=err.model_dump())

    return EnrollmentTokenCreatedResponse(
        id=str(row["id"]),
        label=row["label"],
        token=row["token"],
        single_use=row["single_use"],
        expires_at=row.get("expires_at"),
        created_at=row["created_at"],
    )


# ---------------------------------------------------------------------------
# GET /tokens
# ---------------------------------------------------------------------------

@router.get("/tokens", response_model=EnrollmentTokenListResponse)
async def list_tokens(request: Request):
    """List enrollment tokens (plaintext never included)."""
    if not _check_admin(request):
        return _unauthorized()
    if postgres.get_pool() is None:
        return _db_unavailable()

    rows = await pg_tokens.list_tokens()
    tokens = [
        EnrollmentToken(
            id=str(r["id"]),
            label=r["label"],
            single_use=r["single_use"],
            used=r["used"],
            expires_at=r.get("expires_at"),
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return EnrollmentTokenListResponse(tokens=tokens, total=len(tokens))


# ---------------------------------------------------------------------------
# DELETE /tokens/{token_id}
# ---------------------------------------------------------------------------

@router.delete("/tokens/{token_id}", status_code=204)
async def revoke_token(token_id: str, request: Request):
    """Revoke (delete) an enrollment token by ID."""
    if not _check_admin(request):
        return _unauthorized()
    if postgres.get_pool() is None:
        return _db_unavailable()

    ok = await pg_tokens.revoke_token(token_id)
    if not ok:
        err = ErrorResponse(
            error_code="NOT_FOUND",
            message=f"Token '{token_id}' not found.",
            detail=None,
        )
        return JSONResponse(status_code=404, content=err.model_dump())

    return None
