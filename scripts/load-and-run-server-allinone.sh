#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_PATH="${1:-sharepaste-server-allinone.tar.gz}"
IMAGE_TAG="${IMAGE_TAG:-sharepaste/server-allinone:local}"
CONTAINER_NAME="${CONTAINER_NAME:-sharepaste-server}"
HOST_PORT="${HOST_PORT:-50052}"
VOLUME_NAME="${VOLUME_NAME:-sharepaste-allinone-data}"

PG_USER="${SHAREPASTE_PG_USER:-sharepaste}"
PG_PASSWORD="${SHAREPASTE_PG_PASSWORD:-sharepaste}"
PG_DB="${SHAREPASTE_PG_DB:-sharepaste}"
REDIS_PASSWORD="${SHAREPASTE_REDIS_PASSWORD:-}"

usage() {
  cat <<'EOF'
加载并启动 SharePaste all-in-one 容器

用法：
  bash scripts/load-and-run-server-allinone.sh [镜像包路径]

默认行为：
  1. 从 tar.gz 镜像包执行 docker load
  2. 删除同名旧容器（如果存在）
  3. 以 all-in-one 方式启动 SharePaste server

默认参数：
  镜像包路径: sharepaste-server-allinone.tar.gz
  IMAGE_TAG: sharepaste/server-allinone:local
  CONTAINER_NAME: sharepaste-server
  HOST_PORT: 50052
  VOLUME_NAME: sharepaste-allinone-data

可用环境变量：
  IMAGE_TAG
  CONTAINER_NAME
  HOST_PORT
  VOLUME_NAME
  SHAREPASTE_PG_USER
  SHAREPASTE_PG_PASSWORD
  SHAREPASTE_PG_DB
  SHAREPASTE_REDIS_PASSWORD

示例：
  bash scripts/load-and-run-server-allinone.sh

  SHAREPASTE_PG_PASSWORD='CHANGE_ME' bash scripts/load-and-run-server-allinone.sh /opt/sharepaste/sharepaste-server-allinone.tar.gz
EOF
}

if [[ "$ARCHIVE_PATH" == "--help" || "$ARCHIVE_PATH" == "-h" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "找不到镜像包：${ARCHIVE_PATH}" >&2
  exit 1
fi

echo "加载 SharePaste all-in-one 镜像 ..."
echo "  镜像包: ${ARCHIVE_PATH}"
echo "  目标镜像标签: ${IMAGE_TAG}"

case "$ARCHIVE_PATH" in
  *.tar.gz|*.tgz)
    gunzip -c "$ARCHIVE_PATH" | docker load
    ;;
  *.tar)
    docker load -i "$ARCHIVE_PATH"
    ;;
  *)
    echo "不支持的镜像包格式：${ARCHIVE_PATH}" >&2
    echo "请提供 .tar 或 .tar.gz / .tgz 文件" >&2
    exit 1
    ;;
esac

echo "启动 SharePaste all-in-one 容器 ..."
echo "  容器名称: ${CONTAINER_NAME}"
echo "  映射端口: ${HOST_PORT}:50052"
echo "  数据卷名: ${VOLUME_NAME}"

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${HOST_PORT}:50052" \
  -v "${VOLUME_NAME}:/var/lib/sharepaste" \
  -e SHAREPASTE_PG_USER="${PG_USER}" \
  -e SHAREPASTE_PG_PASSWORD="${PG_PASSWORD}" \
  -e SHAREPASTE_PG_DB="${PG_DB}" \
  -e SHAREPASTE_REDIS_PASSWORD="${REDIS_PASSWORD}" \
  "${IMAGE_TAG}"

echo "启动完成。可执行以下命令查看日志："
echo "  docker logs -f ${CONTAINER_NAME}"
