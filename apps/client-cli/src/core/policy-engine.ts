import type { ClipboardPayload, SharePolicy } from "../types.js";

export const defaultPolicy = (): SharePolicy => ({
  allowText: true,
  allowImage: true,
  allowFile: true,
  maxFileSizeBytes: 3 * 1024 * 1024,
  version: 1
});

export const isAllowedByPolicy = (policy: SharePolicy, payload: ClipboardPayload): boolean => {
  if (payload.type === "text") {
    return policy.allowText;
  }

  if (payload.type === "image") {
    return policy.allowImage;
  }

  if (!policy.allowFile) {
    return false;
  }

  return payload.sizeBytes < policy.maxFileSizeBytes;
};
