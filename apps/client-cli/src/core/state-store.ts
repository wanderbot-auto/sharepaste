import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeviceIdentity } from "@sharepaste/client-core";
import type { PersistedStateStorePort } from "./ports.js";

export interface PersistedState {
  deviceId: string;
  groupId: string;
  deviceName: string;
  platform: string;
  recoveryPhrase: string;
  sealedGroupKey: string;
  identity: DeviceIdentity;
  groupKeyBase64?: string;
  groupKeyVersion?: number;
}

const defaultStatePath = path.join(os.homedir(), ".sharepaste", "state.json");

const isDeviceIdentity = (value: unknown): value is DeviceIdentity => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.signPublicKey === "string" &&
    typeof candidate.signPrivateKey === "string" &&
    typeof candidate.wrapPublicKey === "string" &&
    typeof candidate.wrapPrivateKey === "string"
  );
};

const isPersistedState = (value: unknown): value is PersistedState => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.deviceId === "string" &&
    typeof candidate.groupId === "string" &&
    typeof candidate.deviceName === "string" &&
    typeof candidate.platform === "string" &&
    typeof candidate.recoveryPhrase === "string" &&
    typeof candidate.sealedGroupKey === "string" &&
    isDeviceIdentity(candidate.identity) &&
    (candidate.groupKeyBase64 === undefined || typeof candidate.groupKeyBase64 === "string") &&
    (candidate.groupKeyVersion === undefined || typeof candidate.groupKeyVersion === "number")
  );
};

export class StateStore implements PersistedStateStorePort {
  private readonly filePath: string;

  constructor(filePath = defaultStatePath) {
    this.filePath = filePath;
  }

  async load(): Promise<PersistedState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedState(parsed)) {
        throw new Error("STATE_FILE_INVALID");
      }
      return parsed;
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno?.code === "ENOENT") {
        return null;
      }
      if (error instanceof Error && error.message === "STATE_FILE_INVALID") {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new Error("STATE_FILE_INVALID");
      }
      throw error;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
