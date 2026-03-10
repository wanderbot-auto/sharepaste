import { CryptoAgent } from "@sharepaste/client-core";
import { describe, expect, it } from "vitest";
import { SharePasteClient } from "../src/core/sharepaste-client.js";
import type {
  ClientTransportPort,
  ClipboardPort,
  CryptoPort,
  HistoryStorePort,
  IncomingItemStorePort,
  LoggerPort,
  PersistedStateStorePort,
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

const makeRealtimeStream = (): RealtimeStreamPort => ({
  onData() {},
  onError() {},
  onEnd() {},
  onClose() {},
  cancel() {}
});

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
});
