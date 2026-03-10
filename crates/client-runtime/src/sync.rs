use std::collections::{HashSet, VecDeque};

use rand::{Rng, distr::Alphanumeric, rng};
use sha2::{Digest, Sha256};

use crate::{
    policy::is_allowed_by_policy,
    types::{ClipboardPayload, SharePolicy},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SyncDecision {
    pub accepted: bool,
    pub reason: Option<&'static str>,
}

impl SyncDecision {
    pub const fn accepted() -> Self {
        Self {
            accepted: true,
            reason: None,
        }
    }

    pub const fn rejected(reason: &'static str) -> Self {
        Self {
            accepted: false,
            reason: Some(reason),
        }
    }
}

#[derive(Debug)]
pub struct SyncEngine {
    local_device_id: String,
    recently_seen: HashSet<String>,
    seen_order: VecDeque<String>,
}

impl SyncEngine {
    pub fn new(local_device_id: impl Into<String>) -> Self {
        Self {
            local_device_id: local_device_id.into(),
            recently_seen: HashSet::new(),
            seen_order: VecDeque::new(),
        }
    }

    pub fn make_item_id(&self, content: &[u8], created_at_unix: u64) -> String {
        let mut digest = Sha256::new();
        digest.update(content);
        digest.update(created_at_unix.to_string().as_bytes());
        let digest = digest.finalize();
        let random_suffix: String = rng()
            .sample_iter(&Alphanumeric)
            .take(6)
            .map(char::from)
            .collect();

        format!("item_{}_{random_suffix}", hex_prefix(&digest, 16))
    }

    pub fn should_send(&mut self, payload: &ClipboardPayload, policy: &SharePolicy) -> SyncDecision {
        if !is_allowed_by_policy(policy, payload) {
            return SyncDecision::rejected("blocked_by_policy");
        }

        if self.recently_seen.contains(&payload.item_id) {
            return SyncDecision::rejected("duplicate_item");
        }

        self.mark_seen(&payload.item_id);
        SyncDecision::accepted()
    }

    pub fn should_apply_incoming(&mut self, payload: &ClipboardPayload) -> SyncDecision {
        if payload.source_device_id == self.local_device_id {
            return SyncDecision::rejected("loopback");
        }

        if self.recently_seen.contains(&payload.item_id) {
            return SyncDecision::rejected("duplicate_item");
        }

        self.mark_seen(&payload.item_id);
        SyncDecision::accepted()
    }

    fn mark_seen(&mut self, item_id: &str) {
        self.recently_seen.insert(item_id.to_owned());
        self.seen_order.push_back(item_id.to_owned());

        while self.recently_seen.len() > 1000 {
            if let Some(first) = self.seen_order.pop_front() {
                self.recently_seen.remove(&first);
            }
        }
    }
}

fn hex_prefix(bytes: &[u8], hex_chars: usize) -> String {
    let mut output = String::with_capacity(hex_chars);
    for byte in bytes {
        output.push(nibble_to_hex(byte >> 4));
        if output.len() == hex_chars {
            break;
        }
        output.push(nibble_to_hex(byte & 0x0f));
        if output.len() == hex_chars {
            break;
        }
    }
    output
}

const fn nibble_to_hex(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        10..=15 => (b'a' + (nibble - 10)) as char,
        _ => '0',
    }
}
