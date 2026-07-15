#!/usr/bin/env bash
# start.sh — Single entry point that launches all three processes.
# Usage: ./start.sh  (or: bash start.sh)
#
# Render sets PORT for the public-facing server. For local dev, PORT_MAIN works.
# Database is PostgreSQL (Supabase) — no local store.db needed.
# Images are stored locally in uploads/ (symlinked to persistent disk if available).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p "$SCRIPT_DIR/uploads/products" "$SCRIPT_DIR/uploads/settings"

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

# Wait for backends to be ready (up to 30 seconds)
echo "[start.sh] Waiting for backends to bind..."
for i in $(seq 1 30); do
    if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$MAIN_PORT/')" 2>/dev/null; then
        echo "[start.sh] Main server ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "[start.sh] Main server not ready after 30s, starting proxy anyway"
    fi
    sleep 1
done

echo "[start.sh] Starting reverse proxy (port $PROXY_PORT)..."
PORT="$PROXY_PORT" PORT_MAIN="$MAIN_PORT" PORT_ADMIN="$ADMIN_PORT" python3 proxy.py &
PROXY_PID=$!

echo "[start.sh] All 3 processes started. Proxy listening on $PROXY_PORT."

# Monitor: if any backend crashes, restart it. If proxy crashes, restart everything.
while true; do
    if ! kill -0 "$MAIN_PID" 2>/dev/null; then
        echo "[start.sh] Main server crashed — restarting..."
        PORT_MAIN="$MAIN_PORT" python3 server.py &
        MAIN_PID=$!
    fi
    if ! kill -0 "$ADMIN_PID" 2>/dev/null; then
        echo "[start.sh] Admin server crashed — restarting..."
        PORT_ADMIN="$ADMIN_PORT" python3 admin/app.py &
        ADMIN_PID=$!
    fi
    if ! kill -0 "$PROXY_PID" 2>/dev/null; then
        echo "[start.sh] Proxy crashed — restarting..."
        PORT="$PROXY_PORT" PORT_MAIN="$MAIN_PORT" PORT_ADMIN="$ADMIN_PORT" python3 proxy.py &
        PROXY_PID=$!
    fi
    sleep 5
done
