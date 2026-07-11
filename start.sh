#!/usr/bin/env bash
# start.sh — Single entry point that launches both servers.
# Usage: ./start.sh  (or: bash start.sh)
# The hosting platform should run this as its start command.
#
# Both servers must run from the project root so that
# config/database.py and admin/database.py resolve store.db correctly.
#
# Render sets PORT for the public-facing server. For local dev, PORT_MAIN works.
# Render persistent disk: mount at DISK_MOUNT (default /data). start.sh symlinks
# store.db into the project root so both servers find it on the persistent disk.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Persistent disk setup ---
DISK_MOUNT="${DISK_MOUNT:-/opt/render/project/src/data}"
if [ -d "$DISK_MOUNT" ]; then
    echo "[start.sh] Persistent disk detected at $DISK_MOUNT"
    # Symlink store.db from project root → disk (if not already linked)
    if [ ! -L "$SCRIPT_DIR/store.db" ]; then
        if [ -f "$SCRIPT_DIR/store.db" ]; then
            # First deploy: copy existing DB to disk, then symlink
            cp "$SCRIPT_DIR/store.db" "$DISK_MOUNT/store.db"
            [ -f "$SCRIPT_DIR/store.db-shm" ] && cp "$SCRIPT_DIR/store.db-shm" "$DISK_MOUNT/store.db-shm"
            [ -f "$SCRIPT_DIR/store.db-wal" ] && cp "$SCRIPT_DIR/store.db-wal" "$DISK_MOUNT/store.db-wal"
            echo "[start.sh] Migrated existing DB to persistent disk"
        fi
        ln -sf "$DISK_MOUNT/store.db" "$SCRIPT_DIR/store.db"
        [ -f "$DISK_MOUNT/store.db-shm" ] && ln -sf "$DISK_MOUNT/store.db-shm" "$SCRIPT_DIR/store.db-shm"
        [ -f "$DISK_MOUNT/store.db-wal" ] && ln -sf "$DISK_MOUNT/store.db-wal" "$SCRIPT_DIR/store.db-wal"
        echo "[start.sh] Symlinked store.db → $DISK_MOUNT/store.db"
    fi
else
    echo "[start.sh] No persistent disk at $DISK_MOUNT — using local store.db"
fi

# Render sets PORT; fall back to PORT_MAIN for local dev
MAIN_PORT="${PORT_MAIN:-${PORT:-3000}}"
ADMIN_PORT="${PORT_ADMIN:-5000}"

cleanup() {
    echo ""
    echo "[start.sh] Shutting down servers..."
    kill "$MAIN_PID" "$ADMIN_PID" 2>/dev/null || true
    wait "$MAIN_PID" "$ADMIN_PID" 2>/dev/null || true
    echo "[start.sh] All servers stopped."
}

trap cleanup EXIT INT TERM

echo "[start.sh] Starting main server (port $MAIN_PORT)..."
PORT_MAIN="$MAIN_PORT" python3 server.py &
MAIN_PID=$!

echo "[start.sh] Starting admin server (port $ADMIN_PORT)..."
PORT_ADMIN="$ADMIN_PORT" python3 admin/app.py &
ADMIN_PID=$!

echo "[start.sh] Both servers started. Press Ctrl+C to stop."
wait
