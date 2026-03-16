#!/usr/bin/env bash
set -euo pipefail

SOURCE_IMAGE="${1:-}"
TARGET_IMAGE="${2:-node:20-bookworm-slim}"

usage() {
  cat <<'EOF'
准备 SharePaste all-in-one 构建所需的 Node 基础镜像

用法：
  bash scripts/prepare-node-base-image.sh <源镜像> [目标镜像]

说明：
  1. 该脚本用于将“国内镜像源里的 Node 镜像”或“你本地已拉取的 Node 镜像”
     重标记为 Dockerfile 默认使用的基础镜像名。
  2. 默认目标镜像是 node:20-bookworm-slim。
  3. 这样后续可以直接执行：

     bash scripts/build-server-allinone-image.sh

示例：
  bash scripts/prepare-node-base-image.sh registry.cn-hangzhou.aliyuncs.com/your-mirror/node:20-bookworm-slim

  bash scripts/prepare-node-base-image.sh my-node-cache:20 node:20-bookworm-slim
EOF
}

if [[ "$SOURCE_IMAGE" == "" || "$SOURCE_IMAGE" == "--help" || "$SOURCE_IMAGE" == "-h" ]]; then
  usage
  exit 0
fi

echo "重标记基础镜像 ..."
echo "  源镜像: ${SOURCE_IMAGE}"
echo "  目标镜像: ${TARGET_IMAGE}"

docker tag "${SOURCE_IMAGE}" "${TARGET_IMAGE}"

echo "完成。现在可以执行："
echo "  bash scripts/build-server-allinone-image.sh"
