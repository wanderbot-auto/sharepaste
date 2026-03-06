export type ClipboardKind = "text" | "image" | "file";

export interface ClipboardPayload {
  itemId: string;
  type: ClipboardKind;
  mime: string;
  sizeBytes: number;
  createdAtUnix: number;
  sourceDeviceId: string;
  cipherRef: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export interface SharePolicy {
  allowText: boolean;
  allowImage: boolean;
  allowFile: boolean;
  maxFileSizeBytes: number;
  version: number;
}

export interface DeviceProfile {
  deviceId: string;
  name: string;
  platform: string;
  groupId: string;
}
