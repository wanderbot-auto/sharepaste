import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CryptoAgent } from "../src/core/crypto-agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bridgeBinary = path.resolve(
  __dirname,
  "../../../target/debug",
  process.platform === "win32" ? "sharepaste-client-runtime-bridge.exe" : "sharepaste-client-runtime-bridge"
);

const withCryptoEnv = (
  values: Partial<
    Record<"SHAREPASTE_RUST_BRIDGE_BIN" | "SHAREPASTE_RUST_CRYPTO" | "SHAREPASTE_RUST_CRYPTO_STRICT", string | undefined>
  >,
  work: () => void
): void => {
  const previous = {
    SHAREPASTE_RUST_BRIDGE_BIN: process.env.SHAREPASTE_RUST_BRIDGE_BIN,
    SHAREPASTE_RUST_CRYPTO: process.env.SHAREPASTE_RUST_CRYPTO,
    SHAREPASTE_RUST_CRYPTO_STRICT: process.env.SHAREPASTE_RUST_CRYPTO_STRICT
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
};

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

  it("uses the rust bridge in strict mode when the binary is available", () => {
    if (!existsSync(bridgeBinary)) {
      return;
    }

    withCryptoEnv(
      {
        SHAREPASTE_RUST_BRIDGE_BIN: bridgeBinary,
        SHAREPASTE_RUST_CRYPTO: "1",
        SHAREPASTE_RUST_CRYPTO_STRICT: "1"
      },
      () => {
        const crypto = new CryptoAgent();
        const identity = crypto.createIdentity();
        const key = crypto.generateGroupKey();
        const sealed = crypto.sealGroupKeyForDevice(key, identity.wrapPublicKey);
        const unsealed = crypto.unsealGroupKeyForDevice(sealed, identity.wrapPrivateKey);

        expect(Buffer.from(unsealed).toString("hex")).toBe(Buffer.from(key).toString("hex"));
      }
    );
  });

  it("falls back to node crypto when rust is disabled", () => {
    withCryptoEnv(
      {
        SHAREPASTE_RUST_BRIDGE_BIN: bridgeBinary,
        SHAREPASTE_RUST_CRYPTO: "0",
        SHAREPASTE_RUST_CRYPTO_STRICT: "1"
      },
      () => {
        const crypto = new CryptoAgent();
        const key = crypto.generateGroupKey();
        const plaintext = Buffer.from("fallback", "utf8");
        const encrypted = crypto.encryptClipboard(key, plaintext);
        const decrypted = crypto.decryptClipboard(key, encrypted);

        expect(Buffer.from(decrypted).toString("utf8")).toBe("fallback");
      }
    );
  });
});
