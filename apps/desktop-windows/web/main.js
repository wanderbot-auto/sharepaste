const tauri = window.__TAURI__;

if (!tauri?.tauri || !tauri?.event) {
  document.body.innerHTML = "<main style='padding:24px;font-family:Segoe UI,sans-serif'>Tauri APIs are unavailable. Launch this UI through the SharePaste Windows shell.</main>";
  throw new Error("Tauri APIs unavailable");
}

const invoke = (command, payload = {}) => tauri.tauri.invoke(command, payload);
const listen = (event, handler) => tauri.event.listen(event, handler);

const state = {
  currentDevice: null,
  policy: null,
  devices: [],
  pairingRequests: [],
  bindCode: null,
  syncRunning: false,
  activity: [],
  clipboardPollingTimer: null,
  lastClipboardFingerprint: null,
  suppressedClipboardFingerprint: null
};

const el = {
  connectionDot: document.getElementById("connectionDot"),
  connectionLabel: document.getElementById("connectionLabel"),
  deviceHeadline: document.getElementById("deviceHeadline"),
  deviceSubline: document.getElementById("deviceSubline"),
  deviceNameInput: document.getElementById("deviceNameInput"),
  recoveryPhraseInput: document.getElementById("recoveryPhraseInput"),
  recoveryPhraseValue: document.getElementById("recoveryPhraseValue"),
  bindCodeValue: document.getElementById("bindCodeValue"),
  devicesList: document.getElementById("devicesList"),
  pairingRequestsList: document.getElementById("pairingRequestsList"),
  allowTextInput: document.getElementById("allowTextInput"),
  allowImageInput: document.getElementById("allowImageInput"),
  allowFileInput: document.getElementById("allowFileInput"),
  maxFileSizeInput: document.getElementById("maxFileSizeInput"),
  manualTextInput: document.getElementById("manualTextInput"),
  activityFeed: document.getElementById("activityFeed"),
  bindRequestInput: document.getElementById("bindRequestInput")
};

const addActivity = (level, message, detail) => {
  state.activity.unshift({
    level,
    message,
    detail: detail || "",
    createdAt: new Date().toLocaleTimeString()
  });
  state.activity = state.activity.slice(0, 80);
  renderActivity();
};

const bridge = async (method, params = {}) => {
  try {
    return await invoke("bridge_request", { method, params });
  } catch (error) {
    const message = error?.toString?.() ?? String(error);
    addActivity("error", `Bridge request failed: ${method}`, message);
    throw error;
  }
};

const setConnectionState = (connected, label) => {
  el.connectionDot.className = `status-dot ${connected ? "connected" : "disconnected"}`;
  el.connectionLabel.textContent = label;
};

const renderHeader = () => {
  if (!state.currentDevice) {
    el.deviceHeadline.textContent = "Not initialized";
    el.deviceSubline.textContent = "Initialize a device or recover an existing group to start syncing.";
    el.recoveryPhraseValue.textContent = "Not available";
    return;
  }

  el.deviceHeadline.textContent = `${state.currentDevice.deviceName} (${state.currentDevice.platform})`;
  el.deviceSubline.textContent = `Device ${state.currentDevice.deviceId} in group ${state.currentDevice.groupId}`;
  el.recoveryPhraseValue.textContent = state.currentDevice.recoveryPhrase || "Not available";
};

const renderDevices = () => {
  if (!state.devices.length) {
    el.devicesList.className = "stack muted";
    el.devicesList.textContent = "No devices loaded.";
    return;
  }

  el.devicesList.className = "stack";
  el.devicesList.innerHTML = state.devices
    .map(
      (device) => `
        <div class="device-row">
          <div>
            <strong>${device.name}</strong>
            <div class="muted small">${device.platform} · ${device.deviceId}</div>
          </div>
          <button class="ghost" data-remove-device="${device.deviceId}">Remove</button>
        </div>
      `
    )
    .join("");
};

const renderPairingRequests = () => {
  if (!state.pairingRequests.length) {
    el.pairingRequestsList.className = "stack muted";
    el.pairingRequestsList.textContent = "No pending requests.";
    return;
  }

  el.pairingRequestsList.className = "stack";
  el.pairingRequestsList.innerHTML = state.pairingRequests
    .map(
      (request) => `
        <div class="pairing-row">
          <div>
            <strong>${request.requesterName}</strong>
            <div class="muted small">${request.requesterPlatform} · request ${request.requestId}</div>
          </div>
          <div class="row">
            <button class="primary" data-confirm-pair="${request.requestId}">Approve</button>
            <button class="ghost" data-reject-pair="${request.requestId}">Reject</button>
          </div>
        </div>
      `
    )
    .join("");
};

const renderPolicy = () => {
  if (!state.policy) {
    return;
  }

  el.allowTextInput.checked = Boolean(state.policy.allowText);
  el.allowImageInput.checked = Boolean(state.policy.allowImage);
  el.allowFileInput.checked = Boolean(state.policy.allowFile);
  el.maxFileSizeInput.value = String(state.policy.maxFileSizeBytes);
};

const renderActivity = () => {
  if (!state.activity.length) {
    el.activityFeed.className = "activity-feed muted";
    el.activityFeed.textContent = "No activity yet.";
    return;
  }

  el.activityFeed.className = "activity-feed";
  el.activityFeed.innerHTML = state.activity
    .map(
      (entry) => `
        <div class="activity-row">
          <div class="activity-meta">${entry.level}<br />${entry.createdAt}</div>
          <div class="activity-message ${entry.level === "error" ? "danger" : ""}">${[entry.message, entry.detail].filter(Boolean).join("\n")}</div>
        </div>
      `
    )
    .join("");
};

const refreshDevices = async () => {
  if (!state.currentDevice) {
    return;
  }
  const result = await bridge("listDevices");
  state.devices = result.devices ?? [];
  renderDevices();
};

const refreshPolicy = async () => {
  if (!state.currentDevice) {
    return;
  }
  state.policy = await bridge("getPolicy");
  renderPolicy();
};

const ensureRealtime = async () => {
  if (!state.currentDevice || state.syncRunning) {
    return;
  }

  await bridge("startRealtime");
  state.syncRunning = true;
  setConnectionState(true, "Running");
  addActivity("info", "Realtime sync started");
  startClipboardPolling();
};

const stopRealtime = async () => {
  if (!state.syncRunning) {
    return;
  }
  await bridge("stopRealtime");
  state.syncRunning = false;
  setConnectionState(false, "Stopped");
  addActivity("warn", "Realtime sync stopped");
  stopClipboardPolling();
};

const startClipboardPolling = () => {
  if (state.clipboardPollingTimer) {
    return;
  }

  state.clipboardPollingTimer = window.setInterval(async () => {
    if (!state.syncRunning) {
      return;
    }

    try {
      const snapshot = await invoke("read_clipboard_snapshot");
      if (!snapshot?.fingerprint) {
        return;
      }

      if (snapshot.fingerprint === state.lastClipboardFingerprint) {
        return;
      }

      state.lastClipboardFingerprint = snapshot.fingerprint;
      if (snapshot.fingerprint === state.suppressedClipboardFingerprint) {
        state.suppressedClipboardFingerprint = null;
        return;
      }

      if (snapshot.kind === "text" && snapshot.text) {
        await bridge("notifyClipboardChange", { kind: "text", value: snapshot.text });
      }

      if (snapshot.kind === "image" && snapshot.path) {
        await bridge("notifyClipboardChange", {
          kind: "image",
          filePath: snapshot.path,
          mime: snapshot.mime || "image/png"
        });
      }
    } catch (error) {
      addActivity("error", "Clipboard polling failed", error?.toString?.() ?? String(error));
    }
  }, 800);
};

const stopClipboardPolling = () => {
  if (!state.clipboardPollingTimer) {
    return;
  }
  window.clearInterval(state.clipboardPollingTimer);
  state.clipboardPollingTimer = null;
};

const handleIncomingClipboard = async (payload) => {
  addActivity("info", `Received ${payload.type} from ${payload.sourceDeviceId}`, payload.savedPath || payload.text || "");

  if (payload.type === "text" && payload.text) {
    const snapshot = await invoke("write_text_clipboard", { value: payload.text });
    state.suppressedClipboardFingerprint = snapshot.fingerprint;
    return;
  }

  if (payload.type === "image" && payload.savedPath) {
    const snapshot = await invoke("write_image_clipboard", { path: payload.savedPath });
    state.suppressedClipboardFingerprint = snapshot.fingerprint;
  }
};

const handleBridgeEvent = async (event) => {
  const payload = event.payload;
  if (!payload || typeof payload !== "object") {
    return;
  }

  if (payload.event === "log") {
    addActivity(payload.payload.level, payload.payload.message, payload.payload.detail);
    return;
  }

  if (payload.event === "pairing_request") {
    state.pairingRequests.unshift(payload.payload);
    renderPairingRequests();
    addActivity("info", `Pairing request from ${payload.payload.requesterName}`, payload.payload.requestId);
    return;
  }

  if (payload.event === "clipboard_write_request") {
    const snapshot = await invoke("write_text_clipboard", { value: payload.payload.value });
    state.suppressedClipboardFingerprint = snapshot.fingerprint;
    return;
  }

  if (payload.event === "incoming_clipboard") {
    await handleIncomingClipboard(payload.payload);
  }
};

const loadExistingState = async () => {
  const existing = await bridge("inspectState");
  if (!existing) {
    renderHeader();
    renderDevices();
    renderPairingRequests();
    renderActivity();
    setConnectionState(false, "Setup Required");
    return;
  }

  state.currentDevice = existing;
  renderHeader();
  setConnectionState(false, "Ready");
  await Promise.all([refreshDevices(), refreshPolicy()]);
  await ensureRealtime();
};

const initializeDevice = async () => {
  const deviceName = el.deviceNameInput.value.trim() || "sharepaste-windows";
  state.currentDevice = await bridge("bootstrap", { deviceName });
  renderHeader();
  await Promise.all([refreshDevices(), refreshPolicy()]);
  await ensureRealtime();
};

const recoverGroup = async () => {
  const phrase = el.recoveryPhraseInput.value.trim();
  const deviceName = el.deviceNameInput.value.trim() || "sharepaste-windows";
  if (!phrase) {
    addActivity("warn", "Recovery phrase is required");
    return;
  }

  state.currentDevice = await bridge("recover", { phrase, deviceName });
  renderHeader();
  await Promise.all([refreshDevices(), refreshPolicy()]);
  await ensureRealtime();
};

const generateBindCode = async () => {
  const code = await bridge("createBindCode");
  state.bindCode = code;
  el.bindCodeValue.textContent = code.code ?? "------";
  addActivity("info", "Generated bind code", `expires at ${code.expiresAtUnix}`);
};

const requestBind = async () => {
  const code = el.bindRequestInput.value.trim();
  if (!code) {
    addActivity("warn", "Bind code is required");
    return;
  }
  const result = await bridge("requestBind", { code });
  addActivity("info", "Bind request sent", result.requestId);
};

const savePolicy = async () => {
  state.policy = await bridge("updatePolicy", {
    allowText: el.allowTextInput.checked,
    allowImage: el.allowImageInput.checked,
    allowFile: el.allowFileInput.checked,
    maxFileSizeBytes: Number(el.maxFileSizeInput.value)
  });
  renderPolicy();
  addActivity("info", "Policy updated");
};

const sendText = async () => {
  const value = el.manualTextInput.value;
  if (!value.trim()) {
    addActivity("warn", "Text payload is empty");
    return;
  }
  const result = await bridge("sendText", { value });
  addActivity(result.accepted ? "info" : "warn", result.accepted ? "Text sent" : "Text blocked by policy");
};

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.dataset.removeDevice) {
    await bridge("removeDevice", { targetDeviceId: target.dataset.removeDevice });
    addActivity("warn", "Removed device", target.dataset.removeDevice);
    await refreshDevices();
    return;
  }

  if (target.dataset.confirmPair) {
    await bridge("confirmBind", { requestId: target.dataset.confirmPair, approve: true });
    state.pairingRequests = state.pairingRequests.filter((request) => request.requestId !== target.dataset.confirmPair);
    renderPairingRequests();
    addActivity("info", "Approved pairing request", target.dataset.confirmPair);
    return;
  }

  if (target.dataset.rejectPair) {
    await bridge("confirmBind", { requestId: target.dataset.rejectPair, approve: false });
    state.pairingRequests = state.pairingRequests.filter((request) => request.requestId !== target.dataset.rejectPair);
    renderPairingRequests();
    addActivity("warn", "Rejected pairing request", target.dataset.rejectPair);
  }
});

document.getElementById("initializeButton").addEventListener("click", () => void initializeDevice());
document.getElementById("recoverButton").addEventListener("click", () => void recoverGroup());
document.getElementById("inspectStateButton").addEventListener("click", () => void loadExistingState());
document.getElementById("generateBindCodeButton").addEventListener("click", () => void generateBindCode());
document.getElementById("requestBindButton").addEventListener("click", () => void requestBind());
document.getElementById("refreshDevicesButton").addEventListener("click", () => void refreshDevices());
document.getElementById("refreshPolicyButton").addEventListener("click", () => void refreshPolicy());
document.getElementById("savePolicyButton").addEventListener("click", () => void savePolicy());
document.getElementById("sendTextButton").addEventListener("click", () => void sendText());
document.getElementById("startSyncButton").addEventListener("click", () => void ensureRealtime());
document.getElementById("stopSyncButton").addEventListener("click", () => void stopRealtime());
document.getElementById("hideWindowButton").addEventListener("click", () => void invoke("hide_main_window"));
document.getElementById("clearActivityButton").addEventListener("click", () => {
  state.activity = [];
  renderActivity();
});

window.addEventListener("beforeunload", () => {
  stopClipboardPolling();
});

(async () => {
  renderActivity();
  renderDevices();
  renderPairingRequests();
  renderHeader();
  setConnectionState(false, "Starting");
  await listen("bridge:event", (event) => {
    void handleBridgeEvent(event);
  });
  await loadExistingState();
})();
