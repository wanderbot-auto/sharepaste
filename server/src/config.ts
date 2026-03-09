export interface ServerConfig {
  host: string;
  port: number;
  storageMode: "memory" | "durable";
  databaseUrl: string;
  redisUrl: string;
}

const parseStorageMode = (value: string | undefined): "memory" | "durable" => {
  if (value === "durable" || value === "postgres") {
    return "durable";
  }
  return "memory";
};

export const loadConfig = (): ServerConfig => {
  return {
    host: process.env.SHAREPASTE_HOST ?? "0.0.0.0",
    port: Number(process.env.SHAREPASTE_PORT ?? 50052),
    storageMode: parseStorageMode(process.env.SHAREPASTE_STORAGE_MODE),
    databaseUrl: process.env.SHAREPASTE_DATABASE_URL ?? "postgres://sharepaste:sharepaste@127.0.0.1:5432/sharepaste",
    redisUrl: process.env.SHAREPASTE_REDIS_URL ?? "redis://127.0.0.1:6379"
  };
};
