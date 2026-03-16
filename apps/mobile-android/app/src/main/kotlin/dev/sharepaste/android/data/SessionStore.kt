package dev.sharepaste.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.preferencesDataStoreFile
import dev.sharepaste.android.data.model.PersistedSession
import java.io.IOException
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

class SessionStore(context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
    }
    private val sessionCipher = SessionCipher()

    private val dataStore = PreferenceDataStoreFactory.create(
        produceFile = { context.preferencesDataStoreFile("sharepaste_session.preferences_pb") }
    )

    val sessionFlow: Flow<PersistedSession?> = dataStore.data
        .catch { error ->
            if (error is IOException) {
                emit(emptyPreferences())
            } else {
                throw error
            }
        }
        .map { prefs ->
            prefs[SESSION_JSON]?.takeIf { it.isNotBlank() }?.let(::decodeSession)
        }

    suspend fun load(): PersistedSession? = sessionFlow.first()

    suspend fun save(session: PersistedSession) {
        dataStore.edit { prefs ->
            val encoded = json.encodeToString(PersistedSession.serializer(), session)
            prefs[SESSION_JSON] = sessionCipher.encrypt(encoded)
        }
    }

    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(SESSION_JSON)
        }
    }

    private fun decodeSession(raw: String): PersistedSession? {
        val decoded = runCatching {
            if (raw.trimStart().startsWith("{")) {
                raw
            } else {
                sessionCipher.decrypt(raw)
            }
        }.getOrNull() ?: return null

        return runCatching {
            json.decodeFromString<PersistedSession>(decoded)
        }.getOrNull()
    }

    private companion object {
        val SESSION_JSON = stringPreferencesKey("session_json")
    }
}

private class SessionCipher {
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val iv = requireNotNull(cipher.iv) { "Missing IV" }
        return "$VERSION:${encoder.encodeToString(iv)}:${encoder.encodeToString(ciphertext)}"
    }

    fun decrypt(encoded: String): String {
        val parts = encoded.split(':', limit = 3)
        require(parts.size == 3 && parts[0] == VERSION) { "Unsupported session encoding" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateKey(),
            GCMParameterSpec(TAG_LENGTH_BITS, decoder.decode(parts[1]))
        )
        return String(cipher.doFinal(decoder.decode(parts[2])), Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) {
            return existing
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private companion object {
        const val VERSION = "v1"
        const val KEY_ALIAS = "sharepaste.session"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val TAG_LENGTH_BITS = 128
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
