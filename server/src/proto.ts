import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GrpcObject } from "@grpc/grpc-js";
import { loadPackageDefinition } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const protoCandidates = [
  path.resolve(__dirname, "../../proto/sharepaste.proto"),
  path.resolve(__dirname, "../../../proto/sharepaste.proto")
];

const protoPath = protoCandidates.find((candidate) => existsSync(candidate));
if (!protoPath) {
  throw new Error("sharepaste.proto not found");
}

const packageDefinition = loadSync(protoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

export const grpcPackage = loadPackageDefinition(packageDefinition) as GrpcObject & {
  sharepaste: {
    v1: {
      DeviceService: unknown;
      PairingService: unknown;
      PolicyService: unknown;
      SyncService: unknown;
    };
  };
};
