# client-core

Shared client runtime package for platform-agnostic modules.

Current role: transitional TypeScript reference implementation during convergence onto `crates/client-runtime`.

Current contents:

- `src/types.ts`
- `src/core/crypto-agent.ts`
- `src/core/history-store.ts`
- `src/core/policy-engine.ts`
- `src/core/sync-engine.ts`

Still owned by `apps/client-cli` for now:

- gRPC transport client
- persisted state file implementation
- clipboard watcher and LAN discovery adapters
- CLI entrypoint and Node-oriented orchestration

Planned next extraction steps:

- persistence contracts
- transport abstraction over gRPC
- platform adapter interfaces for clipboard, filesystem, and discovery

Tracking:

- convergence plan: `docs/architecture/client-runtime-convergence-plan-2026-03-16.md`
- parity matrix: `docs/architecture/client-runtime-parity-matrix-2026-03-17.md`
