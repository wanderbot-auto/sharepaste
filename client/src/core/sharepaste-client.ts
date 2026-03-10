import os from "node:os";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import type { ClientDuplexStream } from "@grpc/grpc-js";
import { ClipboardWatcher } from "../adapters/clipboard-watcher.js";
import type { ClipboardPayload } from "../types.js";
import { CryptoAgent } from "./crypto-agent.js";
import { SharePasteGrpcClient } from "./grpc-client.js";
import { HistoryStore } from "./history-store.js";
import { IncomingItemStore } from "./incoming-item-store.js";
import { defaultPolicy } from "./policy-engine.js";
import { StateStore, type PersistedState } from "./state-store.js";
import { SyncEngine } from "./sync-engine.js";

export interface SharePasteClientOptions {
  grpcAddress: string;
  statePath?: string;
}

export class SharePasteClient {
  private readonly grpc: SharePasteGrpcClient;

  private readonly stateStore: StateStore;

  private readonly crypto = new CryptoAgent();

  private readonly clipboard = new ClipboardWatcher();

  private readonly history = new HistoryStore(50);

  private readonly incomingItems = new IncomingItemStore();

  private state: PersistedState | null = null;

  private syncEngine: SyncEngine | null = null;

  private realtimeLoop: Promise<void> | null = null;

  private realtimeStopRequested = false;

  private realtimeStream: ClientDuplexStream<any, any> | null = null;

  constructor(options: SharePasteClientOptions) {
    this.grpc = new SharePasteGrpcClient(options.grpcAddress);
    this.stateStore = new StateStore(options.statePath);
  }

  async bootstrap(deviceName: string): Promise<PersistedState> {
    const existing = await this.stateStore.load();
    if (existing) {
      const refreshed = await this.refreshPersistedState(existing);
      this.state = refreshed;
      this.syncEngine = new SyncEngine(refreshed.deviceId);
      return refreshed;
    }

    const identity = this.crypto.createIdentity();
    const stateSeed: PersistedState = {
      deviceId: "",
      groupId: "",
      deviceName,
      platform: os.platform(),
      recoveryPhrase: "",
      sealedGroupKey: "",
      identity
    };

    this.state = stateSeed;
    const registration = await this.grpc.registerDevice({
      deviceName,
      platform: os.platform(),
      pubkey: identity.wrapPublicKey
    });

    const groupKey = this.extractGroupKey(registration.sealedGroupKey);
    const state: PersistedState = {
      deviceId: registration.device.deviceId,
      groupId: registration.groupId,
      deviceName,
      platform: os.platform(),
      recoveryPhrase: registration.recoveryPhrase,
      sealedGroupKey: registration.sealedGroupKey,
      identity,
      groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
      groupKeyVersion: 1
    };

    await this.stateStore.save(state);
    this.state = state;
    this.syncEngine = new SyncEngine(state.deviceId);
    return state;
  }

  requireState(): PersistedState {
    if (!this.state || !this.syncEngine) {
      throw new Error("CLIENT_NOT_BOOTSTRAPPED");
    }
    return this.state;
  }

  async createBindCode(): Promise<{ code: string; expiresAtUnix: string; attemptsLeft: number }> {
    const state = this.requireState();
    return this.grpc.createBindCode(state.deviceId);
  }

  async requestBind(code: string): Promise<{ requestId: string; expiresAtUnix: string }> {
    const state = this.requireState();
    return this.grpc.requestBind(code, state.deviceId);
  }

  async confirmBind(requestId: string, approve: boolean): Promise<{ approved: boolean; groupId: string }> {
    const state = this.requireState();
    const result = await this.grpc.confirmBind(requestId, state.deviceId, approve);
    if (result.approved) {
      await this.applyGroupKeyUpdate({
        groupId: result.groupId,
        sealedGroupKey: result.sealedGroupKey,
        groupKeyVersion: result.groupKeyVersion
      });
    }
    return { approved: result.approved, groupId: result.groupId };
  }

  async listDevices(): Promise<Array<{ deviceId: string; name: string; platform: string; groupId: string }>> {
    const state = this.requireState();
    return this.grpc.listDevices(state.deviceId);
  }

  async removeDevice(targetDeviceId: string): Promise<boolean> {
    const state = this.requireState();
    return this.grpc.removeDevice(state.deviceId, targetDeviceId);
  }

  async recoverGroup(recoveryPhrase: string, deviceName: string): Promise<PersistedState> {
    const identity = this.crypto.createIdentity();
    const stateSeed: PersistedState = {
      deviceId: "",
      groupId: "",
      deviceName,
      platform: os.platform(),
      recoveryPhrase,
      sealedGroupKey: "",
      identity
    };

    this.state = stateSeed;
    const registration = await this.grpc.recoverGroup({
      recoveryPhrase,
      deviceName,
      platform: os.platform(),
      pubkey: identity.wrapPublicKey
    });

    const groupKey = this.extractGroupKey(registration.sealedGroupKey);
    const state: PersistedState = {
      deviceId: registration.device.deviceId,
      groupId: registration.groupId,
      deviceName,
      platform: os.platform(),
      recoveryPhrase,
      sealedGroupKey: registration.sealedGroupKey,
      identity,
      groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
      groupKeyVersion: 1
    };

    await this.stateStore.save(state);
    this.state = state;
    this.syncEngine = new SyncEngine(state.deviceId);
    return state;
  }

  async getPolicy(): Promise<{ allowText: boolean; allowImage: boolean; allowFile: boolean; maxFileSizeBytes: number; version: number }> {
    const state = this.requireState();
    return this.grpc.getPolicy(state.deviceId);
  }

  async updatePolicy(patch: { allowText: boolean; allowImage: boolean; allowFile: boolean; maxFileSizeBytes: number }): Promise<void> {
    const state = this.requireState();
    const current = await this.grpc.getPolicy(state.deviceId);
    await this.grpc.updatePolicy(state.deviceId, {
      ...patch,
      version: current.version
    });
  }

  async syncOffline(): Promise<void> {
    const state = this.requireState();
    const groupKey = this.getGroupKey();
    const items = await this.grpc.fetchOffline(state.deviceId, 100);
    for (const item of items) {
      await this.applyIncoming(item, groupKey);
      await this.grpc.ackItem(state.deviceId, item.itemId);
    }
  }

  async startRealtime(): Promise<void> {
    if (this.realtimeLoop) {
      return;
    }

    const state = await this.refreshCurrentStateFromServer();

    await this.syncOffline();

    await this.clipboard.start(async (change) => {
      if (change.kind === "text") {
        await this.sendText(change.value);
      }
    });

    this.realtimeStopRequested = false;
    this.realtimeLoop = this.runRealtimeLoop(state.deviceId);
  }

  async stopRealtime(): Promise<void> {
    this.realtimeStopRequested = true;
    if (this.realtimeStream) {
      this.realtimeStream.cancel();
      this.realtimeStream = null;
    }
    if (this.realtimeLoop) {
      await this.realtimeLoop.catch(() => undefined);
      this.realtimeLoop = null;
    }
    this.clipboard.stop();
  }

  async sendText(text: string, cachedPolicy?: ReturnType<typeof defaultPolicy>): Promise<boolean> {
    const state = this.requireState();
    const policy = cachedPolicy ?? (await this.grpc.getPolicy(state.deviceId));
    const plaintext = Buffer.from(text, "utf8");
    return this.sendPayload("text", "text/plain", plaintext, state.deviceId, policy);
  }

  async sendFile(filePath: string, mime = "application/octet-stream", asImage = false): Promise<boolean> {
    const state = this.requireState();
    const policy = await this.grpc.getPolicy(state.deviceId);
    const bytes = await fs.readFile(filePath);
    const kind = asImage ? "image" : "file";
    return this.sendPayload(kind, mime, bytes, state.deviceId, policy);
  }

  private async applyIncoming(item: ClipboardPayload, groupKey: Uint8Array): Promise<void> {
    const decision = this.syncEngine!.shouldApplyIncoming(item);
    if (!decision.accepted) {
      return;
    }

    this.history.push(item);

    const plaintext = this.crypto.decryptClipboard(groupKey, {
      ciphertext: item.ciphertext,
      nonce: item.nonce
    });

    if (item.type === "text") {
      await this.clipboard.writeText(Buffer.from(plaintext).toString("utf8"));
      return;
    }

    const savedPath = await this.incomingItems.materialize(item, plaintext);
    console.log(`saved ${item.type} payload to ${savedPath}`);
  }

  private async sendPayload(
    kind: ClipboardPayload["type"],
    mime: string,
    plaintext: Uint8Array,
    deviceId: string,
    policy: ReturnType<typeof defaultPolicy>
  ): Promise<boolean> {
    const groupKey = this.getGroupKey();
    const createdAtUnix = Math.floor(Date.now() / 1000);
    const itemId = this.syncEngine!.makeItemId(plaintext, createdAtUnix);
    const encrypted = this.crypto.encryptClipboard(groupKey, plaintext);

    const payload: ClipboardPayload = {
      itemId,
      type: kind,
      mime,
      sizeBytes: plaintext.length,
      createdAtUnix,
      sourceDeviceId: deviceId,
      cipherRef: `inline://${itemId}`,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce
    };

    const decision = this.syncEngine!.shouldSend(payload, policy);
    if (!decision.accepted) {
      return false;
    }

    const accepted = await this.grpc.pushClipboardItem(deviceId, payload);
    if (accepted) {
      this.history.push(payload);
    }
    return accepted;
  }

  private getGroupKey(): Uint8Array {
    const state = this.requireState();
    if (!state.groupKeyBase64) {
      return this.extractGroupKey(state.sealedGroupKey);
    }
    return Buffer.from(state.groupKeyBase64, "base64url");
  }

  private extractGroupKey(sealedGroupKey: string): Uint8Array {
    try {
      const parsed = JSON.parse(Buffer.from(sealedGroupKey, "base64url").toString("utf8")) as {
        groupKeyBase64?: string;
        epk?: string;
        nonce?: string;
        ciphertext?: string;
      };
      if (parsed.epk && parsed.nonce && parsed.ciphertext) {
        if (!this.state) {
          throw new Error("CLIENT_NOT_BOOTSTRAPPED");
        }
        return this.crypto.unsealGroupKeyForDevice(sealedGroupKey, this.state.identity.wrapPrivateKey);
      }
      if (parsed.groupKeyBase64) {
        return Buffer.from(parsed.groupKeyBase64, "base64url");
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "INVALID_SEALED_GROUP_KEY");
    }
    throw new Error("INVALID_SEALED_GROUP_KEY");
  }

  private fromServerClipboard(item: any): ClipboardPayload {
    const type =
      item.type === "CLIPBOARD_ITEM_TYPE_IMAGE" ? "image" : item.type === "CLIPBOARD_ITEM_TYPE_FILE" ? "file" : "text";

    return {
      itemId: item.itemId,
      type,
      mime: item.mime,
      sizeBytes: Number(item.sizeBytes),
      createdAtUnix: Number(item.createdAtUnix),
      sourceDeviceId: item.sourceDeviceId,
      cipherRef: item.cipherRef,
      ciphertext: item.ciphertext,
      nonce: item.nonce
    };
  }

  private async runRealtimeLoop(deviceId: string): Promise<void> {
    while (!this.realtimeStopRequested) {
      await this.connectOnce(deviceId);
      if (!this.realtimeStopRequested) {
        await new Promise((resolve) => {
          setTimeout(resolve, 2000);
        });
      }
    }
  }

  private async connectOnce(deviceId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const stream = this.grpc.openEventStream(deviceId, undefined);
      this.realtimeStream = stream;
      let resolved = false;

      const cleanup = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        if (this.realtimeStream === stream) {
          this.realtimeStream = null;
        }
        resolve();
      };

      stream.on("data", (message: any) => {
        void (async () => {
          if (message.groupKeyUpdate) {
            await this.applyGroupKeyUpdate({
              groupId: message.groupKeyUpdate.groupId,
              sealedGroupKey: message.groupKeyUpdate.sealedGroupKey,
              groupKeyVersion: Number(message.groupKeyUpdate.groupKeyVersion)
            });
          }

          if (message.clipboard?.item) {
            const item = this.fromServerClipboard(message.clipboard.item);
            await this.applyIncoming(item, this.getGroupKey());
            await this.grpc.ackItem(deviceId, item.itemId);
          }

          if (message.pairingRequest) {
            console.log(
              `pair request from ${message.pairingRequest.requesterName} (${message.pairingRequest.requesterPlatform}), request_id=${message.pairingRequest.requestId}`
            );
          }
        })().catch((error: unknown) => {
          console.error("realtime stream processing failed", error);
          cleanup();
        });
      });

      stream.on("error", () => {
        cleanup();
      });

      stream.on("end", () => {
        cleanup();
      });

      stream.on("close", () => {
        cleanup();
      });
    });
  }

  private async refreshCurrentStateFromServer(): Promise<PersistedState> {
    const current = this.requireState();
    const refreshed = await this.refreshPersistedState(current);
    this.state = refreshed;
    return refreshed;
  }

  private async refreshPersistedState(existing: PersistedState): Promise<PersistedState> {
    try {
      this.state = existing;
      const context = await this.grpc.getDeviceContext(existing.deviceId);
      return this.applyGroupKeyUpdate(
        {
          groupId: context.groupId,
          sealedGroupKey: context.sealedGroupKey,
          groupKeyVersion: Number(context.groupKeyVersion)
        },
        {
          ...existing,
          deviceName: context.device.name,
          platform: context.device.platform,
          groupId: context.groupId
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (message.includes("device not found")) {
        throw new Error("STALE_DEVICE_STATE");
      }
      throw error;
    }
  }

  private async applyGroupKeyUpdate(
    update: { groupId: string; sealedGroupKey: string; groupKeyVersion: number },
    baseState?: PersistedState
  ): Promise<PersistedState> {
    const current = baseState ?? this.requireState();
    this.state = current;
    const groupKey = this.extractGroupKey(update.sealedGroupKey);
    const next: PersistedState = {
      ...current,
      groupId: update.groupId,
      sealedGroupKey: update.sealedGroupKey,
      groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
      groupKeyVersion: update.groupKeyVersion
    };
    await this.stateStore.save(next);
    this.state = next;
    return next;
  }
}
