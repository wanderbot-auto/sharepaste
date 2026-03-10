package dev.sharepaste.android.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class SharePasteCryptoTest {
    private val crypto = SharePasteCrypto()

    @Test
    fun encryptsAndDecryptsClipboardPayload() {
        val groupKey = ByteArray(32) { (it + 1).toByte() }
        val plaintext = "sharepaste".toByteArray()

        val encrypted = crypto.encryptClipboard(groupKey, plaintext)
        val decrypted = crypto.decryptClipboard(groupKey, encrypted)

        assertArrayEquals(plaintext, decrypted)
    }

    @Test
    fun extractsLegacyInlineGroupKeyEnvelope() {
        val expected = ByteArray(32) { it.toByte() }
        val encodedKey = crypto.encodeBase64Url(expected)
        val sealed = crypto.encodeBase64Url("""{"groupKeyBase64":"$encodedKey"}""".toByteArray())

        val actual = crypto.extractGroupKey(sealed, crypto.createIdentity())

        assertArrayEquals(expected, actual)
        assertEquals(encodedKey, crypto.encodeBase64Url(actual))
    }
}
