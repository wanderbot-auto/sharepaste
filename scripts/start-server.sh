#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm install
fi

export SHAREPASTE_HOST="${SHAREPASTE_HOST:-0.0.0.0}"
export SHAREPASTE_PORT="${SHAREPASTE_PORT:-50052}"
export SHAREPASTE_STORAGE_MODE="${SHAREPASTE_STORAGE_MODE:-memory}"

exec npm run server:dev
