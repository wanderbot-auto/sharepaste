import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { credentials, loadPackageDefinition, type ClientDuplexStream } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import type { ClipboardPayload, SharePolicy } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const protoCandidates = [
  path.resolve(__dirname, "../../../proto/sharepaste.proto"),
  path.resolve(__dirname, "../../../../proto/sharepaste.proto")
];

const protoPath = protoCandidates.find((candidate) => existsSync(candidate));
if (!protoPath) {
  throw new Error("sharepaste.proto not found");
}

const packageDef = loadSync(protoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const proto = loadPackageDefinition(packageDef) as any;

const kindToProto = (kind: ClipboardPayload["type"]): string => {
  if (kind === "text") {
    return "CLIPBOARD_ITEM_TYPE_TEXT";
  }
  if (kind === "image") {
    return "CLIPBOARD_ITEM_TYPE_IMAGE";
  }
  return "CLIPBOARD_ITEM_TYPE_FILE";
};

const kindFromProto = (kind: string): ClipboardPayload["type"] => {
  if (kind === "CLIPBOARD_ITEM_TYPE_IMAGE") {
    return "image";
  }
  if (kind === "CLIPBOARD_ITEM_TYPE_FILE") {
    return "file";
  }
  return "text";
};

export interface RegisterDeviceResult {
  device: {
    deviceId: string;
    groupId: string;
    pubkey: string;
    name: string;
    platform: string;
  };
  groupId: string;
  recoveryPhrase: string;
  sealedGroupKey: string;
}

export interface RecoverGroupResult {
  device: {
    deviceId: string;
    groupId: string;
    pubkey: string;
    name: string;
    platform: string;
  };
  groupId: string;
  sealedGroupKey: string;
}

export class SharePasteGrpcClient {
  private readonly deviceClient: any;

  private readonly pairingClient: any;

  private readonly policyClient: any;

  private readonly syncClient: any;

  constructor(address: string) {
    const v1 = proto.sharepaste.v1;
    this.deviceClient = new v1.DeviceService(address, credentials.createInsecure());
    this.pairingClient = new v1.PairingService(address, credentials.createInsecure());
    this.policyClient = new v1.PolicyService(address, credentials.createInsecure());
    this.syncClient = new v1.SyncService(address, credentials.createInsecure());
  }

  registerDevice(input: {
    deviceName: string;
    platform: string;
    pubkey: string;
    groupId?: string;
    recoveryPhrase?: string;
  }): Promise<RegisterDeviceResult> {
    return new Promise((resolve, reject) => {
      this.deviceClient.RegisterDevice(input, (err: Error | null, response: RegisterDeviceResult) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  listDevices(deviceId: string): Promise<Array<{ deviceId: string; name: string; platform: string; groupId: string }>> {
    return new Promise((resolve, reject) => {
      this.deviceClient.ListDevices({ deviceId }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response.devices ?? []);
      });
    });
  }

  removeDevice(requestDeviceId: string, targetDeviceId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.deviceClient.RemoveDevice({ requestDeviceId, targetDeviceId }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(Boolean(response.removed));
      });
    });
  }

  recoverGroup(input: { recoveryPhrase: string; deviceName: string; platform: string; pubkey: string }): Promise<RecoverGroupResult> {
    return new Promise((resolve, reject) => {
      this.deviceClient.RecoverGroup(input, (err: Error | null, response: RecoverGroupResult) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  createBindCode(deviceId: string): Promise<{ code: string; expiresAtUnix: string; attemptsLeft: number }> {
    return new Promise((resolve, reject) => {
      this.pairingClient.CreateBindCode({ deviceId }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  requestBind(code: string, requesterDeviceId: string): Promise<{ requestId: string; expiresAtUnix: string }> {
    return new Promise((resolve, reject) => {
      this.pairingClient.RequestBind({ code, requesterDeviceId }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  confirmBind(requestId: string, issuerDeviceId: string, approve: boolean): Promise<{ approved: boolean; groupId: string }> {
    return new Promise((resolve, reject) => {
      this.pairingClient.ConfirmBind({ requestId, issuerDeviceId, approve }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  getPolicy(deviceId: string): Promise<SharePolicy> {
    return new Promise((resolve, reject) => {
      this.policyClient.GetPolicy({ deviceId }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          allowText: response.policy.allowText,
          allowImage: response.policy.allowImage,
          allowFile: response.policy.allowFile,
          maxFileSizeBytes: Number(response.policy.maxFileSizeBytes),
          version: Number(response.policy.version)
        });
      });
    });
  }

  updatePolicy(deviceId: string, policy: SharePolicy): Promise<SharePolicy> {
    return new Promise((resolve, reject) => {
      this.policyClient.UpdatePolicy(
        {
          deviceId,
          expectedVersion: policy.version,
          allowText: policy.allowText,
          allowImage: policy.allowImage,
          allowFile: policy.allowFile,
          maxFileSizeBytes: policy.maxFileSizeBytes
        },
        (err: Error | null, response: any) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({
            allowText: response.policy.allowText,
            allowImage: response.policy.allowImage,
            allowFile: response.policy.allowFile,
            maxFileSizeBytes: Number(response.policy.maxFileSizeBytes),
            version: Number(response.policy.version)
          });
        }
      );
    });
  }

  pushClipboardItem(deviceId: string, item: ClipboardPayload): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.syncClient.PushClipboardItem(
        {
          deviceId,
          item: {
            itemId: item.itemId,
            type: kindToProto(item.type),
            sizeBytes: item.sizeBytes,
            mime: item.mime,
            cipherRef: item.cipherRef,
            ciphertext: item.ciphertext,
            nonce: item.nonce,
            createdAtUnix: item.createdAtUnix,
            sourceDeviceId: item.sourceDeviceId
          }
        },
        (err: Error | null, response: any) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(Boolean(response.accepted));
        }
      );
    });
  }

  fetchOffline(deviceId: string, limit = 100): Promise<ClipboardPayload[]> {
    return new Promise((resolve, reject) => {
      this.syncClient.FetchOffline({ deviceId, limit }, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
          return;
        }

        const items = (response.items ?? []).map((item: any) => ({
          itemId: item.itemId,
          type: kindFromProto(item.type),
          mime: item.mime,
          sizeBytes: Number(item.sizeBytes),
          createdAtUnix: Number(item.createdAtUnix),
          sourceDeviceId: item.sourceDeviceId,
          cipherRef: item.cipherRef,
          ciphertext: item.ciphertext,
          nonce: item.nonce
        }));

        resolve(items);
      });
    });
  }

  openEventStream(deviceId: string, lanAddr: string | undefined): ClientDuplexStream<any, any> {
    const stream = this.syncClient.OpenEventStream();
    stream.write({ hello: { deviceId, lanAddr } });
    return stream;
  }

  ackItem(deviceId: string, itemId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.syncClient.AckItem({ deviceId, itemId }, (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
