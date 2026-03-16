#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_TAG="${1:-sharepaste/server-allinone:local}"
BASE_IMAGE="${BASE_IMAGE:-node:20-bookworm-slim}"

echo "构建 SharePaste all-in-one 镜像 ..."
echo "  镜像标签: ${IMAGE_TAG}"
echo "  基础镜像: ${BASE_IMAGE}"

docker build \
  --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
  -f Dockerfile.server-allinone \
  -t "${IMAGE_TAG}" \
  .
