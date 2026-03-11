import type { IncomingClipboardEvent, PairingRequestEvent, PersistedState } from "../index.js";

export interface BridgeRequest<T = Record<string, unknown>> {
  id: string;
  method: string;
  params?: T;
}

export interface BridgeSuccess<T = unknown> {
  id: string;
  ok: true;
  result: T;
}

export interface BridgeFailure {
  id: string;
  ok: false;
  error: string;
}

export type BridgeResponse<T = unknown> = BridgeSuccess<T> | BridgeFailure;

export interface BridgeEvent<T = unknown> {
  event: string;
  payload: T;
}

export interface StateSnapshot {
  deviceId: string;
  groupId: string;
  deviceName: string;
  platform: string;
  recoveryPhrase: string;
  groupKeyVersion?: number;
}

export interface ClipboardWriteRequest {
  kind: "text";
  value: string;
}

export interface BridgeLogEvent {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

export type BridgeOutgoingEvent =
  | BridgeEvent<IncomingClipboardEvent>
  | BridgeEvent<PairingRequestEvent>
  | BridgeEvent<ClipboardWriteRequest>
  | BridgeEvent<BridgeLogEvent>;

export const snapshotState = (state: PersistedState): StateSnapshot => ({
  deviceId: state.deviceId,
  groupId: state.groupId,
  deviceName: state.deviceName,
  platform: state.platform,
  recoveryPhrase: state.recoveryPhrase,
  groupKeyVersion: state.groupKeyVersion
});
