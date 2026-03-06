import { customAlphabet, nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";

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
  return Buffer.from(JSON.stringify({ groupId, pubkey, version, groupKeyBase64 })).toString("base64url");
};
