import { createClient, type RedisClientType } from "redis";
import type { SharePasteRuntimeSignals } from "../store/contracts.js";

const PRESENCE_TTL_SECONDS = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export class RedisRuntimeSignals implements SharePasteRuntimeSignals {
  private readonly client: RedisClientType;

  private connected = false;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.client.on("error", (err) => {
      console.warn("redis runtime signal error", err instanceof Error ? err.message : err);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.connect();
    this.connected = true;
  }

  async touchPresence(deviceId: string, lanAddr?: string): Promise<void> {
    await this.ensureConnected();
    const key = `sharepaste:presence:${deviceId}`;
    await this.client.setEx(
      key,
      PRESENCE_TTL_SECONDS,
      JSON.stringify({
        lanAddr: lanAddr ?? null,
        ts: Date.now()
      })
    );
  }

  async clearPresence(deviceId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(`sharepaste:presence:${deviceId}`);
  }

  async consumeRateLimit(deviceId: string, action: string, maxPerMinute: number): Promise<boolean> {
    await this.ensureConnected();
    const key = `sharepaste:ratelimit:${action}:${deviceId}`;
    const current = await this.client.incr(key);
    if (current === 1) {
      await this.client.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    return current <= maxPerMinute;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
    }
  }
}
