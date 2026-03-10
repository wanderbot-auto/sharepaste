import type { sendUnaryData, ServerDuplexStream, ServerUnaryCall, ServiceError } from "@grpc/grpc-js";
import type { ClipboardItem, ClipboardKind } from "../types.js";
import type { SharePasteStoreApi } from "../store/contracts.js";

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
    SOURCE_DEVICE_MISMATCH: 3,
    RATE_LIMITED: 8
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

const runUnary = async <T>(callback: sendUnaryData<any>, work: () => Promise<T>): Promise<void> => {
  try {
    const payload = await work();
    callback(null, payload);
  } catch (err) {
    callback(toError(err), null);
  }
};

export const createHandlers = (store: SharePasteStoreApi) => {
  const DeviceService = {
    RegisterDevice: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const result = await store.registerDevice({
          deviceName: call.request.deviceName,
          platform: call.request.platform,
          pubkey: call.request.pubkey,
          groupId: call.request.groupId || undefined,
          recoveryPhrase: call.request.recoveryPhrase || undefined
        });

        return {
          device: result.device,
          groupId: result.groupId,
          recoveryPhrase: result.recoveryPhrase,
          createdNewGroup: result.createdNewGroup,
          sealedGroupKey: result.sealedGroupKey
        };
      });
    },

    GetDeviceContext: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const context = await store.getDeviceContext(call.request.deviceId);
        return {
          device: context.device,
          groupId: context.groupId,
          sealedGroupKey: context.sealedGroupKey,
          groupKeyVersion: context.groupKeyVersion
        };
      });
    },

    ListDevices: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const devices = await store.listDevices(call.request.deviceId);
        return { devices };
      });
    },

    RenameDevice: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const device = await store.renameDevice(call.request.deviceId, call.request.newName);
        return { device };
      });
    },

    RemoveDevice: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const removed = await store.removeDevice(call.request.requestDeviceId, call.request.targetDeviceId);
        return { removed };
      });
    },

    RecoverGroup: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const result = await store.recoverGroup({
          recoveryPhrase: call.request.recoveryPhrase,
          deviceName: call.request.deviceName,
          platform: call.request.platform,
          pubkey: call.request.pubkey
        });

        return {
          device: result.device,
          groupId: result.groupId,
          sealedGroupKey: result.sealedGroupKey
        };
      });
    }
  };

  const PairingService = {
    CreateBindCode: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const bindCode = await store.createBindCode(call.request.deviceId);
        return {
          code: bindCode.code,
          expiresAtUnix: bindCode.expiresAtUnix,
          attemptsLeft: bindCode.attemptsLeft
        };
      });
    },

    RequestBind: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const bind = await store.requestBind(call.request.code, call.request.requesterDeviceId);
        const devices = await store.listDevices(bind.issuerDeviceId);
        const issuer = devices.find((device) => device.deviceId === bind.issuerDeviceId);
        return {
          requestId: bind.requestId,
          issuerDevice: issuer,
          expiresAtUnix: bind.expiresAtUnix
        };
      });
    },

    ConfirmBind: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const confirmation = await store.confirmBind(call.request.requestId, call.request.issuerDeviceId, Boolean(call.request.approve));
        return {
          approved: Boolean(confirmation.approved),
          groupId: confirmation.groupId ?? "",
          sealedGroupKey: confirmation.sealedGroupKey ?? "",
          groupKeyVersion: Number(confirmation.groupKeyVersion ?? 0)
        };
      });
    }
  };

  const PolicyService = {
    GetPolicy: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const policy = await store.getPolicy(call.request.deviceId);
        return { policy };
      });
    },

    UpdatePolicy: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const policy = await store.updatePolicy(call.request.deviceId, Number(call.request.expectedVersion), {
          allowText: Boolean(call.request.allowText),
          allowImage: Boolean(call.request.allowImage),
          allowFile: Boolean(call.request.allowFile),
          maxFileSizeBytes: Number(call.request.maxFileSizeBytes)
        });
        return { policy };
      });
    }
  };

  const SyncService = {
    OpenEventStream: (call: ServerDuplexStream<any, any>): void => {
      let connectedDeviceId: string | undefined;

      call.on("data", (message: EnvelopeMessage) => {
        void (async () => {
          if (message.hello) {
            connectedDeviceId = message.hello.deviceId;
            await store.openPresence(message.hello.deviceId, message.hello.lanAddr, (event) => {
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

              if (event.type === "group_key_update") {
                call.write({ groupKeyUpdate: event.payload });
                return;
              }

              call.write({ pairingRequest: event.payload });
            });
            return;
          }

          if (message.ack && connectedDeviceId) {
            await store.ackItem(connectedDeviceId, message.ack.itemId);
          }
        })().catch((err: unknown) => {
          call.emit("error", toError(err));
        });
      });

      call.on("end", () => {
        void (async () => {
          if (connectedDeviceId) {
            await store.closePresence(connectedDeviceId);
          }
          call.end();
        })();
      });

      call.on("error", () => {
        if (connectedDeviceId) {
          void store.closePresence(connectedDeviceId);
        }
      });
    },

    PushClipboardItem: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const result = await store.pushClipboardItem(call.request.deviceId, toClipboardItem(call.request.item));
        return { accepted: result.accepted };
      });
    },

    AckItem: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const acknowledged = await store.ackItem(call.request.deviceId, call.request.itemId);
        return { acknowledged };
      });
    },

    FetchOffline: (call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>): void => {
      void runUnary(callback, async () => {
        const items = (await store.fetchOffline(call.request.deviceId, Number(call.request.limit || 100))).map(fromClipboardItem);
        return { items };
      });
    }
  };

  return {
    DeviceService,
    PairingService,
    PolicyService,
    SyncService
  };
};
