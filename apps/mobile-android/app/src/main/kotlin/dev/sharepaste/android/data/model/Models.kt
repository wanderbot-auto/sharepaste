package dev.sharepaste.android.data.model

import kotlinx.serialization.Serializable

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED
}

@Serializable
enum class PayloadKind {
    TEXT,
    IMAGE,
    FILE
}

enum class MessageTone {
    SUCCESS,
    ERROR,
    INFO
}

@Serializable
data class DeviceIdentity(
    val wrapPublicKeyPem: String,
    val wrapPrivateKeyPem: String
)

@Serializable
data class PersistedSession(
    val server: String = "127.0.0.1:50052",
    val deviceId: String = "",
    val groupId: String = "",
    val deviceName: String = "android-phone",
    val platform: String = "android",
    val recoveryPhrase: String = "",
    val sealedGroupKey: String = "",
    val groupKeyBase64: String = "",
    val groupKeyVersion: Long = 0,
    val syncEnabled: Boolean = false,
    val identity: DeviceIdentity? = null
)

data class SharePolicyUi(
    val loaded: Boolean = false,
    val allowText: Boolean = true,
    val allowImage: Boolean = true,
    val allowFile: Boolean = true,
    val maxFileSizeBytes: Long = 3L * 1024 * 1024,
    val version: Long = 0
) {
    val maxFileSizeMb: Int
        get() = maxOf(1, ((maxFileSizeBytes + BYTES_PER_MB - 1) / BYTES_PER_MB).toInt())

    companion object {
        const val BYTES_PER_MB = 1024L * 1024L
    }
}

data class DeviceSummary(
    val deviceId: String,
    val name: String,
    val platform: String,
    val groupId: String
)

data class ClipboardPayload(
    val itemId: String,
    val kind: PayloadKind,
    val mime: String,
    val sizeBytes: Long,
    val createdAtUnix: Long,
    val sourceDeviceId: String,
    val cipherRef: String,
    val ciphertext: ByteArray,
    val nonce: ByteArray
)

data class CipherEnvelope(
    val nonce: ByteArray,
    val ciphertext: ByteArray
)

data class BindCodeState(
    val code: String,
    val expiresAtUnix: Long,
    val attemptsLeft: Int
) {
    fun secondsRemaining(nowUnix: Long): Int = maxOf(0, (expiresAtUnix - nowUnix).toInt())
}

data class PendingPairingRequest(
    val requestId: String,
    val requesterDeviceId: String = "",
    val requesterName: String = "",
    val requesterPlatform: String = "",
    val expiresAtUnix: Long = 0
)

@Serializable
data class InboxItem(
    val itemId: String,
    val kind: PayloadKind,
    val mime: String,
    val createdAtUnix: Long,
    val sourceDeviceId: String,
    val preview: String? = null,
    val filePath: String? = null
)

data class UserMessage(
    val title: String,
    val body: String,
    val tone: MessageTone
)

data class AppUiState(
    val server: String = "127.0.0.1:50052",
    val deviceName: String = "android-phone",
    val recoveryPhraseInput: String = "",
    val bindInputCode: String = "",
    val manualTextInput: String = "",
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val connectionTimeoutSeconds: Int = 5,
    val remainingSeconds: Int = 0,
    val syncRunning: Boolean = false,
    val busy: Boolean = false,
    val deviceId: String = "",
    val groupId: String = "",
    val recoveryPhrase: String = "",
    val devices: List<DeviceSummary> = emptyList(),
    val policy: SharePolicyUi = SharePolicyUi(),
    val bindCode: BindCodeState? = null,
    val pendingPairingRequest: PendingPairingRequest? = null,
    val pendingBindRequestId: String = "",
    val inbox: List<InboxItem> = emptyList(),
    val message: UserMessage? = null
) {
    val isBootstrapped: Boolean
        get() = deviceId.isNotBlank()
}
