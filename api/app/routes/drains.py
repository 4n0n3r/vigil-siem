from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app import store
from app.db import pg_alerts, pg_suppressions
from app.models import StoredEvent
from app.sigma import evaluator, loader

logger = logging.getLogger(__name__)
router = APIRouter()

_DRAIN_SECRET = os.environ.get("VIGIL_DRAIN_SECRET", "")

# Mirror the enrichment constants from collector_weblog.go and website/src/middleware.ts
# so drain events are field-compatible with collector-sourced web events.
_SCANNER_UAS = [
    "sqlmap", "nikto", "nmap", "masscan", "gobuster", "dirbuster",
    "nuclei", "wfuzz", "ffuf", "burpsuite", "acunetix",
    "nessus", "openvas", "zgrab", "libwww-perl", "lwp-trivial",
    "python-requests", "scrapy", "mechanize", "httpclient",
]
_BOT_UAS = [
    "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
    "yandexbot", "facebookexternalhit", "twitterbot", "linkedinbot",
    "ahrefsbot", "semrushbot", "mj12bot", "dotbot",
]
_ADMIN_PREFIXES = [
    "/admin", "/wp-admin", "/administrator", "/phpmyadmin", "/pma",
    "/manage", "/management", "/dashboard", "/console", "/cpanel",
    "/webmin", "/plesk",
]
_SENSITIVE_SUBSTRINGS = [
    "/.env", "/.git", "/.ssh", "/backup", "/wp-config",
    "/config", "/credentials", "/secrets", "/private",
    "/etc/passwd", "/proc/", "/server-status", "/server-info",
    "/.htaccess", "/.htpasswd", "/web.config", "/appsettings",
]
_SQL_RE = re.compile(
    r"(\bselect\b|\bunion\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b"
    r"|\bexec\b|--|'.*;|xp_|\bor\b\s+\d+\s*=\s*\d+|\band\b\s+\d+\s*=\s*\d+)",
    re.IGNORECASE,
)
_TRAVERSAL_TOKENS = ["../", "..\\", "%2e%2e", "%2f..", "..%2f", "..%5c"]


def _classify_ua(ua: str) -> str:
    lower = ua.lower()
    if not lower:
        return "unknown"
    if any(s in lower for s in _SCANNER_UAS):
        return "scanner"
    if any(b in lower for b in _BOT_UAS):
        return "bot"
    if any(k in lower for k in ("mozilla", "webkit", "gecko")):
        return "browser"
    return "tool"


def _status_class(code: int) -> str:
    if 200 <= code < 300:
        return "2xx"
    if 300 <= code < 400:
        return "3xx"
    if 400 <= code < 500:
        return "4xx"
    if code >= 500:
        return "5xx"
    return "unknown"


def _enrich(
    app_name: str,
    method: str,
    path: str,
    query: str,
    client_ip: str,
    ua: str,
    referer: str,
    host: str,
    status_code: int,
    bytes_sent: int,
) -> dict[str, Any]:
    lower_path = path.lower()
    combined = (path + " " + query).lower()
    dot = path.rfind(".")
    slash = path.rfind("/")
    return {
        "channel": "web",
        "app_name": app_name,
        # Distinct from "middleware" so Sigma rules can target drain-only events.
        "log_format": "vercel-drain",
        "method": method,
        "path": path,
        "query": query,
        "request_line": f"{method} {path}{'?' + query if query else ''}",
        "client_ip": client_ip,
        "user_agent": ua,
        "ua_category": _classify_ua(ua),
        "referer": referer,
        "host": host,
        "protocol": "HTTP/1.1",
        "status_code": status_code,
        "status_class": _status_class(status_code),
        # Vercel log drains do not expose response body size; -1 = unknown.
        "bytes_sent": bytes_sent,
        "path_depth": lower_path.rstrip("/").count("/"),
        "extension": path[dot + 1:].lower() if dot > slash else "",
        "has_traversal": any(t in combined for t in _TRAVERSAL_TOKENS),
        "has_sql_chars": bool(_SQL_RE.search(path + " " + query)),
        "is_admin_path": any(lower_path.startswith(p) for p in _ADMIN_PREFIXES),
        "is_sensitive_path": any(
            lower_path.startswith(p) or p in lower_path for p in _SENSITIVE_SUBSTRINGS
        ),
        "is_error": status_code >= 400,
    }


def _parse_entry(entry: dict[str, Any], app_name: str) -> StoredEvent | None:
    """Parse one Vercel log drain entry. Returns None for non-HTTP entries."""
    proxy = entry.get("proxy")
    if not isinstance(proxy, dict):
        return None  # build or runtime log — no HTTP response data

    method = (proxy.get("method") or "GET").upper()
    raw_path = proxy.get("path") or "/"
    path, _, query = raw_path.partition("?")

    ua_raw = proxy.get("userAgent", "")
    ua = ua_raw[0] if isinstance(ua_raw, list) and ua_raw else str(ua_raw)

    status_code = int(proxy.get("statusCode") or 0)
    client_ip = str(proxy.get("clientIp") or "")
    referer = str(proxy.get("referer") or "")
    host = str(proxy.get("host") or entry.get("host") or "")
    # responseBodyBytes is present in some Vercel drain versions; fall back to -1.
    bytes_sent = int(proxy.get("responseBodyBytes") or proxy.get("bytes") or -1)

    ts_raw = proxy.get("timestamp") or entry.get("timestamp")
    try:
        if isinstance(ts_raw, (int, float)):
            ts = datetime.fromtimestamp(ts_raw / 1000, tz=timezone.utc)
        else:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
    except Exception:
        ts = datetime.now(timezone.utc)

    return StoredEvent(
        id=str(uuid.uuid4()),
        source=f"web:{app_name}",
        event=_enrich(app_name, method, path, query, client_ip, ua, referer, host, status_code, bytes_sent),
        timestamp=ts,
        endpoint_id="",
    )


def _verify_signature(body: bytes, header: str) -> bool:
    if not _DRAIN_SECRET:
        return True  # no secret configured — skip (set VIGIL_DRAIN_SECRET in prod)
    expected = hmac.new(_DRAIN_SECRET.encode(), body, hashlib.sha1).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha1="))


@router.post("/drains/vercel")
async def vercel_drain(request: Request) -> Response:
    """
    Vercel log drain receiver.

    Configure in Vercel: Project Settings → Log Drains → Add Drain
      URL:    https://<your-api-host>/drains/vercel?app=vigilsec.io
      Format: NDJSON
      Secret: value of VIGIL_DRAIN_SECRET env var

    Each NDJSON line is one log entry. Only entries with a `proxy` object
    (HTTP request/response logs) are ingested — build and runtime logs are skipped.
    Unlike the Edge middleware, these entries carry the real HTTP status code.
    """
    body = await request.body()

    sig = request.headers.get("x-vercel-signature", "")
    if not _verify_signature(body, sig):
        return JSONResponse(status_code=401, content={"error_code": "DRAIN_AUTH_FAILED", "message": "invalid signature"})

    app_name = request.query_params.get("app", "vigilsec.io")

    stored_events: list[StoredEvent] = []
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = _parse_entry(json.loads(line), app_name)
            if ev and await store.add_event(ev):
                stored_events.append(ev)
        except Exception:
            pass  # malformed line — skip, never block the drain

    if not stored_events:
        return Response(status_code=204)

    rules = loader.get_enabled_rules()
    suppressions = await pg_suppressions.get_active_suppressions()

    def _eval() -> list[tuple[dict, StoredEvent]]:
        matches: list[tuple[dict, StoredEvent]] = []
        for stored in stored_events:
            eval_event = {"source": stored.source, **stored.event}
            channel = stored.event.get("channel", "").lower()
            for rule in rules:
                ch_filter = rule.get("channel_filter", [])
                if ch_filter and channel and channel not in ch_filter:
                    continue
                try:
                    if evaluator.evaluate(rule["parsed_detection"], eval_event):
                        matches.append((rule, stored))
                except Exception:
                    pass
        return matches

    for rule, stored in await asyncio.to_thread(_eval):
        if pg_suppressions.is_suppressed(stored.event, suppressions, rule_name=rule["name"]):
            await pg_suppressions.record_suppression_hit(stored.event, suppressions, rule_name=rule["name"])
            continue
        await pg_alerts.save_alert(rule, stored)

    return Response(status_code=200)
