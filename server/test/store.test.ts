import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharePasteStore } from "../src/store/sharepaste-store.js";

const makePubkey = (): string => generateKeyPairSync("x25519").publicKey.export({ type: "spki", format: "pem" }).toString();

describe("SharePasteStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T00:00:00Z"));
  });

  it("creates a new anonymous group with recovery phrase", () => {
    const store = new SharePasteStore();
    const registration = store.registerDevice({
      deviceName: "Laptop",
      platform: "windows",
      pubkey: makePubkey()
    });

    expect(registration.createdNewGroup).toBe(true);
    expect(registration.groupId.startsWith("grp_")).toBe(true);
    expect(registration.recoveryPhrase.length).toBeGreaterThan(10);
    expect(store.listDevices(registration.device.deviceId)).toHaveLength(1);
  });

  it("pairs devices with expiring bind code and confirmation", () => {
    const store = new SharePasteStore();

    const issuer = store.registerDevice({ deviceName: "A", platform: "windows", pubkey: makePubkey() });
    const requester = store.registerDevice({ deviceName: "B", platform: "linux", pubkey: makePubkey() });

    const code = store.createBindCode(issuer.device.deviceId);
    const request = store.requestBind(code.code, requester.device.deviceId);

    const approved = store.confirmBind(request.requestId, issuer.device.deviceId, true);
    expect(approved.approved).toBe(true);

    const groupDevices = store.listDevices(issuer.device.deviceId);
    expect(groupDevices).toHaveLength(2);
    expect(groupDevices.every((device) => device.groupId === issuer.groupId)).toBe(true);

    const expiringCode = store.createBindCode(issuer.device.deviceId);
    vi.setSystemTime(new Date("2026-03-06T00:02:00Z"));
    expect(() => store.requestBind(expiringCode.code, issuer.device.deviceId)).toThrowError("BIND_CODE_EXPIRED");
  });

  it("enforces optimistic lock for policy updates", () => {
    const store = new SharePasteStore();
    const device = store.registerDevice({ deviceName: "A", platform: "macos", pubkey: makePubkey() });

    const current = store.getPolicy(device.device.deviceId);
    const next = store.updatePolicy(device.device.deviceId, current.version, {
      allowText: true,
      allowImage: true,
      allowFile: true,
      maxFileSizeBytes: 1024
    });

    expect(next.version).toBe(current.version + 1);

    expect(() =>
      store.updatePolicy(device.device.deviceId, current.version, {
        allowText: true,
        allowImage: true,
        allowFile: false,
        maxFileSizeBytes: 1024
      })
    ).toThrowError("POLICY_VERSION_CONFLICT");
  });

  it("queues offline items and drops expired entries", () => {
    const store = new SharePasteStore();

    const sender = store.registerDevice({ deviceName: "Sender", platform: "windows", pubkey: makePubkey() });
    const receiver = store.registerDevice({ deviceName: "Receiver", platform: "linux", pubkey: makePubkey() });

    const bindCode = store.createBindCode(sender.device.deviceId);
    const bindReq = store.requestBind(bindCode.code, receiver.device.deviceId);
    store.confirmBind(bindReq.requestId, sender.device.deviceId, true);

    store.pushClipboardItem(sender.device.deviceId, {
      itemId: "item-1",
      type: "text",
      sizeBytes: 10,
      mime: "text/plain",
      cipherRef: "cipher://1",
      ciphertext: new Uint8Array([1, 2]),
      nonce: new Uint8Array([3, 4]),
      createdAtUnix: 100,
      sourceDeviceId: sender.device.deviceId
    });

    expect(store.fetchOffline(receiver.device.deviceId, 10)).toHaveLength(1);

    vi.setSystemTime(new Date("2026-03-07T01:00:00Z"));
    expect(store.fetchOffline(receiver.device.deviceId, 10)).toHaveLength(0);
  });

  it("rejects files that violate policy max size", () => {
    const store = new SharePasteStore();
    const sender = store.registerDevice({ deviceName: "Sender", platform: "windows", pubkey: makePubkey() });

    const current = store.getPolicy(sender.device.deviceId);
    store.updatePolicy(sender.device.deviceId, current.version, {
      allowText: true,
      allowImage: true,
      allowFile: true,
      maxFileSizeBytes: 100
    });

    expect(() =>
      store.pushClipboardItem(sender.device.deviceId, {
        itemId: "item-2",
        type: "file",
        sizeBytes: 100,
        mime: "application/octet-stream",
        cipherRef: "cipher://2",
        ciphertext: new Uint8Array([1]),
        nonce: new Uint8Array([2]),
        createdAtUnix: 101,
        sourceDeviceId: sender.device.deviceId
      })
    ).toThrowError("POLICY_REJECTED");
  });
});
