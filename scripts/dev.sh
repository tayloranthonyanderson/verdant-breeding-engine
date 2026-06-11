#!/usr/bin/env bash
# One-command native dev runner (macOS / Homebrew).
# Starts Postgres, applies the schema, and runs the API + frontend together.
#   ./scripts/dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
export DYLD_FALLBACK_LIBRARY_PATH="/opt/homebrew/opt/postgresql@16/lib:${DYLD_FALLBACK_LIBRARY_PATH:-}"
export APP_ROOT="$ROOT"

echo "▸ Postgres"
pg_isready -q 2>/dev/null || brew services start postgresql@16
until pg_isready -q 2>/dev/null; do sleep 1; done
createdb breeding 2>/dev/null || true
psql -d breeding -q -f "$ROOT/db/migrations/0001_init.sql" >/dev/null
echo "  schema ready"

# load .env if present (ANTHROPIC_API_KEY etc.)
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a

cleanup() { echo; echo "stopping…"; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▸ API on :8000"
( cd "$ROOT" && Rscript api/entrypoint.R ) &

echo "▸ Frontend on :3000"
( cd "$ROOT/frontend" && PORT=3000 npm run dev ) &

wait
