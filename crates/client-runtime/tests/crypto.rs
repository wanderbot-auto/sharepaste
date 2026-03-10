use sharepaste_client_runtime::CryptoRuntime;

#[test]
fn encrypts_and_decrypts_payload_with_group_key() {
    let crypto = CryptoRuntime::new();
    let key = crypto.generate_group_key();
    let plaintext = b"hello";

    let encrypted = crypto
        .encrypt_clipboard(&key, plaintext)
        .expect("encryption should succeed");
    let decrypted = crypto
        .decrypt_clipboard(&key, &encrypted)
        .expect("decryption should succeed");

    assert_eq!(decrypted, plaintext);
}

#[test]
fn seals_and_unseals_group_key_for_target_device() {
    let crypto = CryptoRuntime::new();
    let identity = crypto.create_identity();
    let key = crypto.generate_group_key();

    let sealed = crypto
        .seal_group_key_for_device(&key, &identity.wrap_public_key)
        .expect("sealing should succeed");
    let unsealed = crypto
        .unseal_group_key_for_device(&sealed, &identity.wrap_private_key)
        .expect("unsealing should succeed");

    assert_eq!(unsealed, key);
}

#[test]
fn hashes_recovery_phrases_deterministically() {
    let crypto = CryptoRuntime::new();

    assert_eq!(
        crypto.hash_recovery_phrase("sharepaste"),
        crypto.hash_recovery_phrase("sharepaste")
    );
    assert_ne!(
        crypto.hash_recovery_phrase("sharepaste"),
        crypto.hash_recovery_phrase("sharepaste-2")
    );
}

#[test]
fn rejects_invalid_group_key_length() {
    let crypto = CryptoRuntime::new();
    let result = crypto.encrypt_clipboard(
        &[1, 2, 3],
        b"hello",
    );

    assert!(result.is_err());
}

#[test]
fn rejects_tampered_ciphertext() {
    let crypto = CryptoRuntime::new();
    let key = crypto.generate_group_key();
    let plaintext = b"hello";
    let mut encrypted = crypto
        .encrypt_clipboard(&key, plaintext)
        .expect("encryption should succeed");

    encrypted.ciphertext[0] ^= 0x01;

    let result = crypto.decrypt_clipboard(&key, &encrypted);
    assert!(result.is_err());
}

#[test]
fn recovery_phrase_is_hex_encoded() {
    let crypto = CryptoRuntime::new();
    let phrase = crypto.generate_recovery_phrase();

    assert_eq!(phrase.len(), 32);
    assert!(phrase.chars().all(|ch| ch.is_ascii_hexdigit()));
}
