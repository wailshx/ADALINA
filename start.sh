#!/usr/bin/env bash
# start.sh — Single FastAPI process (replaces 3-process architecture).
# Usage: ./start.sh  (or: bash start.sh)
#
# Single command: uvicorn main:app --host 0.0.0.0 --port $PORT
# Database is PostgreSQL (Supabase) — no local store.db needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env file if present (local dev only)
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    . "$SCRIPT_DIR/.env"
    set +a
fi

mkdir -p "$SCRIPT_DIR/uploads/products" "$SCRIPT_DIR/uploads/settings"

PORT="${PORT:-8080}"

echo "[start.sh] Starting ADALINA FastAPI server on port $PORT..."
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1
