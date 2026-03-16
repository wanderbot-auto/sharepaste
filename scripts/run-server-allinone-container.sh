#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-sharepaste/server-allinone:local}"
CONTAINER_NAME="${CONTAINER_NAME:-sharepaste-server}"
HOST_PORT="${HOST_PORT:-50052}"
VOLUME_NAME="${VOLUME_NAME:-sharepaste-allinone-data}"

PG_USER="${SHAREPASTE_PG_USER:-sharepaste}"
PG_PASSWORD="${SHAREPASTE_PG_PASSWORD:-sharepaste}"
PG_DB="${SHAREPASTE_PG_DB:-sharepaste}"
REDIS_PASSWORD="${SHAREPASTE_REDIS_PASSWORD:-}"

echo "启动 SharePaste all-in-one 容器 ..."
echo "  镜像标签: ${IMAGE_TAG}"
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
