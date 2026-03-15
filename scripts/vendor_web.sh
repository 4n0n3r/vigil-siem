#!/usr/bin/env bash
# vendor_web.sh — download vendored JS libraries for the Vigil web UI
# Run from the repo root: bash scripts/vendor_web.sh
set -euo pipefail

VENDOR_DIR="cli/cmd/web/static/vendor"
mkdir -p "$VENDOR_DIR"

echo "Downloading Chart.js v4..."
curl -fsSL "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" \
  -o "$VENDOR_DIR/chart.min.js"

echo "Downloading D3.js v7..."
curl -fsSL "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js" \
  -o "$VENDOR_DIR/d3.min.js"

echo "Done. Vendor files written to $VENDOR_DIR/"
