import type { ClipboardItem, Device, Policy } from "../types.js";
import { nowUnix } from "../utils/ids.js";
import type { SharePasteStoreApi, SharePasteRuntimeSignals, SharePasteStatePersistence } from "./contracts.js";
import { SharePasteStore, type PresenceEvent, type RegisterDeviceInput, type RegisterDeviceResult } from "./sharepaste-store.js";

const CREATE_BIND_MAX_PER_MINUTE = 20;
const REQUEST_BIND_MAX_PER_MINUTE = 30;

export class DurableSharePasteStore implements SharePasteStoreApi {
  private readonly inner: SharePasteStore;

  constructor(
    private readonly persistence: SharePasteStatePersistence,
    private readonly runtimeSignals: SharePasteRuntimeSignals,
    snapshot: Awaited<ReturnType<SharePasteStatePersistence["loadSnapshot"]>>
  ) {
    this.inner = SharePasteStore.fromSnapshot(snapshot);
  }

  static async create(
    persistence: SharePasteStatePersistence,
    runtimeSignals: SharePasteRuntimeSignals
  ): Promise<DurableSharePasteStore> {
    const snapshot = await persistence.loadSnapshot();
    return new DurableSharePasteStore(persistence, runtimeSignals, snapshot);
  }

  private async persist(): Promise<void> {
    await this.persistence.saveSnapshot(this.inner.exportSnapshot());
  }

  private async auditSuccess(action: string, metadata?: Record<string, string | number | boolean | null>): Promise<void> {
    await this.persistence.writeAudit({
      action,
      result: "success",
      createdAtUnix: nowUnix(),
      metadata
    });
  }

  private async withPersist<T>(action: string, actor: () => T): Promise<T> {
    const result = actor();
    await this.persist();
    await this.auditSuccess(action);
    return result;
  }

  async registerDevice(input: RegisterDeviceInput): Promise<RegisterDeviceResult> {
    return this.withPersist("register_device", () => this.inner.registerDevice(input));
  }

  async recoverGroup(input: Omit<RegisterDeviceInput, "groupId"> & { recoveryPhrase: string }): Promise<RegisterDeviceResult> {
    return this.withPersist("recover_group", () => this.inner.recoverGroup(input));
  }

  async listDevices(deviceId: string): Promise<Device[]> {
    return this.inner.listDevices(deviceId);
  }

  async renameDevice(deviceId: string, newName: string): Promise<Device> {
    return this.withPersist("rename_device", () => this.inner.renameDevice(deviceId, newName));
  }

  async removeDevice(requestDeviceId: string, targetDeviceId: string): Promise<boolean> {
    const removed = await this.withPersist("remove_device", () => this.inner.removeDevice(requestDeviceId, targetDeviceId));
    if (removed) {
      await this.runtimeSignals.clearPresence(targetDeviceId).catch(() => undefined);
    }
    return removed;
  }

  async createBindCode(deviceId: string) {
    const allowed = await this.runtimeSignals.consumeRateLimit(deviceId, "create_bind_code", CREATE_BIND_MAX_PER_MINUTE);
    if (!allowed) {
      throw new Error("RATE_LIMITED");
    }
    return this.withPersist("create_bind_code", () => this.inner.createBindCode(deviceId));
  }

  async requestBind(code: string, requesterDeviceId: string) {
    const allowed = await this.runtimeSignals.consumeRateLimit(requesterDeviceId, "request_bind", REQUEST_BIND_MAX_PER_MINUTE);
    if (!allowed) {
      throw new Error("RATE_LIMITED");
    }
    return this.withPersist("request_bind", () => this.inner.requestBind(code, requesterDeviceId));
  }

  async confirmBind(requestId: string, issuerDeviceId: string, approve: boolean) {
    return this.withPersist("confirm_bind", () => this.inner.confirmBind(requestId, issuerDeviceId, approve));
  }

  async getPolicy(deviceId: string): Promise<Policy> {
    return this.inner.getPolicy(deviceId);
  }

  async updatePolicy(
    deviceId: string,
    expectedVersion: number,
    patch: Pick<Policy, "allowText" | "allowImage" | "allowFile" | "maxFileSizeBytes">
  ): Promise<Policy> {
    return this.withPersist("update_policy", () => this.inner.updatePolicy(deviceId, expectedVersion, patch));
  }

  async pushClipboardItem(deviceId: string, item: ClipboardItem): Promise<{ accepted: boolean; lanTargets: string[] }> {
    return this.withPersist("push_clipboard_item", () => this.inner.pushClipboardItem(deviceId, item));
  }

  async ackItem(deviceId: string, itemId: string): Promise<boolean> {
    return this.withPersist("ack_item", () => this.inner.ackItem(deviceId, itemId));
  }

  async fetchOffline(deviceId: string, limit = 100): Promise<ClipboardItem[]> {
    return this.inner.fetchOffline(deviceId, limit);
  }

  async openPresence(deviceId: string, lanAddr: string | undefined, onEvent: (event: PresenceEvent) => void): Promise<void> {
    this.inner.openPresence(deviceId, lanAddr, onEvent);
    await this.runtimeSignals.touchPresence(deviceId, lanAddr).catch(() => undefined);
    await this.persist();
  }

  async closePresence(deviceId: string): Promise<void> {
    this.inner.closePresence(deviceId);
    await this.runtimeSignals.clearPresence(deviceId).catch(() => undefined);
    await this.persist();
  }

  async close(): Promise<void> {
    await Promise.all([this.persistence.close(), this.runtimeSignals.close()]);
  }
}
