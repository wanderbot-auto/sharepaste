import { describe, expect, it } from "vitest";
import { PostgresStatePersistence } from "../src/infrastructure/postgres-persistence.js";
import { RedisRuntimeSignals } from "../src/infrastructure/redis-runtime.js";
import type { SharePasteSnapshot } from "../src/types.js";

const runIntegration = process.env.SHAREPASTE_INTEGRATION === "1";

const integration = runIntegration ? describe : describe.skip;

integration("storage integrations", () => {
  it("round-trips snapshots in Postgres", async () => {
    const url = process.env.SHAREPASTE_DATABASE_URL ?? "postgres://sharepaste:sharepaste@127.0.0.1:5432/sharepaste";
    const persistence = new PostgresStatePersistence(url);

    const snapshot: SharePasteSnapshot = {
      devices: [
        {
          deviceId: "dev_test",
          groupId: "grp_test",
          pubkey: "pub",
          name: "test",
          platform: "linux",
          lastSeenUnix: 1,
          active: true
        }
      ],
      groups: [
        {
          groupId: "grp_test",
          recoveryPhraseHash: "hash",
          groupKeyVersion: 1,
          groupKeyBase64: "key",
          policy: {
            allowText: true,
            allowImage: true,
            allowFile: true,
            maxFileSizeBytes: 1024,
            version: 1,
            updatedBy: "system",
            updatedAtUnix: 1
          }
        }
      ],
      groupDevices: [{ groupId: "grp_test", deviceIds: ["dev_test"] }],
      bindCodes: [],
      bindRequests: [],
      offline: [
        {
          deviceId: "dev_test",
          queue: [
            {
              targetDeviceId: "dev_test",
              expiresAtUnix: 999,
              item: {
                itemId: "item-1",
                type: "text",
                sizeBytes: 3,
                mime: "text/plain",
                cipherRef: "inline://item-1",
                ciphertext: new Uint8Array([1, 2, 3]),
                nonce: new Uint8Array([4, 5]),
                createdAtUnix: 1,
                sourceDeviceId: "dev_test"
              }
            }
          ]
        }
      ],
      seenItems: [{ groupId: "grp_test", itemIds: ["item-1"] }]
    };

    await persistence.saveSnapshot(snapshot);
    const loaded = await persistence.loadSnapshot();
    await persistence.close();

    expect(loaded).not.toBeNull();
    expect(loaded?.devices[0]?.deviceId).toBe("dev_test");
    expect(Array.from(loaded?.offline[0]?.queue[0]?.item.ciphertext ?? [])).toEqual([1, 2, 3]);
  });

  it("enforces redis rate limit counters", async () => {
    const redisUrl = process.env.SHAREPASTE_REDIS_URL ?? "redis://127.0.0.1:6379";
    const runtime = new RedisRuntimeSignals(redisUrl);

    const a = await runtime.consumeRateLimit("dev_rate", "request_bind", 2);
    const b = await runtime.consumeRateLimit("dev_rate", "request_bind", 2);
    const c = await runtime.consumeRateLimit("dev_rate", "request_bind", 2);

    await runtime.close();

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(false);
  });
});
