#!/bin/sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Occu only supports macOS." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh and rerun ./setup.sh." >&2
  exit 1
fi

case "${1:-}" in
  -h|--help)
    echo "Usage: ./setup.sh [options] [APP ...]"
    echo
    echo "Installs Occu globally as an OpenCode MCP server. Named apps are added"
    echo "to the local mutation allowlist. Run without apps for observation only."
    echo
    echo "Options:"
    echo "  --config PATH             Override the OpenCode config path"
    echo "  --skip-permissions        Do not inspect or request macOS permissions"
    echo "  --skip-opencode-check     Do not run opencode mcp list"
    echo "  -h, --help                Show this help"
    exit 0
    ;;
esac

echo "Installing pinned dependencies..."
bun install --cwd "$ROOT" --frozen-lockfile

exec bun "$ROOT/scripts/setup.ts" "$@"
