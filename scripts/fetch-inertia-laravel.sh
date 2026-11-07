#!/usr/bin/env bash
set -euo pipefail

# Fetch the Laravel adapter, the reference server adapter, into a gitignored
# folder, to compare its server behavior with this one.

DEST=".inertia-laravel"
REPO="https://github.com/inertiajs/inertia-laravel.git"

echo "Fetching inertia-laravel sources into $DEST/ …"
rm -rf "$DEST"
git clone --depth 1 "$REPO" "$DEST"
rm -rf "$DEST/.git"
echo "Done. $DEST/ holds a shallow snapshot of $REPO (gitignored)."
