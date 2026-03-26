#!/usr/bin/env bash
# Vigil agent install script — Linux and macOS
#
# Usage (one-liner):
#   curl -fsSL https://raw.githubusercontent.com/4n0n3r/vigil-siem/main/scripts/install.sh | bash
#
# Usage (with API URL passed in):
#   curl -fsSL .../install.sh -o install.sh && bash install.sh --api-url http://your-server:8001
#
# Environment overrides:
#   VIGIL_INSTALL_DIR   Where to place the binary (default: /usr/local/bin)
#   VIGIL_VERSION       Pin a specific version (default: latest)

set -euo pipefail

REPO="4n0n3r/vigil-siem"
INSTALL_DIR="${VIGIL_INSTALL_DIR:-/usr/local/bin}"
BINARY="vigil"
API_URL=""

# Parse optional flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url) API_URL="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --version) VIGIL_VERSION="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux|darwin) ;;
  *) echo "error: unsupported OS: $OS" >&2; exit 1 ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)      ARCH="amd64" ;;
  aarch64|arm64)     ARCH="arm64" ;;
  *) echo "error: unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

# Resolve version
if [[ -z "${VIGIL_VERSION:-}" ]]; then
  echo "Fetching latest release..."
  VIGIL_VERSION=$(curl -fsSL \
    -H "Accept: application/json" \
    "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' \
    | sed 's/.*"v\([^"]*\)".*/\1/')

  if [[ -z "$VIGIL_VERSION" ]]; then
    echo "error: could not determine latest version" >&2
    exit 1
  fi
fi

BINARY_NAME="${BINARY}_${VIGIL_VERSION}_${OS}_${ARCH}"
BASE_URL="https://github.com/$REPO/releases/download/v${VIGIL_VERSION}"

echo "Installing vigil v${VIGIL_VERSION} (${OS}/${ARCH})..."

# Create temp files, clean up on exit
TMP_BIN=$(mktemp)
TMP_SUMS=$(mktemp)
trap 'rm -f "$TMP_BIN" "$TMP_SUMS"' EXIT

# Download binary and checksum file
curl -fsSL "$BASE_URL/$BINARY_NAME"    -o "$TMP_BIN"
curl -fsSL "$BASE_URL/checksums.txt"   -o "$TMP_SUMS"

# Verify SHA256 checksum
EXPECTED=$(grep "  ${BINARY_NAME}$" "$TMP_SUMS" | awk '{print $1}')
if [[ -z "$EXPECTED" ]]; then
  echo "error: checksum not found for $BINARY_NAME" >&2
  exit 1
fi

if command -v sha256sum &>/dev/null; then
  ACTUAL=$(sha256sum "$TMP_BIN" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
  ACTUAL=$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')
else
  echo "error: no SHA256 tool found (need sha256sum or shasum)" >&2
  exit 1
fi

if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "error: checksum mismatch — download may be corrupted" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  got:      $ACTUAL" >&2
  exit 1
fi

# Install
chmod +x "$TMP_BIN"
mkdir -p "$INSTALL_DIR"

if [[ -w "$INSTALL_DIR" ]]; then
  mv "$TMP_BIN" "$INSTALL_DIR/$BINARY"
else
  echo "Install directory requires elevated permissions, using sudo..."
  sudo mv "$TMP_BIN" "$INSTALL_DIR/$BINARY"
fi

echo ""
echo "vigil v${VIGIL_VERSION} installed to $INSTALL_DIR/$BINARY"
echo ""
echo "Next steps:"
if [[ -n "$API_URL" ]]; then
  echo "  vigil config set api_url $API_URL"
else
  echo "  vigil config set api_url http://your-vigil-server:8001"
fi
echo "  vigil agent register --name $(hostname -s 2>/dev/null || hostname)"
echo "  vigil agent start"
echo ""
echo "To install as a systemd service:"
echo "  sudo tee /etc/systemd/system/vigil-agent.service <<EOF"
echo "  [Unit]"
echo "  Description=Vigil Security Agent"
echo "  After=network.target"
echo ""
echo "  [Service]"
echo "  ExecStart=$INSTALL_DIR/$BINARY agent start --profile standard"
echo "  Environment=VIGIL_API_URL=${API_URL:-http://your-vigil-server:8001}"
echo "  Restart=on-failure"
echo ""
echo "  [Install]"
echo "  WantedBy=multi-user.target"
echo "  EOF"
echo "  sudo systemctl daemon-reload && sudo systemctl enable --now vigil-agent"
