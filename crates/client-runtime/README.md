# client-runtime

Rust shared runtime for SharePaste.

Current scope:

- canonical domain types for clipboard sync
- policy evaluation
- bounded history storage
- sync deduplication and item-id generation

Not migrated yet:

- gRPC transport
- local persistence
- clipboard/filesystem/LAN adapters
- cryptographic envelope and key-sealing logic

Role in the architecture:

- `packages/client-core` remains the working TypeScript reference implementation used by today's CLI.
- `crates/client-runtime` is the long-term source of truth for platform-neutral runtime behavior.
- future macOS/Windows/Linux/Android bindings should consume this crate instead of re-implementing business logic in each shell.
