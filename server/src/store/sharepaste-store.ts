import type { BindCode, BindRequest, ClipboardItem, Device, GroupState, OfflineEnvelope, Policy, SharePasteSnapshot } from "../types.js";
import { DEFAULT_POLICY, isItemAllowedByPolicy } from "../utils/policy.js";
import {
  generateBindCode,
  generateGroupKeyBase64,
  generateRecoveryPhrase,
  hashRecoveryPhrase,
  makeDeviceId,
  makeGroupId,
  makeRequestId,
  nowUnix,
  sealGroupKeyForDevice
} from "../utils/ids.js";

export interface RegisterDeviceInput {
  deviceName: string;
  platform: string;
  pubkey: string;
  groupId?: string;
  recoveryPhrase?: string;
}

export interface RegisterDeviceResult {
  device: Device;
  groupId: string;
  recoveryPhrase: string;
  createdNewGroup: boolean;
  sealedGroupKey: string;
}

export interface PresenceEvent {
  type: "clipboard" | "pairing_request" | "connected";
  payload: unknown;
}

interface PresenceState {
  lanAddr?: string;
  onEvent: (event: PresenceEvent) => void;
}

const MAX_BIND_ATTEMPTS = 5;
const BIND_TTL_SECONDS = 60;
const OFFLINE_TTL_SECONDS = 24 * 3600;
const MAX_DEVICES_PER_GROUP = 10;

export class SharePasteStore {
  private readonly devices = new Map<string, Device>();

  private readonly groups = new Map<string, GroupState>();

  private readonly groupDevices = new Map<string, Set<string>>();

  private readonly bindCodes = new Map<string, BindCode>();

  private readonly bindRequests = new Map<string, BindRequest>();

  private readonly offline = new Map<string, OfflineEnvelope[]>();

  private readonly presences = new Map<string, PresenceState>();

  private readonly seenItems = new Map<string, Set<string>>();

  constructor(snapshot?: SharePasteSnapshot | null) {
    if (!snapshot) {
      return;
    }

    for (const device of snapshot.devices) {
      this.devices.set(device.deviceId, device);
    }

    for (const group of snapshot.groups) {
      this.groups.set(group.groupId, group);
    }

    for (const entry of snapshot.groupDevices) {
      this.groupDevices.set(entry.groupId, new Set(entry.deviceIds));
    }

    for (const code of snapshot.bindCodes) {
      this.bindCodes.set(code.code, code);
    }

    for (const request of snapshot.bindRequests) {
      this.bindRequests.set(request.requestId, request);
    }

    for (const queue of snapshot.offline) {
      this.offline.set(queue.deviceId, queue.queue);
    }

    for (const seen of snapshot.seenItems) {
      this.seenItems.set(seen.groupId, new Set(seen.itemIds));
    }
  }

  static fromSnapshot(snapshot: SharePasteSnapshot | null): SharePasteStore {
    return new SharePasteStore(snapshot);
  }

  exportSnapshot(): SharePasteSnapshot {
    this.cleanupExpired();

    return {
      devices: [...this.devices.values()].map((device) => ({ ...device })),
      groups: [...this.groups.values()].map((group) => ({
        ...group,
        policy: { ...group.policy }
      })),
      groupDevices: [...this.groupDevices.entries()].map(([groupId, deviceIds]) => ({
        groupId,
        deviceIds: [...deviceIds.values()]
      })),
      bindCodes: [...this.bindCodes.values()].map((code) => ({ ...code })),
      bindRequests: [...this.bindRequests.values()].map((request) => ({ ...request })),
      offline: [...this.offline.entries()].map(([deviceId, queue]) => ({
        deviceId,
        queue: queue.map((entry) => ({
          targetDeviceId: entry.targetDeviceId,
          expiresAtUnix: entry.expiresAtUnix,
          item: {
            ...entry.item,
            ciphertext: new Uint8Array(entry.item.ciphertext),
            nonce: new Uint8Array(entry.item.nonce)
          }
        }))
      })),
      seenItems: [...this.seenItems.entries()].map(([groupId, itemIds]) => ({
        groupId,
        itemIds: [...itemIds.values()]
      }))
    };
  }

  registerDevice(input: RegisterDeviceInput): RegisterDeviceResult {
    this.cleanupExpired();

    const wantsExistingGroup = Boolean(input.groupId && input.recoveryPhrase);
    let createdNewGroup = false;
    let groupId = input.groupId;
    let recoveryPhrase = input.recoveryPhrase ?? "";

    if (wantsExistingGroup) {
      const group = this.groups.get(input.groupId!);
      if (!group) {
        throw new Error("GROUP_NOT_FOUND");
      }
      if (group.recoveryPhraseHash !== hashRecoveryPhrase(input.recoveryPhrase!)) {
        throw new Error("RECOVERY_PHRASE_INVALID");
      }
      this.assertGroupCapacity(group.groupId);
      groupId = group.groupId;
    } else {
      groupId = makeGroupId();
      recoveryPhrase = generateRecoveryPhrase();
      const now = nowUnix();
      this.groups.set(groupId, {
        groupId,
        recoveryPhraseHash: hashRecoveryPhrase(recoveryPhrase),
        groupKeyVersion: 1,
        groupKeyBase64: generateGroupKeyBase64(),
        policy: DEFAULT_POLICY("system")
      });
      this.groupDevices.set(groupId, new Set());
      this.seenItems.set(groupId, new Set());
      createdNewGroup = true;
    }

    const device: Device = {
      deviceId: makeDeviceId(),
      groupId,
      pubkey: input.pubkey,
      name: input.deviceName,
      platform: input.platform,
      lastSeenUnix: nowUnix(),
      active: true
    };

    this.devices.set(device.deviceId, device);
    this.groupDevices.get(groupId)!.add(device.deviceId);

    const group = this.groups.get(groupId)!;
    const sealedGroupKey = sealGroupKeyForDevice(groupId, input.pubkey, group.groupKeyVersion, group.groupKeyBase64);

    return {
      device,
      groupId,
      recoveryPhrase,
      createdNewGroup,
      sealedGroupKey
    };
  }

  recoverGroup(input: Omit<RegisterDeviceInput, "groupId"> & { recoveryPhrase: string }): RegisterDeviceResult {
    this.cleanupExpired();
    const phraseHash = hashRecoveryPhrase(input.recoveryPhrase);
    const group = [...this.groups.values()].find((candidate) => candidate.recoveryPhraseHash === phraseHash);
    if (!group) {
      throw new Error("RECOVERY_PHRASE_INVALID");
    }
    this.assertGroupCapacity(group.groupId);

    return this.registerDevice({
      deviceName: input.deviceName,
      platform: input.platform,
      pubkey: input.pubkey,
      groupId: group.groupId,
      recoveryPhrase: input.recoveryPhrase
    });
  }

  listDevices(deviceId: string): Device[] {
    this.cleanupExpired();
    const requester = this.requireDevice(deviceId);
    return [...this.groupDevices.get(requester.groupId)!].map((id) => this.devices.get(id)!).filter((d) => d.active);
  }

  renameDevice(deviceId: string, newName: string): Device {
    const device = this.requireDevice(deviceId);
    device.name = newName;
    device.lastSeenUnix = nowUnix();
    return device;
  }

  removeDevice(requestDeviceId: string, targetDeviceId: string): boolean {
    const requester = this.requireDevice(requestDeviceId);
    const target = this.requireDevice(targetDeviceId);
    if (requester.groupId !== target.groupId) {
      throw new Error("GROUP_MISMATCH");
    }

    target.active = false;
    target.lastSeenUnix = nowUnix();
    this.presences.delete(target.deviceId);
    const groupSet = this.groupDevices.get(target.groupId);
    groupSet?.delete(target.deviceId);
    return true;
  }

  createBindCode(deviceId: string): BindCode {
    const issuer = this.requireDevice(deviceId);
    this.cleanupExpired();

    let code = generateBindCode();
    while (this.bindCodes.has(code)) {
      code = generateBindCode();
    }

    const bindCode: BindCode = {
      code,
      issuerDeviceId: issuer.deviceId,
      expiresAtUnix: nowUnix() + BIND_TTL_SECONDS,
      attemptsLeft: MAX_BIND_ATTEMPTS
    };

    this.bindCodes.set(code, bindCode);
    return bindCode;
  }

  requestBind(code: string, requesterDeviceId: string): BindRequest {
    this.cleanupExpired();
    const requester = this.requireDevice(requesterDeviceId);
    const bindCode = this.bindCodes.get(code);
    if (!bindCode || bindCode.expiresAtUnix <= nowUnix()) {
      throw new Error("BIND_CODE_EXPIRED");
    }

    if (bindCode.attemptsLeft <= 0) {
      this.bindCodes.delete(code);
      throw new Error("BIND_CODE_EXHAUSTED");
    }

    bindCode.attemptsLeft -= 1;

    const issuer = this.requireDevice(bindCode.issuerDeviceId);
    if (issuer.groupId === requester.groupId) {
      throw new Error("ALREADY_BOUND");
    }

    const requestId = makeRequestId();
    const bindRequest: BindRequest = {
      requestId,
      code,
      issuerDeviceId: issuer.deviceId,
      requesterDeviceId: requester.deviceId,
      expiresAtUnix: bindCode.expiresAtUnix
    };
    this.bindRequests.set(requestId, bindRequest);

    const issuerPresence = this.presences.get(issuer.deviceId);
    if (issuerPresence) {
      issuerPresence.onEvent({
        type: "pairing_request",
        payload: {
          requestId,
          requesterDeviceId: requester.deviceId,
          requesterName: requester.name,
          requesterPlatform: requester.platform,
          requestedAtUnix: nowUnix(),
          expiresAtUnix: bindCode.expiresAtUnix
        }
      });
    }

    return bindRequest;
  }

  confirmBind(requestId: string, issuerDeviceId: string, approve: boolean): BindRequest {
    this.cleanupExpired();
    const request = this.bindRequests.get(requestId);
    if (!request || request.expiresAtUnix <= nowUnix()) {
      throw new Error("BIND_REQUEST_EXPIRED");
    }
    if (request.issuerDeviceId !== issuerDeviceId) {
      throw new Error("NOT_AUTHORIZED");
    }

    request.approved = approve;
    if (!approve) {
      this.bindRequests.delete(requestId);
      return request;
    }

    const issuer = this.requireDevice(request.issuerDeviceId);
    const requester = this.requireDevice(request.requesterDeviceId);

    this.assertGroupCapacity(issuer.groupId);

    const oldGroupId = requester.groupId;
    this.groupDevices.get(oldGroupId)?.delete(requester.deviceId);

    requester.groupId = issuer.groupId;
    requester.lastSeenUnix = nowUnix();
    this.groupDevices.get(issuer.groupId)?.add(requester.deviceId);

    const group = this.groups.get(issuer.groupId)!;
    group.groupKeyVersion += 1;
    group.groupKeyBase64 = generateGroupKeyBase64();

    request.sealedGroupKey = sealGroupKeyForDevice(
      issuer.groupId,
      requester.pubkey,
      group.groupKeyVersion,
      group.groupKeyBase64
    );
    request.groupId = issuer.groupId;

    this.bindRequests.delete(requestId);
    return request;
  }

  getPolicy(deviceId: string): Policy {
    const device = this.requireDevice(deviceId);
    return this.groups.get(device.groupId)!.policy;
  }

  updatePolicy(
    deviceId: string,
    expectedVersion: number,
    patch: Pick<Policy, "allowText" | "allowImage" | "allowFile" | "maxFileSizeBytes">
  ): Policy {
    const device = this.requireDevice(deviceId);
    const group = this.groups.get(device.groupId)!;
    const current = group.policy;

    if (current.version !== expectedVersion) {
      throw new Error("POLICY_VERSION_CONFLICT");
    }

    if (patch.maxFileSizeBytes <= 0) {
      throw new Error("INVALID_MAX_FILE_SIZE");
    }

    group.policy = {
      allowText: patch.allowText,
      allowImage: patch.allowImage,
      allowFile: patch.allowFile,
      maxFileSizeBytes: patch.maxFileSizeBytes,
      version: current.version + 1,
      updatedBy: device.deviceId,
      updatedAtUnix: nowUnix()
    };

    return group.policy;
  }

  pushClipboardItem(deviceId: string, item: ClipboardItem): { accepted: boolean; lanTargets: string[] } {
    this.cleanupExpired();
    const source = this.requireDevice(deviceId);
    const policy = this.getPolicy(deviceId);
    if (item.sourceDeviceId !== source.deviceId) {
      throw new Error("SOURCE_DEVICE_MISMATCH");
    }

    if (!isItemAllowedByPolicy(policy, item.type, item.sizeBytes)) {
      throw new Error("POLICY_REJECTED");
    }

    const seen = this.seenItems.get(source.groupId)!;
    if (seen.has(item.itemId)) {
      return { accepted: true, lanTargets: [] };
    }
    seen.add(item.itemId);
    if (seen.size > 1000) {
      // Keep a bounded set to avoid unbounded growth in memory.
      const [first] = seen;
      if (first) {
        seen.delete(first);
      }
    }

    const targets = [...this.groupDevices.get(source.groupId)!].filter((id) => id !== source.deviceId);
    const lanTargets: string[] = [];

    for (const targetId of targets) {
      const presence = this.presences.get(targetId);
      if (presence) {
        if (presence.lanAddr) {
          lanTargets.push(presence.lanAddr);
        }
        presence.onEvent({ type: "clipboard", payload: item });
      } else {
        this.enqueueOffline(targetId, item);
      }
    }

    return { accepted: true, lanTargets };
  }

  ackItem(deviceId: string, itemId: string): boolean {
    this.requireDevice(deviceId);
    const queue = this.offline.get(deviceId) ?? [];
    this.offline.set(
      deviceId,
      queue.filter((entry) => entry.item.itemId !== itemId)
    );
    return true;
  }

  fetchOffline(deviceId: string, limit = 100): ClipboardItem[] {
    this.cleanupExpired();
    this.requireDevice(deviceId);
    const queue = this.offline.get(deviceId) ?? [];
    return queue
      .sort((a, b) => a.item.createdAtUnix - b.item.createdAtUnix)
      .slice(0, limit)
      .map((envelope) => envelope.item);
  }

  openPresence(deviceId: string, lanAddr: string | undefined, onEvent: PresenceState["onEvent"]): void {
    const device = this.requireDevice(deviceId);
    device.lastSeenUnix = nowUnix();

    this.presences.set(deviceId, {
      lanAddr,
      onEvent
    });

    onEvent({ type: "connected", payload: { nowUnix: nowUnix() } });
  }

  closePresence(deviceId: string): void {
    this.presences.delete(deviceId);
  }

  private enqueueOffline(targetDeviceId: string, item: ClipboardItem): void {
    const queue = this.offline.get(targetDeviceId) ?? [];
    queue.push({
      targetDeviceId,
      item,
      expiresAtUnix: nowUnix() + OFFLINE_TTL_SECONDS
    });
    this.offline.set(targetDeviceId, queue);
  }

  private cleanupExpired(): void {
    const now = nowUnix();
    for (const [code, bindCode] of this.bindCodes.entries()) {
      if (bindCode.expiresAtUnix <= now || bindCode.attemptsLeft <= 0) {
        this.bindCodes.delete(code);
      }
    }

    for (const [requestId, request] of this.bindRequests.entries()) {
      if (request.expiresAtUnix <= now) {
        this.bindRequests.delete(requestId);
      }
    }

    for (const [deviceId, queue] of this.offline.entries()) {
      this.offline.set(
        deviceId,
        queue.filter((entry) => entry.expiresAtUnix > now)
      );
    }
  }

  private requireDevice(deviceId: string): Device {
    const device = this.devices.get(deviceId);
    if (!device || !device.active) {
      throw new Error("DEVICE_NOT_FOUND");
    }
    return device;
  }

  private assertGroupCapacity(groupId: string): void {
    const count = this.groupDevices.get(groupId)?.size ?? 0;
    if (count >= MAX_DEVICES_PER_GROUP) {
      throw new Error("GROUP_DEVICE_LIMIT_REACHED");
    }
  }
}
