use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::Rng;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{error::Error, fmt};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceIdentity {
    pub sign_public_key: String,
    pub sign_private_key: String,
    pub wrap_public_key: String,
    pub wrap_private_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CipherEnvelope {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug)]
pub enum CryptoError {
    InvalidKeyLength {
        field: &'static str,
        expected: usize,
        actual: usize,
    },
    Base64(base64::DecodeError),
    Json(serde_json::Error),
    Aead,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidKeyLength {
                field,
                expected,
                actual,
            } => {
                write!(
                    f,
                    "invalid key length for {field}: expected {expected}, got {actual}"
                )
            }
            Self::Base64(err) => write!(f, "base64 decode failed: {err}"),
            Self::Json(err) => write!(f, "json decode failed: {err}"),
            Self::Aead => write!(f, "authenticated encryption operation failed"),
        }
    }
}

impl Error for CryptoError {}

impl From<base64::DecodeError> for CryptoError {
    fn from(value: base64::DecodeError) -> Self {
        Self::Base64(value)
    }
}

impl From<serde_json::Error> for CryptoError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

#[derive(Default)]
pub struct CryptoRuntime;

#[derive(Serialize, Deserialize)]
struct SealedEnvelope {
    epk: String,
    nonce: String,
    ciphertext: String,
}

impl CryptoRuntime {
    pub fn new() -> Self {
        Self
    }

    pub fn create_identity(&self) -> DeviceIdentity {
        let sign_key = SigningKey::generate(&mut OsRng);
        let sign_public_key = VerifyingKey::from(&sign_key);
        let wrap_private_key = StaticSecret::random_from_rng(OsRng);
        let wrap_public_key = X25519PublicKey::from(&wrap_private_key);

        DeviceIdentity {
            sign_public_key: encode_base64url(sign_public_key.to_bytes()),
            sign_private_key: encode_base64url(sign_key.to_bytes()),
            wrap_public_key: encode_base64url(wrap_public_key.as_bytes()),
            wrap_private_key: encode_base64url(wrap_private_key.to_bytes()),
        }
    }

    pub fn generate_group_key(&self) -> Vec<u8> {
        random_bytes(32)
    }

    pub fn generate_recovery_phrase(&self) -> String {
        hex::encode(random_bytes(16))
    }

    pub fn hash_recovery_phrase(&self, phrase: &str) -> String {
        hex::encode(Sha256::digest(phrase.as_bytes()))
    }

    pub fn encrypt_clipboard(
        &self,
        group_key: &[u8],
        plaintext: &[u8],
    ) -> Result<CipherEnvelope, CryptoError> {
        let cipher = cipher_from_key(group_key, "group_key")?;
        let nonce = random_bytes(12);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext)
            .map_err(|_| CryptoError::Aead)?;

        Ok(CipherEnvelope { nonce, ciphertext })
    }

    pub fn decrypt_clipboard(
        &self,
        group_key: &[u8],
        envelope: &CipherEnvelope,
    ) -> Result<Vec<u8>, CryptoError> {
        let cipher = cipher_from_key(group_key, "group_key")?;
        cipher
            .decrypt(Nonce::from_slice(&envelope.nonce), envelope.ciphertext.as_ref())
            .map_err(|_| CryptoError::Aead)
    }

    pub fn seal_group_key_for_device(
        &self,
        group_key: &[u8],
        recipient_wrap_public_key: &str,
    ) -> Result<String, CryptoError> {
        let recipient_wrap_public_key =
            decode_fixed_base64url::<32>(recipient_wrap_public_key, "recipient_wrap_public_key")?;
        let recipient_wrap_public_key = X25519PublicKey::from(recipient_wrap_public_key);

        let ephemeral_secret = StaticSecret::random_from_rng(OsRng);
        let ephemeral_public = X25519PublicKey::from(&ephemeral_secret);
        let shared_secret = ephemeral_secret.diffie_hellman(&recipient_wrap_public_key);

        let cipher = cipher_from_key(shared_secret.as_bytes(), "shared_secret")?;
        let nonce = random_bytes(12);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), group_key)
            .map_err(|_| CryptoError::Aead)?;

        let sealed = SealedEnvelope {
            epk: encode_base64url(ephemeral_public.as_bytes()),
            nonce: encode_base64url(&nonce),
            ciphertext: encode_base64url(&ciphertext),
        };

        Ok(encode_base64url(serde_json::to_vec(&sealed)?))
    }

    pub fn unseal_group_key_for_device(
        &self,
        sealed: &str,
        recipient_wrap_private_key: &str,
    ) -> Result<Vec<u8>, CryptoError> {
        let recipient_wrap_private_key =
            decode_fixed_base64url::<32>(recipient_wrap_private_key, "recipient_wrap_private_key")?;
        let recipient_wrap_private_key = StaticSecret::from(recipient_wrap_private_key);

        let sealed = URL_SAFE_NO_PAD.decode(sealed)?;
        let sealed: SealedEnvelope = serde_json::from_slice(&sealed)?;
        let ephemeral_public = decode_fixed_base64url::<32>(&sealed.epk, "epk")?;
        let ephemeral_public = X25519PublicKey::from(ephemeral_public);
        let nonce = URL_SAFE_NO_PAD.decode(&sealed.nonce)?;
        let ciphertext = URL_SAFE_NO_PAD.decode(&sealed.ciphertext)?;

        let shared_secret = recipient_wrap_private_key.diffie_hellman(&ephemeral_public);
        let cipher = cipher_from_key(shared_secret.as_bytes(), "shared_secret")?;
        cipher
            .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
            .map_err(|_| CryptoError::Aead)
    }
}

fn cipher_from_key(key: &[u8], field: &'static str) -> Result<Aes256Gcm, CryptoError> {
    let key = to_fixed_32(key, field)?;
    Ok(Aes256Gcm::new_from_slice(&key).expect("32-byte AES-256 key"))
}

fn to_fixed_32(bytes: &[u8], field: &'static str) -> Result<[u8; 32], CryptoError> {
    bytes.try_into().map_err(|_| CryptoError::InvalidKeyLength {
        field,
        expected: 32,
        actual: bytes.len(),
    })
}

fn decode_fixed_base64url<const N: usize>(
    encoded: &str,
    field: &'static str,
) -> Result<[u8; N], CryptoError> {
    let decoded = URL_SAFE_NO_PAD.decode(encoded)?;
    let actual = decoded.len();
    decoded.try_into().map_err(|_| CryptoError::InvalidKeyLength {
        field,
        expected: N,
        actual,
    })
}

fn encode_base64url(bytes: impl AsRef<[u8]>) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; len];
    rand::rng().fill(bytes.as_mut_slice());
    bytes
}
