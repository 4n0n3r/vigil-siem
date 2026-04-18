"""
Wazuh SIEM connector.

Fetches alerts and context from Wazuh OpenSearch indexer (port 9200).
The Wazuh manager REST API (port 55000) is not required for Phase 1.

Required config keys:
  indexer_url       https://wazuh-indexer:9200
  indexer_user      admin
  indexer_password  <password>

Optional config keys:
  verify_ssl        true (default) | false
  min_rule_level    3 (default) — minimum Wazuh rule.level to include
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .base import BaseSIEMConnector, RawAlertData


_SEVERITY_MAP = {
    range(0, 4): "low",
    range(4, 8): "medium",
    range(8, 12): "high",
    range(12, 16): "critical",
}


def _rule_level_to_severity(level: int) -> str:
    for r, sev in _SEVERITY_MAP.items():
        if level in r:
            return sev
    return "medium"


def _parse_ts(ts: str | None) -> datetime:
    if not ts:
        return datetime.now(timezone.utc)
    # Wazuh 4.x emits ISO 8601 with Z, numeric offset (+00:00), or microseconds.
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",   # e.g. 2024-03-21T14:32:05+00:00
    ):
        try:
            dt = datetime.strptime(ts, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return datetime.now(timezone.utc)


class WazuhConnector(BaseSIEMConnector):
    def __init__(self, connector_id: str, name: str, config: dict[str, Any]) -> None:
        super().__init__(connector_id, name, "wazuh", config)
        self._indexer_url = config["indexer_url"].rstrip("/")
        self._auth = (config["indexer_user"], config["indexer_password"])
        self._verify = config.get("verify_ssl", True)
        self._min_level = int(config.get("min_rule_level", 3))

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(verify=self._verify, timeout=10.0)

    async def fetch_alerts(self, since: datetime, limit: int = 100) -> list[RawAlertData]:
        body = {
            "size": limit,
            "sort": [{"timestamp": {"order": "desc"}}],
            "query": {
                "bool": {
                    "filter": [
                        {"range": {"timestamp": {"gte": since.isoformat()}}},
                        {"range": {"rule.level": {"gte": self._min_level}}},
                    ]
                }
            },
        }

        async with self._client() as client:
            r = await client.post(
                f"{self._indexer_url}/wazuh-alerts-*/_search",
                json=body,
                auth=self._auth,
            )
            r.raise_for_status()
            data = r.json()

        alerts: list[RawAlertData] = []
        for hit in data.get("hits", {}).get("hits", []):
            src = hit["_source"]
            rule = src.get("rule", {})
            agent = src.get("agent", {})
            data_fields = src.get("data", {})

            alerts.append(
                RawAlertData(
                    native_id=hit["_id"],
                    severity=_rule_level_to_severity(rule.get("level", 0)),
                    title=rule.get("description", "Unknown"),
                    hostname=agent.get("name") or agent.get("hostname"),
                    source_ip=(
                        data_fields.get("srcip")
                        or data_fields.get("src_ip")
                        or agent.get("ip")
                    ),
                    detected_at=_parse_ts(src.get("timestamp")),
                    raw=src,
                )
            )
        return alerts

    async def fetch_context(
        self,
        alert: RawAlertData,
        window_minutes: int = 10,
    ) -> list[dict[str, Any]]:
        agent_id = alert.raw.get("agent", {}).get("id")
        location = alert.raw.get("location")
        from_ts = (alert.detected_at - timedelta(minutes=window_minutes)).isoformat()
        to_ts = (alert.detected_at + timedelta(minutes=2)).isoformat()

        filters: list[dict] = [
            {"range": {"timestamp": {"gte": from_ts, "lte": to_ts}}}
        ]
        if agent_id:
            filters.append({"term": {"agent.id": agent_id}})
        if location:
            filters.append({"term": {"location": location}})

        body = {
            "size": 200,
            "sort": [{"timestamp": {"order": "asc"}}],
            "query": {"bool": {"filter": filters}},
        }

        async with self._client() as client:
            r = await client.post(
                f"{self._indexer_url}/wazuh-archives-*/_search",
                json=body,
                auth=self._auth,
            )
            if r.status_code == 404:
                # wazuh-archives not configured — fall back to nearby alerts
                return await self._fallback_context(alert, window_minutes)
            r.raise_for_status()
            data = r.json()

        hits = data.get("hits", {}).get("hits", [])
        if not hits:
            return await self._fallback_context(alert, window_minutes)

        return [h["_source"] for h in hits]

    async def _fallback_context(
        self,
        alert: RawAlertData,
        window_minutes: int,
    ) -> list[dict[str, Any]]:
        """Fallback: query nearby alerts from the same agent."""
        agent_id = alert.raw.get("agent", {}).get("id")
        from_ts = (alert.detected_at - timedelta(minutes=window_minutes)).isoformat()
        to_ts = (alert.detected_at + timedelta(minutes=2)).isoformat()

        filters: list[dict] = [
            {"range": {"timestamp": {"gte": from_ts, "lte": to_ts}}}
        ]
        if agent_id:
            filters.append({"term": {"agent.id": agent_id}})

        body = {
            "size": 50,
            "sort": [{"timestamp": {"order": "asc"}}],
            "query": {"bool": {"filter": filters}},
        }

        async with self._client() as client:
            r = await client.post(
                f"{self._indexer_url}/wazuh-alerts-*/_search",
                json=body,
                auth=self._auth,
            )
            if r.status_code != 200:
                return []
            data = r.json()

        return [h["_source"] for h in data.get("hits", {}).get("hits", [])]

    async def test_connection(self) -> tuple[bool, str, int | None]:
        start = time.monotonic()
        try:
            async with self._client() as client:
                r = await client.get(
                    f"{self._indexer_url}/_cluster/health",
                    auth=self._auth,
                    timeout=5.0,
                )
                latency_ms = int((time.monotonic() - start) * 1000)
                if r.status_code == 200:
                    info = r.json()
                    cluster = info.get("cluster_name", "wazuh-cluster")
                    status = info.get("status", "unknown")
                    return True, f"OpenSearch cluster '{cluster}' is {status}", latency_ms
                return (
                    False,
                    f"OpenSearch returned HTTP {r.status_code}: {r.text[:200]}",
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
        for field in ("indexer_password", "manager_password", "password"):
            if field in c:
                c[field] = "***"
        return c
