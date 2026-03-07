import type { AuditRecord, SharePasteSnapshot } from "../types.js";
import type { SharePasteRuntimeSignals, SharePasteStatePersistence } from "../store/contracts.js";

export class InMemoryStatePersistence implements SharePasteStatePersistence {
  private snapshot: SharePasteSnapshot | null = null;

  private readonly audits: AuditRecord[] = [];

  async loadSnapshot(): Promise<SharePasteSnapshot | null> {
    return this.snapshot;
  }

  async saveSnapshot(snapshot: SharePasteSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async writeAudit(record: AuditRecord): Promise<void> {
    this.audits.push(record);
  }

  async close(): Promise<void> {
    // no-op
  }

  getAuditLog(): AuditRecord[] {
    return [...this.audits];
  }
}

export class NoopRuntimeSignals implements SharePasteRuntimeSignals {
  async touchPresence(): Promise<void> {
    // no-op
  }

  async clearPresence(): Promise<void> {
    // no-op
  }

  async consumeRateLimit(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // no-op
  }
}
