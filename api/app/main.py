from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # Load .env before anything else reads os.environ

# Configure log level from env (default: info). Must run before any logger is used.
logging.basicConfig(
    level=getattr(logging, os.environ.get("VIGIL_LOG_LEVEL", "info").upper(), logging.INFO)
)

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

from app.models import ErrorResponse
from app.routes import events, status
from app.routes import detections as detections_router_module
from app.routes import alerts as alerts_router_module
from app.routes import hunt as hunt_router_module
from app.routes import endpoints as endpoints_router_module
from app.routes import tokens as tokens_router_module
from app.routes import connectors as connectors_router_module
from app.routes import feed as feed_router_module
from app.routes import suppressions as suppressions_router_module
from app.routes import drains as drains_router_module
from app.db import clickhouse, postgres, pg_endpoints
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
    description="CLI-first SIEM backend — Phase 5",
    version="0.5.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

# Auth is required by default. Disable explicitly with VIGIL_REQUIRE_AUTH=false.
REQUIRE_AUTH = os.environ.get("VIGIL_REQUIRE_AUTH", "true").lower() not in ("false", "0", "no")

# Paths that never require an endpoint API key (they have their own auth or are truly open).
_PUBLIC_PATHS = {"/v1/status", "/v1/endpoints/register"}
# Prefixes that are exempt from endpoint-key auth (token routes have their own admin-key check).
_PUBLIC_PREFIXES = ("/v1/tokens",)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Always try to resolve the key so endpoint_id is set even when auth
        # is not enforced. This is what makes heartbeat / last_seen work when
        # VIGIL_REQUIRE_AUTH=false.
        key = request.headers.get("X-Vigil-Key", "")
        endpoint = await pg_endpoints.validate_api_key(key) if key else None

        path = request.url.path
        is_public = path in _PUBLIC_PATHS or any(path.startswith(p) for p in _PUBLIC_PREFIXES)

        if REQUIRE_AUTH and not is_public:
            if endpoint is None:
                status_code = 401 if not key else 403
                error_code = "UNAUTHORIZED" if not key else "FORBIDDEN"
                message = "Missing API key." if not key else "Invalid API key."
                body = ErrorResponse(
                    error_code=error_code,
                    message=message,
                    detail=None,
                    hint="register an endpoint with 'vigil agent register' and set the returned api_key",
                )
                return JSONResponse(status_code=status_code, content=body.model_dump())

        request.state.endpoint_id = str(endpoint["id"]) if endpoint else None
        return await call_next(request)


app.add_middleware(AuthMiddleware)

# ---------------------------------------------------------------------------
# CORS — allow all origins for local dev (tighten in production)
# Note: CORSMiddleware added last runs first (middleware stack is LIFO)
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


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    # If a route handler raised HTTPException with a structured dict detail, pass it through.
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    # Route-not-found and other HTTP errors use our ErrorResponse format.
    if exc.status_code == 404:
        body = ErrorResponse(
            error_code="not_found",
            message=f"Route {request.method} {request.url.path} not found.",
        )
    elif exc.status_code == 405:
        body = ErrorResponse(
            error_code="method_not_allowed",
            message=f"Method {request.method} is not allowed on {request.url.path}.",
        )
    else:
        body = ErrorResponse(
            error_code=f"http_{exc.status_code}",
            message=str(exc.detail) if exc.detail else f"HTTP {exc.status_code}",
        )
    return JSONResponse(status_code=exc.status_code, content=body.model_dump())


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
app.include_router(hunt_router_module.router, prefix="/v1")
app.include_router(endpoints_router_module.router, prefix="/v1")
app.include_router(tokens_router_module.router, prefix="/v1")
app.include_router(connectors_router_module.router)
app.include_router(feed_router_module.router)
app.include_router(suppressions_router_module.router, prefix="/v1")
app.include_router(drains_router_module.router)
