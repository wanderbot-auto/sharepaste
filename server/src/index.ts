import { Server, ServerCredentials } from "@grpc/grpc-js";
import { loadConfig } from "./config.js";
import { PostgresStatePersistence } from "./infrastructure/postgres-persistence.js";
import { RedisRuntimeSignals } from "./infrastructure/redis-runtime.js";
import { NoopRuntimeSignals } from "./infrastructure/noop.js";
import { grpcPackage } from "./proto.js";
import { createHandlers } from "./services/handlers.js";
import type { SharePasteStoreApi } from "./store/contracts.js";
import { DurableSharePasteStore } from "./store/durable-sharepaste-store.js";
import { SharePasteStore } from "./store/sharepaste-store.js";

interface MaybeClosable {
  close?: () => Promise<void>;
}

const buildStore = async (config: ReturnType<typeof loadConfig>): Promise<SharePasteStoreApi & MaybeClosable> => {
  if (config.storageMode === "durable") {
    const persistence = new PostgresStatePersistence(config.databaseUrl);
    const runtime = config.redisUrl ? new RedisRuntimeSignals(config.redisUrl) : new NoopRuntimeSignals();
    return DurableSharePasteStore.create(persistence, runtime);
  }

  return new SharePasteStore();
};

export const createGrpcServer = async (): Promise<{ server: Server; store: SharePasteStoreApi & MaybeClosable }> => {
  const config = loadConfig();
  const server = new Server();
  const store = await buildStore(config);
  const handlers = createHandlers(store);

  const v1 = grpcPackage.sharepaste.v1;
  server.addService((v1.DeviceService as any).service, handlers.DeviceService);
  server.addService((v1.PairingService as any).service, handlers.PairingService);
  server.addService((v1.PolicyService as any).service, handlers.PolicyService);
  server.addService((v1.SyncService as any).service, handlers.SyncService);

  return { server, store };
};

if (process.env.NODE_ENV !== "test") {
  const config = loadConfig();

  const boot = async () => {
    const { server, store } = await createGrpcServer();

    const shutdown = async () => {
      server.forceShutdown();
      await store.close?.();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });

    server.bindAsync(`${config.host}:${config.port}`, ServerCredentials.createInsecure(), (err) => {
      if (err) {
        console.error("failed to start gRPC server", err);
        process.exit(1);
      }
      server.start();
      console.log(`sharepaste server listening on ${config.host}:${config.port} (${config.storageMode})`);
    });
  };

  boot().catch((err) => {
    console.error("failed to bootstrap gRPC server", err);
    process.exit(1);
  });
}
