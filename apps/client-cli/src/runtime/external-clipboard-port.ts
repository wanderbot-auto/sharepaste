import type { ClipboardChange, ClipboardPort } from "../core/ports.js";

interface ExternalClipboardPortOptions {
  onWriteText?: (value: string) => Promise<void> | void;
}

export class ExternalClipboardPort implements ClipboardPort {
  private onChange: ((change: ClipboardChange) => Promise<void> | void) | null = null;

  constructor(private readonly options: ExternalClipboardPortOptions = {}) {}

  async start(onChange: (change: ClipboardChange) => Promise<void> | void): Promise<void> {
    this.onChange = onChange;
  }

  stop(): void {
    this.onChange = null;
  }

  async writeText(value: string): Promise<void> {
    await this.options.onWriteText?.(value);
  }

  async emit(change: ClipboardChange): Promise<void> {
    await this.onChange?.(change);
  }
}
