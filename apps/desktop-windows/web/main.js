const tauri = window.__TAURI__;

if (!tauri?.tauri || !tauri?.event) {
  document.body.innerHTML =
    "<main style='padding:24px;font-family:Segoe UI,sans-serif'>Tauri APIs are unavailable. Launch this UI through the SharePaste Windows shell.</main>";
  throw new Error("Tauri APIs unavailable");
}

const MB = 1024 * 1024;
const invoke = (command, payload = {}) => tauri.tauri.invoke(command, payload);
const listen = (event, handler) => tauri.event.listen(event, handler);

const state = {
  currentDevice: null,
  policy: null,
  devices: [],
  pairingRequests: [],
  bindCode: null,
  syncRunning: false,
  connectionActive: false,
  connectionLabel: "Starting",
  clipboardPollingTimer: null,
  lastClipboardFingerprint: null,
  suppressedClipboardFingerprint: null
};

const el = {
  connectionDot: document.getElementById("connectionDot"),
  connectionLabel: document.getElementById("connectionLabel"),
  heroStateBadge: document.getElementById("heroStateBadge"),
  deviceHeadline: document.getElementById("deviceHeadline"),
  deviceSubline: document.getElementById("deviceSubline"),
  syncToggleButton: document.getElementById("syncToggleButton"),
  syncToggleLabel: document.getElementById("syncToggleLabel"),
  generateBindCodeButton: document.getElementById("generateBindCodeButton"),
  bindCodeValue: document.getElementById("bindCodeValue"),
  codeShell: document.querySelector(".code-shell"),
  devicesMeta: document.getElementById("devicesMeta"),
  devicesList: document.getElementById("devicesList"),
  pairingRequestsInline: document.getElementById("pairingRequestsInline"),
  pairingRequestsList: document.getElementById("pairingRequestsList"),
  deviceNameInput: document.getElementById("deviceNameInput"),
  serverAddressInput: document.getElementById("serverAddressInput"),
  saveServerButton: document.getElementById("saveServerButton"),
  recoveryPhraseInput: document.getElementById("recoveryPhraseInput"),
  bindRequestInput: document.getElementById("bindRequestInput"),
  allowTextInput: document.getElementById("allowTextInput"),
  allowImageInput: document.getElementById("allowImageInput"),
  allowFileInput: document.getElementById("allowFileInput"),
  maxFileSizeInput: document.getElementById("maxFileSizeInput")
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const reportIssue = (message) => {
  console.error(message);
};

const bridge = async (method, params = {}) => {
  try {
    return await invoke("bridge_request", { method, params });
  } catch (error) {
    const message = error?.toString?.() ?? String(error);
    reportIssue(`Bridge request failed: ${method} | ${message}`);
    throw error;
  }
};

const renderStatus = () => {
  let badgeText = "Setup required";
  let badgeClass = "status-badge";
  let buttonText = "Start Sync";
  let buttonDisabled = !state.currentDevice;
  let subtitle = "Set up this PC to start syncing clipboard content.";

  if (state.currentDevice) {
    subtitle = `${state.currentDevice.platform} | ${state.currentDevice.deviceId}`;
    badgeText = "Ready";
    badgeClass = "status-badge ready";
  }

  if (state.currentDevice && state.syncRunning && state.connectionActive) {
    badgeText = "Live";
    badgeClass = "status-badge live";
    buttonText = "Pause Sync";
  } else if (state.currentDevice && state.connectionLabel === "Stopped") {
    badgeText = "Paused";
    badgeClass = "status-badge paused";
  }

  if (el.heroStateBadge) {
    el.heroStateBadge.className = badgeClass;
    el.heroStateBadge.textContent = badgeText;
  }

  if (el.deviceHeadline) {
    el.deviceHeadline.textContent = state.currentDevice?.deviceName || "SharePaste";
  }

  if (el.deviceSubline) {
    el.deviceSubline.textContent = subtitle;
  }

  if (el.syncToggleLabel) {
    el.syncToggleLabel.textContent = buttonText;
  }

  if (el.syncToggleButton) {
    el.syncToggleButton.disabled = buttonDisabled;
  }

  if (el.generateBindCodeButton) {
    el.generateBindCodeButton.disabled = buttonDisabled;
  }

  [el.allowTextInput, el.allowImageInput, el.allowFileInput, el.maxFileSizeInput].forEach((input) => {
    if (input) {
      input.disabled = !state.currentDevice;
    }
  });
};

const setConnectionState = (connected, label) => {
  state.connectionActive = connected;
  state.connectionLabel = label;

  if (el.connectionDot) {
    el.connectionDot.className = `status-dot ${connected ? "connected" : "disconnected"}`;
  }

  if (el.connectionLabel) {
    el.connectionLabel.textContent = label;
  }

  renderStatus();
};

const renderBindCode = () => {
  if (el.bindCodeValue) {
    el.bindCodeValue.textContent = state.bindCode?.code || "------";
  }

  if (el.codeShell) {
    el.codeShell.classList.toggle("has-code", Boolean(state.bindCode?.code));
  }
};
const renderDevices = () => {
  const count = state.devices.length;
  if (el.devicesMeta) {
    el.devicesMeta.textContent = String(count);
  }

  if (!count) {
    el.devicesList.innerHTML = '<div class="empty-state">No paired devices</div>';
    return;
  }

  el.devicesList.innerHTML = state.devices
    .map(
      (device) => `
        <article class="device-item ${state.currentDevice?.deviceId === device.deviceId ? "active" : ""}">
          <div>
            <div class="item-title">${escapeHtml(device.name)}</div>
            <div class="item-meta">${escapeHtml(device.platform)}</div>
          </div>
          <button class="list-action" type="button" data-remove-device="${escapeHtml(device.deviceId)}">Remove</button>
        </article>
      `
    )
    .join("");
};

const renderPairingRequests = () => {
  const count = state.pairingRequests.length;
  if (el.pairingRequestsInline) {
    el.pairingRequestsInline.hidden = count === 0;
  }

  if (!count) {
    el.pairingRequestsList.innerHTML = "";
    return;
  }

  el.pairingRequestsList.innerHTML = state.pairingRequests
    .map(
      (request) => `
        <article class="request-item">
          <div>
            <div class="item-title">${escapeHtml(request.requesterName)}</div>
            <div class="item-meta">${escapeHtml(request.requesterPlatform)}</div>
          </div>
          <div class="request-actions">
            <button class="request-action" type="button" data-confirm-pair="${escapeHtml(request.requestId)}">Accept</button>
            <button class="request-action secondary" type="button" data-reject-pair="${escapeHtml(request.requestId)}">Ignore</button>
          </div>
        </article>
      `
    )
    .join("");
};

const renderPolicy = () => {
  if (!state.policy) {
    return;
  }

  if (el.allowTextInput) el.allowTextInput.checked = Boolean(state.policy.allowText);
  if (el.allowImageInput) el.allowImageInput.checked = Boolean(state.policy.allowImage);
  if (el.allowFileInput) el.allowFileInput.checked = Boolean(state.policy.allowFile);
  if (el.maxFileSizeInput) {
    el.maxFileSizeInput.value = String(Math.max(1, Math.round(state.policy.maxFileSizeBytes / MB)));
  }
};

const refreshDevices = async () => {
  if (!state.currentDevice) {
    state.devices = [];
    renderDevices();
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
  startClipboardPolling();
};

const stopRealtime = async () => {
  if (!state.syncRunning) {
    return;
  }

  await bridge("stopRealtime");
  state.syncRunning = false;
  setConnectionState(false, "Stopped");
  stopClipboardPolling();
};

const toggleRealtime = async () => {
  if (!state.currentDevice) {
    return;
  }

  if (state.syncRunning) {
    await stopRealtime();
  } else {
    await ensureRealtime();
  }
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
      reportIssue(`Clipboard polling failed: ${error?.toString?.() ?? String(error)}`);
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
    if (payload.payload.level === "error") {
      reportIssue(payload.payload.detail || payload.payload.message || "Unknown runtime error");
    }
    return;
  }

  if (payload.event === "pairing_request") {
    state.pairingRequests.unshift(payload.payload);
    renderPairingRequests();
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
  state.currentDevice = existing || null;

  if (!existing) {
    state.devices = [];
    state.policy = null;
    state.syncRunning = false;
    renderDevices();
    renderPairingRequests();
    renderStatus();
    setConnectionState(false, "Setup Required");
    return;
  }

  renderStatus();
  setConnectionState(false, "Ready");
  await Promise.all([refreshDevices(), refreshPolicy()]);
  await ensureRealtime();
};

const initializeDevice = async () => {
  const deviceName = el.deviceNameInput.value.trim() || "sharepaste-windows";
  state.currentDevice = await bridge("bootstrap", { deviceName });
  renderStatus();
  await Promise.all([refreshDevices(), refreshPolicy()]);
  await ensureRealtime();
};

const recoverGroup = async () => {
  const phrase = el.recoveryPhraseInput.value.trim();
  const deviceName = el.deviceNameInput.value.trim() || "sharepaste-windows";
  if (!phrase) {
    return;
  }

  state.currentDevice = await bridge("recover", { phrase, deviceName });
  renderStatus();
  await Promise.all([refreshDevices(), refreshPolicy()]);
  await ensureRealtime();
};

const generateBindCode = async () => {
  state.bindCode = await bridge("createBindCode");
  renderBindCode();
};

const requestBind = async () => {
  const code = el.bindRequestInput.value.trim();
  if (!code) {
    return;
  }

  await bridge("requestBind", { code });
  el.bindRequestInput.value = "";
};

const savePolicy = async () => {
  if (!state.currentDevice) {
    return;
  }

  const maxFileSizeMB = Math.max(1, Number(el.maxFileSizeInput.value) || 1);
  state.policy = await bridge("updatePolicy", {
    allowText: el.allowTextInput.checked,
    allowImage: el.allowImageInput.checked,
    allowFile: el.allowFileInput.checked,
    maxFileSizeBytes: maxFileSizeMB * MB
  });
  renderPolicy();
};

const loadServerAddress = async () => {
  const server = await invoke("get_server_address");
  if (el.serverAddressInput) {
    el.serverAddressInput.value = server;
  }
};

const saveServerAddress = async () => {
  if (!el.serverAddressInput) {
    return;
  }

  const server = el.serverAddressInput.value.trim();
  if (!server) {
    return;
  }

  if (el.saveServerButton) {
    el.saveServerButton.disabled = true;
  }

  try {
    await invoke("set_server_address", { server });
    state.bindCode = null;
    state.syncRunning = false;
    stopClipboardPolling();
    renderBindCode();
    await loadExistingState();
  } finally {
    if (el.saveServerButton) {
      el.saveServerButton.disabled = false;
    }
  }
};

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const removeButton = target.closest("[data-remove-device]");
  if (removeButton instanceof HTMLElement) {
    await bridge("removeDevice", { targetDeviceId: removeButton.dataset.removeDevice });
    await refreshDevices();
    return;
  }

  const confirmButton = target.closest("[data-confirm-pair]");
  if (confirmButton instanceof HTMLElement) {
    await bridge("confirmBind", { requestId: confirmButton.dataset.confirmPair, approve: true });
    state.pairingRequests = state.pairingRequests.filter((request) => request.requestId !== confirmButton.dataset.confirmPair);
    renderPairingRequests();
    return;
  }

  const rejectButton = target.closest("[data-reject-pair]");
  if (rejectButton instanceof HTMLElement) {
    await bridge("confirmBind", { requestId: rejectButton.dataset.rejectPair, approve: false });
    state.pairingRequests = state.pairingRequests.filter((request) => request.requestId !== rejectButton.dataset.rejectPair);
    renderPairingRequests();
  }
});

document.getElementById("initializeButton")?.addEventListener("click", () => void initializeDevice());
document.getElementById("recoverButton")?.addEventListener("click", () => void recoverGroup());
document.getElementById("generateBindCodeButton")?.addEventListener("click", () => void generateBindCode());
document.getElementById("requestBindButton")?.addEventListener("click", () => void requestBind());
document.getElementById("saveServerButton")?.addEventListener("click", () => void saveServerAddress());
document.getElementById("hideWindowButton")?.addEventListener("click", () => void invoke("hide_main_window"));
document.getElementById("quitAppButton")?.addEventListener("click", () => void invoke("quit_app"));
document.getElementById("syncToggleButton")?.addEventListener("click", () => void toggleRealtime());

[el.allowTextInput, el.allowImageInput, el.allowFileInput, el.maxFileSizeInput].forEach((input) => {
  input?.addEventListener("change", () => void savePolicy());
});

window.addEventListener("beforeunload", () => {
  stopClipboardPolling();
});

(async () => {
  renderBindCode();
  renderDevices();
  renderPairingRequests();
  renderStatus();
  setConnectionState(false, "Starting");
  await loadServerAddress();
  await listen("bridge:event", (event) => {
    void handleBridgeEvent(event);
  });
  await loadExistingState();
})();
