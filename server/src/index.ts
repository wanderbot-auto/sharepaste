import { Server, ServerCredentials } from "@grpc/grpc-js";
import { grpcPackage } from "./proto.js";
import { createHandlers } from "./services/handlers.js";
import { SharePasteStore } from "./store/sharepaste-store.js";

export const createGrpcServer = (): Server => {
  const server = new Server();
  const store = new SharePasteStore();
  const handlers = createHandlers(store);

  const v1 = grpcPackage.sharepaste.v1;
  server.addService((v1.DeviceService as any).service, handlers.DeviceService);
  server.addService((v1.PairingService as any).service, handlers.PairingService);
  server.addService((v1.PolicyService as any).service, handlers.PolicyService);
  server.addService((v1.SyncService as any).service, handlers.SyncService);
  return server;
};

const port = Number(process.env.SHAREPASTE_PORT ?? 50051);
const host = process.env.SHAREPASTE_HOST ?? "0.0.0.0";

if (process.env.NODE_ENV !== "test") {
  const server = createGrpcServer();
  server.bindAsync(`${host}:${port}`, ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error("failed to start gRPC server", err);
      process.exit(1);
    }
    server.start();
    console.log(`sharepaste server listening on ${host}:${port}`);
  });
}
