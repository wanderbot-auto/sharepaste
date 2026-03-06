import type {
  sendUnaryData,
  ServerDuplexStream,
  ServerUnaryCall,
  ServiceError
} from "@grpc/grpc-js";
import { SharePasteStore } from "../store/sharepaste-store.js";
import type { ClipboardItem, ClipboardKind } from "../types.js";

interface EnvelopeMessage {
  payload?: string;
  hello?: {
    deviceId: string;
    lanAddr?: string;
  };
  ack?: {
    itemId: string;
  };
}

const toError = (err: unknown): ServiceError => {
  const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";

  const map: Record<string, number> = {
    DEVICE_NOT_FOUND: 5,
    GROUP_NOT_FOUND: 5,
    RECOVERY_PHRASE_INVALID: 16,
    GROUP_MISMATCH: 9,
    GROUP_DEVICE_LIMIT_REACHED: 8,
    BIND_CODE_EXPIRED: 9,
    BIND_CODE_EXHAUSTED: 8,
    BIND_REQUEST_EXPIRED: 9,
    ALREADY_BOUND: 6,
    NOT_AUTHORIZED: 7,
    POLICY_VERSION_CONFLICT: 10,
    INVALID_MAX_FILE_SIZE: 3,
    POLICY_REJECTED: 9,
    SOURCE_DEVICE_MISMATCH: 3
  };

  const code = map[message] ?? 13;
  const details = message.toLowerCase().replaceAll("_", " ");

  const grpcError = new Error(details) as ServiceError;
  grpcError.code = code;
  grpcError.details = details;
  return grpcError;
};

const kindFromProto = (kind: string): ClipboardKind => {
  switch (kind) {
    case "CLIPBOARD_ITEM_TYPE_TEXT":
      return "text";
    case "CLIPBOARD_ITEM_TYPE_IMAGE":
      return "image";
    case "CLIPBOARD_ITEM_TYPE_FILE":
      return "file";
    default:
      return "text";
  }
};

const kindToProto = (kind: ClipboardKind): string => {
  switch (kind) {
    case "text":
      return "CLIPBOARD_ITEM_TYPE_TEXT";
    case "image":
      return "CLIPBOARD_ITEM_TYPE_IMAGE";
    case "file":
      return "CLIPBOARD_ITEM_TYPE_FILE";
  }
};

const toClipboardItem = (item: any): ClipboardItem => ({
  itemId: item.itemId,
  type: kindFromProto(item.type),
  sizeBytes: Number(item.sizeBytes),
  mime: item.mime,
  cipherRef: item.cipherRef,
  ciphertext: item.ciphertext ?? new Uint8Array(),
  nonce: item.nonce ?? new Uint8Array(),
  createdAtUnix: Number(item.createdAtUnix),
  sourceDeviceId: item.sourceDeviceId
});

const fromClipboardItem = (item: ClipboardItem): Record<string, unknown> => ({
  itemId: item.itemId,
  type: kindToProto(item.type),
  sizeBytes: item.sizeBytes,
  mime: item.mime,
  cipherRef: item.cipherRef,
  ciphertext: item.ciphertext,
  nonce: item.nonce,
  createdAtUnix: item.createdAtUnix,
  sourceDeviceId: item.sourceDeviceId
});

export const createHandlers = (store: SharePasteStore) => {
  const DeviceService = {
    RegisterDevice: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const result = store.registerDevice({
          deviceName: call.request.deviceName,
          platform: call.request.platform,
          pubkey: call.request.pubkey,
          groupId: call.request.groupId || undefined,
          recoveryPhrase: call.request.recoveryPhrase || undefined
        });

        callback(null, {
          device: result.device,
          groupId: result.groupId,
          recoveryPhrase: result.recoveryPhrase,
          createdNewGroup: result.createdNewGroup,
          sealedGroupKey: result.sealedGroupKey
        });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    ListDevices: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const devices = store.listDevices(call.request.deviceId);
        callback(null, { devices });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    RenameDevice: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const device = store.renameDevice(call.request.deviceId, call.request.newName);
        callback(null, { device });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    RemoveDevice: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const removed = store.removeDevice(call.request.requestDeviceId, call.request.targetDeviceId);
        callback(null, { removed });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    RecoverGroup: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const result = store.recoverGroup({
          recoveryPhrase: call.request.recoveryPhrase,
          deviceName: call.request.deviceName,
          platform: call.request.platform,
          pubkey: call.request.pubkey
        });
        callback(null, {
          device: result.device,
          groupId: result.groupId,
          sealedGroupKey: result.sealedGroupKey
        });
      } catch (err) {
        callback(toError(err), null);
      }
    }
  };

  const PairingService = {
    CreateBindCode: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const bindCode = store.createBindCode(call.request.deviceId);
        callback(null, {
          code: bindCode.code,
          expiresAtUnix: bindCode.expiresAtUnix,
          attemptsLeft: bindCode.attemptsLeft
        });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    RequestBind: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const bind = store.requestBind(call.request.code, call.request.requesterDeviceId);
        const devices = store.listDevices(bind.issuerDeviceId);
        const issuer = devices.find((device) => device.deviceId === bind.issuerDeviceId);
        callback(null, {
          requestId: bind.requestId,
          issuerDevice: issuer,
          expiresAtUnix: bind.expiresAtUnix
        });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    ConfirmBind: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const confirmation = store.confirmBind(call.request.requestId, call.request.issuerDeviceId, Boolean(call.request.approve));
        callback(null, {
          approved: Boolean(confirmation.approved),
          groupId: confirmation.groupId ?? "",
          sealedGroupKey: confirmation.sealedGroupKey ?? ""
        });
      } catch (err) {
        callback(toError(err), null);
      }
    }
  };

  const PolicyService = {
    GetPolicy: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const policy = store.getPolicy(call.request.deviceId);
        callback(null, { policy });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    UpdatePolicy: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const policy = store.updatePolicy(call.request.deviceId, Number(call.request.expectedVersion), {
          allowText: Boolean(call.request.allowText),
          allowImage: Boolean(call.request.allowImage),
          allowFile: Boolean(call.request.allowFile),
          maxFileSizeBytes: Number(call.request.maxFileSizeBytes)
        });
        callback(null, { policy });
      } catch (err) {
        callback(toError(err), null);
      }
    }
  };

  const SyncService = {
    OpenEventStream: (call: ServerDuplexStream<any, any>): void => {
      let connectedDeviceId: string | undefined;

      call.on("data", (message: EnvelopeMessage) => {
        try {
          if (message.hello) {
            connectedDeviceId = message.hello.deviceId;
            store.openPresence(message.hello.deviceId, message.hello.lanAddr, (event) => {
              if (event.type === "connected") {
                call.write({ connected: event.payload });
                return;
              }

              if (event.type === "clipboard") {
                call.write({
                  clipboard: {
                    item: fromClipboardItem(event.payload as ClipboardItem),
                    preferredLanTargets: []
                  }
                });
                return;
              }

              call.write({ pairingRequest: event.payload });
            });
            return;
          }

          if (message.ack && connectedDeviceId) {
            store.ackItem(connectedDeviceId, message.ack.itemId);
          }
        } catch (err) {
          call.emit("error", toError(err));
        }
      });

      call.on("end", () => {
        if (connectedDeviceId) {
          store.closePresence(connectedDeviceId);
        }
        call.end();
      });

      call.on("error", () => {
        if (connectedDeviceId) {
          store.closePresence(connectedDeviceId);
        }
      });
    },

    PushClipboardItem: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const result = store.pushClipboardItem(call.request.deviceId, toClipboardItem(call.request.item));
        callback(null, { accepted: result.accepted });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    AckItem: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const acknowledged = store.ackItem(call.request.deviceId, call.request.itemId);
        callback(null, { acknowledged });
      } catch (err) {
        callback(toError(err), null);
      }
    },

    FetchOffline: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      try {
        const items = store.fetchOffline(call.request.deviceId, Number(call.request.limit || 100)).map(fromClipboardItem);
        callback(null, { items });
      } catch (err) {
        callback(toError(err), null);
      }
    }
  };

  return {
    DeviceService,
    PairingService,
    PolicyService,
    SyncService
  };
};
