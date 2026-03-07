import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { ClipboardPayload } from "../types.js";
import { isAllowedByPolicy } from "./policy-engine.js";
import type { SharePolicy } from "../types.js";

export interface SyncDecision {
  accepted: boolean;
  reason?: string;
}

export class SyncEngine {
  private readonly localDeviceId: string;

  private readonly recentlySeen = new Set<string>();

  constructor(localDeviceId: string) {
    this.localDeviceId = localDeviceId;
  }

  makeItemId(content: Uint8Array, createdAtUnix: number): string {
    const digest = createHash("sha256").update(content).update(String(createdAtUnix)).digest("hex");
    return `item_${digest.slice(0, 16)}_${nanoid(6)}`;
  }

  shouldSend(payload: ClipboardPayload, policy: SharePolicy): SyncDecision {
    if (!isAllowedByPolicy(policy, payload)) {
      return { accepted: false, reason: "blocked_by_policy" };
    }

    if (this.recentlySeen.has(payload.itemId)) {
      return { accepted: false, reason: "duplicate_item" };
    }

    this.markSeen(payload.itemId);
    return { accepted: true };
  }

  shouldApplyIncoming(payload: ClipboardPayload): SyncDecision {
    if (payload.sourceDeviceId === this.localDeviceId) {
      return { accepted: false, reason: "loopback" };
    }

    if (this.recentlySeen.has(payload.itemId)) {
      return { accepted: false, reason: "duplicate_item" };
    }

    this.markSeen(payload.itemId);
    return { accepted: true };
  }

  private markSeen(itemId: string): void {
    this.recentlySeen.add(itemId);
    if (this.recentlySeen.size > 1000) {
      const [first] = this.recentlySeen;
      if (first) {
        this.recentlySeen.delete(first);
      }
    }
  }
}
