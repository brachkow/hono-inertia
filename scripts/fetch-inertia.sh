#!/usr/bin/env bash
set -euo pipefail

# Fetch upstream Inertia.js sources into a gitignored folder so the coding agent
# can read the real client/protocol code while working on this server adapter.

DEST=".inertia"
REPO="https://github.com/inertiajs/inertia.git"

echo "Fetching Inertia sources into $DEST/ …"
rm -rf "$DEST"
git clone --depth 1 "$REPO" "$DEST"
rm -rf "$DEST/.git"
echo "Done. $DEST/ holds a shallow snapshot of $REPO (gitignored)."
