export type ClipboardKind = "text" | "image" | "file";

export interface Device {
  deviceId: string;
  groupId: string;
  pubkey: string;
  name: string;
  platform: string;
  lastSeenUnix: number;
  active: boolean;
}

export interface BindCode {
  code: string;
  issuerDeviceId: string;
  expiresAtUnix: number;
  attemptsLeft: number;
}

export interface BindRequest {
  requestId: string;
  code: string;
  issuerDeviceId: string;
  requesterDeviceId: string;
  expiresAtUnix: number;
  approved?: boolean;
  groupId?: string;
  sealedGroupKey?: string;
}

export interface Policy {
  allowText: boolean;
  allowImage: boolean;
  allowFile: boolean;
  maxFileSizeBytes: number;
  version: number;
  updatedBy: string;
  updatedAtUnix: number;
}

export interface ClipboardItem {
  itemId: string;
  type: ClipboardKind;
  sizeBytes: number;
  mime: string;
  cipherRef: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  createdAtUnix: number;
  sourceDeviceId: string;
}

export interface GroupState {
  groupId: string;
  recoveryPhraseHash: string;
  groupKeyVersion: number;
  groupKeyBase64: string;
  policy: Policy;
}

export interface OfflineEnvelope {
  item: ClipboardItem;
  targetDeviceId: string;
  expiresAtUnix: number;
}
