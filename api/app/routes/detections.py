"""
/v1/detections — CRUD for Sigma detection rules.

All persistence is via asyncpg.  If the PostgreSQL pool is not available,
every endpoint returns 503 with error_code DB_NOT_CONNECTED.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from app.db import postgres
from app.models import (
    DetectionListResponse,
    DetectionRule,
    DetectionRuleCreate,
    DetectionRuleUpdate,
    ErrorResponse,
)
from app.sigma import loader

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _db_unavailable() -> JSONResponse:
    body = ErrorResponse(
        error_code="DB_NOT_CONNECTED",
        message="PostgreSQL is not available.",
        detail=None,
    )
    return JSONResponse(status_code=503, content=body.model_dump())


def _not_found(rule_id: str) -> JSONResponse:
    body = ErrorResponse(
        error_code="NOT_FOUND",
        message=f"Detection rule '{rule_id}' not found.",
        detail=None,
    )
    return JSONResponse(status_code=404, content=body.model_dump())


def _row_to_rule(row) -> DetectionRule:
    return DetectionRule(
        id=str(row["id"]),
        name=row["name"],
        description=row["description"],
        severity=row["severity"],
        mitre_tactic=row["mitre_tactic"],
        sigma_yaml=row["sigma_yaml"],
        enabled=row["enabled"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------------------------------------------------------------------------
# POST /detections
# ---------------------------------------------------------------------------

@router.post("/detections", response_model=DetectionRule, status_code=201)
async def create_rule(body: DetectionRuleCreate):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO detection_rules (name, description, severity, mitre_tactic, sigma_yaml, enabled)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            """,
            body.name,
            body.description,
            body.severity,
            body.mitre_tactic,
            body.sigma_yaml,
            body.enabled,
        )

    await loader.invalidate_cache()
    return _row_to_rule(row)


# ---------------------------------------------------------------------------
# GET /detections
# ---------------------------------------------------------------------------

@router.get("/detections", response_model=DetectionListResponse)
async def list_rules(
    enabled: Optional[bool] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    conditions = []
    params: list = []
    idx = 1

    if enabled is not None:
        conditions.append(f"enabled = ${idx}")
        params.append(enabled)
        idx += 1

    if severity is not None:
        conditions.append(f"severity = ${idx}")
        params.append(severity)
        idx += 1

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM detection_rules {where_clause}",
            *params,
        )
        rows = await conn.fetch(
            f"""
            SELECT * FROM detection_rules {where_clause}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
            limit,
            offset,
        )

    return DetectionListResponse(
        rules=[_row_to_rule(r) for r in rows],
        total=total,
    )


# ---------------------------------------------------------------------------
# GET /detections/{id}
# ---------------------------------------------------------------------------

@router.get("/detections/{rule_id}", response_model=DetectionRule)
async def get_rule(rule_id: str):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM detection_rules WHERE id = $1",
            rule_id,
        )

    if row is None:
        return _not_found(rule_id)

    return _row_to_rule(row)


# ---------------------------------------------------------------------------
# PATCH /detections/{id}
# ---------------------------------------------------------------------------

@router.patch("/detections/{rule_id}", response_model=DetectionRule)
async def update_rule(rule_id: str, body: DetectionRuleUpdate):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        # Nothing to update — return current state
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM detection_rules WHERE id = $1", rule_id
            )
        if row is None:
            return _not_found(rule_id)
        return _row_to_rule(row)

    set_clauses = []
    params: list = []
    idx = 1
    for col, val in updates.items():
        set_clauses.append(f"{col} = ${idx}")
        params.append(val)
        idx += 1

    params.append(rule_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            UPDATE detection_rules
            SET {', '.join(set_clauses)}
            WHERE id = ${idx}
            RETURNING *
            """,
            *params,
        )

    if row is None:
        return _not_found(rule_id)

    await loader.invalidate_cache()
    return _row_to_rule(row)


# ---------------------------------------------------------------------------
# DELETE /detections/{id}
# ---------------------------------------------------------------------------

@router.delete("/detections/{rule_id}", status_code=204)
async def delete_rule(rule_id: str):
    pool = postgres.get_pool()
    if pool is None:
        return _db_unavailable()

    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM detection_rules WHERE id = $1",
            rule_id,
        )

    # asyncpg returns e.g. "DELETE 1"
    if result == "DELETE 0":
        return _not_found(rule_id)

    await loader.invalidate_cache()
    return Response(status_code=204)
