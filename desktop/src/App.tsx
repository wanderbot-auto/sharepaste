import { invoke } from "@tauri-apps/api/core";
import { FormEvent, useEffect, useMemo, useState } from "react";

type DeviceState = {
  deviceId: string;
  groupId: string;
  deviceName: string;
  recoveryPhrase: string;
};

type BindCode = {
  code: string;
  expiresAtUnix: string;
  attemptsLeft: number;
};

type SharePolicy = {
  allowText: boolean;
  allowImage: boolean;
  allowFile: boolean;
  maxFileSizeBytes: number;
  version: number;
};

type DeviceInfo = {
  deviceId: string;
  name: string;
  platform: string;
  groupId: string;
};

type SyncStatus = {
  running: boolean;
  pid?: number;
};

type CliOptions = {
  server: string;
  statePath: string | null;
  deviceName: string | null;
};

const toDateText = (unix: string): string => {
  const numeric = Number(unix);
  if (Number.isNaN(numeric)) {
    return unix;
  }
  return new Date(numeric * 1000).toLocaleString();
};

export function App() {
  const [server, setServer] = useState("127.0.0.1:50051");
  const [statePath, setStatePath] = useState("");
  const [deviceName, setDeviceName] = useState("my-desktop");

  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [policy, setPolicy] = useState<SharePolicy | null>(null);
  const [bindCode, setBindCode] = useState<BindCode | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ running: false });

  const [bindInputCode, setBindInputCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [removeTargetId, setRemoveTargetId] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [textToSend, setTextToSend] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileMime, setFileMime] = useState("application/octet-stream");

  const [message, setMessage] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const options = useMemo<CliOptions>(
    () => ({
      server,
      statePath: statePath.trim() || null,
      deviceName: deviceName.trim() || null
    }),
    [server, statePath, deviceName]
  );

  const runAction = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage(`Error: ${text}`);
    } finally {
      setBusy(false);
    }
  };

  const refreshSyncStatus = async () => {
    const next = await invoke<SyncStatus>("sync_status");
    setSyncStatus(next);
  };

  useEffect(() => {
    refreshSyncStatus().catch(() => {
      setSyncStatus({ running: false });
    });

    const timer = window.setInterval(() => {
      refreshSyncStatus().catch(() => {
        // Ignore transient errors while polling status.
      });
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const initializeDevice = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!deviceName.trim()) {
      setMessage("Please enter a device name.");
      return;
    }

    await runAction(async () => {
      const state = await invoke<DeviceState>("init_device", { options });
      setDeviceState(state);
      setMessage(`Initialized ${state.deviceId}`);
    });
  };

  const loadDevices = async () => {
    await runAction(async () => {
      const response = await invoke<{ devices: DeviceInfo[] }>("list_devices", { options });
      setDevices(response.devices);
      setMessage(`Loaded ${response.devices.length} devices`);
    });
  };

  const removeDevice = async () => {
    if (!removeTargetId.trim()) {
      setMessage("Enter target device id to remove.");
      return;
    }

    await runAction(async () => {
      const result = await invoke<{ removed: boolean }>("remove_device", {
        options,
        targetDeviceId: removeTargetId.trim()
      });
      const response = await invoke<{ devices: DeviceInfo[] }>("list_devices", { options });
      setDevices(response.devices);
      setMessage(result.removed ? "Device removed from group" : "Device removal failed");
    });
  };

  const loadPolicy = async () => {
    await runAction(async () => {
      const next = await invoke<SharePolicy>("get_policy", { options });
      setPolicy(next);
      setMessage(`Policy v${next.version} loaded`);
    });
  };

  const savePolicy = async () => {
    if (!policy) {
      setMessage("Load policy first.");
      return;
    }

    await runAction(async () => {
      const next = await invoke<SharePolicy>("update_policy", { options, policy });
      setPolicy(next);
      setMessage(`Policy updated to v${next.version}`);
    });
  };

  const generateBindCode = async () => {
    await runAction(async () => {
      const code = await invoke<BindCode>("create_bind_code", { options });
      setBindCode(code);
      setMessage(`Bind code ${code.code} created`);
    });
  };

  const requestBind = async () => {
    if (!bindInputCode.trim()) {
      setMessage("Enter a 6-digit code first.");
      return;
    }

    await runAction(async () => {
      const response = await invoke<{ requestId: string; expiresAtUnix: string }>("request_bind", {
        options,
        code: bindInputCode.trim()
      });
      setRequestId(response.requestId);
      setMessage(`Bind request ${response.requestId} sent`);
    });
  };

  const confirmBind = async (approve: boolean) => {
    if (!requestId.trim()) {
      setMessage("Enter request id first.");
      return;
    }

    await runAction(async () => {
      const response = await invoke<{ approved: boolean; groupId: string }>("confirm_bind", {
        options,
        requestId: requestId.trim(),
        approve
      });
      setMessage(response.approved ? `Request approved into ${response.groupId}` : "Request rejected");
    });
  };

  const sendText = async () => {
    if (!textToSend.trim()) {
      setMessage("Text cannot be empty.");
      return;
    }

    await runAction(async () => {
      const response = await invoke<{ accepted: boolean }>("send_text", { options, value: textToSend });
      setMessage(response.accepted ? "Text sent" : "Text blocked by policy");
    });
  };

  const sendFile = async (asImage: boolean) => {
    if (!filePath.trim()) {
      setMessage("File path cannot be empty.");
      return;
    }

    await runAction(async () => {
      const response = await invoke<{ accepted: boolean }>("send_file", {
        options,
        path: filePath,
        mime: fileMime,
        asImage
      });
      setMessage(response.accepted ? "Binary payload sent" : "Binary payload blocked by policy");
    });
  };

  const recoverGroup = async () => {
    if (!recoveryPhrase.trim()) {
      setMessage("Recovery phrase cannot be empty.");
      return;
    }

    if (!deviceName.trim()) {
      setMessage("Device name is required for recovery.");
      return;
    }

    await runAction(async () => {
      const state = await invoke<DeviceState>("recover_group", {
        options,
        phrase: recoveryPhrase.trim()
      });
      setDeviceState(state);
      setMessage(`Recovered into group ${state.groupId}`);
    });
  };

  const startSync = async () => {
    await runAction(async () => {
      const status = await invoke<SyncStatus>("start_sync", { options });
      setSyncStatus(status);
      setMessage(status.running ? "Realtime sync started" : "Unable to start realtime sync");
    });
  };

  const stopSync = async () => {
    await runAction(async () => {
      const status = await invoke<SyncStatus>("stop_sync");
      setSyncStatus(status);
      setMessage("Realtime sync stopped");
    });
  };

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">SharePaste Desktop Shell</p>
          <h1>Cross-device clipboard control center</h1>
          <p className="subtitle">Tauri UI powered by your existing SharePaste client core.</p>
        </div>
        <div className={`status-pill ${syncStatus.running ? "live" : "idle"}`}>
          {syncStatus.running ? `Sync live (PID ${syncStatus.pid ?? "?"})` : "Sync offline"}
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <h2>Connection</h2>
          <form onSubmit={initializeDevice} className="stack">
            <label>
              Server
              <input value={server} onChange={(event) => setServer(event.target.value)} />
            </label>
            <label>
              Device name
              <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
            </label>
            <label>
              State path (optional)
              <input
                value={statePath}
                onChange={(event) => setStatePath(event.target.value)}
                placeholder="C:\\Users\\you\\.sharepaste\\state.json"
              />
            </label>
            <label>
              Recovery phrase (optional)
              <input value={recoveryPhrase} onChange={(event) => setRecoveryPhrase(event.target.value)} />
            </label>
            <div className="actions">
              <button type="submit" disabled={busy}>
                Initialize
              </button>
              <button type="button" onClick={recoverGroup} disabled={busy}>
                Recover Group
              </button>
              <button type="button" onClick={startSync} disabled={busy || syncStatus.running}>
                Start Sync
              </button>
              <button type="button" onClick={stopSync} disabled={busy || !syncStatus.running}>
                Stop Sync
              </button>
            </div>
          </form>

          {deviceState && (
            <div className="panel">
              <p>
                <strong>Device:</strong> {deviceState.deviceId}
              </p>
              <p>
                <strong>Group:</strong> {deviceState.groupId}
              </p>
              <p>
                <strong>Recovery phrase:</strong> {deviceState.recoveryPhrase}
              </p>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Devices + Policy</h2>
          <div className="actions">
            <button onClick={loadDevices} disabled={busy}>
              Refresh Devices
            </button>
            <button onClick={loadPolicy} disabled={busy}>
              Load Policy
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Platform</th>
                  <th>Device ID</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.deviceId}>
                    <td>{device.name}</td>
                    <td>{device.platform}</td>
                    <td>{device.deviceId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {policy && (
            <div className="stack">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={policy.allowText}
                  onChange={(event) => setPolicy({ ...policy, allowText: event.target.checked })}
                />
                Allow Text
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={policy.allowImage}
                  onChange={(event) => setPolicy({ ...policy, allowImage: event.target.checked })}
                />
                Allow Image
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={policy.allowFile}
                  onChange={(event) => setPolicy({ ...policy, allowFile: event.target.checked })}
                />
                Allow File
              </label>
              <label>
                Max file bytes
                <input
                  type="number"
                  value={policy.maxFileSizeBytes}
                  onChange={(event) =>
                    setPolicy({
                      ...policy,
                      maxFileSizeBytes: Number(event.target.value) || 1
                    })
                  }
                />
              </label>
              <button onClick={savePolicy} disabled={busy}>
                Save Policy (v{policy.version})
              </button>
              <label>
                Remove device by ID
                <input value={removeTargetId} onChange={(event) => setRemoveTargetId(event.target.value)} />
              </label>
              <button className="muted" onClick={removeDevice} disabled={busy}>
                Remove Device
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Binding</h2>
          <div className="actions">
            <button onClick={generateBindCode} disabled={busy}>
              Generate 6-digit code
            </button>
          </div>
          {bindCode && (
            <div className="panel bind-code">
              <p className="code">{bindCode.code}</p>
              <p>Expires: {toDateText(bindCode.expiresAtUnix)}</p>
              <p>Attempts left: {bindCode.attemptsLeft}</p>
            </div>
          )}

          <div className="stack">
            <label>
              Enter code to request bind
              <input value={bindInputCode} onChange={(event) => setBindInputCode(event.target.value)} />
            </label>
            <button onClick={requestBind} disabled={busy}>
              Send Bind Request
            </button>
            <label>
              Request ID to confirm
              <input value={requestId} onChange={(event) => setRequestId(event.target.value)} />
            </label>
            <div className="actions">
              <button onClick={() => confirmBind(true)} disabled={busy}>
                Approve Request
              </button>
              <button className="muted" onClick={() => confirmBind(false)} disabled={busy}>
                Reject Request
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Send Clipboard Payload</h2>
          <div className="stack">
            <label>
              Text
              <textarea value={textToSend} onChange={(event) => setTextToSend(event.target.value)} rows={4} />
            </label>
            <button onClick={sendText} disabled={busy}>
              Send Text
            </button>
            <label>
              File path
              <input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="C:\\tmp\\share.bin" />
            </label>
            <label>
              MIME type
              <input value={fileMime} onChange={(event) => setFileMime(event.target.value)} />
            </label>
            <div className="actions">
              <button onClick={() => sendFile(false)} disabled={busy}>
                Send File
              </button>
              <button onClick={() => sendFile(true)} disabled={busy}>
                Send Image
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot-note">{message}</footer>
    </div>
  );
}
