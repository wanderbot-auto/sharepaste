#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.server ]; then
  # shellcheck disable=SC1091
  source .env.server
fi

export NODE_ENV="${NODE_ENV:-production}"
export SHAREPASTE_HOST="${SHAREPASTE_HOST:-0.0.0.0}"
export SHAREPASTE_PORT="${SHAREPASTE_PORT:-50052}"
export SHAREPASTE_STORAGE_MODE="${SHAREPASTE_STORAGE_MODE:-durable}"
export SHAREPASTE_DATABASE_URL="${SHAREPASTE_DATABASE_URL:-postgres://sharepaste:sharepaste@127.0.0.1:5432/sharepaste}"
export SHAREPASTE_REDIS_URL="${SHAREPASTE_REDIS_URL:-redis://127.0.0.1:6379}"

if [ ! -d node_modules ]; then
  npm install
fi

npm run server:build

exec npm run -w @sharepaste/server start
