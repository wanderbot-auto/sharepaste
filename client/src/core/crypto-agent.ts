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

export class CryptoAgent {
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
