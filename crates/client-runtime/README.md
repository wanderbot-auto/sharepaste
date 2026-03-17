# client-runtime

Rust shared runtime for SharePaste.

Current scope:

- canonical domain types for clipboard sync
- policy evaluation
- bounded history storage
- sync deduplication and item-id generation
- symmetric encryption and X25519-based group-key sealing
- PEM/raw key compatibility helpers for current TypeScript and native client formats

Not migrated yet:

- gRPC transport
- local persistence
- clipboard/filesystem/LAN adapters
- client session state machine and higher-level orchestration

Role in the architecture:

- `packages/client-core` remains the working TypeScript reference implementation used by today's CLI.
- `crates/client-runtime` is the long-term source of truth for platform-neutral runtime behavior.
- future macOS/Windows/Linux/Android bindings should consume this crate instead of re-implementing business logic in each shell.
- current Rust crypto APIs keep raw base64url key material as the canonical internal format while also exposing PEM-compatible helpers for current clients.

Execution tracking:

- convergence plan: `docs/architecture/client-runtime-convergence-plan-2026-03-16.md`
- status checklist: `docs/checklists/2026-03-16-client-runtime-convergence.md`
