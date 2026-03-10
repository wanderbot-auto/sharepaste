import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { ClipboardPayload } from "@sharepaste/client-core";

const extensionForMime = (payload: ClipboardPayload): string => {
  const mime = payload.mime.toLowerCase();
  if (mime === "image/png") {
    return ".png";
  }
  if (mime === "image/jpeg") {
    return ".jpg";
  }
  if (mime === "image/gif") {
    return ".gif";
  }
  if (mime === "image/webp") {
    return ".webp";
  }
  if (mime === "application/pdf") {
    return ".pdf";
  }
  if (mime === "text/plain") {
    return ".txt";
  }
  return payload.type === "image" ? ".img" : ".bin";
};

export class IncomingItemStore {
  constructor(private readonly baseDir = path.join(os.homedir(), ".sharepaste", "received")) {}

  async materialize(payload: ClipboardPayload, plaintext: Uint8Array): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const filename = `${payload.createdAtUnix}-${payload.itemId}${extensionForMime(payload)}`;
    const filePath = path.join(this.baseDir, filename);
    await fs.writeFile(filePath, Buffer.from(plaintext));
    return filePath;
  }
}
