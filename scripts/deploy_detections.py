"""Deploy Sigma detection rules to the Vigil API.

Usage:
  python scripts/deploy_detections.py --all
  python scripts/deploy_detections.py --category credential_access
  python scripts/deploy_detections.py --category credential_access,persistence
  python scripts/deploy_detections.py --file detections/credential_access/brute_force.yml
  python scripts/deploy_detections.py --all --dry-run
  python scripts/deploy_detections.py --all --upsert

Environment:
  VIGIL_API_URL   Base URL (default: http://localhost:8001)
  VIGIL_API_KEY   API key (optional, for authenticated deployments)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).parent.parent
DETECTIONS_ROOT = REPO_ROOT / "detections"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Deploy Vigil detection rules")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Deploy all rules")
    group.add_argument("--category", help="Comma-separated tactic directories, e.g. credential_access,web")
    group.add_argument("--file", help="Single .yml file to deploy")
    p.add_argument("--api-url", default=os.getenv("VIGIL_API_URL", "http://localhost:8001"))
    p.add_argument("--api-key", default=os.getenv("VIGIL_API_KEY", ""))
    p.add_argument("--dry-run", action="store_true", help="Print what would be deployed, don't POST")
    p.add_argument("--upsert", action="store_true", help="Skip rules that already exist (match by name)")
    p.add_argument("--verbose", action="store_true", help="Print full API response for each rule")
    return p.parse_args()


def collect_files(args: argparse.Namespace) -> list[Path]:
    if args.file:
        p = Path(args.file)
        if not p.exists():
            sys.exit(f"File not found: {args.file}")
        return [p]

    if args.all:
        return sorted(DETECTIONS_ROOT.rglob("*.yml"))

    # --category
    files: list[Path] = []
    for cat in args.category.split(","):
        cat = cat.strip()
        cat_dir = DETECTIONS_ROOT / cat
        if not cat_dir.is_dir():
            print(f"WARNING: category dir not found: {cat_dir}", file=sys.stderr)
            continue
        files.extend(sorted(cat_dir.glob("*.yml")))
    return files


def rule_from_file(path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8")
        doc = yaml.safe_load(text)
    except Exception as exc:
        print(f"  PARSE ERROR {path.name}: {exc}", file=sys.stderr)
        return None

    if not isinstance(doc, dict):
        print(f"  SKIP {path.name}: not a YAML mapping", file=sys.stderr)
        return None

    # Derive name from title field, fallback to filename
    name = doc.get("title") or path.stem.replace("_", " ").title()
    severity = doc.get("level", "medium")
    # Sigma uses 'level'; normalise to our enum
    severity_map = {"informational": "info", "low": "low", "medium": "medium",
                    "high": "high", "critical": "critical"}
    severity = severity_map.get(severity.lower(), "medium")

    # Derive primary MITRE tactic from tags or directory name
    tags = doc.get("tags") or []
    tactic = path.parent.name  # directory is the tactic
    for tag in tags:
        t = str(tag).lower()
        if t.startswith("attack.") and not t.startswith("attack.t"):
            tactic = t.replace("attack.", "")
            break

    return {
        "name": name,
        "description": doc.get("description", ""),
        "severity": severity,
        "mitre_tactic": tactic,
        "sigma_yaml": text,
        "enabled": True,
    }


def fetch_existing_names(api_url: str, headers: dict) -> set[str]:
    try:
        req = urllib.request.Request(
            f"{api_url}/v1/detections?limit=1000",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        return {r["name"] for r in data.get("rules", [])}
    except Exception as exc:
        print(f"WARNING: could not fetch existing rules: {exc}", file=sys.stderr)
        return set()


def post_rule(api_url: str, headers: dict, rule: dict) -> tuple[bool, str]:
    body = json.dumps(rule).encode()
    req = urllib.request.Request(
        f"{api_url}/v1/detections",
        data=body,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return True, result.get("id", "")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        return False, f"HTTP {exc.code}: {detail[:120]}"
    except Exception as exc:
        return False, str(exc)


def main() -> None:
    args = parse_args()
    files = collect_files(args)

    if not files:
        sys.exit("No detection files found.")

    print(f"Found {len(files)} detection file(s)")

    if args.dry_run:
        print("\n-- DRY RUN (no POST) --")
        for f in files:
            print(f"  {f.relative_to(REPO_ROOT)}")
        print(f"\nTotal: {len(files)}")
        return

    api_url = args.api_url.rstrip("/")
    headers: dict = {}
    if args.api_key:
        headers["X-Vigil-Key"] = args.api_key

    existing: set[str] = set()
    if args.upsert:
        print("Fetching existing rule names...")
        existing = fetch_existing_names(api_url, headers)
        print(f"  {len(existing)} rules already in API")

    created = skipped = errors = 0

    for path in files:
        rule = rule_from_file(path)
        if rule is None:
            errors += 1
            continue

        if args.upsert and rule["name"] in existing:
            print(f"  SKIP (exists) {rule['name']}")
            skipped += 1
            continue

        ok, detail = post_rule(api_url, headers, rule)
        if ok:
            sev = rule["severity"].upper()
            print(f"  OK  [{sev:8}] {rule['name']}")
            if args.verbose:
                print(f"         id={detail}")
            created += 1
        else:
            print(f"  ERR {rule['name']}: {detail}")
            errors += 1

    print(f"\nCreated: {created}  Skipped: {skipped}  Errors: {errors}")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
