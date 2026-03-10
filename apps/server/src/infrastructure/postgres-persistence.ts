import { Buffer } from "node:buffer";
import { Pool } from "pg";
import type { AuditRecord, ClipboardItem, OfflineEnvelope, SharePasteSnapshot } from "../types.js";
import type { SharePasteStatePersistence } from "../store/contracts.js";

interface SerializedClipboardItem extends Omit<ClipboardItem, "ciphertext" | "nonce"> {
  ciphertext: string;
  nonce: string;
}

interface SerializedOfflineEnvelope extends Omit<OfflineEnvelope, "item"> {
  item: SerializedClipboardItem;
}

type SerializedSnapshot = Omit<SharePasteSnapshot, "offline"> & {
  offline: Array<{ deviceId: string; queue: SerializedOfflineEnvelope[] }>;
};

const encodeItem = (item: ClipboardItem): SerializedClipboardItem => ({
  ...item,
  ciphertext: Buffer.from(item.ciphertext).toString("base64"),
  nonce: Buffer.from(item.nonce).toString("base64")
});

const decodeItem = (item: SerializedClipboardItem): ClipboardItem => ({
  ...item,
  ciphertext: Buffer.from(item.ciphertext, "base64"),
  nonce: Buffer.from(item.nonce, "base64")
});

const serializeSnapshot = (snapshot: SharePasteSnapshot): SerializedSnapshot => ({
  ...snapshot,
  offline: snapshot.offline.map((entry) => ({
    deviceId: entry.deviceId,
    queue: entry.queue.map((envelope) => ({
      ...envelope,
      item: encodeItem(envelope.item)
    }))
  }))
});

const deserializeSnapshot = (snapshot: SerializedSnapshot): SharePasteSnapshot => ({
  ...snapshot,
  offline: snapshot.offline.map((entry) => ({
    deviceId: entry.deviceId,
    queue: entry.queue.map((envelope) => ({
      ...envelope,
      item: decodeItem(envelope.item)
    }))
  }))
});

export class PostgresStatePersistence implements SharePasteStatePersistence {
  private readonly pool: Pool;

  private initialized = false;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  private async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sharepaste_state (
        id SMALLINT PRIMARY KEY,
        snapshot_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sharepaste_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        actor_device_id TEXT,
        group_id TEXT,
        request_id TEXT,
        item_id TEXT,
        result TEXT NOT NULL,
        error_code TEXT,
        metadata JSONB,
        created_at_unix BIGINT NOT NULL
      );
    `);

    this.initialized = true;
  }

  async loadSnapshot(): Promise<SharePasteSnapshot | null> {
    await this.init();
    const result = await this.pool.query<{ snapshot_json: SerializedSnapshot }>(
      `SELECT snapshot_json FROM sharepaste_state WHERE id = 1 LIMIT 1`
    );

    if (result.rows.length === 0) {
      return null;
    }

    return deserializeSnapshot(result.rows[0].snapshot_json);
  }

  async saveSnapshot(snapshot: SharePasteSnapshot): Promise<void> {
    await this.init();
    const serialized = serializeSnapshot(snapshot);
    await this.pool.query(
      `
      INSERT INTO sharepaste_state (id, snapshot_json, updated_at)
      VALUES (1, $1::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = NOW()
    `,
      [JSON.stringify(serialized)]
    );
  }

  async writeAudit(record: AuditRecord): Promise<void> {
    await this.init();
    await this.pool.query(
      `
      INSERT INTO sharepaste_audit_logs (
        action,
        actor_device_id,
        group_id,
        request_id,
        item_id,
        result,
        error_code,
        metadata,
        created_at_unix
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
    `,
      [
        record.action,
        record.actorDeviceId ?? null,
        record.groupId ?? null,
        record.requestId ?? null,
        record.itemId ?? null,
        record.result,
        record.errorCode ?? null,
        JSON.stringify(record.metadata ?? {}),
        record.createdAtUnix
      ]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
