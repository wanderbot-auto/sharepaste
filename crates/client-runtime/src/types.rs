#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClipboardKind {
    Text,
    Image,
    File,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClipboardPayload {
    pub item_id: String,
    pub kind: ClipboardKind,
    pub mime: String,
    pub size_bytes: usize,
    pub created_at_unix: u64,
    pub source_device_id: String,
    pub cipher_ref: String,
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SharePolicy {
    pub allow_text: bool,
    pub allow_image: bool,
    pub allow_file: bool,
    pub max_file_size_bytes: usize,
    pub version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceProfile {
    pub device_id: String,
    pub name: String,
    pub platform: String,
    pub group_id: String,
}
