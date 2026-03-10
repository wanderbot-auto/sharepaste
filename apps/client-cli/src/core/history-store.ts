import type { ClipboardPayload } from "../types.js";

export class HistoryStore {
  private readonly cap: number;

  private readonly values: ClipboardPayload[] = [];

  constructor(capacity = 50) {
    this.cap = capacity;
  }

  push(item: ClipboardPayload): void {
    this.values.unshift(item);
    if (this.values.length > this.cap) {
      this.values.length = this.cap;
    }
  }

  list(): ClipboardPayload[] {
    return [...this.values];
  }
}
