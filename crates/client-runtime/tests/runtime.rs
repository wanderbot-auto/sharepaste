use sharepaste_client_runtime::{
    ClipboardKind, ClipboardPayload, HistoryStore, SyncEngine, default_policy, is_allowed_by_policy,
};

fn payload(item_id: &str, kind: ClipboardKind, source_device_id: &str, size_bytes: usize) -> ClipboardPayload {
    ClipboardPayload {
        item_id: item_id.to_owned(),
        kind,
        mime: "text/plain".to_owned(),
        size_bytes,
        created_at_unix: 1,
        source_device_id: source_device_id.to_owned(),
        cipher_ref: "inline://".to_owned(),
        ciphertext: vec![1],
        nonce: vec![2],
    }
}

#[test]
fn keeps_history_bounded() {
    let mut history = HistoryStore::new(50);
    for i in 0..55 {
        let mut item = payload(&format!("id-{i}"), ClipboardKind::Text, "dev-1", 1);
        item.created_at_unix = i;
        history.push(item);
    }

    let list = history.list();
    assert_eq!(list.len(), 50);
    assert_eq!(list[0].item_id, "id-54");
    assert_eq!(list[49].item_id, "id-5");
}

#[test]
fn blocks_disallowed_file_sizes_by_policy() {
    let mut policy = default_policy();
    policy.max_file_size_bytes = 100;

    let allowed = payload("a", ClipboardKind::File, "dev", 99);
    let blocked = payload("b", ClipboardKind::File, "dev", 100);

    assert!(is_allowed_by_policy(&policy, &allowed));
    assert!(!is_allowed_by_policy(&policy, &blocked));
}

#[test]
fn suppresses_duplicate_and_loopback_events() {
    let mut engine = SyncEngine::new("dev-self");

    let incoming = payload("same", ClipboardKind::Text, "dev-other", 5);

    assert!(engine.should_apply_incoming(&incoming).accepted);
    assert_eq!(
        engine.should_apply_incoming(&incoming).reason,
        Some("duplicate_item")
    );

    let loopback = payload("new", ClipboardKind::Text, "dev-self", 5);
    assert_eq!(
        engine.should_apply_incoming(&loopback).reason,
        Some("loopback")
    );
}

#[test]
fn generates_item_ids_with_expected_prefix_shape() {
    let engine = SyncEngine::new("dev-self");
    let item_id = engine.make_item_id(&[1, 2, 3], 1_700_000_000);
    let parts: Vec<_> = item_id.split('_').collect();

    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0], "item");
    assert_eq!(parts[1].len(), 16);
    assert!(parts[1].chars().all(|ch| ch.is_ascii_hexdigit() && ch.is_ascii_lowercase() || ch.is_ascii_digit()));
    assert_eq!(parts[2].len(), 6);
}
