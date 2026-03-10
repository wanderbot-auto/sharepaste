import { SyncEngine } from "@sharepaste/client-core";
import type { PersistedState } from "./state-store.js";

export class ClientSession {
  private state: PersistedState | null = null;

  private syncEngine: SyncEngine | null = null;

  constructor(private readonly createSyncEngine: (deviceId: string) => SyncEngine = (deviceId) => new SyncEngine(deviceId)) {}

  current(): PersistedState | null {
    return this.state;
  }

  attach(state: PersistedState): PersistedState {
    const deviceChanged = this.state?.deviceId !== state.deviceId;
    this.state = state;
    if (!this.syncEngine || deviceChanged) {
      this.syncEngine = this.createSyncEngine(state.deviceId);
    }
    return state;
  }

  clear(): void {
    this.state = null;
    this.syncEngine = null;
  }

  requireState(): PersistedState {
    if (!this.state) {
      throw new Error("CLIENT_NOT_BOOTSTRAPPED");
    }

    return this.state;
  }

  requireSyncEngine(): SyncEngine {
    if (!this.syncEngine) {
      throw new Error("CLIENT_NOT_BOOTSTRAPPED");
    }

    return this.syncEngine;
  }
}
