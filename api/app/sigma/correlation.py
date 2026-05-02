"""
Vigil correlation rule evaluator.

Handles rules with a `vigil_correlation` extension block.  When a standard
Sigma rule matches (the "trigger" event), this module performs an additional
temporal check: query ClickHouse for N+ failure events from the same source
IP in a rolling time window.  Only if that threshold is met is an alert fired.

Schema for `vigil_correlation` in a Sigma YAML:

    vigil_correlation:
      failure_pattern: "Failed password"   # substring to count in event JSON
      window_minutes: 10                   # look-back window
      min_failures: 3                      # minimum failures required

The rule's `detection` block acts as the trigger (e.g. matches "Accepted password").
"""

from __future__ import annotations

import re
from typing import Optional

_IP_RE = re.compile(r'from (\d{1,3}(?:\.\d{1,3}){3})')


def extract_source_ip(message: str) -> Optional[str]:
    """Extract source IP from sshd auth log messages of the form '... from <ip> port ...'"""
    m = _IP_RE.search(message)
    return m.group(1) if m else None
