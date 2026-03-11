import type { CipherEnvelope, ClipboardPayload, DeviceIdentity, SharePolicy } from "@sharepaste/client-core";
import type { PersistedState } from "./state-store.js";

export type ClipboardChange = { kind: "text"; value: string } | { kind: "image"; filePath: string; mime?: string };

export interface ClipboardPort {
  start(onChange: (change: ClipboardChange) => Promise<void> | void, intervalMs?: number): Promise<void>;
  stop(): void;
  writeText(value: string): Promise<void>;
}

export interface CryptoPort {
  createIdentity(): DeviceIdentity;
  generateGroupKey(): Uint8Array;
  encryptClipboard(groupKey: Uint8Array, plaintext: Uint8Array): CipherEnvelope;
  decryptClipboard(groupKey: Uint8Array, envelope: CipherEnvelope): Uint8Array;
  sealGroupKeyForDevice(groupKey: Uint8Array, recipientWrapPublicKeyPem: string): string;
  unsealGroupKeyForDevice(sealed: string, recipientWrapPrivateKeyPem: string): Uint8Array;
}

export interface HistoryStorePort {
  push(item: ClipboardPayload): void;
}

export interface IncomingItemStorePort {
  materialize(payload: ClipboardPayload, plaintext: Uint8Array): Promise<string>;
}

export interface PersistedStateStorePort {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
  clear(): Promise<void>;
}

export interface DeviceRecord {
  deviceId: string;
  groupId: string;
  pubkey: string;
  name: string;
  platform: string;
}

export interface RegisterDeviceResult {
  device: DeviceRecord;
  groupId: string;
  recoveryPhrase: string;
  sealedGroupKey: string;
}

export interface RecoverGroupResult {
  device: DeviceRecord;
  groupId: string;
  sealedGroupKey: string;
}

export interface DeviceContextResult {
  device: DeviceRecord;
  groupId: string;
  sealedGroupKey: string;
  groupKeyVersion: number;
}

export interface BindCodeResult {
  code: string;
  expiresAtUnix: string;
  attemptsLeft: number;
}

export interface BindRequestResult {
  requestId: string;
  expiresAtUnix: string;
}

export interface ConfirmBindResult {
  approved: boolean;
  groupId: string;
  sealedGroupKey: string;
  groupKeyVersion: number;
}

export interface DeviceSummary {
  deviceId: string;
  name: string;
  platform: string;
  groupId: string;
}

export interface GroupKeyUpdate {
  groupId: string;
  sealedGroupKey: string;
  groupKeyVersion: number;
}

export interface PairingRequestEvent {
  requestId: string;
  requesterDeviceId: string;
  requesterName: string;
  requesterPlatform: string;
  requestedAtUnix: number;
  expiresAtUnix: number;
}

export interface RealtimeMessage {
  connected?: unknown;
  groupKeyUpdate?: GroupKeyUpdate;
  pairingRequest?: PairingRequestEvent;
  clipboard?: {
    item: ClipboardPayload;
    preferredLanTargets?: string[];
  };
}

export interface RealtimeStreamPort {
  onData(handler: (message: RealtimeMessage) => void): void;
  onError(handler: (error: unknown) => void): void;
  onEnd(handler: () => void): void;
  onClose(handler: () => void): void;
  cancel(): void;
}

export interface ClientTransportPort {
  registerDevice(input: {
    deviceName: string;
    platform: string;
    pubkey: string;
    groupId?: string;
    recoveryPhrase?: string;
  }): Promise<RegisterDeviceResult>;
  getDeviceContext(deviceId: string): Promise<DeviceContextResult>;
  listDevices(deviceId: string): Promise<DeviceSummary[]>;
  removeDevice(requestDeviceId: string, targetDeviceId: string): Promise<boolean>;
  recoverGroup(input: { recoveryPhrase: string; deviceName: string; platform: string; pubkey: string }): Promise<RecoverGroupResult>;
  createBindCode(deviceId: string): Promise<BindCodeResult>;
  requestBind(code: string, requesterDeviceId: string): Promise<BindRequestResult>;
  confirmBind(requestId: string, issuerDeviceId: string, approve: boolean): Promise<ConfirmBindResult>;
  getPolicy(deviceId: string): Promise<SharePolicy>;
  updatePolicy(deviceId: string, policy: SharePolicy): Promise<SharePolicy>;
  pushClipboardItem(deviceId: string, item: ClipboardPayload): Promise<boolean>;
  fetchOffline(deviceId: string, limit?: number): Promise<ClipboardPayload[]>;
  openEventStream(deviceId: string, lanAddr: string | undefined): RealtimeStreamPort;
  ackItem(deviceId: string, itemId: string): Promise<void>;
}

export interface LoggerPort {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface IncomingClipboardEvent {
  itemId: string;
  type: ClipboardPayload["type"];
  mime: string;
  sourceDeviceId: string;
  text?: string;
  savedPath?: string;
}

export interface ClientEventHandlers {
  onIncomingClipboard?(event: IncomingClipboardEvent): Promise<void> | void;
  onPairingRequest?(event: PairingRequestEvent): Promise<void> | void;
}
