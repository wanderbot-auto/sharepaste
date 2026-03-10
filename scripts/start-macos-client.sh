#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm install
fi

export SHAREPASTE_REPO_ROOT="${SHAREPASTE_REPO_ROOT:-$(pwd)}"
export SHAREPASTE_SERVER="${SHAREPASTE_SERVER:-127.0.0.1:50052}"
export SHAREPASTE_STATE_PATH="${SHAREPASTE_STATE_PATH:-$(pwd)/.sharepaste-dev/state.json}"
export SHAREPASTE_RESET_STALE_STATE="${SHAREPASTE_RESET_STALE_STATE:-1}"

mkdir -p "$(dirname "$SHAREPASTE_STATE_PATH")"

exec npm run desktop:macos:dev
