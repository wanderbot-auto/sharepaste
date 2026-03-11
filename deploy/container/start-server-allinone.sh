#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${SHAREPASTE_DATA_ROOT:-/var/lib/sharepaste}"
PGDATA="${SHAREPASTE_PGDATA:-$DATA_ROOT/postgres}"
REDIS_DIR="${SHAREPASTE_REDIS_DIR:-$DATA_ROOT/redis}"

usage() {
  cat <<'EOF'
SharePaste all-in-one 容器入口

这个镜像内置：
- SharePaste gRPC server
- PostgreSQL
- Redis

默认行为：
- 容器启动时自动初始化 PostgreSQL / Redis
- 自动创建 sharepaste 数据库与账号
- 自动以 durable 模式启动服务端
- 所有数据落在 /var/lib/sharepaste，可挂载卷持久化

常用环境变量：
  SHAREPASTE_HOST               默认 0.0.0.0
  SHAREPASTE_PORT               默认 50052
  SHAREPASTE_STORAGE_MODE       默认 durable

  SHAREPASTE_PG_USER            默认 sharepaste
  SHAREPASTE_PG_PASSWORD        默认 sharepaste
  SHAREPASTE_PG_DB              默认 sharepaste
  SHAREPASTE_PG_PORT            默认 5432

  SHAREPASTE_REDIS_PORT         默认 6379
  SHAREPASTE_REDIS_PASSWORD     默认空

  SHAREPASTE_DATA_ROOT          默认 /var/lib/sharepaste
  SHAREPASTE_DATABASE_URL       可直接覆盖 PostgreSQL 连接串
  SHAREPASTE_REDIS_URL          可直接覆盖 Redis 连接串

说明：
  1. 这是联调 / 测试用的一体化镜像，不建议作为长期生产形态。
  2. 当前 gRPC 仍是 insecure 模式，建议配合内网 / VPN 使用。
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

export NODE_ENV="${NODE_ENV:-production}"
export SHAREPASTE_HOST="${SHAREPASTE_HOST:-0.0.0.0}"
export SHAREPASTE_PORT="${SHAREPASTE_PORT:-50052}"
export SHAREPASTE_STORAGE_MODE="${SHAREPASTE_STORAGE_MODE:-durable}"

export SHAREPASTE_PG_USER="${SHAREPASTE_PG_USER:-sharepaste}"
export SHAREPASTE_PG_PASSWORD="${SHAREPASTE_PG_PASSWORD:-sharepaste}"
export SHAREPASTE_PG_DB="${SHAREPASTE_PG_DB:-sharepaste}"
export SHAREPASTE_PG_PORT="${SHAREPASTE_PG_PORT:-5432}"

export SHAREPASTE_REDIS_PORT="${SHAREPASTE_REDIS_PORT:-6379}"
export SHAREPASTE_REDIS_PASSWORD="${SHAREPASTE_REDIS_PASSWORD:-}"

export SHAREPASTE_DATABASE_URL="${SHAREPASTE_DATABASE_URL:-postgres://${SHAREPASTE_PG_USER}:${SHAREPASTE_PG_PASSWORD}@127.0.0.1:${SHAREPASTE_PG_PORT}/${SHAREPASTE_PG_DB}}"
if [[ -n "${SHAREPASTE_REDIS_URL:-}" ]]; then
  export SHAREPASTE_REDIS_URL
else
  if [[ -n "$SHAREPASTE_REDIS_PASSWORD" ]]; then
    export SHAREPASTE_REDIS_URL="redis://:${SHAREPASTE_REDIS_PASSWORD}@127.0.0.1:${SHAREPASTE_REDIS_PORT}/0"
  else
    export SHAREPASTE_REDIS_URL="redis://127.0.0.1:${SHAREPASTE_REDIS_PORT}"
  fi
fi

mask_url() {
  local raw="$1"
  printf '%s' "$raw" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'
}

wait_for_postgres() {
  local attempts=0
  until runuser -u postgres -- pg_isready -h 127.0.0.1 -p "$SHAREPASTE_PG_PORT" -U postgres >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      echo "PostgreSQL 启动超时" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_redis() {
  local attempts=0
  local redis_cli=(redis-cli -h 127.0.0.1 -p "$SHAREPASTE_REDIS_PORT")
  if [[ -n "$SHAREPASTE_REDIS_PASSWORD" ]]; then
    redis_cli+=(-a "$SHAREPASTE_REDIS_PASSWORD")
  fi

  until "${redis_cli[@]}" ping >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 60 ]]; then
      echo "Redis 启动超时" >&2
      return 1
    fi
    sleep 1
  done
}

init_postgres() {
  mkdir -p "$PGDATA" "$REDIS_DIR"
  chown -R postgres:postgres "$DATA_ROOT"

  if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
    echo "初始化 PostgreSQL 数据目录 ..."
    runuser -u postgres -- initdb -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=scram-sha-256 >/dev/null

    cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = ${SHAREPASTE_PG_PORT}
EOF

    cat > "$PGDATA/pg_hba.conf" <<EOF
local   all             all                                     trust
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
  fi
}

start_postgres() {
  echo "启动 PostgreSQL ..."
  runuser -u postgres -- postgres -D "$PGDATA" &
  POSTGRES_PID=$!
  wait_for_postgres
}

ensure_database() {
  echo "检查 SharePaste 数据库与账号 ..."
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 --dbname postgres <<SQL >/dev/null
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${SHAREPASTE_PG_USER}') THEN
    CREATE ROLE ${SHAREPASTE_PG_USER} LOGIN PASSWORD '${SHAREPASTE_PG_PASSWORD}';
  ELSE
    ALTER ROLE ${SHAREPASTE_PG_USER} WITH PASSWORD '${SHAREPASTE_PG_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${SHAREPASTE_PG_DB} OWNER ${SHAREPASTE_PG_USER}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${SHAREPASTE_PG_DB}')\gexec
SQL
}

start_redis() {
  echo "启动 Redis ..."
  local redis_cmd=(
    redis-server
    --bind 127.0.0.1
    --port "$SHAREPASTE_REDIS_PORT"
    --dir "$REDIS_DIR"
    --appendonly yes
    --save 60 1
  )

  if [[ -n "$SHAREPASTE_REDIS_PASSWORD" ]]; then
    redis_cmd+=(--requirepass "$SHAREPASTE_REDIS_PASSWORD")
  fi

  "${redis_cmd[@]}" &
  REDIS_PID=$!
  wait_for_redis
}

start_server() {
  echo "启动 SharePaste server ..."
  node /app/apps/server/dist/src/index.js &
  SERVER_PID=$!
}

shutdown() {
  local exit_code=$?
  set +e

  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  if [[ -n "${REDIS_PID:-}" ]] && kill -0 "$REDIS_PID" 2>/dev/null; then
    kill -TERM "$REDIS_PID" 2>/dev/null || true
    wait "$REDIS_PID" 2>/dev/null || true
  fi

  if [[ -n "${POSTGRES_PID:-}" ]] && kill -0 "$POSTGRES_PID" 2>/dev/null; then
    kill -TERM "$POSTGRES_PID" 2>/dev/null || true
    wait "$POSTGRES_PID" 2>/dev/null || true
  fi

  exit "$exit_code"
}

trap shutdown EXIT INT TERM

echo "SharePaste all-in-one 容器即将启动："
echo "  gRPC 地址: ${SHAREPASTE_HOST}:${SHAREPASTE_PORT}"
echo "  存储模式: ${SHAREPASTE_STORAGE_MODE}"
echo "  PostgreSQL: $(mask_url "$SHAREPASTE_DATABASE_URL")"
echo "  Redis: $(mask_url "$SHAREPASTE_REDIS_URL")"
echo "  数据目录: ${DATA_ROOT}"

init_postgres
start_postgres
ensure_database
start_redis
start_server

wait "$SERVER_PID"
