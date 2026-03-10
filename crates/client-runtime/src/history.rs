use std::collections::VecDeque;

use crate::types::ClipboardPayload;

#[derive(Debug)]
pub struct HistoryStore {
    cap: usize,
    values: VecDeque<ClipboardPayload>,
}

impl HistoryStore {
    pub fn new(capacity: usize) -> Self {
        Self {
            cap: capacity,
            values: VecDeque::with_capacity(capacity),
        }
    }

    pub fn push(&mut self, item: ClipboardPayload) {
        self.values.push_front(item);
        if self.values.len() > self.cap {
            self.values.truncate(self.cap);
        }
    }

    pub fn list(&self) -> Vec<ClipboardPayload> {
        self.values.iter().cloned().collect()
    }
}

impl Default for HistoryStore {
    fn default() -> Self {
        Self::new(50)
    }
}
