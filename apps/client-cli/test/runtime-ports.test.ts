import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CryptoAgent } from "@sharepaste/client-core";
import { describe, expect, it, vi } from "vitest";
import { SharePasteClient } from "../src/core/sharepaste-client.js";
import type {
  ClientTransportPort,
  ClipboardChange,
  ClipboardPort,
  CryptoPort,
  HistoryStorePort,
  IncomingItemStorePort,
  LoggerPort,
  PersistedStateStorePort,
  RealtimeMessage,
  RealtimeStreamPort
} from "../src/core/ports.js";
import type { PersistedState } from "../src/core/state-store.js";

const makePersistedState = (): PersistedState => ({
  deviceId: "dev_existing",
  groupId: "grp_existing",
  deviceName: "my-mac",
  platform: "darwin",
  recoveryPhrase: "recovery-phrase",
  sealedGroupKey: "sealed",
  identity: {
    signPublicKey: "sign-public",
    signPrivateKey: "sign-private",
    wrapPublicKey: "wrap-public",
    wrapPrivateKey: "wrap-private"
  },
  groupKeyBase64: "group-key-base64",
  groupKeyVersion: 1
});

const makePlainSealedGroupKey = (groupKey: Uint8Array): string =>
  Buffer.from(
    JSON.stringify({
      groupKeyBase64: Buffer.from(groupKey).toString("base64url")
    }),
    "utf8"
  ).toString("base64url");

const makeRealtimeStream = (): RealtimeStreamPort => ({
  onData() {},
  onError() {},
  onEnd() {},
  onClose() {},
  cancel() {}
});

const makeControllableRealtimeStream = () => {
  let dataHandler: ((message: RealtimeMessage) => void) | undefined;
  let closeHandler: (() => void) | undefined;
  let endHandler: (() => void) | undefined;
  let errorHandler: ((error: unknown) => void) | undefined;

  const stream: RealtimeStreamPort = {
    onData(handler) {
      dataHandler = handler;
    },
    onError(handler) {
      errorHandler = handler;
    },
    onEnd(handler) {
      endHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    cancel() {
      closeHandler?.();
    }
  };

  return {
    stream,
    emit(message: RealtimeMessage) {
      dataHandler?.(message);
    },
    end() {
      endHandler?.();
    },
    error(error: unknown) {
      errorHandler?.(error);
    }
  };
};

const makeUnusedTransport = (): Omit<ClientTransportPort, "getDeviceContext" | "registerDevice"> => ({
  listDevices: async () => [],
  removeDevice: async () => false,
  recoverGroup: async () => {
    throw new Error("not implemented");
  },
  createBindCode: async () => {
    throw new Error("not implemented");
  },
  requestBind: async () => {
    throw new Error("not implemented");
  },
  confirmBind: async () => {
    throw new Error("not implemented");
  },
  getPolicy: async () => {
    throw new Error("not implemented");
  },
  updatePolicy: async () => {
    throw new Error("not implemented");
  },
  pushClipboardItem: async () => {
    throw new Error("not implemented");
  },
  fetchOffline: async () => [],
  openEventStream: () => makeRealtimeStream(),
  ackItem: async () => {}
});

const silentClipboard: ClipboardPort = {
  async start() {},
  stop() {},
  async writeText() {}
};

const silentHistory: HistoryStorePort = {
  push() {}
};

const silentIncomingStore: IncomingItemStorePort = {
  async materialize() {
    return "/tmp/unused";
  }
};

const silentLogger: LoggerPort = {
  info() {},
  warn() {},
  error() {}
};

describe("SharePasteClient runtime ports", () => {
  it("can recover from stale state using injected ports", async () => {
    const crypto = new CryptoAgent();
    const identity = crypto.createIdentity();
    const groupKey = crypto.generateGroupKey();
    const sealedGroupKey = crypto.sealGroupKeyForDevice(groupKey, identity.wrapPublicKey);
    const cryptoPort: CryptoPort = {
      createIdentity: () => identity,
      generateGroupKey: () => crypto.generateGroupKey(),
      encryptClipboard: (key, plaintext) => crypto.encryptClipboard(key, plaintext),
      decryptClipboard: (key, envelope) => crypto.decryptClipboard(key, envelope),
      sealGroupKeyForDevice: (key, publicKey) => crypto.sealGroupKeyForDevice(key, publicKey),
      unsealGroupKeyForDevice: (sealed, privateKey) => crypto.unsealGroupKeyForDevice(sealed, privateKey)
    };

    const saves: PersistedState[] = [];
    let cleared = 0;

    const stateStore: PersistedStateStorePort = {
      async load() {
        return makePersistedState();
      },
      async save(state) {
        saves.push(state);
      },
      async clear() {
        cleared += 1;
      }
    };

    const transport: ClientTransportPort = {
      ...makeUnusedTransport(),
      getDeviceContext: async () => {
        throw new Error("device not found");
      },
      registerDevice: async () => ({
        device: {
          deviceId: "dev_new",
          groupId: "grp_new",
          pubkey: identity.wrapPublicKey,
          name: "my-mac",
          platform: "darwin"
        },
        groupId: "grp_new",
        recoveryPhrase: "new-recovery",
        sealedGroupKey
      })
    };

    const client = new SharePasteClient(
      {
        grpcAddress: "127.0.0.1:50052",
        resetStaleState: true
      },
      {
        transport,
        stateStore,
        crypto: cryptoPort,
        clipboard: silentClipboard,
        history: silentHistory,
        incomingItems: silentIncomingStore,
        logger: silentLogger,
        platform: () => "darwin"
      }
    );

    const state = await client.bootstrap("my-mac");

    expect(cleared).toBe(1);
    expect(saves).toHaveLength(1);
    expect(state.deviceId).toBe("dev_new");
    expect(state.groupId).toBe("grp_new");
    expect(state.recoveryPhrase).toBe("new-recovery");
  });

  it("routes image clipboard changes through the runtime send path", async () => {
    const crypto = new CryptoAgent();
    const groupKey = crypto.generateGroupKey();
    const pushedItems: Array<{ type: string; mime: string; sizeBytes: number }> = [];
    let clipboardHandler: ((change: ClipboardChange) => Promise<void> | void) | undefined;
    const realtime = makeControllableRealtimeStream();

    const tempFile = path.join(os.tmpdir(), `sharepaste-runtime-image-${randomUUID()}.png`);
    await fs.writeFile(tempFile, Buffer.from([1, 2, 3, 4]));

    const transport: ClientTransportPort = {
      ...makeUnusedTransport(),
      getDeviceContext: async () => ({
        device: {
          deviceId: "dev_existing",
          groupId: "grp_existing",
          pubkey: "wrap-public",
          name: "my-mac",
          platform: "windows"
        },
        groupId: "grp_existing",
        sealedGroupKey: makePlainSealedGroupKey(groupKey),
        groupKeyVersion: 1
      }),
      registerDevice: async () => {
        throw new Error("not implemented");
      },
      getPolicy: async () => ({
        allowText: true,
        allowImage: true,
        allowFile: true,
        maxFileSizeBytes: 1_000_000,
        version: 1
      }),
      openEventStream: () => realtime.stream,
      pushClipboardItem: async (_deviceId, item) => {
        pushedItems.push({
          type: item.type,
          mime: item.mime,
          sizeBytes: item.sizeBytes
        });
        return true;
      }
    };

    const stateStore: PersistedStateStorePort = {
      async load() {
        return {
          ...makePersistedState(),
          platform: "windows",
          groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
          sealedGroupKey: makePlainSealedGroupKey(groupKey)
        };
      },
      async save() {},
      async clear() {}
    };

    const clipboard: ClipboardPort = {
      async start(onChange) {
        clipboardHandler = onChange;
      },
      stop() {},
      async writeText() {}
    };

    const client = new SharePasteClient(
      {
        grpcAddress: "127.0.0.1:50052"
      },
      {
        transport,
        stateStore,
        clipboard,
        history: silentHistory,
        incomingItems: silentIncomingStore,
        logger: silentLogger,
        platform: () => "windows"
      }
    );

    await client.bootstrap("my-windows");
    await client.startRealtime();
    await clipboardHandler?.({
      kind: "image",
      filePath: tempFile,
      mime: "image/png"
    });
    await client.stopRealtime();

    expect(pushedItems).toHaveLength(1);
    expect(pushedItems[0]).toMatchObject({
      type: "image",
      mime: "image/png",
      sizeBytes: 4
    });

    await fs.rm(tempFile, { force: true });
  });

  it("emits incoming image events for shell integration", async () => {
    const crypto = new CryptoAgent();
    const groupKey = crypto.generateGroupKey();
    const encrypted = crypto.encryptClipboard(groupKey, Buffer.from([9, 8, 7]));
    const incomingEvents = vi.fn();
    const realtime = makeControllableRealtimeStream();

    const transport: ClientTransportPort = {
      ...makeUnusedTransport(),
      getDeviceContext: async () => ({
        device: {
          deviceId: "dev_existing",
          groupId: "grp_existing",
          pubkey: "wrap-public",
          name: "my-windows",
          platform: "windows"
        },
        groupId: "grp_existing",
        sealedGroupKey: makePlainSealedGroupKey(groupKey),
        groupKeyVersion: 1
      }),
      registerDevice: async () => {
        throw new Error("not implemented");
      },
      openEventStream: () => realtime.stream,
      ackItem: async () => {},
      fetchOffline: async () => []
    };

    const stateStore: PersistedStateStorePort = {
      async load() {
        return {
          ...makePersistedState(),
          platform: "windows",
          groupKeyBase64: Buffer.from(groupKey).toString("base64url"),
          sealedGroupKey: makePlainSealedGroupKey(groupKey)
        };
      },
      async save() {},
      async clear() {}
    };

    const incomingItems: IncomingItemStorePort = {
      async materialize() {
        return "/tmp/sharepaste/incoming.png";
      }
    };

    const client = new SharePasteClient(
      {
        grpcAddress: "127.0.0.1:50052"
      },
      {
        transport,
        stateStore,
        clipboard: silentClipboard,
        history: silentHistory,
        incomingItems,
        logger: silentLogger,
        events: {
          onIncomingClipboard: incomingEvents
        },
        platform: () => "windows"
      }
    );

    await client.bootstrap("my-windows");
    await client.startRealtime();

    realtime.emit({
      clipboard: {
        item: {
          itemId: "item_img",
          type: "image",
          mime: "image/png",
          sizeBytes: 3,
          createdAtUnix: 123,
          sourceDeviceId: "peer",
          cipherRef: "inline://item_img",
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await client.stopRealtime();

    expect(incomingEvents).toHaveBeenCalledWith({
      itemId: "item_img",
      type: "image",
      mime: "image/png",
      sourceDeviceId: "peer",
      savedPath: "/tmp/sharepaste/incoming.png"
    });
  });
});
