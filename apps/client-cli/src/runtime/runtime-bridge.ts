#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";
import type { ClientEventHandlers, LoggerPort } from "../core/ports.js";
import { SharePasteClient } from "../core/sharepaste-client.js";
import { StateStore } from "../core/state-store.js";
import { snapshotState, type BridgeEvent, type BridgeFailure, type BridgeRequest, type BridgeSuccess } from "./bridge-protocol.js";
import { ExternalClipboardPort } from "./external-clipboard-port.js";

interface RuntimeOptions {
  server: string;
  statePath?: string;
  defaultName: string;
  resetStaleState: boolean;
}

const parseArgs = (): RuntimeOptions => {
  const args = process.argv.slice(2);
  let server = process.env.SHAREPASTE_SERVER ?? "127.0.0.1:50052";
  let statePath = process.env.SHAREPASTE_STATE_PATH;
  let defaultName = process.env.SHAREPASTE_DEVICE_NAME ?? `sharepaste-${process.platform}`;
  let resetStaleState = /^(1|true)$/i.test(process.env.SHAREPASTE_RESET_STALE_STATE ?? "");

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--server" && next) {
      server = next;
      index += 1;
      continue;
    }

    if (arg === "--state" && next) {
      statePath = next;
      index += 1;
      continue;
    }

    if (arg === "--name" && next) {
      defaultName = next;
      index += 1;
      continue;
    }

    if (arg === "--reset-stale-state") {
      resetStaleState = true;
    }
  }

  return {
    server,
    statePath,
    defaultName,
    resetStaleState
  };
};

const options = parseArgs();
const stateStore = new StateStore(options.statePath);

const writeLine = (payload: unknown): void => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

const emitEvent = <T>(event: string, payload: T): void => {
  const message: BridgeEvent<T> = { event, payload };
  writeLine(message);
};

const clipboard = new ExternalClipboardPort({
  onWriteText(value) {
    emitEvent("clipboard_write_request", {
      kind: "text",
      value
    });
  }
});

const events: ClientEventHandlers = {
  onIncomingClipboard(event) {
    emitEvent("incoming_clipboard", event);
  },
  onPairingRequest(event) {
    emitEvent("pairing_request", event);
  }
};

const logger: LoggerPort = {
  info(message) {
    emitEvent("log", { level: "info", message });
  },
  warn(message) {
    emitEvent("log", { level: "warn", message });
  },
  error(message, error) {
    emitEvent("log", {
      level: "error",
      message,
      detail: error instanceof Error ? error.message : error ? String(error) : undefined
    });
  }
};

const client = new SharePasteClient(
  {
    grpcAddress: options.server,
    statePath: options.statePath,
    resetStaleState: options.resetStaleState
  },
  {
    clipboard,
    events,
    logger,
    platform: () => "windows"
  }
);

let ready = false;
let realtimeRunning = false;

const ensureReady = async (): Promise<void> => {
  if (ready) {
    return;
  }

  const existing = await stateStore.load();
  if (!existing) {
    throw new Error("CLIENT_NOT_INITIALIZED");
  }

  await client.bootstrap(existing.deviceName || options.defaultName);
  ready = true;
};

const withSnapshot = () => {
  const state = client.requireState();
  return snapshotState(state);
};

const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  async inspectState() {
    const state = await stateStore.load();
    return state ? snapshotState(state) : null;
  },
  async bootstrap(params) {
    const name = typeof params.deviceName === "string" && params.deviceName.trim() ? params.deviceName.trim() : options.defaultName;
    const state = await client.bootstrap(name);
    ready = true;
    return snapshotState(state);
  },
  async recover(params) {
    const phrase = typeof params.phrase === "string" ? params.phrase.trim() : "";
    const deviceName = typeof params.deviceName === "string" && params.deviceName.trim() ? params.deviceName.trim() : options.defaultName;
    if (!phrase) {
      throw new Error("recovery phrase is required");
    }
    const state = await client.recoverGroup(phrase, deviceName);
    ready = true;
    return snapshotState(state);
  },
  async getState() {
    await ensureReady();
    return withSnapshot();
  },
  async listDevices() {
    await ensureReady();
    return { devices: await client.listDevices() };
  },
  async removeDevice(params) {
    await ensureReady();
    const targetDeviceId = typeof params.targetDeviceId === "string" ? params.targetDeviceId.trim() : "";
    if (!targetDeviceId) {
      throw new Error("targetDeviceId is required");
    }
    return { removed: await client.removeDevice(targetDeviceId) };
  },
  async getPolicy() {
    await ensureReady();
    return await client.getPolicy();
  },
  async updatePolicy(params) {
    await ensureReady();
    await client.updatePolicy({
      allowText: Boolean(params.allowText),
      allowImage: Boolean(params.allowImage),
      allowFile: Boolean(params.allowFile),
      maxFileSizeBytes: Number(params.maxFileSizeBytes)
    });
    return await client.getPolicy();
  },
  async createBindCode() {
    await ensureReady();
    return await client.createBindCode();
  },
  async requestBind(params) {
    await ensureReady();
    const code = typeof params.code === "string" ? params.code.trim() : "";
    if (!code) {
      throw new Error("code is required");
    }
    return await client.requestBind(code);
  },
  async confirmBind(params) {
    await ensureReady();
    const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
    if (!requestId) {
      throw new Error("requestId is required");
    }
    return await client.confirmBind(requestId, Boolean(params.approve));
  },
  async startRealtime() {
    await ensureReady();
    if (!realtimeRunning) {
      await client.startRealtime();
      realtimeRunning = true;
    }
    return { running: realtimeRunning, state: withSnapshot() };
  },
  async stopRealtime() {
    if (realtimeRunning) {
      await client.stopRealtime();
      realtimeRunning = false;
    }
    return { running: realtimeRunning };
  },
  async sendText(params) {
    await ensureReady();
    const value = typeof params.value === "string" ? params.value : "";
    return { accepted: await client.sendText(value) };
  },
  async sendFile(params) {
    await ensureReady();
    const filePath = typeof params.path === "string" ? params.path : "";
    if (!filePath) {
      throw new Error("path is required");
    }
    const mime = typeof params.mime === "string" && params.mime ? params.mime : "application/octet-stream";
    return { accepted: await client.sendFile(filePath, mime, false) };
  },
  async sendImage(params) {
    await ensureReady();
    const filePath = typeof params.path === "string" ? params.path : "";
    if (!filePath) {
      throw new Error("path is required");
    }
    const mime = typeof params.mime === "string" && params.mime ? params.mime : "image/png";
    return { accepted: await client.sendFile(filePath, mime, true) };
  },
  async notifyClipboardChange(params) {
    await ensureReady();
    if (params.kind === "text") {
      const value = typeof params.value === "string" ? params.value : "";
      await clipboard.emit({ kind: "text", value });
      return { accepted: true };
    }

    if (params.kind === "image") {
      const filePath = typeof params.filePath === "string" ? params.filePath : "";
      if (!filePath) {
        throw new Error("filePath is required for image clipboard changes");
      }
      const mime = typeof params.mime === "string" && params.mime ? params.mime : "image/png";
      await clipboard.emit({ kind: "image", filePath, mime });
      return { accepted: true };
    }

    throw new Error("unsupported clipboard change");
  },
  async shutdown() {
    if (realtimeRunning) {
      await client.stopRealtime();
      realtimeRunning = false;
    }
    return { stopped: true };
  }
};

const handleRequest = async (request: BridgeRequest): Promise<void> => {
  const handler = handlers[request.method];
  if (!handler) {
    const response: BridgeFailure = {
      id: request.id,
      ok: false,
      error: `unknown method: ${request.method}`
    };
    writeLine(response);
    return;
  }

  try {
    const result = await handler(request.params ?? {});
    const response: BridgeSuccess = {
      id: request.id,
      ok: true,
      result
    };
    writeLine(response);

    if (request.method === "shutdown") {
      process.exit(0);
    }
  } catch (error) {
    const response: BridgeFailure = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    writeLine(response);
  }
};

const input = readline.createInterface({
  input: process.stdin,
  terminal: false
});

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let request: BridgeRequest;
  try {
    request = JSON.parse(trimmed) as BridgeRequest;
  } catch (error) {
    emitEvent("log", {
      level: "error",
      message: "invalid bridge request",
      detail: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  void handleRequest(request);
});

const shutdown = async () => {
  if (realtimeRunning) {
    await client.stopRealtime().catch(() => undefined);
  }
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

process.stdin.on("end", () => {
  void shutdown().finally(() => process.exit(0));
});
