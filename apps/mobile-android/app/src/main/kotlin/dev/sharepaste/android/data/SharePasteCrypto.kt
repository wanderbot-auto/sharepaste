package dev.sharepaste.android.data

import dev.sharepaste.android.data.model.CipherEnvelope
import dev.sharepaste.android.data.model.DeviceIdentity
import java.io.StringReader
import java.io.StringWriter
import java.security.KeyPairGenerator
import java.security.Security
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.random.Random
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.bouncycastle.asn1.pkcs.PrivateKeyInfo
import org.bouncycastle.asn1.x509.SubjectPublicKeyInfo
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.openssl.PEMParser
import org.bouncycastle.openssl.jcajce.JcaPEMKeyConverter
import org.bouncycastle.openssl.jcajce.JcaPEMWriter

class SharePasteCrypto {
    private val urlEncoder = Base64.getUrlEncoder().withoutPadding()
    private val urlDecoder = Base64.getUrlDecoder()
    private val json = Json { ignoreUnknownKeys = true }
    private val pemConverter = JcaPEMKeyConverter().setProvider(BouncyCastleProvider.PROVIDER_NAME)

    init {
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(BouncyCastleProvider())
        }
    }

    fun createIdentity(): DeviceIdentity {
        val generator = KeyPairGenerator.getInstance("X25519", BouncyCastleProvider.PROVIDER_NAME)
        val pair = generator.generateKeyPair()
        return DeviceIdentity(
            wrapPublicKeyPem = toPem(pair.public),
            wrapPrivateKeyPem = toPem(pair.private)
        )
    }

    fun encryptClipboard(groupKey: ByteArray, plaintext: ByteArray): CipherEnvelope {
        val nonce = Random.Default.nextBytes(12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(groupKey.copyOf(32), "AES"),
            GCMParameterSpec(128, nonce)
        )
        return CipherEnvelope(
            nonce = nonce,
            ciphertext = cipher.doFinal(plaintext)
        )
    }

    fun decryptClipboard(groupKey: ByteArray, envelope: CipherEnvelope): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(groupKey.copyOf(32), "AES"),
            GCMParameterSpec(128, envelope.nonce)
        )
        return cipher.doFinal(envelope.ciphertext)
    }

    fun extractGroupKey(sealedGroupKey: String, identity: DeviceIdentity): ByteArray {
        val decoded = String(urlDecoder.decode(sealedGroupKey), Charsets.UTF_8)
        val envelope = json.decodeFromString(SealedEnvelope.serializer(), decoded)
        envelope.groupKeyBase64?.let { return urlDecoder.decode(it) }

        val ephemeralPublic = parsePublicKeyPem(requireNotNull(envelope.epk) { "Missing epk" })
        val privateKey = parsePrivateKeyPem(identity.wrapPrivateKeyPem)
        val agreement = KeyAgreement.getInstance("X25519", BouncyCastleProvider.PROVIDER_NAME)
        agreement.init(privateKey)
        agreement.doPhase(ephemeralPublic, true)
        val sharedSecret = agreement.generateSecret()

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(sharedSecret.copyOf(32), "AES"),
            GCMParameterSpec(128, urlDecoder.decode(requireNotNull(envelope.nonce) { "Missing nonce" }))
        )
        return cipher.doFinal(urlDecoder.decode(requireNotNull(envelope.ciphertext) { "Missing ciphertext" }))
    }

    fun encodeBase64Url(bytes: ByteArray): String = urlEncoder.encodeToString(bytes)

    fun decodeBase64Url(value: String): ByteArray = urlDecoder.decode(value)

    private fun parsePublicKeyPem(pem: String) =
        PEMParser(StringReader(pem)).use { parser ->
            val parsed = parser.readObject()
            when (parsed) {
                is SubjectPublicKeyInfo -> pemConverter.getPublicKey(parsed)
                else -> error("Unsupported public key PEM")
            }
        }

    private fun parsePrivateKeyPem(pem: String) =
        PEMParser(StringReader(pem)).use { parser ->
            val parsed = parser.readObject()
            when (parsed) {
                is PrivateKeyInfo -> pemConverter.getPrivateKey(parsed)
                else -> error("Unsupported private key PEM")
            }
        }

    private fun toPem(key: Any): String {
        val writer = StringWriter()
        JcaPEMWriter(writer).use { pem ->
            pem.writeObject(key)
        }
        return writer.toString()
    }

    @Serializable
    private data class SealedEnvelope(
        val groupId: String? = null,
        val version: Long? = null,
        val epk: String? = null,
        val nonce: String? = null,
        val ciphertext: String? = null,
        @SerialName("groupKeyBase64")
        val groupKeyBase64: String? = null
    )
}
