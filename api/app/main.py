from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # Load .env before anything else reads os.environ

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.models import ErrorResponse
from app.routes import events, status
from app.routes import detections as detections_router_module
from app.routes import alerts as alerts_router_module
from app.db import clickhouse, postgres
from app.sigma import loader

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: connect to databases and warm the rule cache."""
    await clickhouse.init_clickhouse()
    await postgres.init_postgres()
    await loader.load_rules_from_db()
    yield
    # Graceful shutdown — asyncpg pool closes itself via GC, but be explicit
    pool = postgres.get_pool()
    if pool is not None:
        try:
            await pool.close()
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Vigil API",
    description="CLI-first SIEM backend — Phase 2",
    version="0.2.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow all origins for local dev (tighten in production)
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global exception handlers
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception for %s %s", request.method, request.url)
    body = ErrorResponse(
        error_code="internal_error",
        message="An unexpected error occurred.",
        detail=str(exc),
    )
    return JSONResponse(status_code=500, content=body.model_dump())


@app.exception_handler(404)
async def not_found_handler(request: Request, exc: Exception) -> JSONResponse:
    body = ErrorResponse(
        error_code="not_found",
        message=f"Route {request.method} {request.url.path} not found.",
        detail=None,
    )
    return JSONResponse(status_code=404, content=body.model_dump())


@app.exception_handler(405)
async def method_not_allowed_handler(request: Request, exc: Exception) -> JSONResponse:
    body = ErrorResponse(
        error_code="method_not_allowed",
        message=f"Method {request.method} is not allowed on {request.url.path}.",
        detail=None,
    )
    return JSONResponse(status_code=405, content=body.model_dump())


# ---------------------------------------------------------------------------
# Validation error handler (replaces FastAPI's default 422 response)
# ---------------------------------------------------------------------------

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    body = ErrorResponse(
        error_code="validation_error",
        message="Request body or parameters failed validation.",
        detail=exc.errors(),
    )
    return JSONResponse(status_code=422, content=body.model_dump())


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(events.router, prefix="/v1")
app.include_router(status.router, prefix="/v1")
app.include_router(detections_router_module.router, prefix="/v1")
app.include_router(alerts_router_module.router, prefix="/v1")
