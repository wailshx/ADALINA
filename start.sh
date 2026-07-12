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

    # Symlink store.db → persistent disk
    if [ ! -L "$SCRIPT_DIR/store.db" ]; then
        if [ -f "$SCRIPT_DIR/store.db" ]; then
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

    # Symlink uploads/ → persistent disk (images survive deploys)
    DISK_UPLOADS="$DISK_MOUNT/uploads"
    if [ ! -L "$SCRIPT_DIR/uploads" ]; then
        mkdir -p "$DISK_UPLOADS/products" "$DISK_UPLOADS/settings"
        if [ -d "$SCRIPT_DIR/uploads" ] && [ ! -L "$SCRIPT_DIR/uploads" ]; then
            cp -rn "$SCRIPT_DIR/uploads/"* "$DISK_UPLOADS/" 2>/dev/null || true
            rm -rf "$SCRIPT_DIR/uploads"
        fi
        ln -sf "$DISK_UPLOADS" "$SCRIPT_DIR/uploads"
        echo "[start.sh] Symlinked uploads/ → $DISK_UPLOADS"
    fi
else
    echo "[start.sh] No persistent disk at $DISK_MOUNT — using local store.db and uploads/"
fi

# Render sets PORT for the public-facing port. Internally the three processes
# each use their own port. The proxy sits in front and exposes a single port.
PROXY_PORT="${PORT:-8080}"
MAIN_PORT="${PORT_MAIN:-3000}"
ADMIN_PORT="${PORT_ADMIN:-5000}"

# Track process PIDs for crash detection
MAIN_PID=""
ADMIN_PID=""
PROXY_PID=""

cleanup() {
    echo ""
    echo "[start.sh] Shutting down servers..."
    kill "$MAIN_PID" "$ADMIN_PID" "$PROXY_PID" 2>/dev/null || true
    wait "$MAIN_PID" "$ADMIN_PID" "$PROXY_PID" 2>/dev/null || true
    echo "[start.sh] All servers stopped."
}

trap cleanup EXIT INT TERM

echo "[start.sh] Starting main server (port $MAIN_PORT)..."
PORT_MAIN="$MAIN_PORT" python3 server.py &
MAIN_PID=$!

echo "[start.sh] Starting admin server (port $ADMIN_PORT)..."
PORT_ADMIN="$ADMIN_PORT" python3 admin/app.py &
ADMIN_PID=$!

# Wait for backends to be ready (up to 10 seconds)
echo "[start.sh] Waiting for backends to bind..."
for i in $(seq 1 20); do
    if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$MAIN_PORT/')" 2>/dev/null; then
        echo "[start.sh] Main server ready"
        break
    fi
    sleep 0.5
done

echo "[start.sh] Starting reverse proxy (port $PROXY_PORT)..."
PORT="$PROXY_PORT" PORT_MAIN="$MAIN_PORT" PORT_ADMIN="$ADMIN_PORT" python3 proxy.py &
PROXY_PID=$!

echo "[start.sh] All 3 processes started. Proxy listening on $PROXY_PORT."

# Monitor: if any backend crashes, restart it. If proxy crashes, restart everything.
while true; do
    # Check if main server is alive
    if ! kill -0 "$MAIN_PID" 2>/dev/null; then
        echo "[start.sh] Main server crashed — restarting..."
        PORT_MAIN="$MAIN_PORT" python3 server.py &
        MAIN_PID=$!
    fi
    # Check if admin server is alive
    if ! kill -0 "$ADMIN_PID" 2>/dev/null; then
        echo "[start.sh] Admin server crashed — restarting..."
        PORT_ADMIN="$ADMIN_PORT" python3 admin/app.py &
        ADMIN_PID=$!
    fi
    # Check if proxy is alive
    if ! kill -0 "$PROXY_PID" 2>/dev/null; then
        echo "[start.sh] Proxy crashed — restarting..."
        PORT="$PROXY_PORT" PORT_MAIN="$MAIN_PORT" PORT_ADMIN="$ADMIN_PORT" python3 proxy.py &
        PROXY_PID=$!
    fi
    sleep 5
done
