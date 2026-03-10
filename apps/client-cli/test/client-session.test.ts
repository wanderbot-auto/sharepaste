import { SyncEngine } from "@sharepaste/client-core";
import { describe, expect, it } from "vitest";
import { ClientSession } from "../src/core/client-session.js";
import type { PersistedState } from "../src/core/state-store.js";

const makeState = (deviceId: string, groupKeyVersion = 1): PersistedState => ({
  deviceId,
  groupId: "grp_123",
  deviceName: "my-device",
  platform: "darwin",
  recoveryPhrase: "phrase",
  sealedGroupKey: "sealed",
  identity: {
    signPublicKey: "sign-pub",
    signPrivateKey: "sign-priv",
    wrapPublicKey: "wrap-pub",
    wrapPrivateKey: "wrap-priv"
  },
  groupKeyBase64: "group-key",
  groupKeyVersion
});

describe("ClientSession", () => {
  it("reuses the sync engine for updates on the same device", () => {
    const createdFor: string[] = [];
    const session = new ClientSession((deviceId) => {
      createdFor.push(deviceId);
      return new SyncEngine(deviceId);
    });

    session.attach(makeState("dev_a", 1));
    session.attach(makeState("dev_a", 2));

    expect(createdFor).toEqual(["dev_a"]);
  });

  it("recreates the sync engine when the active device changes", () => {
    const createdFor: string[] = [];
    const session = new ClientSession((deviceId) => {
      createdFor.push(deviceId);
      return new SyncEngine(deviceId);
    });

    session.attach(makeState("dev_a"));
    session.attach(makeState("dev_b"));

    expect(createdFor).toEqual(["dev_a", "dev_b"]);
  });
});
