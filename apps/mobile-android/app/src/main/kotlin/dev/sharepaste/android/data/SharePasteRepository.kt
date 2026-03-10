package dev.sharepaste.android.data

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.ContextCompat
import dev.sharepaste.android.data.model.AppUiState
import dev.sharepaste.android.data.model.BindCodeState
import dev.sharepaste.android.data.model.CipherEnvelope
import dev.sharepaste.android.data.model.ClipboardPayload
import dev.sharepaste.android.data.model.ConnectionState
import dev.sharepaste.android.data.model.InboxItem
import dev.sharepaste.android.data.model.MessageTone
import dev.sharepaste.android.data.model.PayloadKind
import dev.sharepaste.android.data.model.PendingPairingRequest
import dev.sharepaste.android.data.model.PersistedSession
import dev.sharepaste.android.data.model.SharePolicyUi
import dev.sharepaste.android.data.model.UserMessage
import dev.sharepaste.android.sync.SyncForegroundService
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class SharePasteRepository(
    private val appContext: Context,
    private val sessionStore: SessionStore,
    private val transport: SharePasteTransport,
    private val crypto: SharePasteCrypto,
    private val incomingItemStore: IncomingItemStore,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
) {
    private val appScope = CoroutineScope(SupervisorJob() + ioDispatcher)
    private val syncMutex = Mutex()
    private val clipboardManager = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    private val syncEngine = SyncEngine { currentSession?.deviceId.orEmpty() }
    private val _uiState = MutableStateFlow(AppUiState())
    private val currentConnection = AtomicReference<RealtimeConnection?>(null)

    private var currentSession: PersistedSession? = null
    private var syncJob: Job? = null
    private var ignoreNextClipboardText: String? = null

    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    init {
        appScope.launch {
            sessionStore.sessionFlow.collectLatest { session ->
                currentSession = session
                val state = _uiState.value
                if (session == null) {
                    _uiState.value = state.copy(
                        server = state.server,
                        deviceName = state.deviceName,
                        deviceId = "",
                        groupId = "",
                        recoveryPhrase = "",
                        syncRunning = false
                    )
                } else {
                    _uiState.value = state.copy(
                        server = session.server,
                        deviceName = session.deviceName,
                        deviceId = session.deviceId,
                        groupId = session.groupId,
                        recoveryPhrase = session.recoveryPhrase,
                        syncRunning = session.syncEnabled
                    )
                }
            }
        }
        appScope.launch {
            while (true) {
                tickClocks()
                delay(1000)
            }
        }
    }

    suspend fun bootstrap() {
        currentSession = sessionStore.load()
        currentSession?.let { session ->
            _uiState.value = _uiState.value.copy(
                server = session.server,
                deviceName = session.deviceName,
                deviceId = session.deviceId,
                groupId = session.groupId,
                recoveryPhrase = session.recoveryPhrase,
                syncRunning = session.syncEnabled
            )
            if (session.syncEnabled) {
                SyncForegroundService.start(appContext)
            }
        }
    }

    fun updateServer(server: String) {
        _uiState.value = _uiState.value.copy(server = server)
        persistUiConfig()
    }

    fun applyLaunchServerOverride(server: String) {
        if (server.isBlank()) {
            return
        }
        _uiState.value = _uiState.value.copy(server = server)
        currentSession?.let { session ->
            appScope.launch {
                saveSession(session.copy(server = server))
            }
        }
    }

    fun updateDeviceName(name: String) {
        _uiState.value = _uiState.value.copy(deviceName = name)
        persistUiConfig()
    }

    fun updateRecoveryPhraseInput(phrase: String) {
        _uiState.value = _uiState.value.copy(recoveryPhraseInput = phrase)
    }

    fun updateBindInput(code: String) {
        _uiState.value = _uiState.value.copy(bindInputCode = code)
    }

    fun updateManualTextInput(value: String) {
        _uiState.value = _uiState.value.copy(manualTextInput = value)
    }

    fun setPolicyAllowText(value: Boolean) {
        _uiState.value = _uiState.value.copy(policy = _uiState.value.policy.copy(allowText = value, loaded = true))
    }

    fun setPolicyAllowImage(value: Boolean) {
        _uiState.value = _uiState.value.copy(policy = _uiState.value.policy.copy(allowImage = value, loaded = true))
    }

    fun setPolicyAllowFile(value: Boolean) {
        _uiState.value = _uiState.value.copy(policy = _uiState.value.policy.copy(allowFile = value, loaded = true))
    }

    fun setPolicyMaxFileSizeMb(value: Int) {
        val bytes = value.coerceAtLeast(1) * SharePolicyUi.BYTES_PER_MB
        _uiState.value = _uiState.value.copy(
            policy = _uiState.value.policy.copy(
                loaded = true,
                maxFileSizeBytes = bytes
            )
        )
    }

    fun clearMessage() {
        _uiState.value = _uiState.value.copy(message = null)
    }

    suspend fun initializeDevice() = runBusyAction {
        val state = _uiState.value
        require(state.deviceName.isNotBlank()) { "Device name is required" }
        val identity = crypto.createIdentity()
        val result = transport.registerDevice(
            server = state.server,
            deviceName = state.deviceName,
            platform = "android",
            pubkey = identity.wrapPublicKeyPem
        )
        val groupKey = crypto.extractGroupKey(result.sealedGroupKey, identity)
        val session = PersistedSession(
            server = state.server,
            deviceId = result.deviceId,
            groupId = result.groupId,
            deviceName = state.deviceName,
            platform = "android",
            recoveryPhrase = result.recoveryPhrase,
            sealedGroupKey = result.sealedGroupKey,
            groupKeyBase64 = crypto.encodeBase64Url(groupKey),
            groupKeyVersion = 1,
            syncEnabled = false,
            identity = identity
        )
        saveSession(session)
        showMessage("Initialized", "Device ${result.deviceId} is ready.", MessageTone.SUCCESS)
    }

    suspend fun recoverGroup() = runBusyAction {
        val state = _uiState.value
        require(state.recoveryPhraseInput.isNotBlank()) { "Recovery phrase is required" }
        require(state.deviceName.isNotBlank()) { "Device name is required" }
        val identity = crypto.createIdentity()
        val result = transport.recoverGroup(
            server = state.server,
            recoveryPhrase = state.recoveryPhraseInput,
            deviceName = state.deviceName,
            platform = "android",
            pubkey = identity.wrapPublicKeyPem
        )
        val groupKey = crypto.extractGroupKey(result.sealedGroupKey, identity)
        val session = PersistedSession(
            server = state.server,
            deviceId = result.deviceId,
            groupId = result.groupId,
            deviceName = state.deviceName,
            platform = "android",
            recoveryPhrase = state.recoveryPhraseInput,
            sealedGroupKey = result.sealedGroupKey,
            groupKeyBase64 = crypto.encodeBase64Url(groupKey),
            groupKeyVersion = 1,
            syncEnabled = false,
            identity = identity
        )
        saveSession(session)
        _uiState.value = _uiState.value.copy(recoveryPhraseInput = "")
        showMessage("Recovered", "Group ${result.groupId} restored on Android.", MessageTone.SUCCESS)
    }

    suspend fun loadDevices() = runBusyAction {
        val session = requireSession()
        val devices = transport.listDevices(session.server, session.deviceId)
        _uiState.value = _uiState.value.copy(devices = devices)
        showMessage("Devices", "Loaded ${devices.size} devices.", MessageTone.INFO)
    }

    suspend fun removeDevice(targetDeviceId: String) = runBusyAction {
        val session = requireSession()
        transport.removeDevice(session.server, session.deviceId, targetDeviceId)
        val devices = transport.listDevices(session.server, session.deviceId)
        _uiState.value = _uiState.value.copy(devices = devices)
        showMessage("Device Removed", "Removed $targetDeviceId from the group.", MessageTone.SUCCESS)
    }

    suspend fun loadPolicy() = runBusyAction {
        val session = requireSession()
        val policy = transport.getPolicy(session.server, session.deviceId)
        _uiState.value = _uiState.value.copy(policy = policy)
        showMessage("Policy Loaded", "Policy v${policy.version} is ready.", MessageTone.INFO)
    }

    suspend fun savePolicy(policy: SharePolicyUi) = runBusyAction {
        val session = requireSession()
        val next = transport.updatePolicy(session.server, session.deviceId, policy)
        _uiState.value = _uiState.value.copy(policy = next)
        showMessage("Policy Saved", "Policy updated to v${next.version}.", MessageTone.SUCCESS)
    }

    suspend fun generateBindCode() = runBusyAction {
        val session = requireSession()
        val code = transport.createBindCode(session.server, session.deviceId)
        _uiState.value = _uiState.value.copy(
            bindCode = BindCodeState(
                code = code.code,
                expiresAtUnix = code.expiresAtUnix,
                attemptsLeft = code.attemptsLeft
            )
        )
        showMessage("Bind Code", "Bind code ${code.code} generated.", MessageTone.SUCCESS)
    }

    suspend fun requestBind() = runBusyAction {
        val session = requireSession()
        val code = _uiState.value.bindInputCode.trim()
        require(code.isNotBlank()) { "Bind code is required" }
        val result = transport.requestBind(session.server, code, session.deviceId)
        _uiState.value = _uiState.value.copy(
            pendingBindRequestId = result.requestId,
            bindInputCode = ""
        )
        showMessage("Request Sent", "Bind request ${result.requestId} sent.", MessageTone.SUCCESS)
    }

    suspend fun confirmBind(requestId: String, approve: Boolean) = runBusyAction {
        val session = requireSession()
        val result = transport.confirmBind(session.server, requestId, session.deviceId, approve)
        if (approve && result.approved) {
            val updated = requireSession().copy(
                groupId = result.groupId,
                sealedGroupKey = result.sealedGroupKey,
                groupKeyVersion = result.groupKeyVersion,
                groupKeyBase64 = crypto.encodeBase64Url(
                    crypto.extractGroupKey(result.sealedGroupKey, requireNotNull(requireSession().identity))
                )
            )
            saveSession(updated)
        }
        _uiState.value = _uiState.value.copy(
            pendingPairingRequest = null,
            pendingBindRequestId = ""
        )
        showMessage(
            if (approve) "Request Approved" else "Request Rejected",
            if (approve) "Pairing request was approved." else "Pairing request was rejected.",
            MessageTone.SUCCESS
        )
    }

    suspend fun startSync() = runBusyAction {
        val session = requireSession()
        saveSession(session.copy(syncEnabled = true, server = _uiState.value.server, deviceName = _uiState.value.deviceName))
        SyncForegroundService.start(appContext)
        showMessage("Sync Starting", "Foreground sync service has started.", MessageTone.INFO)
    }

    suspend fun stopSync() = runBusyAction {
        val session = requireSession()
        saveSession(session.copy(syncEnabled = false))
        stopSyncLoop()
        SyncForegroundService.stop(appContext)
        _uiState.value = _uiState.value.copy(
            connectionState = ConnectionState.DISCONNECTED,
            remainingSeconds = 0,
            syncRunning = false
        )
        showMessage("Sync Stopped", "Realtime sync has stopped.", MessageTone.INFO)
    }

    suspend fun sendManualText() = runBusyAction {
        val text = _uiState.value.manualTextInput.trim()
        require(text.isNotBlank()) { "Manual text cannot be empty" }
        sendPlaintext(PayloadKind.TEXT, "text/plain", text.toByteArray())
        _uiState.value = _uiState.value.copy(manualTextInput = "")
        showMessage("Sent", "Text payload sent to the group.", MessageTone.SUCCESS)
    }

    suspend fun sendClipboardText() = runBusyAction {
        val clip = clipboardManager.primaryClip
        val text = clip?.getItemAt(0)?.coerceToText(appContext)?.toString()?.takeIf { it.isNotBlank() }
            ?: error("Clipboard is empty")
        sendPlaintext(PayloadKind.TEXT, "text/plain", text.toByteArray())
        showMessage("Clipboard Sent", "Current clipboard text was sent.", MessageTone.SUCCESS)
    }

    suspend fun sendSharedIntent(intent: Intent) = runBusyAction {
        when (intent.action) {
            Intent.ACTION_SEND -> handleActionSend(intent)
            else -> error("Unsupported share action")
        }
        showMessage("Shared", "Incoming shared payload sent to the group.", MessageTone.SUCCESS)
    }

    suspend fun sendUri(uri: Uri, explicitMime: String?) = runBusyAction {
        internalSendUri(uri, explicitMime)
        showMessage("Sent", "Selected file sent to the group.", MessageTone.SUCCESS)
    }

    suspend fun refreshStatus() = runBusyAction {
        val session = requireSession()
        refreshDeviceContext()
        _uiState.value = _uiState.value.copy(
            connectionState = if (session.syncEnabled) ConnectionState.CONNECTING else ConnectionState.DISCONNECTED,
            syncRunning = session.syncEnabled
        )
        showMessage("Status Refreshed", "Latest device context loaded from server.", MessageTone.INFO)
    }

    suspend fun openInboxItem(item: InboxItem) {
        if (item.kind == PayloadKind.TEXT) {
            val preview = item.preview ?: return
            ignoreNextClipboardText = preview
            clipboardManager.setPrimaryClip(ClipData.newPlainText("SharePaste", preview))
            showMessage("Copied", "Text copied back to clipboard.", MessageTone.INFO)
            return
        }

        val path = item.filePath ?: return
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(incomingItemStore.openUri(path), item.mime)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ContextCompat.startActivity(appContext, intent, null)
    }

    suspend fun onForegroundClipboardChanged() {
        val text = clipboardManager.primaryClip?.getItemAt(0)?.coerceToText(appContext)?.toString()?.trim().orEmpty()
        if (text.isBlank()) return
        if (ignoreNextClipboardText == text) {
            ignoreNextClipboardText = null
            return
        }

        val state = _uiState.value
        if (!state.syncRunning || !state.isBootstrapped) {
            return
        }

        runCatching {
            sendPlaintext(PayloadKind.TEXT, "text/plain", text.toByteArray())
        }
    }

    suspend fun runSyncLoop() {
        syncMutex.withLock {
            if (syncJob?.isActive == true) return
            syncJob = appScope.launch {
                while (currentSession?.syncEnabled == true) {
                    val session = requireNotNull(currentSession)
                    runCatching {
                        _uiState.value = _uiState.value.copy(
                            connectionState = ConnectionState.CONNECTING,
                            remainingSeconds = _uiState.value.connectionTimeoutSeconds,
                            syncRunning = true
                        )
                        refreshDeviceContext()
                        syncOffline()
                        val connection = transport.openEventStream(session.server, session.deviceId)
                        currentConnection.set(connection)
                        connection.messages.collectLatest { message ->
                            when {
                                message.hasConnected() -> {
                                    _uiState.value = _uiState.value.copy(
                                        connectionState = ConnectionState.CONNECTED,
                                        remainingSeconds = 0,
                                        syncRunning = true
                                    )
                                }

                                message.hasClipboard() -> {
                                    val payload = message.clipboard.item.let { item ->
                                        ClipboardPayload(
                                            itemId = item.itemId,
                                            kind = when (item.type) {
                                                sharepaste.v1.Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_IMAGE -> PayloadKind.IMAGE
                                                sharepaste.v1.Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_FILE -> PayloadKind.FILE
                                                else -> PayloadKind.TEXT
                                            },
                                            mime = item.mime,
                                            sizeBytes = item.sizeBytes,
                                            createdAtUnix = item.createdAtUnix,
                                            sourceDeviceId = item.sourceDeviceId,
                                            cipherRef = item.cipherRef,
                                            ciphertext = item.ciphertext.toByteArray(),
                                            nonce = item.nonce.toByteArray()
                                        )
                                    }
                                    applyIncoming(payload)
                                    connection.ack(payload.itemId)
                                }

                                message.hasPairingRequest() -> {
                                    _uiState.value = _uiState.value.copy(
                                        pendingPairingRequest = PendingPairingRequest(
                                            requestId = message.pairingRequest.requestId,
                                            requesterDeviceId = message.pairingRequest.requesterDeviceId,
                                            requesterName = message.pairingRequest.requesterName,
                                            requesterPlatform = message.pairingRequest.requesterPlatform,
                                            expiresAtUnix = message.pairingRequest.expiresAtUnix
                                        )
                                    )
                                }

                                message.hasGroupKeyUpdate() -> {
                                    val sessionNow = requireSession()
                                    val updated = sessionNow.copy(
                                        groupId = message.groupKeyUpdate.groupId,
                                        sealedGroupKey = message.groupKeyUpdate.sealedGroupKey,
                                        groupKeyVersion = message.groupKeyUpdate.groupKeyVersion,
                                        groupKeyBase64 = crypto.encodeBase64Url(
                                            crypto.extractGroupKey(
                                                message.groupKeyUpdate.sealedGroupKey,
                                                requireNotNull(sessionNow.identity)
                                            )
                                        )
                                    )
                                    saveSession(updated)
                                }
                            }
                        }
                    }.onFailure { error ->
                        _uiState.value = _uiState.value.copy(
                            connectionState = ConnectionState.DISCONNECTED,
                            remainingSeconds = _uiState.value.connectionTimeoutSeconds,
                            syncRunning = true,
                            message = UserMessage("Connection Failed", parseError(error), MessageTone.ERROR)
                        )
                    }

                    currentConnection.getAndSet(null)?.close()
                    if (currentSession?.syncEnabled == true) {
                        delay(2000)
                    }
                }
            }
        }
    }

    suspend fun stopSyncLoop() {
        currentConnection.getAndSet(null)?.close()
        syncJob?.cancel()
        syncJob = null
    }

    private suspend fun internalSendUri(uri: Uri, explicitMime: String?) {
        val resolver = appContext.contentResolver
        val mime = explicitMime ?: resolver.getType(uri) ?: "application/octet-stream"
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Unable to read selected file")
        val kind = if (mime.startsWith("image/")) PayloadKind.IMAGE else PayloadKind.FILE
        sendPlaintext(kind, mime, bytes)
    }

    private suspend fun handleActionSend(intent: Intent) {
        val type = intent.type ?: "text/plain"
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        if (!text.isNullOrBlank()) {
            sendPlaintext(PayloadKind.TEXT, "text/plain", text.toByteArray())
            return
        }

        val stream = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            ?: error("No shared stream found")
        internalSendUri(stream, type)
    }

    private suspend fun refreshDeviceContext() {
        val session = requireSession()
        val context = transport.getDeviceContext(session.server, session.deviceId)
        val updated = session.copy(
            groupId = context.groupId,
            deviceName = context.deviceName,
            platform = context.platform,
            sealedGroupKey = context.sealedGroupKey,
            groupKeyVersion = context.groupKeyVersion,
            groupKeyBase64 = crypto.encodeBase64Url(
                crypto.extractGroupKey(context.sealedGroupKey, requireNotNull(session.identity))
            )
        )
        saveSession(updated)
    }

    private suspend fun syncOffline() {
        val session = requireSession()
        val items = transport.fetchOffline(session.server, session.deviceId)
        items.forEach { item ->
            applyIncoming(item)
            transport.ackItem(session.server, session.deviceId, item.itemId)
        }
    }

    private suspend fun applyIncoming(payload: ClipboardPayload) {
        if (!syncEngine.shouldApplyIncoming(payload)) {
            return
        }

        val session = requireSession()
        val groupKey = crypto.decodeBase64Url(session.groupKeyBase64)
        val plaintext = crypto.decryptClipboard(groupKey, CipherEnvelope(payload.nonce, payload.ciphertext))
        val inboxItem = incomingItemStore.materialize(
            itemId = payload.itemId,
            kind = payload.kind,
            mime = payload.mime,
            createdAtUnix = payload.createdAtUnix,
            sourceDeviceId = payload.sourceDeviceId,
            plaintext = plaintext
        )
        if (payload.kind == PayloadKind.TEXT) {
            val text = plaintext.toString(Charsets.UTF_8)
            ignoreNextClipboardText = text
            clipboardManager.setPrimaryClip(ClipData.newPlainText("SharePaste", text))
        }
        _uiState.value = _uiState.value.copy(inbox = listOf(inboxItem) + _uiState.value.inbox.take(19))
    }

    private suspend fun sendPlaintext(kind: PayloadKind, mime: String, plaintext: ByteArray) {
        val session = requireSession()
        val policy = if (_uiState.value.policy.loaded) _uiState.value.policy else transport.getPolicy(session.server, session.deviceId)
        val createdAtUnix = System.currentTimeMillis() / 1000
        val itemId = syncEngine.makeItemId(plaintext, createdAtUnix)
        val encrypted = crypto.encryptClipboard(crypto.decodeBase64Url(session.groupKeyBase64), plaintext)
        val payload = ClipboardPayload(
            itemId = itemId,
            kind = kind,
            mime = mime,
            sizeBytes = plaintext.size.toLong(),
            createdAtUnix = createdAtUnix,
            sourceDeviceId = session.deviceId,
            cipherRef = "inline://$itemId",
            ciphertext = encrypted.ciphertext,
            nonce = encrypted.nonce
        )
        check(syncEngine.shouldSend(payload, policy)) { "Payload blocked by policy or dedupe window" }
        check(transport.pushClipboardItem(session.server, session.deviceId, payload)) { "Server rejected payload" }
    }

    private fun tickClocks() {
        val state = _uiState.value
        val nowUnix = System.currentTimeMillis() / 1000
        val bindCode = state.bindCode?.takeIf { it.secondsRemaining(nowUnix) > 0 }
        val remaining = when (state.connectionState) {
            ConnectionState.CONNECTING -> maxOf(0, state.remainingSeconds - 1)
            else -> 0
        }
        if (bindCode != state.bindCode || remaining != state.remainingSeconds) {
            _uiState.value = state.copy(bindCode = bindCode, remainingSeconds = remaining)
        }
    }

    private suspend fun runBusyAction(block: suspend () -> Unit) {
        _uiState.value = _uiState.value.copy(busy = true)
        runCatching { block() }
            .onFailure { error ->
                _uiState.value = _uiState.value.copy(message = UserMessage("Error", parseError(error), MessageTone.ERROR))
            }
        _uiState.value = _uiState.value.copy(busy = false)
    }

    private fun showMessage(title: String, body: String, tone: MessageTone) {
        _uiState.value = _uiState.value.copy(message = UserMessage(title, body, tone))
    }

    private fun parseError(error: Throwable): String {
        val message = error.message.orEmpty().lowercase()
        return when {
            "device not found" in message -> "Local device state is stale. Re-initialize or recover the group."
            "recovery phrase" in message -> "Recovery phrase was rejected by the server."
            "policy version conflict" in message -> "Policy was changed elsewhere. Reload and try again."
            "failed to connect" in message || "unavailable" in message -> "Unable to reach the server. Check address and service status."
            "payload blocked" in message -> "Current policy or dedupe window blocked this payload."
            else -> error.message ?: error.toString()
        }
    }

    private suspend fun saveSession(session: PersistedSession) {
        currentSession = session
        sessionStore.save(session)
        _uiState.value = _uiState.value.copy(
            server = session.server,
            deviceName = session.deviceName,
            deviceId = session.deviceId,
            groupId = session.groupId,
            recoveryPhrase = session.recoveryPhrase,
            syncRunning = session.syncEnabled
        )
    }

    private fun persistUiConfig() {
        val state = _uiState.value
        val session = currentSession ?: return
        appScope.launch {
            saveSession(session.copy(server = state.server, deviceName = state.deviceName))
        }
    }

    private fun requireSession(): PersistedSession =
        requireNotNull(currentSession?.takeIf { it.deviceId.isNotBlank() && it.identity != null }) {
            "Device is not initialized yet"
        }
}
