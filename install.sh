#!/bin/sh

set -eu

REPOSITORY="Arjun-Ingole/occu"
REF=${OCCU_REF:-main}
INSTALL_DIR=${OCCU_INSTALL_DIR:-"$HOME/.local/share/occu"}

case "$INSTALL_DIR" in
  ""|/|"$HOME")
    echo "Refusing unsafe OCCU_INSTALL_DIR: $INSTALL_DIR" >&2
    exit 1
    ;;
  /*) ;;
  *) INSTALL_DIR="$PWD/$INSTALL_DIR" ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Occu only supports macOS." >&2
  exit 1
fi

for command in curl tar bun opencode; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is required but was not found in PATH." >&2
    exit 1
  fi
done

PARENT_DIR=$(dirname -- "$INSTALL_DIR")
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/occu-install.XXXXXX")
STAGED_DIR="$TEMP_DIR/source"
ARCHIVE="$TEMP_DIR/occu.tar.gz"
BACKUP_DIR="$INSTALL_DIR.previous.$$"
HAS_BACKUP=false

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup 0 1 2 15

echo "Downloading Occu ($REF)..."
curl -fsSL "https://codeload.github.com/$REPOSITORY/tar.gz/$REF" -o "$ARCHIVE"
mkdir -p "$STAGED_DIR"
tar -xzf "$ARCHIVE" -C "$STAGED_DIR" --strip-components=1

if [ ! -x "$STAGED_DIR/setup.sh" ]; then
  echo "Downloaded archive does not contain an executable setup.sh." >&2
  exit 1
fi

mkdir -p "$PARENT_DIR"
if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
  if [ -e "$BACKUP_DIR" ] || [ -L "$BACKUP_DIR" ]; then
    echo "Temporary backup path already exists: $BACKUP_DIR" >&2
    exit 1
  fi
  mv "$INSTALL_DIR" "$BACKUP_DIR"
  HAS_BACKUP=true
fi

if ! mv "$STAGED_DIR" "$INSTALL_DIR"; then
  if [ "$HAS_BACKUP" = true ]; then
    mv "$BACKUP_DIR" "$INSTALL_DIR"
  fi
  echo "Could not install Occu at $INSTALL_DIR." >&2
  exit 1
fi

if ! "$INSTALL_DIR/setup.sh" "$@"; then
  echo "Setup failed; restoring the previous Occu installation." >&2
  rm -rf "$INSTALL_DIR"
  if [ "$HAS_BACKUP" = true ]; then
    mv "$BACKUP_DIR" "$INSTALL_DIR"
  fi
  exit 1
fi

if [ "$HAS_BACKUP" = true ]; then
  rm -rf "$BACKUP_DIR"
fi

echo "Occu is installed at $INSTALL_DIR"

