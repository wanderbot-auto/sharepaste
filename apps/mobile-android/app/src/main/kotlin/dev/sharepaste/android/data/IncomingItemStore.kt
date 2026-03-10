package dev.sharepaste.android.data

import android.content.Context
import androidx.core.content.FileProvider
import dev.sharepaste.android.data.model.InboxItem
import dev.sharepaste.android.data.model.PayloadKind
import java.io.File

class IncomingItemStore(private val context: Context) {
    private val baseDir: File = File(context.filesDir, "received").apply { mkdirs() }

    fun materialize(
        itemId: String,
        kind: PayloadKind,
        mime: String,
        createdAtUnix: Long,
        sourceDeviceId: String,
        plaintext: ByteArray
    ): InboxItem {
        if (kind == PayloadKind.TEXT) {
            val preview = plaintext.toString(Charsets.UTF_8)
            return InboxItem(
                itemId = itemId,
                kind = kind,
                mime = mime,
                createdAtUnix = createdAtUnix,
                sourceDeviceId = sourceDeviceId,
                preview = preview
            )
        }

        val file = File(baseDir, "$createdAtUnix-$itemId${extensionForMime(mime, kind)}")
        file.writeBytes(plaintext)
        return InboxItem(
            itemId = itemId,
            kind = kind,
            mime = mime,
            createdAtUnix = createdAtUnix,
            sourceDeviceId = sourceDeviceId,
            filePath = file.absolutePath
        )
    }

    fun openUri(filePath: String) = FileProvider.getUriForFile(
        context,
        "${context.packageName}.files",
        File(filePath)
    )

    private fun extensionForMime(mime: String, kind: PayloadKind): String {
        return when (mime.lowercase()) {
            "image/png" -> ".png"
            "image/jpeg" -> ".jpg"
            "image/gif" -> ".gif"
            "image/webp" -> ".webp"
            "application/pdf" -> ".pdf"
            "text/plain" -> ".txt"
            else -> if (kind == PayloadKind.IMAGE) ".img" else ".bin"
        }
    }
}
