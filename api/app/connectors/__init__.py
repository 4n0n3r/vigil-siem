"""
SIEM connector factory.
"""

from __future__ import annotations

from typing import Any

from .base import BaseSIEMConnector, RawAlertData
from .wazuh import WazuhConnector
from .elastic import ElasticConnector

__all__ = ["BaseSIEMConnector", "RawAlertData", "get_connector"]

_CONNECTOR_TYPES = {
    "wazuh": WazuhConnector,
    "elastic": ElasticConnector,
}

SUPPORTED_TYPES = list(_CONNECTOR_TYPES.keys())


def get_connector(row: dict[str, Any]) -> BaseSIEMConnector:
    """Instantiate the correct connector from a siem_connectors DB row."""
    siem_type = row["siem_type"]
    cls = _CONNECTOR_TYPES.get(siem_type)
    if cls is None:
        raise ValueError(f"Unsupported SIEM type: {siem_type!r}")
    return cls(str(row["id"]), row["name"], row["config"])
