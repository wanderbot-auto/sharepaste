import { describe, expect, it } from "vitest";
import { HistoryStore } from "../src/core/history-store.js";
import { defaultPolicy, isAllowedByPolicy } from "../src/core/policy-engine.js";
import { SyncEngine } from "../src/core/sync-engine.js";

describe("client core", () => {
  it("keeps history bounded to last 50", () => {
    const history = new HistoryStore(50);
    for (let i = 0; i < 55; i += 1) {
      history.push({
        itemId: `id-${i}`,
        type: "text",
        mime: "text/plain",
        sizeBytes: 1,
        createdAtUnix: i,
        sourceDeviceId: "dev-1",
        cipherRef: "inline://",
        ciphertext: new Uint8Array([1]),
        nonce: new Uint8Array([2])
      });
    }

    const list = history.list();
    expect(list).toHaveLength(50);
    expect(list[0].itemId).toBe("id-54");
    expect(list[49].itemId).toBe("id-5");
  });

  it("blocks disallowed file sizes by policy", () => {
    const policy = defaultPolicy();
    policy.maxFileSizeBytes = 100;

    const allowed = isAllowedByPolicy(policy, {
      itemId: "a",
      type: "file",
      mime: "application/octet-stream",
      sizeBytes: 99,
      createdAtUnix: 1,
      sourceDeviceId: "dev",
      cipherRef: "inline://",
      ciphertext: new Uint8Array([1]),
      nonce: new Uint8Array([1])
    });

    const blocked = isAllowedByPolicy(policy, {
      itemId: "b",
      type: "file",
      mime: "application/octet-stream",
      sizeBytes: 100,
      createdAtUnix: 1,
      sourceDeviceId: "dev",
      cipherRef: "inline://",
      ciphertext: new Uint8Array([1]),
      nonce: new Uint8Array([1])
    });

    expect(allowed).toBe(true);
    expect(blocked).toBe(false);
  });

  it("suppresses duplicate and loopback events", () => {
    const engine = new SyncEngine("dev-self");

    const incoming = {
      itemId: "same",
      type: "text" as const,
      mime: "text/plain",
      sizeBytes: 5,
      createdAtUnix: 1,
      sourceDeviceId: "dev-other",
      cipherRef: "inline://",
      ciphertext: new Uint8Array([1]),
      nonce: new Uint8Array([2])
    };

    expect(engine.shouldApplyIncoming(incoming).accepted).toBe(true);
    expect(engine.shouldApplyIncoming(incoming).accepted).toBe(false);
    expect(
      engine.shouldApplyIncoming({
        ...incoming,
        itemId: "new",
        sourceDeviceId: "dev-self"
      }).accepted
    ).toBe(false);
  });
});
