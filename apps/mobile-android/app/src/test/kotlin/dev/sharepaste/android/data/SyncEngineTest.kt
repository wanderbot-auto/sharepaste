package dev.sharepaste.android.data

import dev.sharepaste.android.data.model.ClipboardPayload
import dev.sharepaste.android.data.model.PayloadKind
import dev.sharepaste.android.data.model.SharePolicyUi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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
    fun blocksFileAtConfiguredSizeBoundary() {
        val policy = SharePolicyUi(
            loaded = true,
            allowText = true,
            allowImage = true,
            allowFile = true,
            maxFileSizeBytes = 100,
            version = 1
        )

        assertTrue(syncEngine.shouldSend(testPayload(itemId = "item-allow", kind = PayloadKind.FILE, sizeBytes = 99), policy))
        assertFalse(syncEngine.shouldSend(testPayload(itemId = "item-block", kind = PayloadKind.FILE, sizeBytes = 100), policy))
    }

    @Test
    fun acceptsFreshTextPayload() {
        val policy = SharePolicyUi(loaded = true)
        assertTrue(syncEngine.shouldSend(testPayload(), policy))
    }

    @Test
    fun blocksDuplicateIncomingPayloads() {
        val payload = testPayload(itemId = "duplicate-item")

        assertTrue(syncEngine.shouldApplyIncoming(payload))
        assertFalse(syncEngine.shouldApplyIncoming(payload))
    }

    @Test
    fun generatesItemIdsWithExpectedPrefixShape() {
        val itemId = syncEngine.makeItemId(byteArrayOf(1, 2, 3), 1_700_000_000L)
        val parts = itemId.split("_")

        assertEquals(3, parts.size)
        assertEquals("item", parts[0])
        assertEquals(16, parts[1].length)
        assertTrue(parts[1].all { it in '0'..'9' || it in 'a'..'f' })
        assertEquals(6, parts[2].length)
        assertNotEquals(itemId, syncEngine.makeItemId(byteArrayOf(1, 2, 3), 1_700_000_000L))
    }

    private fun testPayload(
        itemId: String = "item-test",
        kind: PayloadKind = PayloadKind.TEXT,
        sourceDeviceId: String = "peer-device",
        sizeBytes: Long = 16
    ) = ClipboardPayload(
        itemId = itemId,
        kind = kind,
        mime = if (kind == PayloadKind.TEXT) "text/plain" else "application/octet-stream",
        sizeBytes = sizeBytes,
        createdAtUnix = 1,
        sourceDeviceId = sourceDeviceId,
        cipherRef = "inline://item-test",
        ciphertext = byteArrayOf(1, 2, 3),
        nonce = byteArrayOf(4, 5, 6)
    )
}
