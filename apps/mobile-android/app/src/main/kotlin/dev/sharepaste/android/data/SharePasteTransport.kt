package dev.sharepaste.android.data

import dev.sharepaste.android.data.model.ClipboardPayload
import dev.sharepaste.android.data.model.DeviceSummary
import dev.sharepaste.android.data.model.PayloadKind
import dev.sharepaste.android.data.model.SharePolicyUi
import io.grpc.ManagedChannel
import io.grpc.okhttp.OkHttpChannelBuilder
import io.grpc.stub.StreamObserver
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import sharepaste.v1.DeviceServiceGrpc
import sharepaste.v1.PairingServiceGrpc
import sharepaste.v1.PolicyServiceGrpc
import sharepaste.v1.Sharepaste
import sharepaste.v1.SyncServiceGrpc

class SharePasteTransport {
    suspend fun registerDevice(
        server: String,
        deviceName: String,
        platform: String,
        pubkey: String
    ): RegisterDeviceResult = withChannel(server) { channel ->
        val response = DeviceServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .registerDevice(
                Sharepaste.RegisterDeviceRequest.newBuilder()
                    .setDeviceName(deviceName)
                    .setPlatform(platform)
                    .setPubkey(pubkey)
                    .build()
            )
        RegisterDeviceResult(
            deviceId = response.device.deviceId,
            groupId = response.groupId,
            deviceName = response.device.name,
            platform = response.device.platform,
            recoveryPhrase = response.recoveryPhrase,
            sealedGroupKey = response.sealedGroupKey
        )
    }

    suspend fun recoverGroup(
        server: String,
        recoveryPhrase: String,
        deviceName: String,
        platform: String,
        pubkey: String
    ): RegisterDeviceResult = withChannel(server) { channel ->
        val response = DeviceServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .recoverGroup(
                Sharepaste.RecoverGroupRequest.newBuilder()
                    .setRecoveryPhrase(recoveryPhrase)
                    .setDeviceName(deviceName)
                    .setPlatform(platform)
                    .setPubkey(pubkey)
                    .build()
            )
        RegisterDeviceResult(
            deviceId = response.device.deviceId,
            groupId = response.groupId,
            deviceName = response.device.name,
            platform = response.device.platform,
            recoveryPhrase = recoveryPhrase,
            sealedGroupKey = response.sealedGroupKey
        )
    }

    suspend fun getDeviceContext(server: String, deviceId: String): DeviceContextResult = withChannel(server) { channel ->
        val response = DeviceServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .getDeviceContext(
                Sharepaste.GetDeviceContextRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .build()
            )
        DeviceContextResult(
            deviceName = response.device.name,
            platform = response.device.platform,
            groupId = response.groupId,
            sealedGroupKey = response.sealedGroupKey,
            groupKeyVersion = response.groupKeyVersion
        )
    }

    suspend fun listDevices(server: String, deviceId: String): List<DeviceSummary> = withChannel(server) { channel ->
        val response = DeviceServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .listDevices(Sharepaste.ListDevicesRequest.newBuilder().setDeviceId(deviceId).build())
        response.devicesList.map {
            DeviceSummary(
                deviceId = it.deviceId,
                name = it.name,
                platform = it.platform,
                groupId = it.groupId
            )
        }
    }

    suspend fun renameDevice(server: String, deviceId: String, newName: String): DeviceSummary = withChannel(server) { channel ->
        val device = DeviceServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .renameDevice(
                Sharepaste.RenameDeviceRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .setNewName(newName)
                    .build()
            )
            .device
        DeviceSummary(
            deviceId = device.deviceId,
            name = device.name,
            platform = device.platform,
            groupId = device.groupId
        )
    }

    suspend fun removeDevice(server: String, requestDeviceId: String, targetDeviceId: String): Boolean = withChannel(server) { channel ->
        DeviceServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .removeDevice(
                Sharepaste.RemoveDeviceRequest.newBuilder()
                    .setRequestDeviceId(requestDeviceId)
                    .setTargetDeviceId(targetDeviceId)
                    .build()
            )
            .removed
    }

    suspend fun getPolicy(server: String, deviceId: String): SharePolicyUi = withChannel(server) { channel ->
        val policy = PolicyServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .getPolicy(
                Sharepaste.GetPolicyRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .build()
            )
            .policy
        SharePolicyUi(
            loaded = true,
            allowText = policy.allowText,
            allowImage = policy.allowImage,
            allowFile = policy.allowFile,
            maxFileSizeBytes = policy.maxFileSizeBytes,
            version = policy.version
        )
    }

    suspend fun updatePolicy(server: String, deviceId: String, policy: SharePolicyUi): SharePolicyUi = withChannel(server) { channel ->
        val response = PolicyServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .updatePolicy(
                Sharepaste.UpdatePolicyRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .setExpectedVersion(policy.version)
                    .setAllowText(policy.allowText)
                    .setAllowImage(policy.allowImage)
                    .setAllowFile(policy.allowFile)
                    .setMaxFileSizeBytes(policy.maxFileSizeBytes)
                    .build()
            )
        SharePolicyUi(
            loaded = true,
            allowText = response.policy.allowText,
            allowImage = response.policy.allowImage,
            allowFile = response.policy.allowFile,
            maxFileSizeBytes = response.policy.maxFileSizeBytes,
            version = response.policy.version
        )
    }

    suspend fun createBindCode(server: String, deviceId: String): BindCodeResult = withChannel(server) { channel ->
        val response = PairingServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .createBindCode(
                Sharepaste.CreateBindCodeRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .build()
            )
        BindCodeResult(
            code = response.code,
            expiresAtUnix = response.expiresAtUnix,
            attemptsLeft = response.attemptsLeft
        )
    }

    suspend fun requestBind(server: String, code: String, requesterDeviceId: String): RequestBindResult = withChannel(server) { channel ->
        val response = PairingServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .requestBind(
                Sharepaste.RequestBindRequest.newBuilder()
                    .setCode(code)
                    .setRequesterDeviceId(requesterDeviceId)
                    .build()
            )
        RequestBindResult(
            requestId = response.requestId,
            expiresAtUnix = response.expiresAtUnix
        )
    }

    suspend fun confirmBind(server: String, requestId: String, issuerDeviceId: String, approve: Boolean): ConfirmBindResult =
        withChannel(server) { channel ->
            val response = PairingServiceGrpc.newBlockingStub(channel)
                .withDeadlineAfter(5, TimeUnit.SECONDS)
                .confirmBind(
                    Sharepaste.ConfirmBindRequest.newBuilder()
                        .setRequestId(requestId)
                        .setIssuerDeviceId(issuerDeviceId)
                        .setApprove(approve)
                        .build()
                )
            ConfirmBindResult(
                approved = response.approved,
                groupId = response.groupId,
                sealedGroupKey = response.sealedGroupKey,
                groupKeyVersion = response.groupKeyVersion
            )
        }

    suspend fun fetchOffline(server: String, deviceId: String, limit: Int = 100): List<ClipboardPayload> = withChannel(server) { channel ->
        val response = SyncServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .fetchOffline(
                Sharepaste.FetchOfflineRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .setLimit(limit)
                    .build()
            )
        response.itemsList.map(::toPayload)
    }

    suspend fun ackItem(server: String, deviceId: String, itemId: String) = withChannel(server) { channel ->
        SyncServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .ackItem(
                Sharepaste.AckItemRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .setItemId(itemId)
                    .build()
            )
    }

    suspend fun pushClipboardItem(server: String, deviceId: String, payload: ClipboardPayload): Boolean = withChannel(server) { channel ->
        SyncServiceGrpc.newBlockingStub(channel)
            .withDeadlineAfter(5, TimeUnit.SECONDS)
            .pushClipboardItem(
                Sharepaste.PushClipboardItemRequest.newBuilder()
                    .setDeviceId(deviceId)
                    .setItem(
                        Sharepaste.ClipboardItem.newBuilder()
                            .setItemId(payload.itemId)
                            .setType(kindToProto(payload.kind))
                            .setSizeBytes(payload.sizeBytes)
                            .setMime(payload.mime)
                            .setCipherRef(payload.cipherRef)
                            .setCiphertext(com.google.protobuf.ByteString.copyFrom(payload.ciphertext))
                            .setNonce(com.google.protobuf.ByteString.copyFrom(payload.nonce))
                            .setCreatedAtUnix(payload.createdAtUnix)
                            .setSourceDeviceId(payload.sourceDeviceId)
                            .build()
                    )
                    .build()
            )
            .accepted
    }

    suspend fun openEventStream(server: String, deviceId: String): RealtimeConnection {
        val channel = newChannel(server)
        val incoming = Channel<Sharepaste.EventStreamServerMessage>(Channel.BUFFERED)
        val completion = Channel<Throwable?>(1)
        val stub = SyncServiceGrpc.newStub(channel)

        lateinit var requestObserver: StreamObserver<Sharepaste.EventStreamClientMessage>
        requestObserver = stub.openEventStream(object : StreamObserver<Sharepaste.EventStreamServerMessage> {
            override fun onNext(value: Sharepaste.EventStreamServerMessage) {
                incoming.trySend(value)
            }

            override fun onError(t: Throwable) {
                completion.trySend(t)
                incoming.close(t)
            }

            override fun onCompleted() {
                completion.trySend(null)
                incoming.close()
            }
        })

        requestObserver.onNext(
            Sharepaste.EventStreamClientMessage.newBuilder()
                .setHello(
                    Sharepaste.EventStreamHello.newBuilder()
                        .setDeviceId(deviceId)
                        .build()
                )
                .build()
        )

        return RealtimeConnection(
            messages = incoming.receiveAsFlow(),
            close = {
                runCatching { requestObserver.onCompleted() }
                channel.shutdownNow()
            },
            ack = { itemId ->
                requestObserver.onNext(
                    Sharepaste.EventStreamClientMessage.newBuilder()
                        .setAck(
                            Sharepaste.EventStreamAck.newBuilder()
                                .setItemId(itemId)
                                .build()
                        )
                        .build()
                )
            }
        )
    }

    private suspend fun <T> withChannel(server: String, block: suspend (ManagedChannel) -> T): T {
        val channel = newChannel(server)
        return try {
            block(channel)
        } finally {
            channel.shutdownNow()
        }
    }

    private fun newChannel(server: String): ManagedChannel =
        OkHttpChannelBuilder.forTarget(server)
            .usePlaintext()
            .build()

    private fun kindToProto(kind: PayloadKind): Sharepaste.ClipboardItemType = when (kind) {
        PayloadKind.TEXT -> Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_TEXT
        PayloadKind.IMAGE -> Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_IMAGE
        PayloadKind.FILE -> Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_FILE
    }

    private fun kindFromProto(kind: Sharepaste.ClipboardItemType): PayloadKind = when (kind) {
        Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_IMAGE -> PayloadKind.IMAGE
        Sharepaste.ClipboardItemType.CLIPBOARD_ITEM_TYPE_FILE -> PayloadKind.FILE
        else -> PayloadKind.TEXT
    }

    private fun toPayload(item: Sharepaste.ClipboardItem): ClipboardPayload = ClipboardPayload(
        itemId = item.itemId,
        kind = kindFromProto(item.type),
        mime = item.mime,
        sizeBytes = item.sizeBytes,
        createdAtUnix = item.createdAtUnix,
        sourceDeviceId = item.sourceDeviceId,
        cipherRef = item.cipherRef,
        ciphertext = item.ciphertext.toByteArray(),
        nonce = item.nonce.toByteArray()
    )
}

data class RegisterDeviceResult(
    val deviceId: String,
    val groupId: String,
    val deviceName: String,
    val platform: String,
    val recoveryPhrase: String,
    val sealedGroupKey: String
)

data class DeviceContextResult(
    val deviceName: String,
    val platform: String,
    val groupId: String,
    val sealedGroupKey: String,
    val groupKeyVersion: Long
)

data class BindCodeResult(
    val code: String,
    val expiresAtUnix: Long,
    val attemptsLeft: Int
)

data class RequestBindResult(
    val requestId: String,
    val expiresAtUnix: Long
)

data class ConfirmBindResult(
    val approved: Boolean,
    val groupId: String,
    val sealedGroupKey: String,
    val groupKeyVersion: Long
)

data class RealtimeConnection(
    val messages: Flow<Sharepaste.EventStreamServerMessage>,
    val close: () -> Unit,
    val ack: (String) -> Unit
)
