import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes
} from "node:crypto";

export interface DeviceIdentity {
  signPublicKey: string;
  signPrivateKey: string;
  wrapPublicKey: string;
  wrapPrivateKey: string;
}

export interface CipherEnvelope {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

interface BridgeIdentityResult {
  signPublicKey: string;
  signPrivateKey: string;
  wrapPublicKey: string;
  wrapPrivateKey: string;
}

interface BridgeEnvelopeResult {
  nonce: string;
  ciphertext: string;
}

interface BridgeBytesResult {
  bytes: string;
}

interface BridgeSealedResult {
  sealed: string;
}

interface BridgeSuccess<T> {
  ok: true;
  result: T;
}

interface BridgeFailure {
  ok: false;
  error: string;
}

type BridgeResponse<T> = BridgeSuccess<T> | BridgeFailure;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rustEnabled = (): boolean => (process.env.SHAREPASTE_RUST_CRYPTO ?? "1") !== "0";

const bridgeExecutableNames = (): string[] => {
  if (process.platform === "win32") {
    return ["sharepaste-client-runtime-bridge.exe", "sharepaste-client-runtime-bridge"];
  }

  return ["sharepaste-client-runtime-bridge"];
};

const bridgeCandidates = (): string[] => {
  const explicit = process.env.SHAREPASTE_RUST_BRIDGE_BIN;
  const candidateDirectories = [
    path.resolve(__dirname, "../../../../target/debug"),
    path.resolve(__dirname, "../../../../../target/debug"),
    path.resolve(__dirname, "../../../../target/release"),
    path.resolve(__dirname, "../../../../../target/release")
  ];
  const candidates = explicit ? [explicit] : [];

  for (const directory of candidateDirectories) {
    for (const executable of bridgeExecutableNames()) {
      candidates.push(path.join(directory, executable));
    }
  }

  return candidates;
};

class NodeCryptoAgent {
  createIdentity(): DeviceIdentity {
    const signPair = generateKeyPairSync("ed25519");
    const wrapPair = generateKeyPairSync("x25519");

    return {
      signPublicKey: signPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      signPrivateKey: signPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      wrapPublicKey: wrapPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      wrapPrivateKey: wrapPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    };
  }

  generateGroupKey(): Uint8Array {
    return randomBytes(32);
  }

  encryptClipboard(groupKey: Uint8Array, plaintext: Uint8Array): CipherEnvelope {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", createSecretKey(Buffer.from(groupKey)), nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return { nonce, ciphertext };
  }

  decryptClipboard(groupKey: Uint8Array, envelope: CipherEnvelope): Uint8Array {
    const body = envelope.ciphertext.slice(0, envelope.ciphertext.length - 16);
    const tag = envelope.ciphertext.slice(envelope.ciphertext.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", createSecretKey(Buffer.from(groupKey)), envelope.nonce);
    decipher.setAuthTag(Buffer.from(tag));
    return Buffer.concat([decipher.update(Buffer.from(body)), decipher.final()]);
  }

  sealGroupKeyForDevice(groupKey: Uint8Array, recipientWrapPublicKeyPem: string): string {
    const ephemeral = generateKeyPairSync("x25519");
    const sharedSecret = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: createPublicKey(recipientWrapPublicKeyPem)
    });

    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sharedSecret.subarray(0, 32), nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(groupKey)), cipher.final(), cipher.getAuthTag()]);

    return Buffer.from(
      JSON.stringify({
        epk: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url")
      })
    ).toString("base64url");
  }

  unsealGroupKeyForDevice(sealed: string, recipientWrapPrivateKeyPem: string): Uint8Array {
    const parsed = JSON.parse(Buffer.from(sealed, "base64url").toString("utf8")) as {
      epk: string;
      nonce: string;
      ciphertext: string;
    };

    const sharedSecret = diffieHellman({
      privateKey: createPrivateKey(recipientWrapPrivateKeyPem),
      publicKey: createPublicKey(parsed.epk)
    });

    const ciphertext = Buffer.from(parsed.ciphertext, "base64url");
    const body = ciphertext.subarray(0, ciphertext.length - 16);
    const tag = ciphertext.subarray(ciphertext.length - 16);

    const decipher = createDecipheriv("aes-256-gcm", sharedSecret.subarray(0, 32), Buffer.from(parsed.nonce, "base64url"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }
}

class RustCryptoBridge {
  constructor(private readonly binaryPath: string) {}

  createIdentity(): DeviceIdentity {
    const result = this.invoke<BridgeIdentityResult>({ op: "create_identity" });
    return result;
  }

  generateGroupKey(): Uint8Array {
    const result = this.invoke<BridgeBytesResult>({ op: "generate_group_key" });
    return Buffer.from(result.bytes, "base64url");
  }

  encryptClipboard(groupKey: Uint8Array, plaintext: Uint8Array): CipherEnvelope {
    const result = this.invoke<BridgeEnvelopeResult>({
      op: "encrypt_clipboard",
      group_key: Buffer.from(groupKey).toString("base64url"),
      plaintext: Buffer.from(plaintext).toString("base64url")
    });
    return {
      nonce: Buffer.from(result.nonce, "base64url"),
      ciphertext: Buffer.from(result.ciphertext, "base64url")
    };
  }

  decryptClipboard(groupKey: Uint8Array, envelope: CipherEnvelope): Uint8Array {
    const result = this.invoke<BridgeBytesResult>({
      op: "decrypt_clipboard",
      group_key: Buffer.from(groupKey).toString("base64url"),
      nonce: Buffer.from(envelope.nonce).toString("base64url"),
      ciphertext: Buffer.from(envelope.ciphertext).toString("base64url")
    });
    return Buffer.from(result.bytes, "base64url");
  }

  sealGroupKeyForDevice(groupKey: Uint8Array, recipientWrapPublicKeyPem: string): string {
    const result = this.invoke<BridgeSealedResult>({
      op: "seal_group_key_for_device",
      group_key: Buffer.from(groupKey).toString("base64url"),
      recipient_wrap_public_key_pem: recipientWrapPublicKeyPem
    });
    return result.sealed;
  }

  unsealGroupKeyForDevice(sealed: string, recipientWrapPrivateKeyPem: string): Uint8Array {
    const result = this.invoke<BridgeBytesResult>({
      op: "unseal_group_key_for_device",
      sealed,
      recipient_wrap_private_key_pem: recipientWrapPrivateKeyPem
    });
    return Buffer.from(result.bytes, "base64url");
  }

  private invoke<T>(payload: Record<string, unknown>): T {
    const proc = spawnSync(this.binaryPath, {
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });

    if (proc.error) {
      throw proc.error;
    }
    if (proc.status !== 0 && !proc.stdout) {
      throw new Error(proc.stderr.trim() || `bridge exited with code ${proc.status}`);
    }

    const output = proc.stdout.trim();
    if (!output) {
      throw new Error("bridge returned no output");
    }

    const parsed = JSON.parse(output) as BridgeResponse<T>;
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.result;
  }
}

const resolveRustBridge = (): RustCryptoBridge | null => {
  if (!rustEnabled()) {
    return null;
  }

  for (const candidate of bridgeCandidates()) {
    if (existsSync(candidate)) {
      return new RustCryptoBridge(candidate);
    }
  }

  return null;
};

export class CryptoAgent {
  private readonly node = new NodeCryptoAgent();

  private readonly rust = resolveRustBridge();

  createIdentity(): DeviceIdentity {
    return this.tryRust((agent) => agent.createIdentity(), () => this.node.createIdentity());
  }

  generateGroupKey(): Uint8Array {
    return this.tryRust((agent) => agent.generateGroupKey(), () => this.node.generateGroupKey());
  }

  encryptClipboard(groupKey: Uint8Array, plaintext: Uint8Array): CipherEnvelope {
    return this.tryRust((agent) => agent.encryptClipboard(groupKey, plaintext), () => this.node.encryptClipboard(groupKey, plaintext));
  }

  decryptClipboard(groupKey: Uint8Array, envelope: CipherEnvelope): Uint8Array {
    return this.tryRust((agent) => agent.decryptClipboard(groupKey, envelope), () => this.node.decryptClipboard(groupKey, envelope));
  }

  sealGroupKeyForDevice(groupKey: Uint8Array, recipientWrapPublicKeyPem: string): string {
    return this.tryRust(
      (agent) => agent.sealGroupKeyForDevice(groupKey, recipientWrapPublicKeyPem),
      () => this.node.sealGroupKeyForDevice(groupKey, recipientWrapPublicKeyPem)
    );
  }

  unsealGroupKeyForDevice(sealed: string, recipientWrapPrivateKeyPem: string): Uint8Array {
    return this.tryRust(
      (agent) => agent.unsealGroupKeyForDevice(sealed, recipientWrapPrivateKeyPem),
      () => this.node.unsealGroupKeyForDevice(sealed, recipientWrapPrivateKeyPem)
    );
  }

  private tryRust<T>(work: (bridge: RustCryptoBridge) => T, fallback: () => T): T {
    if (!this.rust) {
      return fallback();
    }

    try {
      return work(this.rust);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (process.env.SHAREPASTE_RUST_CRYPTO_STRICT === "1") {
        throw error;
      }
      console.warn(`rust crypto bridge failed, falling back to node crypto: ${message}`);
      return fallback();
    }
  }
}
