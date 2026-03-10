import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryStatePersistence, NoopRuntimeSignals } from "../src/infrastructure/noop.js";
import { DurableSharePasteStore } from "../src/store/durable-sharepaste-store.js";

const makePubkey = (): string => generateKeyPairSync("x25519").publicKey.export({ type: "spki", format: "pem" }).toString();

describe("DurableSharePasteStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T00:00:00Z"));
  });

  it("restores group state from persisted snapshot", async () => {
    const persistence = new InMemoryStatePersistence();
    const runtime = new NoopRuntimeSignals();

    const first = await DurableSharePasteStore.create(persistence, runtime);
    const owner = await first.registerDevice({
      deviceName: "Owner",
      platform: "macos",
      pubkey: makePubkey()
    });

    const joiner = await first.registerDevice({
      deviceName: "Joiner",
      platform: "windows",
      pubkey: makePubkey()
    });

    const bindCode = await first.createBindCode(owner.device.deviceId);
    const bindRequest = await first.requestBind(bindCode.code, joiner.device.deviceId);
    await first.confirmBind(bindRequest.requestId, owner.device.deviceId, true);

    const second = await DurableSharePasteStore.create(persistence, runtime);
    const devices = await second.listDevices(owner.device.deviceId);

    expect(devices).toHaveLength(2);
    expect(devices.every((device) => device.groupId === owner.groupId)).toBe(true);

    const policy = await second.getPolicy(owner.device.deviceId);
    expect(policy.version).toBe(1);

    const audits = persistence.getAuditLog();
    expect(audits.length).toBeGreaterThan(0);
  });
});
