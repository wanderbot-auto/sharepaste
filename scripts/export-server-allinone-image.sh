#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_TAG="${1:-sharepaste/server-allinone:local}"
OUTPUT_PATH="${2:-sharepaste-server-allinone.tar.gz}"

echo "导出 SharePaste all-in-one 镜像 ..."
echo "  镜像标签: ${IMAGE_TAG}"
echo "  输出文件: ${OUTPUT_PATH}"

docker save "${IMAGE_TAG}" | gzip > "${OUTPUT_PATH}"
