use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sharepaste_client_runtime::{CipherEnvelope, CryptoRuntime};
use std::io::{self, Read, Write};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    CreateIdentity,
    GenerateGroupKey,
    EncryptClipboard {
        group_key: String,
        plaintext: String,
    },
    DecryptClipboard {
        group_key: String,
        nonce: String,
        ciphertext: String,
    },
    SealGroupKeyForDevice {
        group_key: String,
        recipient_wrap_public_key_pem: String,
    },
    UnsealGroupKeyForDevice {
        sealed: String,
        recipient_wrap_private_key_pem: String,
    },
}

#[derive(Serialize)]
struct Response<T> {
    ok: bool,
    result: T,
}

#[derive(Serialize)]
struct ErrorResponse {
    ok: bool,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityResult {
    sign_public_key: String,
    sign_private_key: String,
    wrap_public_key: String,
    wrap_private_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeResult {
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BytesResult {
    bytes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SealedResult {
    sealed: String,
}

fn main() {
    if let Err(error) = run() {
        write_json(&ErrorResponse {
            ok: false,
            error: error.to_string(),
        });
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let request: Request = serde_json::from_str(&input)?;
    let crypto = CryptoRuntime::new();

    match request {
        Request::CreateIdentity => {
            let identity = crypto.create_identity_pem();
            write_json(&Response {
                ok: true,
                result: IdentityResult {
                    sign_public_key: identity.sign_public_key,
                    sign_private_key: identity.sign_private_key,
                    wrap_public_key: identity.wrap_public_key,
                    wrap_private_key: identity.wrap_private_key,
                },
            });
        }
        Request::GenerateGroupKey => {
            let group_key = crypto.generate_group_key();
            write_json(&Response {
                ok: true,
                result: BytesResult {
                    bytes: encode_base64url(&group_key),
                },
            });
        }
        Request::EncryptClipboard {
            group_key,
            plaintext,
        } => {
            let group_key = decode_base64url(&group_key)?;
            let plaintext = decode_base64url(&plaintext)?;
            let envelope = crypto.encrypt_clipboard(&group_key, &plaintext)?;
            write_json(&Response {
                ok: true,
                result: envelope_to_result(&envelope),
            });
        }
        Request::DecryptClipboard {
            group_key,
            nonce,
            ciphertext,
        } => {
            let group_key = decode_base64url(&group_key)?;
            let envelope = CipherEnvelope {
                nonce: decode_base64url(&nonce)?,
                ciphertext: decode_base64url(&ciphertext)?,
            };
            let plaintext = crypto.decrypt_clipboard(&group_key, &envelope)?;
            write_json(&Response {
                ok: true,
                result: BytesResult {
                    bytes: encode_base64url(&plaintext),
                },
            });
        }
        Request::SealGroupKeyForDevice {
            group_key,
            recipient_wrap_public_key_pem,
        } => {
            let group_key = decode_base64url(&group_key)?;
            let sealed = crypto.seal_group_key_for_device_pem(&group_key, &recipient_wrap_public_key_pem)?;
            write_json(&Response {
                ok: true,
                result: SealedResult { sealed },
            });
        }
        Request::UnsealGroupKeyForDevice {
            sealed,
            recipient_wrap_private_key_pem,
        } => {
            let plaintext = crypto.unseal_group_key_for_device_pem(&sealed, &recipient_wrap_private_key_pem)?;
            write_json(&Response {
                ok: true,
                result: BytesResult {
                    bytes: encode_base64url(&plaintext),
                },
            });
        }
    }

    Ok(())
}

fn envelope_to_result(envelope: &CipherEnvelope) -> EnvelopeResult {
    EnvelopeResult {
        nonce: encode_base64url(&envelope.nonce),
        ciphertext: encode_base64url(&envelope.ciphertext),
    }
}

fn write_json<T: Serialize>(value: &T) {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, value).expect("json response should serialize");
    stdout.write_all(b"\n").expect("stdout should be writable");
}

fn encode_base64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_base64url(value: &str) -> Result<Vec<u8>, base64::DecodeError> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(value)
}
