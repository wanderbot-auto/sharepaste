#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.server"
SKIP_INSTALL=0
SKIP_BUILD=0

ARG_HOST=""
ARG_PORT=""
ARG_STORAGE_MODE=""
ARG_NODE_ENV=""
ARG_DATABASE_URL=""
ARG_REDIS_URL=""

ARG_DB_HOST=""
ARG_DB_PORT=""
ARG_DB_NAME=""
ARG_DB_USER=""
ARG_DB_PASSWORD=""
ARG_DB_SSLMODE=""

ARG_REDIS_HOST=""
ARG_REDIS_PORT=""
ARG_REDIS_PASSWORD=""
ARG_REDIS_DB=""

usage() {
  cat <<'EOF'
SharePaste 服务端启动脚本

用法：
  bash scripts/start-server-prod.sh [参数]

常用参数：
  -h, --help                     显示中文帮助
  --env-file <路径>             指定环境变量文件
  --host <地址>                 服务监听地址，默认 0.0.0.0
  --port <端口>                 服务监听端口，默认 50052
  --storage-mode <模式>         存储模式：memory 或 durable，默认 durable
  --node-env <环境>             NODE_ENV，默认 production
  --skip-install                跳过 npm install
  --skip-build                  跳过 npm run server:build

直接传完整连接串：
  --database-url <URL>          PostgreSQL 连接串
  --redis-url <URL>             Redis 连接串

按认证参数拼装 PostgreSQL 连接串：
  --db-host <主机>
  --db-port <端口>
  --db-name <数据库名>
  --db-user <用户名>
  --db-password <密码>
  --db-sslmode <模式>           例如 disable / require

按认证参数拼装 Redis 连接串：
  --redis-host <主机>
  --redis-port <端口>
  --redis-password <密码>
  --redis-db <编号>             例如 0 / 1

说明：
  1. 未传 --env-file 时，会优先读取仓库根目录 .env.server；
     若该文件不存在且 /etc/sharepaste/server.env 存在，则自动读取后者。
  2. 命令行参数优先级最高。
  3. 若密码包含 @、:、/、? 等特殊字符，建议直接使用 --database-url 或 --redis-url。
  4. durable 模式下建议显式提供 PostgreSQL 与 Redis 参数，避免误连本地默认配置。

示例：
  bash scripts/start-server-prod.sh --host 0.0.0.0 --port 50052

  bash scripts/start-server-prod.sh \
    --db-host 127.0.0.1 \
    --db-port 5432 \
    --db-name sharepaste \
    --db-user sharepaste \
    --db-password 'CHANGE_ME' \
    --redis-host 127.0.0.1 \
    --redis-port 6379

  bash scripts/start-server-prod.sh \
    --database-url 'postgres://sharepaste:CHANGE_ME@127.0.0.1:5432/sharepaste' \
    --redis-url 'redis://:CHANGE_ME@127.0.0.1:6379/0'
EOF
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    echo "参数错误：${flag} 需要指定值" >&2
    echo "可执行 bash scripts/start-server-prod.sh --help 查看帮助" >&2
    exit 1
  fi
}

resolve_env_file() {
  if [[ "$ENV_FILE" != ".env.server" ]]; then
    return
  fi

  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  if [[ -f "/etc/sharepaste/server.env" ]]; then
    ENV_FILE="/etc/sharepaste/server.env"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --env-file)
      require_value "$1" "${2:-}"
      ENV_FILE="$2"
      shift 2
      ;;
    --host)
      require_value "$1" "${2:-}"
      ARG_HOST="$2"
      shift 2
      ;;
    --port)
      require_value "$1" "${2:-}"
      ARG_PORT="$2"
      shift 2
      ;;
    --storage-mode)
      require_value "$1" "${2:-}"
      ARG_STORAGE_MODE="$2"
      shift 2
      ;;
    --node-env)
      require_value "$1" "${2:-}"
      ARG_NODE_ENV="$2"
      shift 2
      ;;
    --database-url)
      require_value "$1" "${2:-}"
      ARG_DATABASE_URL="$2"
      shift 2
      ;;
    --redis-url)
      require_value "$1" "${2:-}"
      ARG_REDIS_URL="$2"
      shift 2
      ;;
    --db-host)
      require_value "$1" "${2:-}"
      ARG_DB_HOST="$2"
      shift 2
      ;;
    --db-port)
      require_value "$1" "${2:-}"
      ARG_DB_PORT="$2"
      shift 2
      ;;
    --db-name)
      require_value "$1" "${2:-}"
      ARG_DB_NAME="$2"
      shift 2
      ;;
    --db-user)
      require_value "$1" "${2:-}"
      ARG_DB_USER="$2"
      shift 2
      ;;
    --db-password)
      require_value "$1" "${2:-}"
      ARG_DB_PASSWORD="$2"
      shift 2
      ;;
    --db-sslmode)
      require_value "$1" "${2:-}"
      ARG_DB_SSLMODE="$2"
      shift 2
      ;;
    --redis-host)
      require_value "$1" "${2:-}"
      ARG_REDIS_HOST="$2"
      shift 2
      ;;
    --redis-port)
      require_value "$1" "${2:-}"
      ARG_REDIS_PORT="$2"
      shift 2
      ;;
    --redis-password)
      require_value "$1" "${2:-}"
      ARG_REDIS_PASSWORD="$2"
      shift 2
      ;;
    --redis-db)
      require_value "$1" "${2:-}"
      ARG_REDIS_DB="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    *)
      echo "未知参数：$1" >&2
      echo "可执行 bash scripts/start-server-prod.sh --help 查看帮助" >&2
      exit 1
      ;;
  esac
done

resolve_env_file

if [[ -f "$ENV_FILE" ]]; then
  if [[ ! -r "$ENV_FILE" ]]; then
    echo "无法读取环境文件：$ENV_FILE" >&2
    echo "请检查文件权限，建议设置为 root:sharepaste 且权限为 640。" >&2
    echo "若只做一次性排查，也可改用命令行参数传入数据库和 Redis 连接信息。" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

export NODE_ENV="${ARG_NODE_ENV:-${NODE_ENV:-production}}"
export SHAREPASTE_HOST="${ARG_HOST:-${SHAREPASTE_HOST:-0.0.0.0}}"
export SHAREPASTE_PORT="${ARG_PORT:-${SHAREPASTE_PORT:-50052}}"
export SHAREPASTE_STORAGE_MODE="${ARG_STORAGE_MODE:-${SHAREPASTE_STORAGE_MODE:-durable}}"
export SHAREPASTE_DATABASE_URL="${ARG_DATABASE_URL:-${SHAREPASTE_DATABASE_URL:-postgres://sharepaste:sharepaste@127.0.0.1:5432/sharepaste}}"
export SHAREPASTE_REDIS_URL="${ARG_REDIS_URL:-${SHAREPASTE_REDIS_URL:-redis://127.0.0.1:6379}}"

if [[ "$SHAREPASTE_STORAGE_MODE" != "memory" && "$SHAREPASTE_STORAGE_MODE" != "durable" ]]; then
  echo "参数错误：--storage-mode 仅支持 memory 或 durable，当前值为 $SHAREPASTE_STORAGE_MODE" >&2
  exit 1
fi

build_database_url_from_parts() {
  local host="${ARG_DB_HOST:-${DB_HOST:-127.0.0.1}}"
  local port="${ARG_DB_PORT:-${DB_PORT:-5432}}"
  local name="${ARG_DB_NAME:-${DB_NAME:-sharepaste}}"
  local user="${ARG_DB_USER:-${DB_USER:-sharepaste}}"
  local password="${ARG_DB_PASSWORD:-${DB_PASSWORD:-sharepaste}}"
  local sslmode="${ARG_DB_SSLMODE:-${DB_SSLMODE:-}}"
  local url="postgres://${user}:${password}@${host}:${port}/${name}"
  if [[ -n "$sslmode" ]]; then
    url="${url}?sslmode=${sslmode}"
  fi
  printf '%s' "$url"
}

build_redis_url_from_parts() {
  local host="${ARG_REDIS_HOST:-${REDIS_HOST:-127.0.0.1}}"
  local port="${ARG_REDIS_PORT:-${REDIS_PORT:-6379}}"
  local password="${ARG_REDIS_PASSWORD:-${REDIS_PASSWORD:-}}"
  local database="${ARG_REDIS_DB:-${REDIS_DB:-}}"
  local auth=""
  local suffix=""

  if [[ -n "$password" ]]; then
    auth=":${password}@"
  fi
  if [[ -n "$database" ]]; then
    suffix="/${database}"
  fi

  printf 'redis://%s%s:%s%s' "$auth" "$host" "$port" "$suffix"
}

if [[ -n "$ARG_DB_HOST$ARG_DB_PORT$ARG_DB_NAME$ARG_DB_USER$ARG_DB_PASSWORD$ARG_DB_SSLMODE" ]]; then
  export SHAREPASTE_DATABASE_URL
  SHAREPASTE_DATABASE_URL="$(build_database_url_from_parts)"
fi

if [[ -n "$ARG_REDIS_HOST$ARG_REDIS_PORT$ARG_REDIS_PASSWORD$ARG_REDIS_DB" ]]; then
  export SHAREPASTE_REDIS_URL
  SHAREPASTE_REDIS_URL="$(build_redis_url_from_parts)"
fi

mask_url() {
  local raw="$1"
  printf '%s' "$raw" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'
}

echo "即将启动 SharePaste 服务端："
echo "  运行环境: ${NODE_ENV}"
echo "  监听地址: ${SHAREPASTE_HOST}:${SHAREPASTE_PORT}"
echo "  存储模式: ${SHAREPASTE_STORAGE_MODE}"
echo "  PostgreSQL: $(mask_url "$SHAREPASTE_DATABASE_URL")"
echo "  Redis: $(mask_url "$SHAREPASTE_REDIS_URL")"
echo "  环境文件: ${ENV_FILE}"

if [[ "$SKIP_INSTALL" -eq 0 && ! -d node_modules ]]; then
  echo "检测到 node_modules 不存在，执行 npm install ..."
  npm install
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "执行服务端构建 ..."
  npm run server:build
fi

echo "启动服务端进程 ..."
exec npm run -w @sharepaste/server start
