import clipboard from "clipboardy";

export type ClipboardChange = {
  kind: "text";
  value: string;
};

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | undefined;

  private latest = "";

  private suppressNext = false;

  async start(onChange: (change: ClipboardChange) => Promise<void> | void, intervalMs = 500): Promise<void> {
    this.latest = await clipboard.read();

    this.timer = setInterval(async () => {
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
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async writeText(value: string): Promise<void> {
    this.suppressNext = true;
    this.latest = value;
    await clipboard.write(value);
  }
}
