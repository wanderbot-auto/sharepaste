use crate::types::{ClipboardKind, ClipboardPayload, SharePolicy};

pub const DEFAULT_MAX_FILE_SIZE_BYTES: usize = 3 * 1024 * 1024;

pub fn default_policy() -> SharePolicy {
    SharePolicy {
        allow_text: true,
        allow_image: true,
        allow_file: true,
        max_file_size_bytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        version: 1,
    }
}

pub fn is_allowed_by_policy(policy: &SharePolicy, payload: &ClipboardPayload) -> bool {
    match payload.kind {
        ClipboardKind::Text => policy.allow_text,
        ClipboardKind::Image => policy.allow_image,
        ClipboardKind::File => policy.allow_file && payload.size_bytes < policy.max_file_size_bytes,
    }
}
