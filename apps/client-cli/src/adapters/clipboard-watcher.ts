import clipboard from "clipboardy";

export type ClipboardChange = {
  kind: "text";
  value: string;
};

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | undefined;

  private latest = "";

  private suppressNext = false;

  private pollInFlight = false;

  async start(onChange: (change: ClipboardChange) => Promise<void> | void, intervalMs = 500): Promise<void> {
    this.latest = await clipboard.read();
    this.pollInFlight = false;

    this.timer = setInterval(() => {
      if (this.pollInFlight) {
        return;
      }

      this.pollInFlight = true;
      void this.pollOnce(onChange).finally(() => {
        this.pollInFlight = false;
      });
    }, intervalMs);
  }

  private async pollOnce(onChange: (change: ClipboardChange) => Promise<void> | void): Promise<void> {
    try {
      const next = await clipboard.read();
      if (next === this.latest) {
        return;
      }

      this.latest = next;
      if (this.suppressNext) {
        this.suppressNext = false;
        return;
      }

      await onChange({ kind: "text", value: next });
    } catch (error) {
      console.error("clipboard watcher iteration failed", error);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.pollInFlight = false;
  }

  async writeText(value: string): Promise<void> {
    this.suppressNext = true;
    this.latest = value;
    await clipboard.write(value);
  }
}
