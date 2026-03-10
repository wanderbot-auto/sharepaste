import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/core/state-store.js";

const tempPaths: string[] = [];

const makeStatePath = (name: string): string => {
  const filePath = path.join(os.tmpdir(), `sharepaste-state-store-${process.pid}-${Date.now()}-${name}.json`);
  tempPaths.push(filePath);
  return filePath;
};

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map((filePath) =>
      fs.rm(filePath, {
        force: true
      })
    )
  );
});

describe("StateStore", () => {
  it("loads persisted state when the file is valid", async () => {
    const store = new StateStore(makeStatePath("valid"));
    const state = {
      deviceId: "dev_123",
      groupId: "grp_123",
      deviceName: "Laptop",
      platform: "darwin",
      recoveryPhrase: "phrase",
      sealedGroupKey: "sealed",
      groupKeyBase64: "group-key",
      groupKeyVersion: 2,
      identity: {
        signPublicKey: "sign-pub",
        signPrivateKey: "sign-priv",
        wrapPublicKey: "wrap-pub",
        wrapPrivateKey: "wrap-priv"
      }
    };

    await store.save(state);

    await expect(store.load()).resolves.toEqual(state);
  });

  it("fails fast on malformed state files", async () => {
    const filePath = makeStatePath("invalid-json");
    await fs.writeFile(filePath, "{not-json", "utf8");

    const store = new StateStore(filePath);

    await expect(store.load()).rejects.toThrowError("STATE_FILE_INVALID");
  });

  it("fails fast on structurally invalid state files", async () => {
    const filePath = makeStatePath("invalid-shape");
    await fs.writeFile(filePath, JSON.stringify({ deviceId: "dev_123" }), "utf8");

    const store = new StateStore(filePath);

    await expect(store.load()).rejects.toThrowError("STATE_FILE_INVALID");
  });
});
