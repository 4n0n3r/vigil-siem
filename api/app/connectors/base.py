"""
Base class and shared types for SIEM connectors.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class RawAlertData:
    """Minimal metadata extracted from a SIEM alert, plus the full raw document."""
    native_id: str
    severity: str          # critical / high / medium / low
    title: str
    hostname: str | None
    source_ip: str | None
    detected_at: datetime
    raw: dict[str, Any]


class BaseSIEMConnector(ABC):
    def __init__(
        self,
        connector_id: str,
        name: str,
        siem_type: str,
        config: dict[str, Any],
    ) -> None:
        self.connector_id = connector_id
        self.name = name
        self.siem_type = siem_type
        self.config = config

    @abstractmethod
    async def fetch_alerts(self, since: datetime, limit: int = 100) -> list[RawAlertData]:
        """Return alerts created on or after `since`, newest first."""
        ...

    @abstractmethod
    async def fetch_context(
        self,
        alert: RawAlertData,
        window_minutes: int = 10,
    ) -> list[dict[str, Any]]:
        """Return raw log events surrounding the alert from the originating SIEM."""
        ...

    @abstractmethod
    async def test_connection(self) -> tuple[bool, str, int | None]:
        """Returns (ok, message, latency_ms). latency_ms may be None on failure."""
        ...

    @abstractmethod
    def redact_config(self) -> dict[str, Any]:
        """Return a copy of config with credential fields replaced by '***'."""
        ...
