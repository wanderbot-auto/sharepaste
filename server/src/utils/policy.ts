import type { Policy } from "../types.js";
import { nowUnix } from "./ids.js";

export const DEFAULT_POLICY = (updatedBy = "system"): Policy => ({
  allowText: true,
  allowImage: true,
  allowFile: true,
  maxFileSizeBytes: 3 * 1024 * 1024,
  version: 1,
  updatedBy,
  updatedAtUnix: nowUnix()
});

export const isItemAllowedByPolicy = (
  policy: Policy,
  kind: "text" | "image" | "file",
  sizeBytes: number
): boolean => {
  if (kind === "text") {
    return policy.allowText;
  }
  if (kind === "image") {
    return policy.allowImage;
  }
  if (!policy.allowFile) {
    return false;
  }
  return sizeBytes < policy.maxFileSizeBytes;
};
