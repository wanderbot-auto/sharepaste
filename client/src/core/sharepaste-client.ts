import os from "node:os";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import { ClipboardWatcher } from "../adapters/clipboard-watcher.js";
import type { ClipboardPayload } from "../types.js";
import { CryptoAgent } from "./crypto-agent.js";
import { SharePasteGrpcClient } from "./grpc-client.js";
import { HistoryStore } from "./history-store.js";
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

  private state: PersistedState | null = null;

  private syncEngine: SyncEngine | null = null;

  constructor(options: SharePasteClientOptions) {
    this.grpc = new SharePasteGrpcClient(options.grpcAddress);
    this.stateStore = new StateStore(options.statePath);
  }

  async bootstrap(deviceName: string): Promise<PersistedState> {
    const existing = await this.stateStore.load();
    if (existing) {
      this.state = existing;
      this.syncEngine = new SyncEngine(existing.deviceId);
      return existing;
    }

    const identity = this.crypto.createIdentity();
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
      groupKeyBase64: Buffer.from(groupKey).toString("base64url")
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
    return this.grpc.confirmBind(requestId, state.deviceId, approve);
  }

  async listDevices(): Promise<Array<{ deviceId: string; name: string; platform: string; groupId: string }>> {
    const state = this.requireState();
    return this.grpc.listDevices(state.deviceId);
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
    const state = this.requireState();
    const policy = await this.grpc.getPolicy(state.deviceId).catch(() => defaultPolicy());
    const groupKey = this.getGroupKey();

    const stream = this.grpc.openEventStream(state.deviceId, undefined);
    stream.on("data", async (message: any) => {
      if (message.clipboard?.item) {
        const item = this.fromServerClipboard(message.clipboard.item);
        await this.applyIncoming(item, groupKey);
        await this.grpc.ackItem(state.deviceId, item.itemId);
      }

      if (message.pairingRequest) {
        console.log(
          `pair request from ${message.pairingRequest.requesterName} (${message.pairingRequest.requesterPlatform}), request_id=${message.pairingRequest.requestId}`
        );
      }
    });

    await this.syncOffline();

    await this.clipboard.start(async (change) => {
      if (change.kind === "text") {
        await this.sendText(change.value, policy);
      }
    });
  }

  async stopRealtime(): Promise<void> {
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

    if (item.type === "text") {
      const plaintext = this.crypto.decryptClipboard(groupKey, {
        ciphertext: item.ciphertext,
        nonce: item.nonce
      });
      await this.clipboard.writeText(Buffer.from(plaintext).toString("utf8"));
    }
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
    this.history.push(payload);
    await this.grpc.pushClipboardItem(deviceId, payload);
    return true;
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
      const parsed = JSON.parse(Buffer.from(sealedGroupKey, "base64url").toString("utf8")) as { groupKeyBase64?: string };
      if (parsed.groupKeyBase64) {
        return Buffer.from(parsed.groupKeyBase64, "base64url");
      }
    } catch {
      // fallback below
    }
    return this.crypto.generateGroupKey();
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
}
