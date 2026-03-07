import type { AuditRecord, BindCode, BindRequest, ClipboardItem, Device, Policy, SharePasteSnapshot } from "../types.js";
import type { PresenceEvent, RegisterDeviceInput, RegisterDeviceResult } from "./sharepaste-store.js";

export interface SharePasteStatePersistence {
  loadSnapshot(): Promise<SharePasteSnapshot | null>;
  saveSnapshot(snapshot: SharePasteSnapshot): Promise<void>;
  writeAudit(record: AuditRecord): Promise<void>;
  close(): Promise<void>;
}

export interface SharePasteRuntimeSignals {
  touchPresence(deviceId: string, lanAddr?: string): Promise<void>;
  clearPresence(deviceId: string): Promise<void>;
  consumeRateLimit(deviceId: string, action: string, maxPerMinute: number): Promise<boolean>;
  close(): Promise<void>;
}

export interface SharePasteStoreApi {
  registerDevice(input: RegisterDeviceInput): Promise<RegisterDeviceResult> | RegisterDeviceResult;
  recoverGroup(input: Omit<RegisterDeviceInput, "groupId"> & { recoveryPhrase: string }): Promise<RegisterDeviceResult> | RegisterDeviceResult;
  listDevices(deviceId: string): Promise<Device[]> | Device[];
  renameDevice(deviceId: string, newName: string): Promise<Device> | Device;
  removeDevice(requestDeviceId: string, targetDeviceId: string): Promise<boolean> | boolean;
  createBindCode(deviceId: string): Promise<BindCode> | BindCode;
  requestBind(code: string, requesterDeviceId: string): Promise<BindRequest> | BindRequest;
  confirmBind(requestId: string, issuerDeviceId: string, approve: boolean): Promise<BindRequest> | BindRequest;
  getPolicy(deviceId: string): Promise<Policy> | Policy;
  updatePolicy(
    deviceId: string,
    expectedVersion: number,
    patch: Pick<Policy, "allowText" | "allowImage" | "allowFile" | "maxFileSizeBytes">
  ): Promise<Policy> | Policy;
  pushClipboardItem(deviceId: string, item: ClipboardItem): Promise<{ accepted: boolean; lanTargets: string[] }> | { accepted: boolean; lanTargets: string[] };
  ackItem(deviceId: string, itemId: string): Promise<boolean> | boolean;
  fetchOffline(deviceId: string, limit?: number): Promise<ClipboardItem[]> | ClipboardItem[];
  openPresence(deviceId: string, lanAddr: string | undefined, onEvent: (event: PresenceEvent) => void): Promise<void> | void;
  closePresence(deviceId: string): Promise<void> | void;
}
