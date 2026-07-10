#!/usr/bin/env bash
# start.sh — Single entry point that launches both servers.
# Usage: ./start.sh  (or: bash start.sh)
# The hosting platform should run this as its start command.
#
# Both servers must run from the project root so that
# config/database.py and admin/database.py resolve store.db correctly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cleanup() {
    echo ""
    echo "[start.sh] Shutting down servers..."
    kill "$MAIN_PID" "$ADMIN_PID" 2>/dev/null || true
    wait "$MAIN_PID" "$ADMIN_PID" 2>/dev/null || true
    echo "[start.sh] All servers stopped."
}

trap cleanup EXIT INT TERM

echo "[start.sh] Starting main server (port ${PORT_MAIN:-3000})..."
python3 server.py &
MAIN_PID=$!

echo "[start.sh] Starting admin server (port ${PORT_ADMIN:-5000})..."
python3 admin/app.py &
ADMIN_PID=$!

echo "[start.sh] Both servers started. Press Ctrl+C to stop."
wait
