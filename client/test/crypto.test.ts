import { describe, expect, it } from "vitest";
import { CryptoAgent } from "../src/core/crypto-agent.js";

describe("CryptoAgent", () => {
  it("encrypts and decrypts payload with group key", () => {
    const crypto = new CryptoAgent();
    const key = crypto.generateGroupKey();
    const plaintext = Buffer.from("hello", "utf8");

    const encrypted = crypto.encryptClipboard(key, plaintext);
    const decrypted = crypto.decryptClipboard(key, encrypted);

    expect(Buffer.from(decrypted).toString("utf8")).toBe("hello");
  });

  it("seals and unseals group key for target device", () => {
    const crypto = new CryptoAgent();
    const identity = crypto.createIdentity();
    const key = crypto.generateGroupKey();

    const sealed = crypto.sealGroupKeyForDevice(key, identity.wrapPublicKey);
    const unsealed = crypto.unsealGroupKeyForDevice(sealed, identity.wrapPrivateKey);

    expect(Buffer.from(unsealed).toString("hex")).toBe(Buffer.from(key).toString("hex"));
  });
});
