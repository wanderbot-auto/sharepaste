import os from "node:os";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import { CryptoAgent, HistoryStore, type ClipboardPayload, type SharePolicy } from "@sharepaste/client-core";
import { ClipboardWatcher } from "../adapters/clipboard-watcher.js";
import { ClientSession } from "./client-session.js";
import { SharePasteGrpcClient } from "./grpc-client.js";
import { IncomingItemStore } from "./incoming-item-store.js";
import type {
  ClientEventHandlers,
  ClientTransportPort,
  ClipboardPort,
  CryptoPort,
  GroupKeyUpdate,
  HistoryStorePort,
  IncomingItemStorePort,
  LoggerPort,
  PersistedStateStorePort,
  RealtimeMessage,
  RealtimeStreamPort
} from "./ports.js";
import { StateStore, type PersistedState } from "./state-store.js";

export interface SharePasteClientOptions {
  grpcAddress: string;
  statePath?: string;
  resetStaleState?: boolean;
}

export interface SharePasteClientDependencies {
  transport?: ClientTransportPort;
  stateStore?: PersistedStateStorePort;
  crypto?: CryptoPort;
  clipboard?: ClipboardPort;
  history?: HistoryStorePort;
  incomingItems?: IncomingItemStorePort;
  session?: ClientSession;
  logger?: LoggerPort;
  events?: ClientEventHandlers;
  platform?: () => string;
  wait?: (ms: number) => Promise<void>;
}

const defaultLogger: LoggerPort = {
  info(message) {
    console.log(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message, error) {
    console.error(message, error);
  }
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class SharePasteClient {
  private readonly transport: ClientTransportPort;

  private readonly stateStore: PersistedStateStorePort;

  private readonly crypto: CryptoPort;

  private readonly clipboard: ClipboardPort;

  private readonly history: HistoryStorePort;

  private readonly incomingItems: IncomingItemStorePort;

  private readonly session: ClientSession;

  private readonly logger: LoggerPort;

  private readonly events: ClientEventHandlers;

  private readonly platform: () => string;

  private readonly wait: (ms: number) => Promise<void>;

  private realtimeLoop: Promise<void> | null = null;

  private realtimeStopRequested = false;

  private realtimeStream: RealtimeStreamPort | null = null;

  private readonly resetStaleState: boolean;

  constructor(options: SharePasteClientOptions, dependencies: SharePasteClientDependencies = {}) {
    this.transport = dependencies.transport ?? new SharePasteGrpcClient(options.grpcAddress);
    this.stateStore = dependencies.stateStore ?? new StateStore(options.statePath);
    this.crypto = dependencies.crypto ?? new CryptoAgent();
    this.clipboard = dependencies.clipboard ?? new ClipboardWatcher();
    this.history = dependencies.history ?? new HistoryStore(50);
    this.incomingItems = dependencies.incomingItems ?? new IncomingItemStore();
    this.session = dependencies.session ?? new ClientSession();
    this.logger = dependencies.logger ?? defaultLogger;
    this.events = dependencies.events ?? {};
    this.platform = dependencies.platform ?? (() => os.platform());
    this.wait = dependencies.wait ?? sleep;
    this.resetStaleState = options.resetStaleState ?? false;
  }

  async bootstrap(deviceName: string): Promise<PersistedState> {
    const existing = await this.stateStore.load();
    if (existing) {
      try {
        const refreshed = await this.refreshPersistedState(existing);
        return this.session.attach(refreshed);
      } catch (error) {
        if (!this.shouldResetStaleState(error)) {
          throw error;
        }

        await this.stateStore.clear();
        this.session.clear();
      }
    }

    return this.registerFreshDevice(deviceName);
  }

  requireState(): PersistedState {
    return this.session.requireState();
  }

  async createBindCode(): Promise<{ code: string; expiresAtUnix: string; attemptsLeft: number }> {
    const state = this.session.requireState();
    return this.transport.createBindCode(state.deviceId);
  }

  async requestBind(code: string): Promise<{ requestId: string; expiresAtUnix: string }> {
    const state = this.session.requireState();
    return this.transport.requestBind(code, state.deviceId);
  }

  async confirmBind(requestId: string, approve: boolean): Promise<{ approved: boolean; groupId: string }> {
    const state = this.session.requireState();
    const result = await this.transport.confirmBind(requestId, state.deviceId, approve);
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
    const state = this.session.requireState();
    return this.transport.listDevices(state.deviceId);
  }

  async removeDevice(targetDeviceId: string): Promise<boolean> {
    const state = this.session.requireState();
    return this.transport.removeDevice(state.deviceId, targetDeviceId);
  }

  async recoverGroup(recoveryPhrase: string, deviceName: string): Promise<PersistedState> {
    const identity = this.crypto.createIdentity();
    this.session.attach({
      deviceId: "",
      groupId: "",
      deviceName,
      platform: this.platform(),
      recoveryPhrase,
      sealedGroupKey: "",
      identity
    });

    const registration = await this.transport.recoverGroup({
      recoveryPhrase,
      deviceName,
      platform: this.platform(),
      pubkey: identity.wrapPublicKey
    });

    const state = await this.buildRegisteredState({
      deviceName,
      recoveryPhrase,
      identity,
      registration
    });

    await this.stateStore.save(state);
    return this.session.attach(state);
  }

  async getPolicy(): Promise<SharePolicy> {
    const state = this.session.requireState();
    return this.transport.getPolicy(state.deviceId);
  }

  async updatePolicy(patch: {
    allowText: boolean;
    allowImage: boolean;
    allowFile: boolean;
    maxFileSizeBytes: number;
  }): Promise<void> {
    const state = this.session.requireState();
    const current = await this.transport.getPolicy(state.deviceId);
    await this.transport.updatePolicy(state.deviceId, {
      ...patch,
      version: current.version
    });
  }

  async syncOffline(): Promise<void> {
    const state = this.session.requireState();
    const groupKey = this.getGroupKey();
    const items = await this.transport.fetchOffline(state.deviceId, 100);
    for (const item of items) {
      await this.applyIncoming(item, groupKey);
      await this.transport.ackItem(state.deviceId, item.itemId);
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
        return;
      }

      await this.sendFile(change.filePath, change.mime ?? "image/png", true);
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

  async sendText(text: string, cachedPolicy?: SharePolicy): Promise<boolean> {
    const state = this.session.requireState();
    const policy = cachedPolicy ?? (await this.transport.getPolicy(state.deviceId));
    const plaintext = Buffer.from(text, "utf8");
    return this.sendPayload("text", "text/plain", plaintext, state.deviceId, policy);
  }

  async sendFile(filePath: string, mime = "application/octet-stream", asImage = false): Promise<boolean> {
    const state = this.session.requireState();
    const policy = await this.transport.getPolicy(state.deviceId);
    const bytes = await fs.readFile(filePath);
    const kind = asImage ? "image" : "file";
    return this.sendPayload(kind, mime, bytes, state.deviceId, policy);
  }

  private async registerFreshDevice(deviceName: string): Promise<PersistedState> {
    const identity = this.crypto.createIdentity();
    this.session.attach({
      deviceId: "",
      groupId: "",
      deviceName,
      platform: this.platform(),
      recoveryPhrase: "",
      sealedGroupKey: "",
      identity
    });

    const registration = await this.transport.registerDevice({
      deviceName,
      platform: this.platform(),
      pubkey: identity.wrapPublicKey
    });

    const state = await this.buildRegisteredState({
      deviceName,
      recoveryPhrase: registration.recoveryPhrase,
      identity,
      registration
    });

    await this.stateStore.save(state);
    return this.session.attach(state);
  }

  private async buildRegisteredState(input: {
    deviceName: string;
    recoveryPhrase: string;
    identity: PersistedState["identity"];
    registration: { device: { deviceId: string; groupId: string }; groupId: string; sealedGroupKey: string };
  }): Promise<PersistedState> {
    const groupKey = this.extractGroupKey(input.registration.sealedGroupKey);
    return {
      deviceId: input.registration.device.deviceId,
      groupId: input.registration.groupId,
      deviceName: input.deviceName,
      platform: this.platform(),
      recoveryPhrase: input.recoveryPhrase,
      sealedGroupKey: input.registration.sealedGroupKey,
      identity: input.identity,
      groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
      groupKeyVersion: 1
    };
  }

  private async applyIncoming(item: ClipboardPayload, groupKey: Uint8Array): Promise<void> {
    const decision = this.session.requireSyncEngine().shouldApplyIncoming(item);
    if (!decision.accepted) {
      return;
    }

    this.history.push(item);

    const plaintext = this.crypto.decryptClipboard(groupKey, {
      ciphertext: item.ciphertext,
      nonce: item.nonce
    });

    if (item.type === "text") {
      const text = Buffer.from(plaintext).toString("utf8");
      await this.clipboard.writeText(text);
      await this.events.onIncomingClipboard?.({
        itemId: item.itemId,
        type: item.type,
        mime: item.mime,
        sourceDeviceId: item.sourceDeviceId,
        text
      });
      return;
    }

    const savedPath = await this.incomingItems.materialize(item, plaintext);
    this.logger.info(`saved ${item.type} payload to ${savedPath}`);
    await this.events.onIncomingClipboard?.({
      itemId: item.itemId,
      type: item.type,
      mime: item.mime,
      sourceDeviceId: item.sourceDeviceId,
      savedPath
    });
  }

  private async sendPayload(
    kind: ClipboardPayload["type"],
    mime: string,
    plaintext: Uint8Array,
    deviceId: string,
    policy: SharePolicy
  ): Promise<boolean> {
    const groupKey = this.getGroupKey();
    const createdAtUnix = Math.floor(Date.now() / 1000);
    const itemId = this.session.requireSyncEngine().makeItemId(plaintext, createdAtUnix);
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

    const decision = this.session.requireSyncEngine().shouldSend(payload, policy);
    if (!decision.accepted) {
      return false;
    }

    const accepted = await this.transport.pushClipboardItem(deviceId, payload);
    if (accepted) {
      this.history.push(payload);
    }
    return accepted;
  }

  private getGroupKey(): Uint8Array {
    const state = this.session.requireState();
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
        const identity = this.session.current()?.identity;
        if (!identity) {
          throw new Error("CLIENT_NOT_BOOTSTRAPPED");
        }
        return this.crypto.unsealGroupKeyForDevice(sealedGroupKey, identity.wrapPrivateKey);
      }
      if (parsed.groupKeyBase64) {
        return Buffer.from(parsed.groupKeyBase64, "base64url");
      }
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "INVALID_SEALED_GROUP_KEY");
    }
    throw new Error("INVALID_SEALED_GROUP_KEY");
  }

  private async runRealtimeLoop(deviceId: string): Promise<void> {
    while (!this.realtimeStopRequested) {
      await this.connectOnce(deviceId);
      if (!this.realtimeStopRequested) {
        await this.wait(2000);
      }
    }
  }

  private async connectOnce(deviceId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const stream = this.transport.openEventStream(deviceId, undefined);
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

      stream.onData((message) => {
        void this.handleRealtimeMessage(deviceId, message).catch((error: unknown) => {
          this.logger.error("realtime stream processing failed", error);
          cleanup();
        });
      });

      stream.onError(() => {
        cleanup();
      });

      stream.onEnd(() => {
        cleanup();
      });

      stream.onClose(() => {
        cleanup();
      });
    });
  }

  private async handleRealtimeMessage(deviceId: string, message: RealtimeMessage): Promise<void> {
    if (message.groupKeyUpdate) {
      await this.applyGroupKeyUpdate(message.groupKeyUpdate);
    }

    if (message.clipboard?.item) {
      const item = message.clipboard.item;
      await this.applyIncoming(item, this.getGroupKey());
      await this.transport.ackItem(deviceId, item.itemId);
    }

    if (message.pairingRequest) {
      await this.events.onPairingRequest?.(message.pairingRequest);
      this.logger.info(
        `pair request from ${message.pairingRequest.requesterName} (${message.pairingRequest.requesterPlatform}), request_id=${message.pairingRequest.requestId}`
      );
    }
  }

  private async refreshCurrentStateFromServer(): Promise<PersistedState> {
    const current = this.session.requireState();
    const refreshed = await this.refreshPersistedState(current);
    return this.session.attach(refreshed);
  }

  private async refreshPersistedState(existing: PersistedState): Promise<PersistedState> {
    try {
      this.session.attach(existing);
      const context = await this.transport.getDeviceContext(existing.deviceId);
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

  private shouldResetStaleState(error: unknown): boolean {
    if (!this.resetStaleState) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    return message === "STALE_DEVICE_STATE";
  }

  private async applyGroupKeyUpdate(update: GroupKeyUpdate, baseState?: PersistedState): Promise<PersistedState> {
    const current = baseState ?? this.session.requireState();
    this.session.attach(current);
    const groupKey = this.extractGroupKey(update.sealedGroupKey);
    const next: PersistedState = {
      ...current,
      groupId: update.groupId,
      sealedGroupKey: update.sealedGroupKey,
      groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
      groupKeyVersion: update.groupKeyVersion
    };
    await this.stateStore.save(next);
    return this.session.attach(next);
  }
}
