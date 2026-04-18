#!/usr/bin/env python3
"""
Seed all Sigma detection rules from the detections/ and rules/ directories
into the Vigil API.  Safe to run repeatedly — rules are upserted by name.

Usage:
    python scripts/seed_detections.py [--api-url http://localhost:8001]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.request
import urllib.error

import yaml  # pip install pyyaml


REPO_ROOT = pathlib.Path(__file__).parent.parent
RULE_DIRS = [
    REPO_ROOT / "detections",
    REPO_ROOT / "rules",
]

# Map directory name → MITRE tactic string used in the API
_TACTIC_MAP = {
    "credential_access":    "credential_access",
    "defense_evasion":      "defense_evasion",
    "discovery":            "discovery",
    "execution":            "execution",
    "initial_access":       "initial_access",
    "lateral_movement":     "lateral_movement",
    "persistence":          "persistence",
    "privilege_escalation": "privilege_escalation",
    "collection":           "collection",
    "command_and_control":  "command_and_control",
    "exfiltration":         "exfiltration",
    "impact":               "impact",
    "account_management":   "account_management",
}


def _collect_rule_files() -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    for d in RULE_DIRS:
        if d.exists():
            files.extend(d.rglob("*.yml"))
            files.extend(d.rglob("*.yaml"))
    files.sort()
    return files


def _parse_rule(path: pathlib.Path) -> dict | None:
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"  SKIP  {path.name}: YAML parse error — {exc}", file=sys.stderr)
        return None

    if not isinstance(doc, dict):
        print(f"  SKIP  {path.name}: not a YAML mapping", file=sys.stderr)
        return None

    name = doc.get("title") or doc.get("name") or path.stem
    description = str(doc.get("description") or "").strip().replace("\n", " ")
    level = str(doc.get("level") or "medium").lower()
    if level not in ("low", "medium", "high", "critical"):
        level = "medium"

    # Derive MITRE tactic from the parent directory name
    tactic = _TACTIC_MAP.get(path.parent.name, path.parent.name)

    return {
        "name": name,
        "description": description,
        "severity": level,
        "mitre_tactic": tactic,
        "sigma_yaml": path.read_text(encoding="utf-8"),
        "enabled": True,
    }


def _api_get(api_url: str, path: str) -> dict:
    url = f"{api_url.rstrip('/')}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _api_post(api_url: str, path: str, payload: dict) -> tuple[int, dict]:
    url = f"{api_url.rstrip('/')}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def _api_patch(api_url: str, path: str, payload: dict) -> tuple[int, dict]:
    url = f"{api_url.rstrip('/')}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def seed(api_url: str) -> None:
    # Fetch existing rules once to build name → id map (for upsert)
    try:
        existing_resp = _api_get(api_url, "/v1/detections?limit=1000")
        existing: dict[str, str] = {
            r["name"]: r["id"] for r in existing_resp.get("rules", [])
        }
    except Exception as exc:
        print(f"ERROR: Could not reach API at {api_url} — {exc}", file=sys.stderr)
        sys.exit(1)

    files = _collect_rule_files()
    print(f"Found {len(files)} rule file(s) in {[str(d) for d in RULE_DIRS]}")

    created = updated = skipped = 0

    for path in files:
        rule = _parse_rule(path)
        if rule is None:
            skipped += 1
            continue

        existing_id = existing.get(rule["name"])
        if existing_id:
            # Upsert — update sigma_yaml + severity in case rule was changed
            status, body = _api_patch(api_url, f"/v1/detections/{existing_id}", {
                "sigma_yaml": rule["sigma_yaml"],
                "severity":   rule["severity"],
                "description": rule["description"],
                "enabled":    True,
            })
            if status == 200:
                print(f"  UPDATE  {rule['name']}")
                updated += 1
            else:
                print(f"  ERROR   {rule['name']}: {status} — {body}", file=sys.stderr)
                skipped += 1
        else:
            status, body = _api_post(api_url, "/v1/detections", rule)
            if status == 201:
                print(f"  CREATE  {rule['name']}")
                created += 1
            else:
                print(f"  ERROR   {rule['name']}: {status} — {body}", file=sys.stderr)
                skipped += 1

    print(f"\nDone — {created} created, {updated} updated, {skipped} skipped/errored")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed Sigma detection rules into Vigil")
    parser.add_argument(
        "--api-url", default="http://localhost:8001",
        help="Base URL of the Vigil API (default: http://localhost:8001)"
    )
    args = parser.parse_args()
    seed(args.api_url)
