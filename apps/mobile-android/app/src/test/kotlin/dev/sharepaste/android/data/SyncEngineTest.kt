package dev.sharepaste.android.data

import dev.sharepaste.android.data.model.ClipboardPayload
import dev.sharepaste.android.data.model.PayloadKind
import dev.sharepaste.android.data.model.SharePolicyUi
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncEngineTest {
    private val syncEngine = SyncEngine { "local-device" }

    @Test
    fun blocksLoopbackPayloads() {
        val payload = testPayload(sourceDeviceId = "local-device")
        assertFalse(syncEngine.shouldApplyIncoming(payload))
    }

    @Test
    fun blocksFileWhenPolicyDisallowsIt() {
        val policy = SharePolicyUi(
            loaded = true,
            allowText = true,
            allowImage = true,
            allowFile = false,
            maxFileSizeBytes = 1024,
            version = 1
        )

        assertFalse(syncEngine.shouldSend(testPayload(kind = PayloadKind.FILE), policy))
    }

    @Test
    fun acceptsFreshTextPayload() {
        val policy = SharePolicyUi(loaded = true)
        assertTrue(syncEngine.shouldSend(testPayload(), policy))
    }

    private fun testPayload(
        kind: PayloadKind = PayloadKind.TEXT,
        sourceDeviceId: String = "peer-device"
    ) = ClipboardPayload(
        itemId = "item-test",
        kind = kind,
        mime = if (kind == PayloadKind.TEXT) "text/plain" else "application/octet-stream",
        sizeBytes = 16,
        createdAtUnix = 1,
        sourceDeviceId = sourceDeviceId,
        cipherRef = "inline://item-test",
        ciphertext = byteArrayOf(1, 2, 3),
        nonce = byteArrayOf(4, 5, 6)
    )
}
