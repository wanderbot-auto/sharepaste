#!/usr/bin/env node
import { Command } from "commander";
import { SharePasteClient } from "./core/sharepaste-client.js";

interface RootOptions {
  server: string;
  state?: string;
  name?: string;
  json?: boolean;
}

const program = new Command();

program.name("sharepaste-client").description("SharePaste cross-platform clipboard client").version("0.1.0");

program
  .option("--server <address>", "gRPC endpoint", process.env.SHAREPASTE_SERVER ?? "127.0.0.1:50052")
  .option("--state <path>", "local state file path")
  .option("--name <name>", "default device display name")
  .option("--json", "print machine-readable JSON output", false);

const options = (): RootOptions => program.opts<RootOptions>();

const getClient = (): SharePasteClient => {
  const opts = options();
  return new SharePasteClient({ grpcAddress: opts.server, statePath: opts.state });
};

const emit = (data: unknown, humanPrinter: () => void): void => {
  if (options().json) {
    console.log(JSON.stringify(data));
    return;
  }
  humanPrinter();
};

const bootstrap = async (client: SharePasteClient, explicitName?: string) => {
  const fallbackName = options().name ?? `device-${process.platform}`;
  return client.bootstrap(explicitName ?? fallbackName);
};

program
  .command("init")
  .option("--name <name>", "device display name")
  .action(async (opts: { name?: string }) => {
    const client = getClient();
    const desiredName = opts.name ?? options().name;
    if (!desiredName) {
      throw new Error("device name is required via --name");
    }

    const state = await bootstrap(client, desiredName);
    emit(state, () => {
      console.log(`initialized device ${state.deviceId}`);
      console.log(`group: ${state.groupId}`);
      console.log(`recovery phrase: ${state.recoveryPhrase}`);
    });
  });

program.command("devices").action(async () => {
  const client = getClient();
  await bootstrap(client);
  const devices = await client.listDevices();

  emit({ devices }, () => {
    console.table(devices);
  });
});

program
  .command("remove-device")
  .requiredOption("--target-device-id <deviceId>", "device id to remove from group")
  .action(async (opts: { targetDeviceId: string }) => {
    const client = getClient();
    await bootstrap(client);
    const removed = await client.removeDevice(opts.targetDeviceId);
    emit({ removed }, () => {
      console.log(removed ? "removed" : "not_removed");
    });
  });

program
  .command("recover")
  .requiredOption("--phrase <phrase>", "recovery phrase")
  .option("--name <name>", "new device name")
  .action(async (opts: { phrase: string; name?: string }) => {
    const client = getClient();
    const recoverName = opts.name ?? options().name;
    if (!recoverName) {
      throw new Error("device name is required via --name");
    }
    const state = await client.recoverGroup(opts.phrase, recoverName);
    emit(state, () => {
      console.log(`recovered device ${state.deviceId}`);
      console.log(`group: ${state.groupId}`);
    });
  });

program.command("bind-code").action(async () => {
  const client = getClient();
  await bootstrap(client);
  const code = await client.createBindCode();

  emit(code, () => {
    console.log(`code=${code.code} expires_at=${code.expiresAtUnix} attempts_left=${code.attemptsLeft}`);
  });
});

program
  .command("bind-request")
  .requiredOption("--code <code>", "6-digit bind code")
  .action(async (opts: { code: string }) => {
    const client = getClient();
    await bootstrap(client);
    const req = await client.requestBind(opts.code);

    emit(req, () => {
      console.log(`request_id=${req.requestId} expires_at=${req.expiresAtUnix}`);
    });
  });

program
  .command("bind-confirm")
  .requiredOption("--request-id <requestId>", "request id")
  .option("--approve", "approve bind request", false)
  .action(async (opts: { requestId: string; approve?: boolean }) => {
    const client = getClient();
    await bootstrap(client);
    const result = await client.confirmBind(opts.requestId, Boolean(opts.approve));

    emit(result, () => {
      console.log(`approved=${result.approved} group=${result.groupId}`);
    });
  });

program.command("policy-get").action(async () => {
  const client = getClient();
  await bootstrap(client);
  const policy = await client.getPolicy();
  emit(policy, () => {
    console.table(policy);
  });
});

program
  .command("policy")
  .requiredOption("--allow-text <boolean>", "allow text")
  .requiredOption("--allow-image <boolean>", "allow image")
  .requiredOption("--allow-file <boolean>", "allow file")
  .requiredOption("--max-file-size <bytes>", "max file size in bytes")
  .action(async (opts: { allowText: string; allowImage: string; allowFile: string; maxFileSize: string }) => {
    const client = getClient();
    await bootstrap(client);
    await client.updatePolicy({
      allowText: opts.allowText === "true",
      allowImage: opts.allowImage === "true",
      allowFile: opts.allowFile === "true",
      maxFileSizeBytes: Number(opts.maxFileSize)
    });
    const policy = await client.getPolicy();

    emit(policy, () => {
      console.log("policy updated");
      console.table(policy);
    });
  });

program.command("run").action(async () => {
  const client = getClient();
  const state = await bootstrap(client);
  await client.startRealtime();

  emit({ status: "running", deviceId: state.deviceId }, () => {
    console.log("realtime sync started");
  });

  process.on("SIGINT", async () => {
    await client.stopRealtime();
    process.exit(0);
  });
});

program
  .command("send-text")
  .requiredOption("--value <value>", "text to send")
  .action(async (opts: { value: string }) => {
    const client = getClient();
    await bootstrap(client);
    const accepted = await client.sendText(opts.value);
    emit({ accepted }, () => {
      console.log(accepted ? "sent" : "blocked_by_policy");
    });
  });

program
  .command("send-file")
  .requiredOption("--path <path>", "file path")
  .option("--mime <mime>", "file mime", "application/octet-stream")
  .action(async (opts: { path: string; mime: string }) => {
    const client = getClient();
    await bootstrap(client);
    const accepted = await client.sendFile(opts.path, opts.mime, false);
    emit({ accepted }, () => {
      console.log(accepted ? "sent" : "blocked_by_policy");
    });
  });

program
  .command("send-image")
  .requiredOption("--path <path>", "image path")
  .option("--mime <mime>", "image mime", "image/png")
  .action(async (opts: { path: string; mime: string }) => {
    const client = getClient();
    await bootstrap(client);
    const accepted = await client.sendFile(opts.path, opts.mime, true);
    emit({ accepted }, () => {
      console.log(accepted ? "sent" : "blocked_by_policy");
    });
  });

program.parseAsync().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (options().json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(err);
  }
  process.exit(1);
});
