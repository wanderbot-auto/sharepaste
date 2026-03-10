import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePasteClient } from "../src/core/sharepaste-client.js";
import { CryptoAgent } from "../src/core/crypto-agent.js";
import { SharePasteGrpcClient } from "../src/core/grpc-client.js";
import { StateStore, type PersistedState } from "../src/core/state-store.js";

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

describe("SharePasteClient bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-registers when stale state reset is enabled", async () => {
    const crypto = new CryptoAgent();
    const identity = crypto.createIdentity();
    const groupKey = crypto.generateGroupKey();
    const sealedGroupKey = crypto.sealGroupKeyForDevice(groupKey, identity.wrapPublicKey);

    const load = vi.spyOn(StateStore.prototype, "load").mockResolvedValue(makePersistedState());
    const clear = vi.spyOn(StateStore.prototype, "clear").mockResolvedValue();
    const save = vi.spyOn(StateStore.prototype, "save").mockResolvedValue();
    const getDeviceContext = vi.spyOn(SharePasteGrpcClient.prototype, "getDeviceContext").mockRejectedValue(new Error("device not found"));
    const registerDevice = vi.spyOn(SharePasteGrpcClient.prototype, "registerDevice").mockResolvedValue({
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
    });
    vi.spyOn(CryptoAgent.prototype, "createIdentity").mockReturnValue(identity);

    const client = new SharePasteClient({
      grpcAddress: "127.0.0.1:50052",
      statePath: "/tmp/sharepaste-bootstrap-reset.json",
      resetStaleState: true
    });

    const state = await client.bootstrap("my-mac");

    expect(load).toHaveBeenCalledOnce();
    expect(getDeviceContext).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(registerDevice).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(state.deviceId).toBe("dev_new");
    expect(state.groupId).toBe("grp_new");
    expect(state.recoveryPhrase).toBe("new-recovery");
  });

  it("preserves stale state failure by default", async () => {
    vi.spyOn(StateStore.prototype, "load").mockResolvedValue(makePersistedState());
    const clear = vi.spyOn(StateStore.prototype, "clear").mockResolvedValue();
    vi.spyOn(SharePasteGrpcClient.prototype, "getDeviceContext").mockRejectedValue(new Error("device not found"));
    const registerDevice = vi.spyOn(SharePasteGrpcClient.prototype, "registerDevice");

    const client = new SharePasteClient({
      grpcAddress: "127.0.0.1:50052",
      statePath: "/tmp/sharepaste-bootstrap-reset.json"
    });

    await expect(client.bootstrap("my-mac")).rejects.toThrowError("STALE_DEVICE_STATE");
    expect(clear).not.toHaveBeenCalled();
    expect(registerDevice).not.toHaveBeenCalled();
  });
});
