# client-runtime

Rust shared runtime for SharePaste.

Current scope:

- canonical domain types for clipboard sync
- policy evaluation
- bounded history storage
- sync deduplication and item-id generation
- symmetric encryption and X25519-based group-key sealing

Not migrated yet:

- gRPC transport
- local persistence
- clipboard/filesystem/LAN adapters
- compatibility bridge to the current PEM/SPKI/PKCS8 TypeScript key format

Role in the architecture:

- `packages/client-core` remains the working TypeScript reference implementation used by today's CLI.
- `crates/client-runtime` is the long-term source of truth for platform-neutral runtime behavior.
- future macOS/Windows/Linux/Android bindings should consume this crate instead of re-implementing business logic in each shell.
- current Rust crypto APIs use raw base64url-encoded key material internally for portability; PEM compatibility belongs in a dedicated bridge layer.
