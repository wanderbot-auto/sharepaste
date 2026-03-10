# client-core

Shared client runtime package for platform-agnostic modules.

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
