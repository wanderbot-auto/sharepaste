package dev.sharepaste.android.data

import dev.sharepaste.android.data.model.ClipboardPayload
import dev.sharepaste.android.data.model.PayloadKind
import dev.sharepaste.android.data.model.SharePolicyUi
import java.security.MessageDigest
import java.util.UUID

class SyncEngine(private val localDeviceId: () -> String) {
    private val recentlySeen = LinkedHashSet<String>()

    fun makeItemId(content: ByteArray, createdAtUnix: Long): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(content + createdAtUnix.toString().toByteArray())
            .joinToString("") { byte -> "%02x".format(byte) }
        return "item_${digest.take(16)}_${UUID.randomUUID().toString().take(6)}"
    }

    fun shouldSend(payload: ClipboardPayload, policy: SharePolicyUi): Boolean {
        if (!isAllowedByPolicy(policy, payload.kind, payload.sizeBytes)) {
            return false
        }
        if (recentlySeen.contains(payload.itemId)) {
            return false
        }
        markSeen(payload.itemId)
        return true
    }

    fun shouldApplyIncoming(payload: ClipboardPayload): Boolean {
        if (payload.sourceDeviceId == localDeviceId()) {
            return false
        }
        if (recentlySeen.contains(payload.itemId)) {
            return false
        }
        markSeen(payload.itemId)
        return true
    }

    private fun isAllowedByPolicy(policy: SharePolicyUi, kind: PayloadKind, sizeBytes: Long): Boolean {
        return when (kind) {
            PayloadKind.TEXT -> policy.allowText
            PayloadKind.IMAGE -> policy.allowImage
            PayloadKind.FILE -> policy.allowFile && sizeBytes < policy.maxFileSizeBytes
        }
    }

    private fun markSeen(itemId: String) {
        recentlySeen += itemId
        if (recentlySeen.size > 1000) {
            val first = recentlySeen.firstOrNull() ?: return
            recentlySeen.remove(first)
        }
    }
}
