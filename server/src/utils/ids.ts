import { customAlphabet, nanoid } from "nanoid";
import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes } from "node:crypto";

const bindCodeAlphabet = customAlphabet("0123456789", 6);

export const nowUnix = (): number => Math.floor(Date.now() / 1000);

export const makeDeviceId = (): string => `dev_${nanoid(16)}`;

export const makeGroupId = (): string => `grp_${nanoid(16)}`;

export const makeRequestId = (): string => `req_${nanoid(14)}`;

export const generateBindCode = (): string => bindCodeAlphabet();

export const hashRecoveryPhrase = (phrase: string): string => {
  return createHash("sha256").update(phrase).digest("hex");
};

export const generateRecoveryPhrase = (): string => {
  return randomBytes(16).toString("hex");
};

export const generateGroupKeyBase64 = (): string => randomBytes(32).toString("base64url");

export const sealGroupKeyForDevice = (groupId: string, pubkey: string, version: number, groupKeyBase64: string): string => {
  const ephemeral = generateKeyPairSync("x25519");
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey(pubkey)
  });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sharedSecret.subarray(0, 32), nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(groupKeyBase64, "base64url")), cipher.final(), cipher.getAuthTag()]);

  return Buffer.from(
    JSON.stringify({
      groupId,
      version,
      epk: ephemeral.publicKey.export({ type: "spki", format: "pem" }).toString(),
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url")
    })
  ).toString("base64url");
};
