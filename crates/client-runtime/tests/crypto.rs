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
fn converts_generated_identity_to_and_from_pem() {
    let crypto = CryptoRuntime::new();
    let identity = crypto.create_identity();

    let pem = crypto
        .identity_to_pem(&identity)
        .expect("identity should convert to pem");
    let decoded = crypto
        .identity_from_pem(&pem)
        .expect("pem should convert back to raw identity");

    assert_eq!(decoded, identity);
    assert!(pem.sign_public_key.starts_with("-----BEGIN PUBLIC KEY-----"));
    assert!(pem.sign_private_key.starts_with("-----BEGIN PRIVATE KEY-----"));
    assert!(pem.wrap_public_key.starts_with("-----BEGIN PUBLIC KEY-----"));
    assert!(pem.wrap_private_key.starts_with("-----BEGIN PRIVATE KEY-----"));
}

#[test]
fn decodes_known_node_compatible_pem_examples() {
    let crypto = CryptoRuntime::new();
    let wrap_public_pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VuAyEAFW8uopA4EX06VjRlldIrxyLJzNWC6BZ3mZLmKh+Dngo=\n-----END PUBLIC KEY-----\n";
    let wrap_private_pem = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VuBCIEILh3wBIhBGOlz677tp7PydBzLyKL21gjEpfeOnxeLoJK\n-----END PRIVATE KEY-----\n";
    let sign_public_pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA+xMhors7mzLj2mamDf0Sl/IN7hae/tPLDX57C3U5cwQ=\n-----END PUBLIC KEY-----\n";
    let sign_private_pem = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEINLJLuVHMaHt0J96VdOab7VOk6LEvhAPsG1V49HTnmB8\n-----END PRIVATE KEY-----\n";

    assert_eq!(
        crypto.wrap_public_key_from_pem(wrap_public_pem).expect("decode x25519 public pem"),
        "FW8uopA4EX06VjRlldIrxyLJzNWC6BZ3mZLmKh-Dngo"
    );
    assert_eq!(
        crypto.wrap_private_key_from_pem(wrap_private_pem).expect("decode x25519 private pem"),
        "uHfAEiEEY6XPrvu2ns_J0HMvIovbWCMSl946fF4ugko"
    );
    assert_eq!(
        crypto.sign_public_key_from_pem(sign_public_pem).expect("decode ed25519 public pem"),
        "-xMhors7mzLj2mamDf0Sl_IN7hae_tPLDX57C3U5cwQ"
    );
    assert_eq!(
        crypto.sign_private_key_from_pem(sign_private_pem).expect("decode ed25519 private pem"),
        "0sku5Ucxoe3Qn3pV05pvtU6TosS-EA-wbVXj0dOeYHw"
    );
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
