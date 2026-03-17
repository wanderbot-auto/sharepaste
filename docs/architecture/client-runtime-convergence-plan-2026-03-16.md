# Client Runtime Convergence Plan

Date: 2026-03-16

## Purpose

Define the convergence path for SharePaste client logic so iOS, Android, Windows, macOS, and Linux can share one platform-neutral core without forcing platform shells, UI, or OS integrations into a single implementation.

Companion tracking:

- parity matrix: `docs/architecture/client-runtime-parity-matrix-2026-03-17.md`
- execution checklist: `docs/checklists/2026-03-16-client-runtime-convergence.md`

## Decision

Use `crates/client-runtime` as the long-term shared client core.

Do not treat `packages/client-core` as the final multi-platform core. It remains the TypeScript reference implementation and migration bridge for the existing CLI and desktop runtime bridge.

## Current State

- `apps/client-cli` is the only runtime that directly imports `@sharepaste/client-core`.
- `apps/desktop-macos` and `apps/desktop-windows` reuse `@sharepaste/client` through a process bridge, not `@sharepaste/client-core` directly.
- `apps/mobile-android` maintains its own Kotlin implementations of models, sync rules, crypto, persistence, and transport.
- `crates/client-runtime` already covers `types`, `policy`, `history`, `sync`, and `crypto`, but does not yet own transport, persistence, or the higher-level client session flow.

## Architectural Boundary

The shared Rust core should own:

- canonical domain types for clipboard payloads and policies
- sync rules such as item-id generation, deduplication, and loopback suppression
- bounded history storage
- crypto, key generation, sealed group-key handling, recovery-phrase helpers
- client session state machine and pure business orchestration that does not depend on OS APIs

The platform adapters should own:

- gRPC transport implementation details
- local persistence implementation details
- clipboard, filesystem, LAN discovery, notifications, tray, share targets
- background execution and app lifecycle integration
- UI state and presentation concerns

## Non-Goals

- Do not force a shared Rust UI layer.
- Do not force all platform adapters to expose identical UX.
- Do not block current CLI/macOS/Windows/Android flows on a large rewrite.
- Do not migrate platform-bound services into Rust until stable adapter contracts exist.

## Target Shape

```text
apps/desktop-macos     \
apps/desktop-windows    \
apps/mobile-android      -> platform shell + adapters -> crates/client-runtime
apps/mobile-ios         /
apps/desktop-linux     /

apps/client-cli -> migration host / test harness -> crates/client-runtime
packages/client-core -> temporary TS compatibility layer during migration
packages/proto -> protocol source of truth
```

## Migration Principles

1. Move only platform-neutral logic into Rust.
2. Preserve working clients while introducing adapter seams.
3. Make Rust the behavioral source of truth before deleting TS/Kotlin duplicates.
4. Prefer parity tests and compatibility helpers before switching production call paths.
5. Keep platform state formats explicit while the migration is in progress.

## Phases

### Phase 0: Baseline and Contracts

- Record the convergence plan and track status in-repo.
- Correct outdated runtime documentation.
- Stabilize PEM/raw compatibility helpers needed by current clients and bridges.
- Add parity tests for Rust crypto behavior used by today's TS bridge and future native bindings.

Exit criteria:

- plan is documented
- current status is visible in repo docs
- Rust crypto API has explicit PEM-compatible entry points and tests

### Phase 1: Canonicalize Core Data and Rules

- Promote Rust `types`, `policy`, `history`, and `sync` as canonical behavior.
- Add a parity matrix covering TS `client-core`, Android Kotlin logic, and Rust runtime.
- Freeze item-id, dedup, policy, and history semantics behind tests.
- Mark duplicate TS/Kotlin implementations as transitional.

Exit criteria:

- parity tests exist for shared logic
- duplicated implementations are documented as migration shims

### Phase 2: Session and Group-Key Orchestration

- Add a platform-neutral client session model in Rust.
- Move pure registration/recovery/bind/group-key refresh state transitions into Rust.
- Define adapter contracts for transport, persistence, clipboard input/output, and incoming-item materialization.
- Use the Rust core from the CLI first as the migration host.

Exit criteria:

- high-level session flow runs through Rust inside `apps/client-cli`
- TS orchestration shrinks to adapter wiring

### Phase 3: Platform Binding Adoption

- Introduce stable bindings for desktop and mobile clients.
- Migrate Windows native shell away from Node business runtime when binding coverage is sufficient.
- Migrate macOS from CLI subprocess orchestration to direct Rust binding usage.
- Prototype Android binding integration and retire duplicated Kotlin sync/crypto logic.

Exit criteria:

- at least one desktop shell and one mobile shell use Rust core directly
- duplicated platform business logic is reduced

### Phase 4: Decommission Transitional Layers

- Reduce `packages/client-core` to a compatibility facade or remove it from the primary path.
- Remove redundant TS/Kotlin implementations once parity and rollout confidence are established.
- Keep only platform adapters and UI code outside the Rust core.

Exit criteria:

- one shared core owns business rules
- per-platform code only contains adapters and product-specific UX logic

## Execution Order

1. `crypto` compatibility and tests
2. `types/policy/history/sync` parity tracking
3. session-state orchestration in Rust
4. CLI integration onto Rust core
5. native binding rollout by platform

## Risks

- FFI and binding complexity may exceed the effort of the logic being shared.
- Android/iOS background behavior will still differ even after core convergence.
- State format mismatches can block migration unless compatibility layers are explicit.
- A mixed TS/Rust/Kotlin period is unavoidable and needs strong parity tests.

## Recommendation

Maintain one shared core logic set, but only at the platform-neutral layer.

This is recommended for SharePaste because encryption, sync semantics, and bind/recovery flows are correctness-sensitive and already duplicated across TypeScript, Kotlin, and Rust. The recommendation does not extend to platform adapters or UI layers.
