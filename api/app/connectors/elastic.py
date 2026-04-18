"""
Elastic Security connector.

Fetches alerts from .alerts-security.alerts-default-* and retrieves context
via the ancestor document pointer embedded in each alert.

Required config keys:
  url      https://your-elastic:9200
  api_key  base64(id:api_key) — created in Kibana Stack Management > API Keys

Optional config keys:
  verify_ssl   true (default) | false
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .base import BaseSIEMConnector, RawAlertData


def _parse_ts(ts: str | None) -> datetime:
    if not ts:
        return datetime.now(timezone.utc)
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
    ):
        try:
            dt = datetime.strptime(ts, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return datetime.now(timezone.utc)


def _nested_get(d: dict, *keys: str, default: Any = None) -> Any:
    """Access nested dict keys, handling both nested dicts and dotted-key flat dicts."""
    dotted = ".".join(keys)
    if dotted in d:
        return d[dotted]
    curr = d
    for k in keys:
        if not isinstance(curr, dict):
            return default
        curr = curr.get(k, default)
        if curr is default:
            return default
    return curr


class ElasticConnector(BaseSIEMConnector):
    def __init__(self, connector_id: str, name: str, config: dict[str, Any]) -> None:
        super().__init__(connector_id, name, "elastic", config)
        self._url = config["url"].rstrip("/")
        self._headers = {
            "Authorization": f"ApiKey {config['api_key']}",
            "Content-Type": "application/json",
        }
        self._verify = config.get("verify_ssl", True)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers=self._headers,
            verify=self._verify,
            timeout=10.0,
        )

    async def fetch_alerts(self, since: datetime, limit: int = 100) -> list[RawAlertData]:
        body = {
            "size": limit,
            "sort": [{"kibana.alert.original_time": {"order": "desc"}}],
            "query": {
                "bool": {
                    "filter": [
                        {
                            "range": {
                                "kibana.alert.original_time": {"gte": since.isoformat()}
                            }
                        },
                        {"term": {"kibana.alert.workflow_status": "open"}},
                    ]
                }
            },
        }

        async with self._client() as client:
            r = await client.post(
                f"{self._url}/.alerts-security.alerts-default-*/_search",
                json=body,
            )
            r.raise_for_status()
            data = r.json()

        alerts: list[RawAlertData] = []
        for hit in data.get("hits", {}).get("hits", []):
            src = hit["_source"]
            alerts.append(
                RawAlertData(
                    native_id=hit["_id"],
                    severity=_nested_get(src, "kibana", "alert", "severity") or "medium",
                    title=_nested_get(src, "kibana", "alert", "rule", "name") or "Unknown",
                    hostname=_nested_get(src, "host", "name"),
                    source_ip=_nested_get(src, "source", "ip"),
                    detected_at=_parse_ts(
                        _nested_get(src, "kibana", "alert", "original_time")
                    ),
                    raw=src,
                )
            )
        return alerts

    async def fetch_context(
        self,
        alert: RawAlertData,
        window_minutes: int = 10,
    ) -> list[dict[str, Any]]:
        src = alert.raw
        ancestors = _nested_get(src, "kibana", "alert", "ancestors") or []
        results: list[dict[str, Any]] = []

        seen_ids: set[str] = set()
        anc_id: str | None = None
        source_index = ".ds-logs-*"

        async with self._client() as client:
            # Step 1: fetch the exact triggering document via ancestor pointer
            if ancestors:
                ancestor = ancestors[0]
                anc_id = ancestor.get("id") or ancestor.get("_id")
                anc_index = ancestor.get("index") or ancestor.get("_index")
                if anc_id and anc_index:
                    r = await client.get(f"{self._url}/{anc_index}/_doc/{anc_id}")
                    if r.status_code == 200:
                        hit = r.json()
                        doc = hit.get("_source")
                        if doc:
                            results.append(doc)
                            seen_ids.add(anc_id)
                    source_index = anc_index

            # Step 2: surrounding events on the same host
            host_name = _nested_get(src, "host", "name")
            from_ts = (alert.detected_at - timedelta(minutes=window_minutes)).isoformat()
            to_ts = (alert.detected_at + timedelta(minutes=2)).isoformat()

            window_filters: list[dict] = [
                {"range": {"@timestamp": {"gte": from_ts, "lte": to_ts}}}
            ]
            if host_name:
                window_filters.append({"term": {"host.name": host_name}})

            body = {
                "size": 100,
                "sort": [{"@timestamp": {"order": "asc"}}],
                "query": {"bool": {"filter": window_filters}},
            }

            r2 = await client.post(f"{self._url}/{source_index}/_search", json=body)
            if r2.status_code == 200:
                for h in r2.json().get("hits", {}).get("hits", []):
                    doc_id = h.get("_id", "")
                    if doc_id and doc_id in seen_ids:
                        continue
                    if doc_id:
                        seen_ids.add(doc_id)
                    results.append(h["_source"])

        return results

    async def test_connection(self) -> tuple[bool, str, int | None]:
        start = time.monotonic()
        try:
            async with self._client() as client:
                r = await client.get(f"{self._url}/_cluster/health", timeout=5.0)
                latency_ms = int((time.monotonic() - start) * 1000)
                if r.status_code == 200:
                    info = r.json()
                    cluster = info.get("cluster_name", "elasticsearch")
                    status = info.get("status", "unknown")
                    return True, f"Elasticsearch cluster '{cluster}' is {status}", latency_ms
                if r.status_code == 401:
                    return False, "Authentication failed — check your API key", latency_ms
                return (
                    False,
                    f"Elasticsearch returned HTTP {r.status_code}: {r.text[:200]}",
                    latency_ms,
                )
        except httpx.ConnectError as e:
            return False, f"Connection refused: {e}", None
        except httpx.TimeoutException:
            return False, "Connection timed out (5s)", None
        except Exception as e:  # noqa: BLE001
            return False, str(e), None

    def redact_config(self) -> dict[str, Any]:
        c = dict(self.config)
        if "api_key" in c:
            c["api_key"] = "***"
        return c
