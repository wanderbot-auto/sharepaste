import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeviceIdentity } from "./crypto-agent.js";

export interface PersistedState {
  deviceId: string;
  groupId: string;
  deviceName: string;
  platform: string;
  recoveryPhrase: string;
  sealedGroupKey: string;
  identity: DeviceIdentity;
  groupKeyBase64?: string;
}

const defaultStatePath = path.join(os.homedir(), ".sharepaste", "state.json");

export class StateStore {
  private readonly filePath: string;

  constructor(filePath = defaultStatePath) {
    this.filePath = filePath;
  }

  async load(): Promise<PersistedState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as PersistedState;
    } catch {
      return null;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}
